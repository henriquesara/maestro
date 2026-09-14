import { createHash } from 'node:crypto'
import { EVIDENCE_JOINER } from '../domain/settlement-incident'
import { computeLifecycleClosureDigest } from '../domain/dispatch-lifecycle-closure'
import { SHADOW_DELEGATED_BOUNDARY_CLOSED } from '../domain/dispatch-lifecycle-event'
import type { DispatchLifecycleIncidentKind } from '../domain/dispatch-lifecycle-incident'
import { computeFinalizationEligibilityDigest } from '../domain/worktree-finalization'
import { verifyRestartRecoveredIdentity } from '../domain/restart-recovered-identity-verification'
import type { ChildProcessHandle } from '../../../shared/child-process/process-spec'
import { processIdentitySidecarPath } from '../infrastructure/durable-shadow-lifecycle-root'
import type { SqliteDispatchLifecycleClosureStore } from '../infrastructure/sqlite-dispatch-lifecycle-closure-store'
import type { SqliteDispatchLifecycleEventStore } from '../infrastructure/sqlite-dispatch-lifecycle-event-store'
import type { SqliteDispatchLifecycleIncidentStore } from '../infrastructure/sqlite-dispatch-lifecycle-incident-store'
import type { SqliteDispatchProcessBindingStore } from '../infrastructure/sqlite-dispatch-process-binding-store'
import type { SqliteDispatchTerminationStore } from '../infrastructure/sqlite-dispatch-termination-store'
import type { SqliteWorktreeFinalizationStore } from '../infrastructure/sqlite-worktree-finalization-store'
import type { DispatchWorktreeStore } from './dispatch-worktree-store'
import type { ExecutionStore } from './execution-store'
import type { SettlementObservationStore } from './settlement-observation-store'
import { advanceWorktreeFinalization } from './worktree-finalizer'
import type { WorktreeProvenanceIncidentStore } from './worktree-provenance-incident-store'
import type { WorktreeProvenanceStore } from './worktree-provenance-store'

// Execution bounded context — application. ORCA-S4 SPEC §11 — the third
// sibling sweep, invoked by the composition boundary AFTER
// convergeWorktreeProvenance(...) (ORCA-S3) returns. Never a phase inside
// ORCA-S2 or ORCA-S3's own coordinators.

export type ProcessLifecycleObservationLike =
  | { kind: 'still_running' }
  | { kind: 'self_exit'; exitCode: number | null; exitSignal: string | null }
  | { kind: 'confirmed_dead_unknown_cause' }
  | { kind: 'identity_unverifiable' }
  | { kind: '__raw_os_observation__'; pidExists: boolean; currentOsStartMarker: string | null; argv?: string | null }

export type ShadowLifecycleProcessPortLike = {
  observe(
    handle: ChildProcessHandle | null | undefined,
    durable: {
      pid: number
      processNonce: string
      identitySidecarPath: string
      teardownRequestedAt: string | null
      osStartMarker: string | null
      osStartMarkerSource: string
    }
  ): Promise<ProcessLifecycleObservationLike>
  requestTermination(handle: ChildProcessHandle): Promise<{ verified: boolean }>
  requestTerminationByPid(pid: number, killScope: string): Promise<{ verified: boolean }>
}

export type DelegationBoundaryLifecycleDeps = {
  bindings: ExecutionStore
  settlements: SettlementObservationStore
  dispatchWorktrees: DispatchWorktreeStore
  provenance: WorktreeProvenanceStore
  worktreeProvenanceIncidents: WorktreeProvenanceIncidentStore
  processBindings: SqliteDispatchProcessBindingStore
  terminations: SqliteDispatchTerminationStore
  finalizations: SqliteWorktreeFinalizationStore
  closures: SqliteDispatchLifecycleClosureStore
  events: SqliteDispatchLifecycleEventStore
  incidents: SqliteDispatchLifecycleIncidentStore
  processPort: ShadowLifecycleProcessPortLike
  /** Live ChildProcess handles for shadow lifecycle processes spawned by the CURRENT composition-root instance (§6). Keyed by orcaDispatchId. */
  liveHandles: Map<string, ChildProcessHandle>
  durableShadowWorktreeRoot: string
  /** §9.2 — the durable shadow-lifecycle root the process identity sidecar lives under. Required to re-read the REAL sidecar on the restart-recovered path (§9.1.2 check 1). */
  durableShadowLifecycleRoot: string
  now: () => string
  newId: (prefix: string) => string
}

