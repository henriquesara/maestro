// Execution bounded context — application. Orchestrates ORCA-S1 with a
// crash-safe durable reservation lifecycle (amendment 001 §5), same-workload
// parity (§3), mechanical confinement (§6), and structured root-cause
// adjudication (§7). Advisory only — never touches an authoritative run.

import type { AuthoritativeExecutor } from './authoritative-executor'
import {
  convergeDelegationBoundaryLifecycle,
  type DelegationBoundaryLifecycleDeps,
  type DelegationBoundaryLifecycleReport
} from './converge-delegation-boundary-lifecycle'
import type { SettlementConvergenceReport } from './converge-settlements'
import type { WorktreeProvenanceConvergenceReport } from './converge-worktree-provenance'
import type { ExecutionPlane } from './execution-plane'
import type { ExecutionStore } from './execution-store'
import {
  reconcileShadowExecutionState,
  type ShadowSettlementDeps
} from './reconcile-shadow-execution-state'
import type { ReservationStore } from './reservation-store'
import {
  bindDispatchWorktree,
  type DelegationBoundaryBindDeps,
  type WorktreeProvenanceDeps
} from './worktree-provenance-bind-step'
import { convergeWorktreeProvenanceSibling } from './worktree-provenance-converge-sibling'
import {
  makeAiControlRunRef,
  makeCorrelationId,
  makeGovernanceAgentRunRef,
  type RunBinding
} from '../domain/execution-identity'
import {
  assertObservationComplete,
  compareOutcomes,
  type ParityObservation
} from '../domain/parity'
import { assertWorkloadConfined, PathConfinementError } from '../domain/path-confinement'
import { classifyShadowWorkload, type WorkloadDescriptor } from '../domain/shadow-safety-policy'
import type { WorkloadSpec } from '../domain/workload-spec'
import { adjudicate } from './shadow-parity-adjudication'

export { adjudicate } from './shadow-parity-adjudication'

export type ShadowSampleSlot = {
  profile: string
  authoritativeRunRef: string | null
  descriptor: WorkloadDescriptor
  workload: WorkloadSpec
}

export type ShadowObservationInput = {
  sliceRef: string
  slots: readonly ShadowSampleSlot[]
  shadowRoot: string
  /**
   * ORCA-S3 §10 — confinement boundary for the `'shadow'` worktree when a
   * durable shadow-worktree root is composed (the `'auth'` worktree always
   * confines to `shadowRoot`). Defaults to `shadowRoot` when S3 is not composed.
   */
  shadowWorktreeRoot?: string
  worktreeDirFor: (kind: 'auth' | 'shadow', correlationId: string) => string
  now: () => string
  newId: (prefix: string) => string
  /** ORCA-S2 §9 / §15.2 — cutoff after which a still-non-terminal bound Dispatch is abandoned. */
  staleAfter?: number
}

export type ShadowObservationReport = {
  sliceRef: string
  bindings: readonly RunBinding[]
  observations: readonly ParityObservation[]
  exclusionCount: number
  divergences: readonly { dispatchId: string; dimension: string; adjudicationStatus: string }[]
  abandoned: readonly { workloadId: string; reason: string }[]
  reconcile: { scanned: number; abandoned: number }
  /** ORCA-S2 — the durable settlement convergence report, when S2 convergence is composed. */
  settlementConvergence?: SettlementConvergenceReport
  /** ORCA-S3 — the sibling worktree-provenance convergence report, when S3 is composed. */
  worktreeProvenanceConvergence?: WorktreeProvenanceConvergenceReport
  /** ORCA-S4 — the third sibling sweep's report, when S4 is composed. */
  delegationBoundaryLifecycle?: DelegationBoundaryLifecycleReport
}

/**
 * ORCA-S4 §9.2/§11 — present only when S4 is composed (requires
 * `worktreeProvenance` and `settlement` too, since S4 depends on S3's durable
 * shadow-worktree root and on S2's settled-status truth).
 */
export type DelegationBoundaryDeps = DelegationBoundaryBindDeps & {
  terminations: DelegationBoundaryLifecycleDeps['terminations']
  finalizations: DelegationBoundaryLifecycleDeps['finalizations']
  closures: DelegationBoundaryLifecycleDeps['closures']
  events: DelegationBoundaryLifecycleDeps['events']
  incidents: DelegationBoundaryLifecycleDeps['incidents']
  /** Live ChildProcess handles for shadow lifecycle processes spawned by the CURRENT composition-root instance. */
  liveHandles: DelegationBoundaryLifecycleDeps['liveHandles']
}

export type ShadowObservationDeps = {
  authoritativeExecutor: AuthoritativeExecutor
  plane: ExecutionPlane
  store: ExecutionStore
  reservations: ReservationStore
  /** ORCA-S2 §15 — present when a real durable shadow orchestration.db is composed. */
  settlement?: ShadowSettlementDeps
  /** ORCA-S3 §7 — present when a durable shadow-worktree root is composed (requires `settlement`). */
  worktreeProvenance?: WorktreeProvenanceDeps
  /** ORCA-S4 §9.2/§11 — present when S4 is composed (requires `worktreeProvenance` + `settlement`). */
  delegationBoundary?: DelegationBoundaryDeps
}

