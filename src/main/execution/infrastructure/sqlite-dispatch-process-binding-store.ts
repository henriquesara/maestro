import type SyncDatabase from '../../sqlite/sync-database'
import type {
  DispatchProcessBindingRecord,
  OsStartMarkerSource,
  ProcessTreeKillScope,
  TeardownReason
} from '../domain/dispatch-process-binding'
import { DELEGATION_BOUNDARY_LIFECYCLE_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// dispatch_process_binding (§8.1). Durable SOURCE state — never touched by the
// projection rebuild (§8.8, LIFE-4). orca_dispatch_id is the PRIMARY KEY: a
// second insert for the same id throws, never a silent overwrite.
// teardown_requested_at is the ONE permitted post-insert mutation.

type Row = {
  orca_dispatch_id: string
  correlation_id: string
  orca_run_id: string
  process_nonce: string
  pid: number
  kill_scope: string
  os_start_marker: string | null
  os_start_marker_source: string
  spawned_at: string
  teardown_requested_at: string | null
  /** ORCA-S5 §8.2 — additive column (schema v6). Absent on a row read from a pre-v6 shape. */
  teardown_reason?: string | null
}

function toRecord(row: Row): DispatchProcessBindingRecord {
  const record: DispatchProcessBindingRecord = {
    orcaDispatchId: row.orca_dispatch_id,
    correlationId: row.correlation_id,
    orcaRunId: row.orca_run_id,
    processNonce: row.process_nonce,
    pid: row.pid,
    killScope: row.kill_scope as ProcessTreeKillScope,
    osStartMarker: row.os_start_marker,
    osStartMarkerSource: row.os_start_marker_source as OsStartMarkerSource,
    spawnedAt: row.spawned_at,
    teardownRequestedAt: row.teardown_requested_at
  }
  // Keyed only when set, so every ORCA-S4 shadow record keeps its exact shape.
  if (row.teardown_reason) {
    record.teardownReason = row.teardown_reason as TeardownReason
  }
  return record
}

export class SqliteDispatchProcessBindingStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATION_BOUNDARY_LIFECYCLE_SQL)
  }

  insert(record: DispatchProcessBindingRecord): void {
    this.ensureSchema()
    // ORCA-S5 — `teardown_reason` joins the single INSERT only when provided (never set at
    // spawn for a real run; kept for completeness). Otherwise the ORCA-S4 statement is unchanged.
    const withReason = Boolean(record.teardownReason)
    this.db
      .prepare(
        `INSERT INTO dispatch_process_binding (
           orca_dispatch_id, correlation_id, orca_run_id, process_nonce, pid,
           kill_scope, os_start_marker, os_start_marker_source, spawned_at, teardown_requested_at${
             withReason ? ', teardown_reason' : ''
           }
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${withReason ? ', ?' : ''})`
      )
      .run(
        record.orcaDispatchId,
        record.correlationId,
        record.orcaRunId,
        record.processNonce,
        record.pid,
        record.killScope,
        record.osStartMarker,
        record.osStartMarkerSource,
        record.spawnedAt,
        record.teardownRequestedAt,
        ...(withReason ? [record.teardownReason as string] : [])
      )
  }

  getByDispatchId(orcaDispatchId: string): DispatchProcessBindingRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM dispatch_process_binding WHERE orca_dispatch_id = ?')
      .get(orcaDispatchId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  getByCorrelationId(correlationId: string): DispatchProcessBindingRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM dispatch_process_binding WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  /**
   * §9.3, window L6 — idempotent: a second call never overwrites the first timestamp.
   * ORCA-S5 §9.1/§12/X13 — with a `reason`, `teardown_requested_at` and `teardown_reason` are
   * written in ONE statement guarded by `teardown_requested_at IS NULL`, so the FIRST durable
   * writer wins, a later conflicting reason is a silent no-op, and there is never a window in
   * which intent exists without its reason. Returns whether THIS call won the write.
   */
  markTeardownRequested(
    orcaDispatchId: string,
    at: string,
    reason?: TeardownReason
  ): { applied: boolean } {
    this.ensureSchema()
    const result = reason
      ? this.db
          .prepare(
            'UPDATE dispatch_process_binding SET teardown_requested_at = ?, teardown_reason = ? WHERE orca_dispatch_id = ? AND teardown_requested_at IS NULL'
          )
          .run(at, reason, orcaDispatchId)
      : this.db
          .prepare(
            'UPDATE dispatch_process_binding SET teardown_requested_at = ? WHERE orca_dispatch_id = ? AND teardown_requested_at IS NULL'
          )
          .run(at, orcaDispatchId)
    return { applied: Number(result.changes) > 0 }
  }
}
