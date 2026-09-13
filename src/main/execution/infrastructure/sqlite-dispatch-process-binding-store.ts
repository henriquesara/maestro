import type SyncDatabase from '../../sqlite/sync-database'
import type { DispatchProcessBindingRecord, OsStartMarkerSource, ProcessTreeKillScope } from '../domain/dispatch-process-binding'
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
}

function toRecord(row: Row): DispatchProcessBindingRecord {
  return {
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
}

export class SqliteDispatchProcessBindingStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATION_BOUNDARY_LIFECYCLE_SQL)
  }

  insert(record: DispatchProcessBindingRecord): void {
    this.ensureSchema()
    this.db
      .prepare(
        `INSERT INTO dispatch_process_binding (
           orca_dispatch_id, correlation_id, orca_run_id, process_nonce, pid,
           kill_scope, os_start_marker, os_start_marker_source, spawned_at, teardown_requested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        record.teardownRequestedAt
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

  /** §9.3, window L6 — idempotent: a second call never overwrites the first timestamp. */
  markTeardownRequested(orcaDispatchId: string, at: string): void {
    this.ensureSchema()
    this.db
      .prepare(
        'UPDATE dispatch_process_binding SET teardown_requested_at = ? WHERE orca_dispatch_id = ? AND teardown_requested_at IS NULL'
      )
      .run(at, orcaDispatchId)
  }
}
