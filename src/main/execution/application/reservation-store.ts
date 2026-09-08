// Execution bounded context — application. The durable pre-Dispatch reservation
// (amendment 001 §5, blocker B2). Every step of the shadow-run lifecycle is
// persisted here so a crash between any two steps reconciles deterministically —
// no in-memory Map as correctness authority, no log reconstruction.

import type { CorrelationId } from '../domain/execution-identity'

export type ReservationState =
  | 'reserved' // durable intent written; Orca Dispatch NOT yet created
  | 'orca_created' // shadow Run/Task/Dispatch created; binding NOT yet written
  | 'bound' // run_binding row written
  | 'executed' // workload applied
  | 'settled' // shadow Dispatch settled
  | 'observed' // parity_observation written — terminal success
  | 'abandoned' // reconciled or failed — terminal

export type RunReservation = {
  correlationId: CorrelationId
  sliceRef: string
  authoritativeRunRef: string | null
  workloadId: string
  state: ReservationState
  orcaRunId: string | null
  orcaDispatchId: string | null
  orgTaskId: string | null
  candidateHead: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type ReservationStore = {
  reserve(input: {
    correlationId: CorrelationId
    sliceRef: string
    authoritativeRunRef: string | null
    workloadId: string
    now: string
  }): RunReservation
  advance(
    correlationId: CorrelationId,
    to: ReservationState,
    patch?: {
      orcaRunId?: string
      orcaDispatchId?: string
      orgTaskId?: string
      candidateHead?: string
      lastError?: string
      now: string
    }
  ): RunReservation
  get(correlationId: CorrelationId): RunReservation | undefined
  /** Reservations for this slice not in a terminal state (`observed` / `abandoned`). */
  listIncomplete(sliceRef: string): RunReservation[]
  findByAuthoritativeWorkload(
    sliceRef: string,
    authoritativeRunRef: string | null,
    workloadId: string
  ): RunReservation | undefined
  listAll(sliceRef: string): RunReservation[]
}
