import type SyncDatabase from '../../sqlite/sync-database'
import type { SettlementObservationStore } from '../application/settlement-observation-store'
import type {
  SettlementObservationRecord,
  SettlementObservationStatus
} from '../domain/settlement-observation'

// Execution bounded context — infrastructure. The only writer of
// settlement_observation (§12). Shares its SyncDatabase handle with
// SqliteExecutionStore / SqliteReservationStore. Write-once PRIMARY KEY
// correlation_id; the only permitted mutation is
// status 'observed' → 'observed_conflicted' + conflicted_at (§7, I-S2-2).

type Row = {
  correlation_id: string
  orca_dispatch_id: string
  orca_run_id: string
  org_task_id: string
  slice_ref: string
  status: string
  source_dispatch_status: string
  source_dispatch_completed_at: string | null
  source_task_status: string
  source_task_completed_at: string | null
  source_digest: string
  observed_outcome_json: string
  provenance_json: string
  first_seen_at: string
  observed_at: string
  conflicted_at: string | null
}

function toRecord(row: Row): SettlementObservationRecord {
  return {
    correlationId: row.correlation_id,
    orcaDispatchId: row.orca_dispatch_id,
    orcaRunId: row.orca_run_id,
    orgTaskId: row.org_task_id,
    sliceRef: row.slice_ref,
    status: row.status as SettlementObservationStatus,
    sourceDispatchStatus: row.source_dispatch_status,
    sourceDispatchCompletedAt: row.source_dispatch_completed_at,
    sourceTaskStatus: row.source_task_status,
    sourceTaskCompletedAt: row.source_task_completed_at,
    sourceDigest: row.source_digest,
    observedOutcomeJson: row.observed_outcome_json,
    provenanceJson: row.provenance_json,
    firstSeenAt: row.first_seen_at,
    observedAt: row.observed_at,
    conflictedAt: row.conflicted_at
  }
}

export class SqliteSettlementObservationStore implements SettlementObservationStore {
  constructor(private readonly db: SyncDatabase) {}

  insert(record: SettlementObservationRecord): { inserted: boolean } {
    const info = this.db
      .prepare(
        `INSERT INTO settlement_observation (
           correlation_id, orca_dispatch_id, orca_run_id, org_task_id, slice_ref, status,
           source_dispatch_status, source_dispatch_completed_at, source_task_status,
           source_task_completed_at, source_digest, observed_outcome_json, provenance_json,
           first_seen_at, observed_at, conflicted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(correlation_id) DO NOTHING`
      )
      .run(
        record.correlationId,
        record.orcaDispatchId,
        record.orcaRunId,
        record.orgTaskId,
        record.sliceRef,
        record.status,
        record.sourceDispatchStatus,
        record.sourceDispatchCompletedAt,
        record.sourceTaskStatus,
        record.sourceTaskCompletedAt,
        record.sourceDigest,
        record.observedOutcomeJson,
        record.provenanceJson,
        record.firstSeenAt,
        record.observedAt,
        record.conflictedAt
      )
    return { inserted: Number(info.changes) > 0 }
  }

  getByCorrelation(correlationId: string): SettlementObservationRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM settlement_observation WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  listBySlice(sliceRef: string): SettlementObservationRecord[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM settlement_observation WHERE slice_ref = ? ORDER BY first_seen_at, correlation_id'
        )
        .all(sliceRef) as Row[]
    ).map(toRecord)
  }

  markConflicted(correlationId: string, conflictedAt: string): void {
    // The ONLY permitted mutation. `WHERE status = 'observed'` makes it idempotent:
    // an already-conflicted row is untouched, keeping its first conflicted_at.
    const conflicted: SettlementObservationStatus = 'observed_conflicted'
    this.db
      .prepare(
        `UPDATE settlement_observation
         SET status = ?, conflicted_at = ?
         WHERE correlation_id = ? AND status = 'observed'`
      )
      .run(conflicted, conflictedAt, correlationId)
  }
}
