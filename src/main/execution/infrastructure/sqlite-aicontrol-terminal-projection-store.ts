import type SyncDatabase from '../../sqlite/sync-database'
import type {
  AiControlTerminalProjectionRecord,
  AiControlTerminalProjectionStatus
} from '../domain/aicontrol-terminal-projection'
import { DELEGATED_CUTOVER_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// aicontrol_terminal_projection (SPEC §8.3, §14 X8). The row is mutable retry
// bookkeeping ONLY while `status = 'pending'`; once it leaves `pending` it is SOURCE
// for its own terminal state (§17) and every mutation below is guarded on
// `status = 'pending'`, so a non-pending row can never be rewritten. Creation is
// idempotent by PRIMARY KEY (`INSERT OR IGNORE`): a racing creator reads the winner.

type Row = {
  correlation_id: string
  aicontrol_run_id: string
  fence_token_ref: string
  closure_digest_ref: string
  attempt_count: number
  last_attempted_at: string | null
  projected_at: string | null
  status: string
}

function toRecord(row: Row): AiControlTerminalProjectionRecord {
  return {
    correlationId: row.correlation_id,
    aicontrolRunId: row.aicontrol_run_id,
    fenceTokenRef: row.fence_token_ref,
    closureDigestRef: row.closure_digest_ref,
    attemptCount: row.attempt_count,
    lastAttemptedAt: row.last_attempted_at,
    projectedAt: row.projected_at,
    status: row.status as AiControlTerminalProjectionStatus
  }
}

export type NewAiControlTerminalProjection = Pick<
  AiControlTerminalProjectionRecord,
  'correlationId' | 'aicontrolRunId' | 'fenceTokenRef' | 'closureDigestRef'
> & { status: 'pending' | 'blocked_closure_contradicted' }

export class SqliteAiControlTerminalProjectionStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATED_CUTOVER_SQL)
  }

  /** Idempotent: returns whether THIS call created the row. Never overwrites an existing row. */
  insertIfAbsent(record: NewAiControlTerminalProjection): { inserted: boolean } {
    this.ensureSchema()
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO aicontrol_terminal_projection (
           correlation_id, aicontrol_run_id, fence_token_ref, closure_digest_ref,
           attempt_count, last_attempted_at, projected_at, status
         ) VALUES (?, ?, ?, ?, 0, NULL, NULL, ?)`
      )
      .run(
        record.correlationId,
        record.aicontrolRunId,
        record.fenceTokenRef,
        record.closureDigestRef,
        record.status
      )
    return { inserted: Number(result.changes) > 0 }
  }

  get(correlationId: string): AiControlTerminalProjectionRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM aicontrol_terminal_projection WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  /** Durable attempt bookkeeping, written BEFORE the transport call so a crash mid-call still counts. */
  recordAttempt(correlationId: string, at: string): void {
    this.ensureSchema()
    this.db
      .prepare(
        `UPDATE aicontrol_terminal_projection
            SET attempt_count = attempt_count + 1, last_attempted_at = ?
          WHERE correlation_id = ? AND status = 'pending'`
      )
      .run(at, correlationId)
  }

  /** The one-way `pending -> <terminal status>` transition; a no-op on any non-pending row. */
  resolve(
    correlationId: string,
    status: Exclude<AiControlTerminalProjectionStatus, 'pending'>,
    projectedAt: string | null
  ): void {
    this.ensureSchema()
    this.db
      .prepare(
        `UPDATE aicontrol_terminal_projection SET status = ?, projected_at = ?
          WHERE correlation_id = ? AND status = 'pending'`
      )
      .run(status, projectedAt, correlationId)
  }
}
