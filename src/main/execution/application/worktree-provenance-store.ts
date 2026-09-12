// Execution bounded context — application. Persistence port for the S3-owned
// worktree_provenance projection (§7.1). Write-once per correlation_id; the
// only permitted mutation is status 'recorded' -> 'conflicted' (+ conflicted_at).

import type { WorktreeProvenanceRecord } from '../domain/worktree-provenance'

export type WorktreeProvenanceStore = {
  /** Insert-or-no-op. A PRIMARY KEY collision returns `{ inserted: false }` — never an error (PROV-1/PROV-2). */
  insert(record: WorktreeProvenanceRecord): { inserted: boolean }
  getByCorrelation(correlationId: string): WorktreeProvenanceRecord | undefined
  listBySlice(sliceRef: string): WorktreeProvenanceRecord[]
  /** The ONLY permitted mutation. Idempotent — a second call does not change conflictedAt. */
  markConflicted(correlationId: string, input: { conflictedAt: string }): void
}
