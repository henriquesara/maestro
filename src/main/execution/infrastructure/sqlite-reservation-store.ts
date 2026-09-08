import type SyncDatabase from '../../sqlite/sync-database'
import type {
  ReservationState,
  ReservationStore,
  RunReservation
} from '../application/reservation-store'
import { makeCorrelationId, type CorrelationId } from '../domain/execution-identity'

// Execution bounded context — infrastructure. The durable reservation ledger
// (amendment 001 §5). Correctness authority for the shadow-run lifecycle — the
// in-memory adapter cache never is.

type Row = {
  correlation_id: string
  slice_ref: string
  authoritative_run_ref: string | null
  workload_id: string
  state: string
  orca_run_id: string | null
  orca_dispatch_id: string | null
  org_task_id: string | null
  candidate_head: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

function toReservation(row: Row): RunReservation {
  return {
    correlationId: makeCorrelationId(row.correlation_id),
    sliceRef: row.slice_ref,
    authoritativeRunRef: row.authoritative_run_ref,
    workloadId: row.workload_id,
    state: row.state as ReservationState,
    orcaRunId: row.orca_run_id,
    orcaDispatchId: row.orca_dispatch_id,
    orgTaskId: row.org_task_id,
    candidateHead: row.candidate_head,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const TERMINAL: ReadonlySet<ReservationState> = new Set(['observed', 'abandoned'])

export class SqliteReservationStore implements ReservationStore {
  constructor(private readonly db: SyncDatabase) {}

  reserve(input: {
    correlationId: CorrelationId
    sliceRef: string
    authoritativeRunRef: string | null
    workloadId: string
    now: string
  }): RunReservation {
    this.db
      .prepare(
        `INSERT INTO run_reservation (
           correlation_id, slice_ref, authoritative_run_ref, workload_id, state,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'reserved', ?, ?)`
      )
      .run(
        String(input.correlationId),
        input.sliceRef,
        input.authoritativeRunRef,
        input.workloadId,
        input.now,
        input.now
      )
    return this.get(input.correlationId)!
  }

  advance(
    correlationId: CorrelationId,
    to: ReservationState,
    patch: {
      orcaRunId?: string
      orcaDispatchId?: string
      orgTaskId?: string
      candidateHead?: string
      lastError?: string
      now: string
    } = { now: new Date().toISOString() }
  ): RunReservation {
    const current = this.get(correlationId)
    if (!current) {
      throw new Error(`unknown reservation ${correlationId}`)
    }
    this.db
      .prepare(
        `UPDATE run_reservation SET
           state = ?,
           orca_run_id = COALESCE(?, orca_run_id),
           orca_dispatch_id = COALESCE(?, orca_dispatch_id),
           org_task_id = COALESCE(?, org_task_id),
           candidate_head = COALESCE(?, candidate_head),
           last_error = COALESCE(?, last_error),
           updated_at = ?
         WHERE correlation_id = ?`
      )
      .run(
        to,
        patch.orcaRunId ?? null,
        patch.orcaDispatchId ?? null,
        patch.orgTaskId ?? null,
        patch.candidateHead ?? null,
        patch.lastError ?? null,
        patch.now,
        String(correlationId)
      )
    return this.get(correlationId)!
  }

  get(correlationId: CorrelationId): RunReservation | undefined {
    const row = this.db
      .prepare('SELECT * FROM run_reservation WHERE correlation_id = ?')
      .get(String(correlationId)) as Row | undefined
    return row ? toReservation(row) : undefined
  }

  listIncomplete(sliceRef: string): RunReservation[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM run_reservation WHERE slice_ref = ? ORDER BY created_at, correlation_id'
        )
        .all(sliceRef) as Row[]
    )
      .map(toReservation)
      .filter((r) => !TERMINAL.has(r.state))
  }

  findByAuthoritativeWorkload(
    sliceRef: string,
    authoritativeRunRef: string | null,
    workloadId: string
  ): RunReservation | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM run_reservation
         WHERE slice_ref = ? AND workload_id = ?
           AND ((authoritative_run_ref IS NULL AND ? IS NULL) OR authoritative_run_ref = ?)`
      )
      .get(sliceRef, workloadId, authoritativeRunRef, authoritativeRunRef) as Row | undefined
    return row ? toReservation(row) : undefined
  }

  listAll(sliceRef: string): RunReservation[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM run_reservation WHERE slice_ref = ? ORDER BY created_at, correlation_id'
        )
        .all(sliceRef) as Row[]
    ).map(toReservation)
  }
}