export type DelegationBoundaryLifecycleOptions = { sliceRef: string }

export type RetryableResult = { correlationId: string; code: string; attempts: number }
export type IncidentSummary = { correlationId: string; kind: DispatchLifecycleIncidentKind }

export type DelegationBoundaryLifecycleReport = {
  closed: string[]
  legacyNotLifecycleManaged: string[]
  incidents: IncidentSummary[]
  retryable: RetryableResult[]
  /** §5, gate 21 — the acceptance-evidence disclaimer this report itself must carry. */
  syntheticProcessDisclaimer: string
}

const SYNTHETIC_PROCESS_DISCLAIMER =
  'SYNTHETIC LOCAL LIFECYCLE PROOF: every process this report accounts for is a synthetic, ' +
  'self-spawned Execution fixture (ORCA-S4 SPEC §4/§5). This report does not prove, and must ' +
  'never be cited as evidence of, production process-handle acquisition, real (non-MockExecutor) ' +
  'executor parity, or remote/SSH execution identity parity — no production workload process is ' +
  'ever observed or signalled here.'

const RETRYABLE_CODES = new Set([
  'LIFECYCLE_STORE_BUSY_RETRYABLE',
  'LIFECYCLE_FS_OPERATIONAL_RETRYABLE',
  'LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE'
])

function evidenceDigest(parts: string[]): string {
  return createHash('sha256').update(parts.join(EVIDENCE_JOINER)).digest('hex')
}

type TerminationOutcome = {
  outcome: 'termination'
  terminationMethod: 'self_exit' | 'signalled' | 'confirmed_dead_unknown_cause'
  exitCode: number | null
  exitSignal: string | null
  treeVerified: boolean
}
type IncidentOutcome = { outcome: 'incident'; kind: DispatchLifecycleIncidentKind; reason: string }

async function resolvePhase1(
  deps: DelegationBoundaryLifecycleDeps,
  orcaDispatchId: string,
  processBinding: NonNullable<ReturnType<SqliteDispatchProcessBindingStore['getByCorrelationId']>>
): Promise<TerminationOutcome | IncidentOutcome> {
  const liveHandle = deps.liveHandles.get(orcaDispatchId) ?? null
  const durable = {
    pid: processBinding.pid,
    processNonce: processBinding.processNonce,
    identitySidecarPath: processIdentitySidecarPath(deps.durableShadowLifecycleRoot, orcaDispatchId),
    teardownRequestedAt: processBinding.teardownRequestedAt,
    osStartMarker: processBinding.osStartMarker,
    osStartMarkerSource: processBinding.osStartMarkerSource
  }

  const observation = await deps.processPort.observe(liveHandle, durable)

  const requestTeardown = (): void => {
    if (!processBinding.teardownRequestedAt) {
      deps.processBindings.markTeardownRequested(orcaDispatchId, deps.now())
    }
  }

  if (observation.kind === '__raw_os_observation__') {
    const sidecar = {
      correlationId: processBinding.correlationId,
      orcaRunId: processBinding.orcaRunId,
      orcaDispatchId,
      processNonce: processBinding.processNonce
    }
    const macos =
      processBinding.osStartMarkerSource === 'posix_ps_lstart'
        ? { argv: observation.argv ?? null, expectedShapePrefix: 'shadow-lifecycle-child.mjs' }
        : undefined
    const verification = verifyRestartRecoveredIdentity({
      durable: {
        ...sidecar,
        pid: processBinding.pid,
        osStartMarker: processBinding.osStartMarker,
        osStartMarkerSource: processBinding.osStartMarkerSource
      },
      sidecar,
      pidExists: observation.pidExists,
      currentOsStartMarker: observation.currentOsStartMarker,
      macos
    })
    if (verification.kind !== 'verified') {
      return { outcome: 'incident', kind: 'orphan_process_unverifiable', reason: verification.reason }
    }
    requestTeardown()
    const result = await deps.processPort.requestTerminationByPid(processBinding.pid, processBinding.killScope)
    return { outcome: 'termination', terminationMethod: 'signalled', exitCode: null, exitSignal: null, treeVerified: result.verified }
  }

  if (observation.kind === 'still_running') {
    requestTeardown()
    const result = liveHandle
      ? await deps.processPort.requestTermination(liveHandle)
      : await deps.processPort.requestTerminationByPid(processBinding.pid, processBinding.killScope)
    return { outcome: 'termination', terminationMethod: 'signalled', exitCode: null, exitSignal: null, treeVerified: result.verified }
  }

  if (observation.kind === 'self_exit') {
    return {
      outcome: 'termination',
      terminationMethod: 'self_exit',
      exitCode: observation.exitCode,
      exitSignal: observation.exitSignal,
      treeVerified: true
    }
  }

  if (observation.kind === 'confirmed_dead_unknown_cause') {
    // §9.3 — honest reattribution: a durably-recorded teardown request makes
    // this attributable to S4, never a bare "unknown cause" (§12 window L6).
    if (processBinding.teardownRequestedAt) {
      return { outcome: 'termination', terminationMethod: 'signalled', exitCode: null, exitSignal: null, treeVerified: false }
    }
    return { outcome: 'termination', terminationMethod: 'confirmed_dead_unknown_cause', exitCode: null, exitSignal: null, treeVerified: false }
  }

  // 'identity_unverifiable'
  return { outcome: 'incident', kind: 'process_identity_mismatch', reason: 'process identity could not be confirmed' }
}

