import type SyncDatabase from '../../sqlite/sync-database'
import type { DispatchLifecycleClosureRecord } from '../domain/dispatch-lifecycle-closure'
import { DELEGATION_BOUNDARY_LIFECYCLE_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// dispatch_lifecycle_closure (§8.5). Durable SOURCE state (corrected from
// PROJECTION, §8.0.1) — never touched by the projection rebuild. correlation_id
// is the PRIMARY KEY: structurally forbids a replacement closure row for a
// correlation_id that already has one (§7, LIFE-15). The surface exposes only
// `insert` and the ONE permitted post-insert mutation — there is deliberately
// no update/rewrite/replace method of any kind.

type Row = {
  correlation_id: string
  orca_dispatch_id: string
  orca_run_id: string
  slice_ref: string
  settlement_status_ref: string
  worktree_provenance_ref: string
  termination_method_ref: string
  finalization_status_ref: string
  closure_digest: string
  closed_at: string
  post_closure_settlement_conflict_detected_at: string | null
}

function toRecord(row: Row): DispatchLifecycleClosureRecord {
  return {
    correlationId: row.correlation_id,
    orcaDispatchId: row.orca_dispatch_id,
    orcaRunId: row.orca_run_id,
    sliceRef: row.slice_ref,
    settlementStatusRef: row.settlement_status_ref,
    worktreeProvenanceRef: row.worktree_provenance_ref,
    terminationMethodRef: row.termination_method_ref,
    finalizationStatusRef: row.finalization_status_ref,
    closureDigest: row.closure_digest,
    closedAt: row.closed_at,
    postClosureSettlementConflictDetectedAt: row.post_closure_settlement_conflict_detected_at
  }
}

export class SqliteDispatchLifecycleClosureStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATION_BOUNDARY_LIFECYCLE_SQL)
  }

  insert(record: DispatchLifecycleClosureRecord): void {
    this.ensureSchema()
    this.db
      .prepare(
        `INSERT INTO dispatch_lifecycle_closure (
           correlation_id, orca_dispatch_id, orca_run_id, slice_ref,
           settlement_status_ref, worktree_provenance_ref, termination_method_ref,
           finalization_status_ref, closure_digest, closed_at, post_closure_settlement_conflict_detected_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.correlationId,
        record.orcaDispatchId,
        record.orcaRunId,
        record.sliceRef,
        record.settlementStatusRef,
        record.worktreeProvenanceRef,
        record.terminationMethodRef,
        record.finalizationStatusRef,
        record.closureDigest,
        record.closedAt,
        record.postClosureSettlementConflictDetectedAt
      )
  }

  getByCorrelationId(correlationId: string): DispatchLifecycleClosureRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM dispatch_lifecycle_closure WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  /** §11 Phase 5 — every existing closure not yet marked with a post-closure conflict, for THIS slice. */
  listPendingPostClosureCheck(sliceRef: string): DispatchLifecycleClosureRecord[] {
    this.ensureSchema()
    return (
      this.db
        .prepare(
          'SELECT * FROM dispatch_lifecycle_closure WHERE slice_ref = ? AND post_closure_settlement_conflict_detected_at IS NULL'
        )
        .all(sliceRef) as Row[]
    ).map(toRecord)
  }

  /**
   * §7, §11 Phase 5, LIFE-15 — the ONE permitted post-insert mutation. Sets
   * post_closure_settlement_conflict_detected_at exactly once; idempotent — a
   * second call never overwrites the first timestamp (Phase 5's own
   * fixed-point property). Touches no other column.
   */
  markPostClosureSettlementConflictDetected(correlationId: string, at: string): void {
    this.ensureSchema()
    this.db
      .prepare(
        'UPDATE dispatch_lifecycle_closure SET post_closure_settlement_conflict_detected_at = ? WHERE correlation_id = ? AND post_closure_settlement_conflict_detected_at IS NULL'
      )
      .run(at, correlationId)
  }
}
