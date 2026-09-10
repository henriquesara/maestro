// Execution bounded context — application. The DurableSettlementSource read port
// (§14). Resolve + read in one call, entirely over a read-only shadow
// orchestration.db. NO Orca row type crosses this port — the adapter returns a
// plain DurableSettlementRead.

import type { DurableSettlementSnapshot } from '../domain/durable-settlement-snapshot'

export type DurableSettlementRead =
  | { kind: 'no_task' }
  | { kind: 'no_dispatch' }
  | { kind: 'non_terminal'; dispatchId: string }
  | { kind: 'foreign'; resolvedDispatchId: string; resolvedRunId: string; failedCheck: string }
  | { kind: 'unresolvable'; partial: unknown; failedExpectation: string }
  | { kind: 'terminal'; snapshot: DurableSettlementSnapshot; sourceDigest: string }

export type DurableSettlementReadInput = {
  correlationId: string
  boundDispatchId: string
  boundRunId: string
}

/** §10 — the `sourceGuard` block of the SettlementConvergenceReport. */
export type SourceGuardCounters = {
  openedReadonly: boolean
  ddlIssued: number
  pragmaJournalMutations: number
  triggersCreated: number
  metadataWrites: number
  sidecarsCreatedByS2: number
}

export type DurableSettlementSource = {
  readSettlement(input: DurableSettlementReadInput): DurableSettlementRead
  sourceGuard(): SourceGuardCounters
}
