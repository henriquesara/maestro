// Execution bounded context — application. Orchestrates ORCA-S1 with a
// crash-safe durable reservation lifecycle (amendment 001 §5), same-workload
// parity (§3), mechanical confinement (§6), and structured root-cause
// adjudication (§7). Advisory only — never touches an authoritative run.

import type { AuthoritativeExecutor } from './authoritative-executor'
import type { SettlementConvergenceReport } from './converge-settlements'
import type { ExecutionPlane } from './execution-plane'
import type { ExecutionStore } from './execution-store'
import {
  reconcileShadowExecutionState,
  type ShadowSettlementDeps
} from './reconcile-shadow-execution-state'
import type { ReservationStore } from './reservation-store'
import {
  makeAiControlRunRef,
  makeCorrelationId,
  makeGovernanceAgentRunRef,
  type RunBinding
} from '../domain/execution-identity'
import {
  assertObservationComplete,
  compareOutcomes,
  type ParityObservation,
  type RootCauseAdjudication
} from '../domain/parity'
import { assertWorkloadConfined, PathConfinementError } from '../domain/path-confinement'
import { classifyShadowWorkload, type WorkloadDescriptor } from '../domain/shadow-safety-policy'
import type { WorkloadSpec } from '../domain/workload-spec'

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
}

export type ShadowObservationDeps = {
  authoritativeExecutor: AuthoritativeExecutor
  plane: ExecutionPlane
  store: ExecutionStore
  reservations: ReservationStore
  /** ORCA-S2 §15 — present when a real durable shadow orchestration.db is composed. */
  settlement?: ShadowSettlementDeps
}

function sanitize(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg
}

/**
 * Structured adjudication (blocker B9). Each divergence dimension is either
 * genuinely `explained` with concrete evidence, or `unresolved` — which makes
 * `assertObservationComplete` throw and fails the acceptance gate.
 */
export function adjudicate(
  parity: ReturnType<typeof compareOutcomes>,
  spec: WorkloadSpec,
  authoritative: { cancellationBehavior: string },
  shadow: { cancellationBehavior: string; filesChanged: readonly string[] | null }
): RootCauseAdjudication[] {
  return parity.divergences.map((divergence): RootCauseAdjudication => {
    const observedMismatch = `${divergence.dimension}: authoritative=${divergence.authoritative} shadow=${divergence.shadow}`

    if (divergence.dimension === 'files_changed' && (spec.shadowInputExtras?.length ?? 0) > 0) {
      return {
        status: 'explained',
        dimension: 'files_changed',
        observedMismatch,
        classifiedCause: 'shadow_input_worktree_divergence',
        evidence: [
          `shadow input worktree carried extra untracked content: ${spec
            .shadowInputExtras!.map((f) => f.path)
            .join(', ')}`,
          `shadow files_changed = [${(shadow.filesChanged ?? []).join(', ')}]`
        ]
      }
    }

    if (
      divergence.dimension === 'cancellation' &&
      spec.steps.some((s) => s.op === 'cancel' && s.midFlight) &&
      authoritative.cancellationBehavior === 'cancelled_clean' &&
      shadow.cancellationBehavior === 'cancelled_mid_flight'
    ) {
      return {
        status: 'explained',
        dimension: 'cancellation',
        observedMismatch,
        classifiedCause: 'reference_executor_cancellation_granularity_coarse',
        evidence: [
          'aiControl-native recording coarsens mid-flight cancellation to clean (amendment 001 §4 row 6)',
          `authoritative=${authoritative.cancellationBehavior} shadow=${shadow.cancellationBehavior}`
        ]
      }
    }

    return {
      status: 'unresolved',
      dimension: divergence.dimension,
      observedMismatch,
      classifiedCause: null,
      evidence: [observedMismatch]
    }
  })
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
      assertWorkloadConfined(spec, shadowWorktree, input.shadowRoot)
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
      store.recordBinding(binding) // I3
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
    settlementConvergence: coordinated.convergence ?? undefined
  }
}
