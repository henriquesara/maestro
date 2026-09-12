import type SyncDatabase from '../../sqlite/sync-database'
import type { DispatchWorktreeStore } from '../application/dispatch-worktree-store'
import type { DispatchWorktreeRecord } from '../domain/worktree-provenance'
import { DISPATCH_WORKTREE_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// dispatch_worktree (§7.2). Durable SOURCE state — never touched by the
// provenance-projection rebuild (§7.5, PROV-11). orca_dispatch_id is the
// PRIMARY KEY: a second insert for the same id throws, never a silent
// overwrite.

type Row = {
  orca_dispatch_id: string
  correlation_id: string
  orca_run_id: string
  worktree_nonce: string
  worktree_path: string
  root_ref: string
  opened_at: string
}

function toRecord(row: Row): DispatchWorktreeRecord {
  return {
    orcaDispatchId: row.orca_dispatch_id,
    correlationId: row.correlation_id,
    orcaRunId: row.orca_run_id,
    worktreeNonce: row.worktree_nonce,
    worktreePath: row.worktree_path,
    rootRef: row.root_ref,
    openedAt: row.opened_at
  }
}

export class SqliteDispatchWorktreeStore implements DispatchWorktreeStore {
  constructor(private readonly db: SyncDatabase) {}

  /** Defensive re-ensure — dispatch_worktree is SOURCE state and is never dropped by S3 itself. */
  private ensureSchema(): void {
    this.db.exec(DISPATCH_WORKTREE_SQL)
  }

  insert(record: DispatchWorktreeRecord): void {
    this.ensureSchema()
    this.db
      .prepare(
        `INSERT INTO dispatch_worktree (
           orca_dispatch_id, correlation_id, orca_run_id, worktree_nonce,
           worktree_path, root_ref, opened_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.orcaDispatchId,
        record.correlationId,
        record.orcaRunId,
        record.worktreeNonce,
        record.worktreePath,
        record.rootRef,
        record.openedAt
      )
  }

  getByDispatchId(orcaDispatchId: string): DispatchWorktreeRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM dispatch_worktree WHERE orca_dispatch_id = ?')
      .get(orcaDispatchId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  getByCorrelationId(correlationId: string): DispatchWorktreeRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM dispatch_worktree WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }
}