function sanitize(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg
}

export async function runShadowObservation(
  deps: ShadowObservationDeps,
  input: ShadowObservationInput
): Promise<ShadowObservationReport> {
  const { authoritativeExecutor, plane, store, reservations } = deps

  // B2 / ORCA-S2 §15 — the SINGLE reconciliation coordinator, first and idempotently:
  // converge terminal durable Dispatches → verify already-observed → abandon remainder.
  const coordinated = reconcileShadowExecutionState(
    { plane, store, reservations, settlement: deps.settlement },
    {
      sliceRef: input.sliceRef,
      now: input.now,
      newId: input.newId,
      staleAfter: input.staleAfter
    }
  )
  const reconcile = coordinated.reconcile

  // ORCA-S3 §8 — the sibling two-phase provenance sweep, invoked immediately
  // AFTER reconcileShadowExecutionState(...) returns (requires `settlement` —
  // the source of settled-status truth Phase A gates on).
  let worktreeProvenanceConvergence: WorktreeProvenanceConvergenceReport | undefined
  if (deps.worktreeProvenance && deps.settlement) {
    worktreeProvenanceConvergence = convergeWorktreeProvenanceSibling(
      deps.worktreeProvenance,
      store,
      deps.settlement.observations,
      input.sliceRef,
      input.now,
      input.newId
    )
  }

  // ORCA-S4 §11 — the third sibling sweep, invoked immediately AFTER
  // convergeWorktreeProvenance(...) returns (requires `worktreeProvenance` +
  // `settlement` — S4 depends on S3's durable shadow-worktree root and on
  // S2's settled-status truth). Never a phase inside S2 or S3's own coordinators.
  let delegationBoundaryLifecycle: DelegationBoundaryLifecycleReport | undefined
  if (deps.delegationBoundary && deps.worktreeProvenance && deps.settlement) {
    delegationBoundaryLifecycle = await convergeDelegationBoundaryLifecycle(
      {
        bindings: store,
        settlements: deps.settlement.observations,
        dispatchWorktrees: deps.worktreeProvenance.dispatchWorktrees,
        provenance: deps.worktreeProvenance.provenance,
        worktreeProvenanceIncidents: deps.worktreeProvenance.incidents,
        processBindings: deps.delegationBoundary.processBindings,
        terminations: deps.delegationBoundary.terminations,
        finalizations: deps.delegationBoundary.finalizations,
        closures: deps.delegationBoundary.closures,
        events: deps.delegationBoundary.events,
        incidents: deps.delegationBoundary.incidents,
        processPort: deps.delegationBoundary.processPort,
        liveHandles: deps.delegationBoundary.liveHandles,
        durableShadowWorktreeRoot: deps.worktreeProvenance.durableShadowWorktreeRoot,
        now: input.now,
        newId: input.newId
      },
      { sliceRef: input.sliceRef }
    )
  }

  const bindings: RunBinding[] = []
  const observations: ParityObservation[] = []
  const divergences: { dispatchId: string; dimension: string; adjudicationStatus: string }[] = []
  const abandoned: { workloadId: string; reason: string }[] = []
  let exclusionCount = 0

  for (const slot of input.slots) {
    const spec = slot.workload

    const decision = classifyShadowWorkload(slot.descriptor)
    if (!decision.eligible) {
      store.recordExclusion({
        id: input.newId('excl'),
        sliceRef: input.sliceRef,
        workloadId: slot.descriptor.id,
        code: decision.code,
        reason: decision.reason,
        excludedAt: input.now()
      })
      exclusionCount += 1
      continue
    }

    // B2 idempotency — a prior reservation for this (authoritative row, workload)
    // is reused/short-circuited, never re-dispatched.
    const prior = reservations.findByAuthoritativeWorkload(
      input.sliceRef,
      slot.authoritativeRunRef,
      spec.id
    )
    if (prior && prior.state === 'observed') {
      continue
    }
    if (prior && prior.state !== 'abandoned') {
      reservations.advance(prior.correlationId, 'abandoned', {
        lastError: 'still incomplete after reconcile',
        now: input.now()
      })
      abandoned.push({ workloadId: spec.id, reason: 'still incomplete after reconcile' })
      continue
    }

    const correlationId = makeCorrelationId(input.newId('corr'))
    const authWorktree = input.worktreeDirFor('auth', String(correlationId))
    const shadowWorktree = input.worktreeDirFor('shadow', String(correlationId))

    // B5 — mechanical confinement of every file effect, before any execution.
    try {
      assertWorkloadConfined(spec, authWorktree, input.shadowRoot)
      assertWorkloadConfined(spec, shadowWorktree, input.shadowWorktreeRoot ?? input.shadowRoot)
    } catch (error) {
      if (error instanceof PathConfinementError) {
        store.recordExclusion({
          id: input.newId('excl'),
          sliceRef: input.sliceRef,
          workloadId: spec.id,
          code: 'path_confinement',
          reason: `${error.code}: ${error.message}`,
          excludedAt: input.now()
        })
        exclusionCount += 1
        continue
      }
      throw error
    }

    reservations.reserve({
      correlationId,
      sliceRef: input.sliceRef,
      authoritativeRunRef: slot.authoritativeRunRef,
      workloadId: spec.id,
      now: input.now()
    })

    let opened: Awaited<ReturnType<ExecutionPlane['openShadowRun']>> | undefined
    try {
      const auth = await authoritativeExecutor.execute({ spec, worktreeDir: authWorktree })

      opened = await plane.openShadowRun({
        sliceRef: input.sliceRef,
        workloadId: spec.id,
        correlationId,
        governanceAgentRunId: makeGovernanceAgentRunRef(input.newId('gar')),
        worktreeDir: shadowWorktree,
        seededFiles: spec.seededFiles ?? [],
        postBaseFiles: spec.shadowInputExtras ?? []
      })
      reservations.advance(correlationId, 'orca_created', {
        orcaRunId: String(opened.orcaRunRef),
        orcaDispatchId: String(opened.orcaDispatchRef),
        orgTaskId: String(opened.orgTaskRef),
        now: input.now()
      })

      const binding: RunBinding = {
        correlationId,
        governanceAgentRunId: makeGovernanceAgentRunRef(input.newId('gar')),
        aicontrolRunId:
          slot.authoritativeRunRef === null ? null : makeAiControlRunRef(slot.authoritativeRunRef),
        orcaRunId: opened.orcaRunRef,
        orcaDispatchId: opened.orcaDispatchRef,
        orgTaskId: opened.orgTaskRef,
        sliceRef: input.sliceRef,
        baseCommit: opened.baseCommit,
        candidateHead: null,
        boundAt: input.now()
      }
      // ORCA-S3 §7.2, §7.6 — pinned bind-time write ordering (bindDispatchWorktree).
      if (deps.worktreeProvenance) {
        bindDispatchWorktree(
          deps.worktreeProvenance,
          store,
          binding,
          {
            orcaDispatchId: String(opened.orcaDispatchRef),
            orcaRunId: String(opened.orcaRunRef),
            correlationId: String(correlationId)
          },
          shadowWorktree,
          input.sliceRef,
          input.now,
          input.newId,
          deps.delegationBoundary
        )
      } else {
        store.recordBinding(binding) // I3
      }
      reservations.advance(correlationId, 'bound', { now: input.now() })
      bindings.push(binding)

      const shadowResult = await plane.runShadowWorkload({
        orcaRunRef: opened.orcaRunRef,
        orcaDispatchRef: opened.orcaDispatchRef,
        workload: spec
      })
      reservations.advance(correlationId, 'executed', { now: input.now() })

      const settled = await plane.settleShadow({
        orcaRunRef: opened.orcaRunRef,
        orcaDispatchRef: opened.orcaDispatchRef,
        result: shadowResult
      })
      store.setBindingCandidateHead(String(opened.orcaDispatchRef), settled.candidateHead)
      binding.candidateHead = settled.candidateHead // keep the in-memory report row in step with the row
      reservations.advance(correlationId, 'settled', {
        candidateHead: settled.candidateHead,
        now: input.now()
      })

      const parity = compareOutcomes(auth.outcome, settled.outcome)
      const adjudications = adjudicate(parity, spec, auth.outcome, settled.outcome)
      const observation: ParityObservation = {
        id: input.newId('parity'),
        runBindingDispatchId: String(opened.orcaDispatchRef),
        sliceRef: input.sliceRef,
        workloadId: spec.id,
        authoritative: auth.outcome,
        shadow: settled.outcome,
        parity,
        adjudications,
        observedAt: input.now()
      }
      assertObservationComplete(observation) // I7 / B9 — throws on unresolved / unexplained
      store.recordParityObservation(observation)
      reservations.advance(correlationId, 'observed', { now: input.now() })
      observations.push(observation)

      for (const divergence of parity.divergences) {
        const adj = adjudications.find((a) => a.dimension === divergence.dimension)
        divergences.push({
          dispatchId: String(opened.orcaDispatchRef),
          dimension: divergence.dimension,
          adjudicationStatus: adj?.status ?? 'missing'
        })
      }
    } catch (error) {
      abandoned.push({ workloadId: spec.id, reason: sanitize(error) })
      reservations.advance(correlationId, 'abandoned', {
        lastError: sanitize(error),
        now: input.now()
      })
      if (opened) {
        try {
          await plane.abandonShadow({
            orcaRunRef: opened.orcaRunRef,
            orcaDispatchRef: opened.orcaDispatchRef,
            reason: sanitize(error)
          })
        } catch {
          // contained — advisory-only teardown
        }
      }
    }
  }

  return {
    sliceRef: input.sliceRef,
    bindings,
    observations,
    exclusionCount,
    divergences,
    abandoned,
    reconcile: { scanned: reconcile.scanned, abandoned: reconcile.abandoned.length },
    settlementConvergence: coordinated.convergence ?? undefined,
    worktreeProvenanceConvergence,
    delegationBoundaryLifecycle
  }
}
