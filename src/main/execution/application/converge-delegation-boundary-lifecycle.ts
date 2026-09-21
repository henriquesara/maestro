import type { RunBinding } from '../domain/execution-identity'
import { computeLifecycleClosureDigest } from '../domain/dispatch-lifecycle-closure'
import { deriveDelegatedTerminalStatus } from '../domain/delegated-terminal-status'
import { SHADOW_DELEGATED_BOUNDARY_CLOSED } from '../domain/dispatch-lifecycle-event'
import type { DispatchLifecycleIncidentKind } from '../domain/dispatch-lifecycle-incident'
import { computeFinalizationEligibilityDigest } from '../domain/worktree-finalization'
import {
  convergeTerminalProjectionOutbox,
  insertOrConverge,
  lifecycleEvidenceDigest,
  LIFECYCLE_RETRYABLE_CODES,
  sanitizeSweepError
} from './converge-delegated-lifecycle-steps'
import {
  DELEGATED_PROCESS_DISCLAIMER,
  SYNTHETIC_PROCESS_DISCLAIMER,
  type DelegationBoundaryLifecycleDeps,
  type DelegationBoundaryLifecycleOptions,
  type DelegationBoundaryLifecycleReport,
  type IncidentSummary,
  type LifecycleSweepErrorRef,
  type RetryableResult
} from './delegation-boundary-lifecycle-contract'
import { resolveProcessTermination } from './lifecycle-process-termination'
import { advanceWorktreeFinalization } from './worktree-finalizer'

export type {
  DelegationBoundaryLifecycleDeps,
  DelegationBoundaryLifecycleOptions,
  DelegationBoundaryLifecycleReport,
  IncidentSummary,
  LifecycleSweepErrorRef,
  RetryableResult
} from './delegation-boundary-lifecycle-contract'
export type {
  ProcessLifecycleObservationLike,
  ShadowLifecycleProcessPortLike
} from './lifecycle-process-termination'

// Execution bounded context — application. ORCA-S4 SPEC §11 — the third
// sibling sweep, invoked by the composition boundary AFTER
// convergeWorktreeProvenance(...) (ORCA-S3) returns. Never a phase inside
// ORCA-S2 or ORCA-S3's own coordinators.
//
// ORCA-S5 (SPEC §5.2 S11, §9, §13, §15, X12) extends it for a run with a durable
// `delegation_cutover` — and ONLY for such a run (the S4 shadow path is
// byte-identical): a real process is observed but never terminated without a
// durable teardown request; the real worktree is never deleted; the closure
// carries `terminal_status_ref` in a five-field digest; racing compatible writers
// converge; and Phase 6 creates/delivers the Maestro-side projection outbox.