export async function convergeDelegationBoundaryLifecycle(
  deps: DelegationBoundaryLifecycleDeps,
  opts: DelegationBoundaryLifecycleOptions
): Promise<DelegationBoundaryLifecycleReport> {
  const { sliceRef } = opts
  const closed: string[] = []
  const legacyNotLifecycleManaged: string[] = []
  const incidentsOut: IncidentSummary[] = []
  const retryable: RetryableResult[] = []

  const raiseIncident = (
    correlationId: string,
    orcaDispatchId: string | null,
    kind: DispatchLifecycleIncidentKind,
    detail: Record<string, unknown>
  ): void => {
    const digest = evidenceDigest([correlationId, kind, JSON.stringify(detail)])
    const { inserted } = deps.incidents.insert({
      id: deps.newId('s4inc'),
      correlationId,
      orcaDispatchId,
      sliceRef,
      kind,
      evidenceDigest: digest,
      detailJson: JSON.stringify(detail),
      blocked: true,
      resolvedAt: null,
      resolutionNote: null,
      raisedAt: deps.now()
    })
    if (inserted) {
      incidentsOut.push({ correlationId, kind })
    }
  }

  for (const binding of deps.bindings.listBindings(sliceRef)) {
    const correlationId = binding.correlationId
    const orcaDispatchId = binding.orcaDispatchId

    if (deps.incidents.hasOpenLifecycleIncident(correlationId)) {
      continue // §14 LIFE-9 — S4-only block
    }

    const processBinding = deps.processBindings.getByCorrelationId(correlationId)
    if (!processBinding) {
      // §8.7 — a run_binding predating S4's own bind-time seam. No row, no
      // incident, no block, no retroactive spawn.
      legacyNotLifecycleManaged.push(correlationId)
      continue
    }

    const settlement = deps.settlements.getByCorrelation(correlationId)
    const provenance = deps.provenance.getByCorrelation(correlationId)

    if (deps.worktreeProvenanceIncidents.hasOpenIncident(correlationId)) {
      continue // never override an ORCA-S3 block (mirrors PROV-10 the other direction)
    }

    // Phase 1 — Observe & tear down.
    let termination = deps.terminations.getByCorrelationId(correlationId)
    if (!termination) {
      try {
        const resolved = await resolvePhase1(deps, orcaDispatchId, processBinding)
        if (resolved.outcome === 'incident') {
          raiseIncident(correlationId, orcaDispatchId, resolved.kind, {
            reason: resolved.reason,
            pid: processBinding.pid
          })
          continue
        }
        deps.terminations.insert({
          correlationId,
          orcaDispatchId,
          terminationMethod: resolved.terminationMethod,
          exitCode: resolved.exitCode,
          exitSignal: resolved.exitSignal,
          treeVerified: resolved.treeVerified,
          observedAt: deps.now()
        })
        termination = deps.terminations.getByCorrelationId(correlationId)
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code && RETRYABLE_CODES.has(code)) {
          retryable.push({ correlationId, code, attempts: 1 })
          continue
        }
        throw error
      }
    }

    if (!settlement || !termination) {
      continue // not yet eligible for anything further this pass
    }

    // Phase 2 — Finalize (§10.1-§10.2).
    const eligible =
      ['observed', 'observed_conflicted'].includes(settlement.status) &&
      (provenance ? ['recorded', 'conflicted'].includes(provenance.status) : true) &&
      !deps.worktreeProvenanceIncidents.hasOpenIncident(correlationId)

    let finalization = deps.finalizations.getByCorrelationId(correlationId)
    if (eligible && (!finalization || finalization.status === 'intent_recorded')) {
      const worktreeProvenanceStatus = provenance ? provenance.status : 'legacy_not_convergeable'
      const eligibilityDigest = computeFinalizationEligibilityDigest({
        settlementStatus: settlement.status,
        worktreeProvenanceStatus,
        terminationMethod: termination.terminationMethod
      })
      const dispatchWorktree = deps.dispatchWorktrees.getByCorrelationId(correlationId)
      try {
        await advanceWorktreeFinalization(
          { finalizations: deps.finalizations, durableShadowWorktreeRoot: deps.durableShadowWorktreeRoot },
          {
            correlationId,
            orcaDispatchId,
            sliceRef,
            eligibilityDigest,
            worktreePath: dispatchWorktree ? dispatchWorktree.worktreePath : null,
            now: deps.now
          }
        )
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code && RETRYABLE_CODES.has(code)) {
          retryable.push({ correlationId, code, attempts: 1 })
          continue
        }
        throw error
      }
      finalization = deps.finalizations.getByCorrelationId(correlationId)
    }

    // Phase 3 — Close.
    let closure = deps.closures.getByCorrelationId(correlationId)
    if (!closure && finalization && ['finalized', 'skipped_not_eligible'].includes(finalization.status)) {
      const refs = {
        settlementStatusRef: settlement.status,
        worktreeProvenanceRef: provenance ? provenance.status : 'legacy_not_convergeable',
        terminationMethodRef: termination.terminationMethod,
        finalizationStatusRef: finalization.status
      }
      deps.closures.insert({
        correlationId,
        orcaDispatchId,
        orcaRunId: binding.orcaRunId,
        sliceRef,
        ...refs,
        closureDigest: computeLifecycleClosureDigest(refs),
        closedAt: deps.now(),
        postClosureSettlementConflictDetectedAt: null
      })
      closure = deps.closures.getByCorrelationId(correlationId)
    }

    // Phase 4 — Emit.
    if (closure) {
      closed.push(correlationId)
      if (!deps.events.getByCorrelationAndKind(correlationId, SHADOW_DELEGATED_BOUNDARY_CLOSED)) {
        deps.events.insert({
          correlationId,
          eventKind: SHADOW_DELEGATED_BOUNDARY_CLOSED,
          closureDigestRef: closure.closureDigest,
          emittedAt: deps.now()
        })
      }
    }
  }

  // Phase 5 — Reconcile post-closure contradictions (§11, §8.0.1, §12 window
  // L14). Runs on EVERY sweep pass for EVERY existing closure, independent of
  // Phases 1-4's progress this pass for any other binding.
  for (const closure of deps.closures.listPendingPostClosureCheck(sliceRef)) {
    const currentSettlement = deps.settlements.getByCorrelation(closure.correlationId)
    if (!currentSettlement || currentSettlement.status === closure.settlementStatusRef) {
      continue
    }
    deps.closures.markPostClosureSettlementConflictDetected(closure.correlationId, deps.now())
    raiseIncident(closure.correlationId, closure.orcaDispatchId, 'post_closure_settlement_conflict', {
      frozenSettlementStatus: closure.settlementStatusRef,
      currentSettlementStatus: currentSettlement.status
    })
  }

  return { closed, legacyNotLifecycleManaged, incidents: incidentsOut, retryable, syntheticProcessDisclaimer: SYNTHETIC_PROCESS_DISCLAIMER }
}
