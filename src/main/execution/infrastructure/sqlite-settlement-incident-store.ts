import type SyncDatabase from '../../sqlite/sync-database'
import type { SettlementIncidentStore } from '../application/settlement-incident-store'
import type {
  SettlementIncidentKind,
  SettlementIncidentRecord
} from '../domain/settlement-incident'

// Execution bounded context — infrastructure. The only writer of
// settlement_incident (§13). UNIQUE (correlation_id, kind, evidence_digest);
// `INSERT ... ON CONFLICT DO NOTHING`. No sweep clears `blocked`; there is no
// auto-resolution path in S2 — only the §13.1 manual-resolution contract.

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

function toRecord(row: Row): SettlementIncidentRecord {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    orcaDispatchId: row.orca_dispatch_id,
    sliceRef: row.slice_ref,
    kind: row.kind as SettlementIncidentKind,
    evidenceDigest: row.evidence_digest,
    detailJson: row.detail_json,
    blocked: row.blocked !== 0,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    raisedAt: row.raised_at
  }
}

export class SqliteSettlementIncidentStore implements SettlementIncidentStore {
  constructor(private readonly db: SyncDatabase) {}

  insert(record: SettlementIncidentRecord): { inserted: boolean } {
    const info = this.db
      .prepare(
        `INSERT INTO settlement_incident (
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

  listBySlice(sliceRef: string): SettlementIncidentRecord[] {
    return (
      this.db
        .prepare('SELECT * FROM settlement_incident WHERE slice_ref = ? ORDER BY raised_at, id')
        .all(sliceRef) as Row[]
    ).map(toRecord)
  }

  listOpenByCorrelation(correlationId: string): SettlementIncidentRecord[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM settlement_incident WHERE correlation_id = ? AND resolved_at IS NULL ORDER BY raised_at, id'
        )
        .all(correlationId) as Row[]
    ).map(toRecord)
  }

  hasOpenIncident(correlationId: string): boolean {
    const row = this.db
      .prepare(
        'SELECT 1 FROM settlement_incident WHERE correlation_id = ? AND resolved_at IS NULL LIMIT 1'
      )
      .get(correlationId)
    return row !== undefined
  }

  resolve(id: string, input: { resolvedAt: string; resolutionNote: string }): void {
    this.db
      .prepare(
        'UPDATE settlement_incident SET resolved_at = ?, resolution_note = ?, blocked = 0 WHERE id = ?'
      )
      .run(input.resolvedAt, input.resolutionNote, id)
  }
}
