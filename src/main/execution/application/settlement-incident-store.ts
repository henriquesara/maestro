// Execution bounded context — application. Persistence port for the S2-owned
// settlement_incident aggregate (§13). Keyed (correlation_id, kind,
// evidence_digest). Never auto-resolved by S2; only its contract is defined.

import type { SettlementIncidentRecord } from '../domain/settlement-incident'

export type SettlementIncidentStore = {
  /** `INSERT ... ON CONFLICT DO NOTHING` — a duplicate evidence key returns `{ inserted: false }`. */
  insert(record: SettlementIncidentRecord): { inserted: boolean }
  listBySlice(sliceRef: string): SettlementIncidentRecord[]
  listOpenByCorrelation(correlationId: string): SettlementIncidentRecord[]
  hasOpenIncident(correlationId: string): boolean
  /** §13.1 — the manual-resolution contract (workflow itself out of S2 scope). */
  resolve(id: string, input: { resolvedAt: string; resolutionNote: string }): void
}
