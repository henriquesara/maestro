import type SyncDatabase from '../../sqlite/sync-database'
import type { WorktreeProvenanceStore } from '../application/worktree-provenance-store'
import type {
  WorktreeProvenanceRecord,
  WorktreeProvenanceStatus
} from '../domain/worktree-provenance'
import { WORKTREE_PROVENANCE_PROJECTION_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// worktree_provenance (§7.1). Write-once PRIMARY KEY correlation_id; the only
// permitted mutation is status 'recorded' -> 'conflicted' (+ conflicted_at).
// A provenance-projection rebuild drops this table (§7.5); ensureSchema()
// defensively re-creates it (idempotent) so this store keeps working across
// an external DROP without requiring a fresh migrateExecutionStore call.

type Row = {
  correlation_id: string
  orca_dispatch_id: string
  orca_run_id: string
  slice_ref: string
  status: string
  base_commit: string
  candidate_head: string
  files_changed_json: string
  provenance_source: string
  worktree_path_ref: string
  provenance_digest: string
  provenance_json: string
  first_seen_at: string
  observed_at: string
  conflicted_at: string | null
}

function toRecord(row: Row): WorktreeProvenanceRecord {
  return {
    correlationId: row.correlation_id,
    orcaDispatchId: row.orca_dispatch_id,
    orcaRunId: row.orca_run_id,
    sliceRef: row.slice_ref,
    status: row.status as WorktreeProvenanceStatus,
    baseCommit: row.base_commit,
    candidateHead: row.candidate_head,
    filesChangedJson: row.files_changed_json,
    provenanceSource: row.provenance_source as WorktreeProvenanceRecord['provenanceSource'],
    worktreePathRef: row.worktree_path_ref,
    provenanceDigest: row.provenance_digest,
    provenanceJson: row.provenance_json,
    firstSeenAt: row.first_seen_at,
    observedAt: row.observed_at,
    conflictedAt: row.conflicted_at
  }
}

export class SqliteWorktreeProvenanceStore implements WorktreeProvenanceStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(WORKTREE_PROVENANCE_PROJECTION_SQL)
  }

  insert(record: WorktreeProvenanceRecord): { inserted: boolean } {
    this.ensureSchema()
    const info = this.db
      .prepare(
        `INSERT INTO worktree_provenance (
           correlation_id, orca_dispatch_id, orca_run_id, slice_ref, status,
           base_commit, candidate_head, files_changed_json, provenance_source,
           worktree_path_ref, provenance_digest, provenance_json, first_seen_at,
           observed_at, conflicted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(correlation_id) DO NOTHING`
      )
      .run(
        record.correlationId,
        record.orcaDispatchId,
        record.orcaRunId,
        record.sliceRef,
        record.status,
        record.baseCommit,
        record.candidateHead,
        record.filesChangedJson,
        record.provenanceSource,
        record.worktreePathRef,
        record.provenanceDigest,
        record.provenanceJson,
        record.firstSeenAt,
        record.observedAt,
        record.conflictedAt
      )
    return { inserted: Number(info.changes) > 0 }
  }

  getByCorrelation(correlationId: string): WorktreeProvenanceRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM worktree_provenance WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  listBySlice(sliceRef: string): WorktreeProvenanceRecord[] {
    this.ensureSchema()
    return (
      this.db
        .prepare(
          'SELECT * FROM worktree_provenance WHERE slice_ref = ? ORDER BY first_seen_at, correlation_id'
        )
        .all(sliceRef) as Row[]
    ).map(toRecord)
  }

  markConflicted(correlationId: string, input: { conflictedAt: string }): void {
    this.ensureSchema()
    // The ONLY permitted mutation. `WHERE status = 'recorded'` makes it idempotent:
    // an already-conflicted row is untouched, keeping its first conflicted_at.
    const conflicted: WorktreeProvenanceStatus = 'conflicted'
    this.db
      .prepare(
        `UPDATE worktree_provenance
         SET status = ?, conflicted_at = ?
         WHERE correlation_id = ? AND status = 'recorded'`
      )
      .run(conflicted, input.conflictedAt, correlationId)
  }
}
