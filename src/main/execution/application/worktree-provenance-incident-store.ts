// Execution bounded context — application. Persistence port for the S3-owned,
// S3-ONLY incident channel (§7.3, B1). Keyed (correlation_id, kind,
// evidence_digest). Never auto-resolved; its open-incident predicate gates
// ONLY convergeWorktreeProvenance (PROV-10) — never settlement_incident.

import type { WorktreeProvenanceIncidentRecord } from '../domain/worktree-provenance'

export type WorktreeProvenanceIncidentStore = {
  /** `INSERT ... ON CONFLICT DO NOTHING` — a duplicate evidence key returns `{ inserted: false }`. */
  insert(record: WorktreeProvenanceIncidentRecord): { inserted: boolean }
  listBySlice(sliceRef: string): WorktreeProvenanceIncidentRecord[]
  hasOpenIncident(correlationId: string): boolean
  /** Contract-only manual resolution (mirrors ORCA-S2 §13.1). */
  resolve(id: string, input: { resolvedAt: string; resolutionNote: string }): void
}
