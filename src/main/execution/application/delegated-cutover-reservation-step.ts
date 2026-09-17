import type { ReservationStore, RunReservation } from './reservation-store'
import { makeCorrelationId } from '../domain/execution-identity'

// Execution bounded context — application. ORCA-S5 Delegated Cutover Core
// (SPEC.md §5.2 S1/S2, §4.8.1, corrected round 5). The S1(fence)->S2
// (run_reservation) step: the coordinator's own first durable write, before
// any process is prepared. `run_reservation` here is Execution's own
// FK-anchor bookkeeping only -- never a second admission/capacity authority;
// aiControl's own `agent_runs.status`/`orca_fence_state` remains the sole
// admission authority (unaffected by this step).

export type DelegatedCutoverFenceOutcome =
  | 'ACQUIRED'
  | 'ALREADY_FENCED_SAME_TOKEN'
  | 'CONFLICT_DIFFERENT_TOKEN'
  | 'ALREADY_CUTOVER'
  | 'NOT_ELIGIBLE'
  | 'ACQUISITION_DISABLED'

/** The minimum fence surface this step needs -- satisfied structurally by
 *  the real future `AiControlFenceClientPort` (SPEC §4.8.5) and, in tests,
 *  by `FakeAiControlFenceClient` (cutover-core-test-harness.ts). */
export type DelegatedCutoverFencePort = {
  acquireOrcaFence(input: { runId: string; token: string }): Promise<{
    outcome: DelegatedCutoverFenceOutcome
    runId: string
    token?: string
  }>
}

export type DelegatedCutoverReservationDeps = {
  reservations: ReservationStore
  fence: DelegatedCutoverFencePort
  /** Distinct from the shadow-observation slice's own `slice_ref` (SPEC §5.2/§4.8.1). */
  sliceRef: string
}

export type DelegatedCutoverReservationInput = {
  correlationId: string
  aicontrolRunId: string
  fenceToken: string
  workloadId: string
  /** Provider/runtime eligibility (`supportsDelegatedCutoverHold`, already
   *  real and GREEN at the PTY layer) -- checked by the caller and passed in
   *  here so this step can refuse to touch the fence at all when false,
   *  without recreating provider eligibility itself. */
  providerEligible: boolean
  now: string
}

const ELIGIBLE_FENCE_OUTCOMES: ReadonlySet<DelegatedCutoverFenceOutcome> = new Set([
  'ACQUIRED',
  'ALREADY_FENCED_SAME_TOKEN'
])

export class DelegatedCutoverReservationRejectedError extends Error {
  constructor(readonly reason: 'provider_ineligible' | DelegatedCutoverFenceOutcome) {
    super(`delegated_cutover_reservation_rejected: ${reason}`)
    this.name = 'DelegatedCutoverReservationRejectedError'
  }
}

/**
 * Frozen ordering (SPEC §5.2 S1->S2): provider eligibility -> fence
 * acquisition -> (only on success) establish `run_reservation`. Idempotent
 * for a same-identity retry (a pre-existing reservation for the same
 * `correlationId` is read back, never re-inserted); a different token for
 * the same `aicontrolRunId` fails closed at the fence CAS, never reaching
 * the reservation write.
 */
export async function establishDelegatedCutoverReservation(
  deps: DelegatedCutoverReservationDeps,
  input: DelegatedCutoverReservationInput
): Promise<{ reservation: RunReservation; authority: 'AICONTROL_NATIVE' }> {
  if (!input.providerEligible) {
    throw new DelegatedCutoverReservationRejectedError('provider_ineligible')
  }

  const correlationId = makeCorrelationId(input.correlationId)

  const existing = deps.reservations.get(correlationId)
  if (existing) {
    // Same-protocol-identity retry (response loss, restart before S3) --
    // idempotent: the fence CAS below is still exercised (a duplicate
    // acquire is itself idempotent/ALREADY_FENCED_SAME_TOKEN) but the
    // reservation write is not repeated.
    const outcome = await deps.fence.acquireOrcaFence({
      runId: input.aicontrolRunId,
      token: input.fenceToken
    })
    if (!ELIGIBLE_FENCE_OUTCOMES.has(outcome.outcome)) {
      throw new DelegatedCutoverReservationRejectedError(outcome.outcome)
    }
    return { reservation: existing, authority: 'AICONTROL_NATIVE' }
  }

  const outcome = await deps.fence.acquireOrcaFence({
    runId: input.aicontrolRunId,
    token: input.fenceToken
  })
  if (!ELIGIBLE_FENCE_OUTCOMES.has(outcome.outcome)) {
    throw new DelegatedCutoverReservationRejectedError(outcome.outcome)
  }

  const reservation = deps.reservations.reserve({
    correlationId,
    sliceRef: deps.sliceRef,
    authoritativeRunRef: input.aicontrolRunId,
    workloadId: input.workloadId,
    now: input.now
  })

  return { reservation, authority: 'AICONTROL_NATIVE' }
}
