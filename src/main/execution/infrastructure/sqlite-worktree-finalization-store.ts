import type SyncDatabase from '../../sqlite/sync-database'
import type { WorktreeFinalizationRecord, WorktreeFinalizationStatus } from '../domain/worktree-finalization'
import { DELEGATION_BOUNDARY_LIFECYCLE_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// worktree_finalization (§8.3, §10.2). Durable SOURCE state. correlation_id is
// the PRIMARY KEY: insertIntent throws on a second attempt for the same
// binding (§12 window L8, LIFE-7 — duplicate finalization is a no-op, never a
// double-delete).

type Row = {
  correlation_id: string
  orca_dispatch_id: string
  slice_ref: string
  eligibility_digest: string
  intent_recorded_at: string
  status: string
  finalized_at: string | null
  outcome_detail_json: string | null
  conflicted_at: string | null
}

function toRecord(row: Row): WorktreeFinalizationRecord {
  return {
    correlationId: row.correlation_id,
    orcaDispatchId: row.orca_dispatch_id,
    sliceRef: row.slice_ref,
    eligibilityDigest: row.eligibility_digest,
    intentRecordedAt: row.intent_recorded_at,
    status: row.status as WorktreeFinalizationStatus,
    finalizedAt: row.finalized_at,
    outcomeDetailJson: row.outcome_detail_json,
    conflictedAt: row.conflicted_at
  }
}

export class SqliteWorktreeFinalizationStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATION_BOUNDARY_LIFECYCLE_SQL)
  }

  /** §10.2 step 1 — durable intent BEFORE any filesystem deletion is attempted. */
  insertIntent(record: WorktreeFinalizationRecord): void {
    this.ensureSchema()
    this.db
      .prepare(
        `INSERT INTO worktree_finalization (
           correlation_id, orca_dispatch_id, slice_ref, eligibility_digest,
           intent_recorded_at, status, finalized_at, outcome_detail_json, conflicted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.correlationId,
        record.orcaDispatchId,
        record.sliceRef,
        record.eligibilityDigest,
        record.intentRecordedAt,
        record.status,
        record.finalizedAt,
        record.outcomeDetailJson,
        record.conflictedAt
      )
  }

  getByCorrelationId(correlationId: string): WorktreeFinalizationRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM worktree_finalization WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  /** §10.2 step 4 — idempotent: safe to call twice with the same outcome (L3/L4/L5 retry). */
  markFinalized(correlationId: string, input: { finalizedAt: string; outcomeDetailJson: string }): void {
    this.ensureSchema()
    this.db
      .prepare(
        "UPDATE worktree_finalization SET status = 'finalized', finalized_at = ?, outcome_detail_json = ? WHERE correlation_id = ? AND status = 'intent_recorded'"
      )
      .run(input.finalizedAt, input.outcomeDetailJson, correlationId)
    // idempotent retry: if status is already 'finalized' with identical
    // outcome, the WHERE clause matches zero rows — a legitimate no-op.
  }

  /** §10.2 — a legacy/pre-S3 binding, no durable worktree at all: no filesystem act. */
  markSkippedNotEligible(correlationId: string): void {
    this.ensureSchema()
    this.db
      .prepare(
        "UPDATE worktree_finalization SET status = 'skipped_not_eligible' WHERE correlation_id = ? AND status = 'intent_recorded'"
      )
      .run(correlationId)
  }

  /** §10.2 step 2 — a Phase-B re-verify found the eligibility digest diverged; no deletion attempted. */
  markConflicted(correlationId: string, conflictedAt: string): void {
    this.ensureSchema()
    this.db
      .prepare(
        "UPDATE worktree_finalization SET status = 'conflicted', conflicted_at = ? WHERE correlation_id = ? AND status = 'intent_recorded'"
      )
      .run(conflictedAt, correlationId)
  }
}
