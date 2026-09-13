import type SyncDatabase from '../../sqlite/sync-database'
import type { DispatchLifecycleEventRecord } from '../domain/dispatch-lifecycle-event'
import { DELEGATION_BOUNDARY_LIFECYCLE_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// dispatch_lifecycle_event (§8.6). Durable SOURCE state (corrected from
// PROJECTION, §8.0.1) — never touched by the projection rebuild. The composite
// PRIMARY KEY (correlation_id, event_kind) IS the idempotency mechanism: a
// duplicate/hook-triggered emission attempt is a no-op (§12 window L9).

type Row = {
  correlation_id: string
  event_kind: string
  closure_digest_ref: string
  emitted_at: string
}

function toRecord(row: Row): DispatchLifecycleEventRecord {
  return {
    correlationId: row.correlation_id,
    eventKind: row.event_kind,
    closureDigestRef: row.closure_digest_ref,
    emittedAt: row.emitted_at
  }
}

export class SqliteDispatchLifecycleEventStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATION_BOUNDARY_LIFECYCLE_SQL)
  }

  insert(record: DispatchLifecycleEventRecord): void {
    this.ensureSchema()
    this.db
      .prepare(
        `INSERT INTO dispatch_lifecycle_event (correlation_id, event_kind, closure_digest_ref, emitted_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(record.correlationId, record.eventKind, record.closureDigestRef, record.emittedAt)
  }

  getByCorrelationAndKind(correlationId: string, eventKind: string): DispatchLifecycleEventRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM dispatch_lifecycle_event WHERE correlation_id = ? AND event_kind = ?')
      .get(correlationId, eventKind) as Row | undefined
    return row ? toRecord(row) : undefined
  }
}
