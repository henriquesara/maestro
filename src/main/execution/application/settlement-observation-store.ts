// Execution bounded context — application. Persistence port for the S2-owned
// settlement_observation aggregate (§12). Write-once per correlation_id; the only
// permitted mutation is status 'observed' → 'observed_conflicted' + conflicted_at.

import type { SettlementObservationRecord } from '../domain/settlement-observation'

export type SettlementObservationStore = {
  /** Insert-or-no-op. A PRIMARY KEY collision returns `{ inserted: false }` — never an error (§16.2). */
  insert(record: SettlementObservationRecord): { inserted: boolean }
  getByCorrelation(correlationId: string): SettlementObservationRecord | undefined
  listBySlice(sliceRef: string): SettlementObservationRecord[]
  /** The ONLY permitted mutation (§7, §12). No-op if the row is not currently 'observed'. */
  markConflicted(correlationId: string, conflictedAt: string): void
}