export async function convergeDelegationBoundaryLifecycle(
  deps: DelegationBoundaryLifecycleDeps,
  opts: DelegationBoundaryLifecycleOptions
): Promise<DelegationBoundaryLifecycleReport> {
  const { sliceRef } = opts
  const closed: string[] = []
  const legacyNotLifecycleManaged: string[] = []
  const incidentsOut: IncidentSummary[] = []
  const retryable: RetryableResult[] = []
  const sweepErrors: LifecycleSweepErrorRef[] = []
  let sawDelegated = false

  const raiseIncident = (
    correlationId: string,
    orcaDispatchId: string | null,
    kind: DispatchLifecycleIncidentKind,
    detail: Record<string, unknown>
  ): void => {
    const digest = lifecycleEvidenceDigest([correlationId, kind, JSON.stringify(detail)])
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

  const convergeBinding = async (binding: RunBinding): Promise<void> => {
    const correlationId = binding.correlationId
    const orcaDispatchId = binding.orcaDispatchId

    if (deps.incidents.hasOpenLifecycleIncident(correlationId)) {
      return // §14 LIFE-9 — S4-only block
    }

    const processBinding = deps.processBindings.getByCorrelationId(correlationId)
    if (!processBinding) {
      // §8.7 — a run_binding predating S4's own bind-time seam. No row, no
      // incident, no block, no retroactive spawn.
      legacyNotLifecycleManaged.push(correlationId)
      return
    }

    const settlement = deps.settlements.getByCorrelation(correlationId)
    const provenance = deps.provenance.getByCorrelation(correlationId)

    if (deps.worktreeProvenanceIncidents.hasOpenIncident(correlationId)) {
      return // never override an ORCA-S3 block (mirrors PROV-10 the other direction)
    }

    const delegated = deps.delegationCutovers?.get(correlationId) !== undefined
    sawDelegated ||= delegated

    // Phase 1 — Observe & tear down.
    let termination = deps.terminations.getByCorrelationId(correlationId)
    if (!termination) {
      try {
        const resolved = await resolveProcessTermination(deps, orcaDispatchId, processBinding, {
          delegated
        })
        if (resolved.outcome === 'left_running') {
          return // a healthy delegated process with no durable teardown request: nothing legal this pass
        }
        if (resolved.outcome === 'incident') {
          raiseIncident(correlationId, orcaDispatchId, resolved.kind, {
            reason: resolved.reason,
            pid: processBinding.pid
          })
          return
        }
        await insertOrConverge(
          () =>
            deps.terminations.insert({
              correlationId,
              orcaDispatchId,
              terminationMethod: resolved.terminationMethod,
              exitCode: resolved.exitCode,
              exitSignal: resolved.exitSignal,
              treeVerified: resolved.treeVerified,
              observedAt: deps.now()
            }),
          () => deps.terminations.getByCorrelationId(correlationId),
          (canonical) => canonical.orcaDispatchId === orcaDispatchId, // X12: the first commit is the fact
          'dispatch_termination'
        )
        termination = deps.terminations.getByCorrelationId(correlationId)
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code && LIFECYCLE_RETRYABLE_CODES.has(code)) {
          retryable.push({ correlationId, code, attempts: 1 })
          return
        }
        throw error
      }
    }

    if (!settlement || !termination) {
      return // not yet eligible for anything further this pass
    }

    // Phase 2 — Finalize (§10.1-§10.2; §13 for a real delegated worktree).
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
        await insertOrConverge(
          () =>
            advanceWorktreeFinalization(
              {
                finalizations: deps.finalizations,
                durableShadowWorktreeRoot: deps.durableShadowWorktreeRoot
              },
              {
                correlationId,
                orcaDispatchId,
                sliceRef,
                eligibilityDigest,
                worktreePath: dispatchWorktree ? dispatchWorktree.worktreePath : null,
                realDelegatedWorktree: delegated,
                now: deps.now
              }
            ),
          () => deps.finalizations.getByCorrelationId(correlationId),
          (canonical) => canonical.orcaDispatchId === orcaDispatchId,
          'worktree_finalization'
        )
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code && LIFECYCLE_RETRYABLE_CODES.has(code)) {
          retryable.push({ correlationId, code, attempts: 1 })
          return
        }
        throw error
      }
      finalization = deps.finalizations.getByCorrelationId(correlationId)
    }

    // Phase 3 — Close. A delegated closure classifies from DURABLE facts (§9.2) and its
    // five-field digest covers that classification; a shadow closure stays four-field.
    let closure = deps.closures.getByCorrelationId(correlationId)
    if (
      !closure &&
      finalization &&
      ['finalized', 'skipped_not_eligible'].includes(finalization.status)
    ) {
      const refs = {
        settlementStatusRef: settlement.status,
        worktreeProvenanceRef: provenance ? provenance.status : 'legacy_not_convergeable',
        terminationMethodRef: termination.terminationMethod,
        finalizationStatusRef: finalization.status
      }
      const terminalStatusRef = delegated
        ? deriveDelegatedTerminalStatus({
            terminationMethod: termination.terminationMethod,
            exitCode: termination.exitCode,
            teardownReason: deps.processBindings.getByCorrelationId(correlationId)?.teardownReason
          })
        : undefined
      await insertOrConverge(
        () =>
          deps.closures.insert({
            correlationId,
            orcaDispatchId,
            orcaRunId: binding.orcaRunId,
            sliceRef,
            ...refs,
            ...(terminalStatusRef !== undefined ? { terminalStatusRef } : {}),
            closureDigest: computeLifecycleClosureDigest({ ...refs, terminalStatusRef }),
            closedAt: deps.now(),
            postClosureSettlementConflictDetectedAt: null
          }),
        () => deps.closures.getByCorrelationId(correlationId),
        // Immutable once legally closed: a racing closure must carry the SAME terminal truth.
        (canonical) =>
          canonical.orcaDispatchId === orcaDispatchId &&
          (terminalStatusRef === undefined ||
            (canonical.terminalStatusRef ?? null) === terminalStatusRef),
        'dispatch_lifecycle_closure'
      )
      closure = deps.closures.getByCorrelationId(correlationId)
    }

    // Phase 4 — Emit.
    if (closure) {
      closed.push(correlationId)
      if (!deps.events.getByCorrelationAndKind(correlationId, SHADOW_DELEGATED_BOUNDARY_CLOSED)) {
        const closureDigestRef = closure.closureDigest
        await insertOrConverge(
          () =>
            deps.events.insert({
              correlationId,
              eventKind: SHADOW_DELEGATED_BOUNDARY_CLOSED,
              closureDigestRef,
              emittedAt: deps.now()
            }),
          () =>
            deps.events.getByCorrelationAndKind(correlationId, SHADOW_DELEGATED_BOUNDARY_CLOSED),
          (canonical) => canonical.closureDigestRef === closureDigestRef,
          'dispatch_lifecycle_event'
        )
      }
    }
  }

  for (const binding of deps.bindings.listBindings(sliceRef)) {
    try {
      await convergeBinding(binding)
    } catch (error) {
      // S4 SPEC §13 — fail closed for THIS binding only; a sibling binding is never blocked by it.
      sweepErrors.push({ correlationId: binding.correlationId, error: sanitizeSweepError(error) })
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
    raiseIncident(
      closure.correlationId,
      closure.orcaDispatchId,
      'post_closure_settlement_conflict',
      {
        frozenSettlementStatus: closure.settlementStatusRef,
        currentSettlementStatus: currentSettlement.status
      }
    )
  }

  // Phase 6 — ORCA-S5 projection outbox (SPEC §8.3, X8): the ONLY writer of the outbox.
  if (deps.delegationCutovers && deps.projections) {
    await convergeTerminalProjectionOutbox(
      {
        bindings: deps.bindings,
        closures: deps.closures,
        terminations: deps.terminations,
        events: deps.events,
        delegationCutovers: deps.delegationCutovers,
        projections: deps.projections,
        projectionWriter: deps.projectionWriter,
        now: deps.now
      },
      {
        sliceRef,
        raiseIncident,
        onError: (correlationId, error) =>
          sweepErrors.push({ correlationId, error: sanitizeSweepError(error) })
      }
    )
  }

  return {
    closed,
    legacyNotLifecycleManaged,
    incidents: incidentsOut,
    retryable,
    sweepErrors,
    syntheticProcessDisclaimer: sawDelegated
      ? DELEGATED_PROCESS_DISCLAIMER
      : SYNTHETIC_PROCESS_DISCLAIMER
  }
}
