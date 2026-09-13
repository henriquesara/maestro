import type SyncDatabase from '../../sqlite/sync-database'
import type { DispatchLifecycleIncidentKind, DispatchLifecycleIncidentRecord } from '../domain/dispatch-lifecycle-incident'
import { DELEGATION_BOUNDARY_LIFECYCLE_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// dispatch_lifecycle_incident (§8.4) — the S4-ONLY incident channel, never
// settlement_incident or worktree_provenance_incident. UNIQUE(correlation_id,
// kind, evidence_digest); `INSERT ... ON CONFLICT DO NOTHING`. Classified
// PROJECTION (§8.0, §8.8) — the only S4 table a rebuild drops + recreates. No
// sweep clears `blocked` — only the manual-resolution contract does.

type Row = {
  id: string
  correlation_id: string
  orca_dispatch_id: string | null
  slice_ref: string
  kind: string
  evidence_digest: string
  detail_json: string
  blocked: number
  resolved_at: string | null
  resolution_note: string | null
  raised_at: string
}

function toRecord(row: Row): DispatchLifecycleIncidentRecord {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    orcaDispatchId: row.orca_dispatch_id,
    sliceRef: row.slice_ref,
    kind: row.kind as DispatchLifecycleIncidentKind,
    evidenceDigest: row.evidence_digest,
    detailJson: row.detail_json,
    blocked: row.blocked !== 0,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    raisedAt: row.raised_at
  }
}

export class SqliteDispatchLifecycleIncidentStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATION_BOUNDARY_LIFECYCLE_SQL)
  }

  insert(record: DispatchLifecycleIncidentRecord): { inserted: boolean } {
    this.ensureSchema()
    const info = this.db
      .prepare(
        `INSERT INTO dispatch_lifecycle_incident (
           id, correlation_id, orca_dispatch_id, slice_ref, kind, evidence_digest,
           detail_json, blocked, resolved_at, resolution_note, raised_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(correlation_id, kind, evidence_digest) DO NOTHING`
      )
      .run(
        record.id,
        record.correlationId,
        record.orcaDispatchId,
        record.sliceRef,
        record.kind,
        record.evidenceDigest,
        record.detailJson,
        record.blocked ? 1 : 0,
        record.resolvedAt,
        record.resolutionNote,
        record.raisedAt
      )
    return { inserted: Number(info.changes) > 0 }
  }

  listBySlice(sliceRef: string): DispatchLifecycleIncidentRecord[] {
    this.ensureSchema()
    return (
      this.db
        .prepare('SELECT * FROM dispatch_lifecycle_incident WHERE slice_ref = ? ORDER BY raised_at, id')
        .all(sliceRef) as Row[]
    ).map(toRecord)
  }

  /** Consulted ONLY by convergeDelegationBoundaryLifecycle — never suppresses S1/S2/S3 (§14 LIFE-9). */
  hasOpenLifecycleIncident(correlationId: string): boolean {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT 1 FROM dispatch_lifecycle_incident WHERE correlation_id = ? AND resolved_at IS NULL LIMIT 1')
      .get(correlationId)
    return row !== undefined
  }

  resolve(id: string, input: { resolvedAt: string; resolutionNote: string }): void {
    this.ensureSchema()
    this.db
      .prepare(
        'UPDATE dispatch_lifecycle_incident SET resolved_at = ?, resolution_note = ?, blocked = 0 WHERE id = ?'
      )
      .run(input.resolvedAt, input.resolutionNote, id)
  }
}
