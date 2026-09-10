import { createHash } from 'node:crypto'
import { canonicalSerialize } from './durable-settlement-snapshot'

// Execution bounded context — domain. The settlement-incident aggregate (§13):
// a DURABLE SEMANTIC divergence replay of durable facts cannot resolve. Blocks
// its binding. Never auto-resolved. Never overwritten by later conflicting
// evidence (the key includes evidence_digest). A transient operational inability
// is NOT an incident.

export type SettlementIncidentKind =
  | 'foreign_dispatch'
  | 'invalid_or_unresolvable_source'
  | 'source_snapshot_changed'

export type SettlementIncidentRecord = {
  id: string
  correlationId: string
  orcaDispatchId: string | null
  sliceRef: string
  kind: SettlementIncidentKind
  evidenceDigest: string
  detailJson: string
  blocked: boolean
  resolvedAt: string | null
  resolutionNote: string | null
  raisedAt: string
}

/** Component joiner for the identity-triple evidence digest — NUL keeps components unambiguous. */
export const EVIDENCE_JOINER = String.fromCharCode(0)

/** §13 — `SHA-256(resolved_dispatch_id ‖ resolved_run_id ‖ correlationId)`. */
export function foreignDispatchEvidenceDigest(
  resolvedDispatchId: string,
  resolvedRunId: string,
  correlationId: string
): string {
  return createHash('sha256')
    .update([resolvedDispatchId, resolvedRunId, correlationId].join(EVIDENCE_JOINER))
    .digest('hex')
}

/** §13 — `SHA-256` of the partial/failed canonical snapshot attempt. */
export function invalidSourceEvidenceDigest(partial: unknown): string {
  return createHash('sha256').update(canonicalSerialize(partial)).digest('hex')
}

/** §13 — the new stable (conflicting) `source_digest` IS the evidence digest for this kind. */
export function sourceSnapshotChangedEvidenceDigest(newStableSourceDigest: string): string {
  return newStableSourceDigest
}
