import type SyncDatabase from '../../sqlite/sync-database'
import type { DispatchTerminationRecord, TerminationMethod } from '../domain/dispatch-termination'
import { DELEGATION_BOUNDARY_LIFECYCLE_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// dispatch_termination (§8.2). Durable SOURCE state — never touched by the
// projection rebuild. correlation_id is the PRIMARY KEY: a duplicate
// observation is a PK-collision no-op (§14 LIFE-6). No update method exists —
// every column is immutable after insert; there is no Phase-B re-verify for a
// termination fact because the source event cannot recur.

type Row = {
  correlation_id: string
  orca_dispatch_id: string
  termination_method: string
  exit_code: number | null
  exit_signal: string | null
  tree_verified: number
  observed_at: string
}

function toRecord(row: Row): DispatchTerminationRecord {
  return {
    correlationId: row.correlation_id,
    orcaDispatchId: row.orca_dispatch_id,
    terminationMethod: row.termination_method as TerminationMethod,
    exitCode: row.exit_code,
    exitSignal: row.exit_signal,
    treeVerified: row.tree_verified !== 0,
    observedAt: row.observed_at
  }
}

export class SqliteDispatchTerminationStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATION_BOUNDARY_LIFECYCLE_SQL)
  }

  insert(record: DispatchTerminationRecord): void {
    this.ensureSchema()
    this.db
      .prepare(
        `INSERT INTO dispatch_termination (
           correlation_id, orca_dispatch_id, termination_method, exit_code, exit_signal,
           tree_verified, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.correlationId,
        record.orcaDispatchId,
        record.terminationMethod,
        record.exitCode,
        record.exitSignal,
        record.treeVerified ? 1 : 0,
        record.observedAt
      )
  }

  getByCorrelationId(correlationId: string): DispatchTerminationRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM dispatch_termination WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }
}
