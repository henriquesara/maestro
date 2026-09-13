// Execution bounded context — domain. Pure.
// ORCA-S4 SPEC §8.4 — the S4-only incident channel (never settlement_incident,
// never worktree_provenance_incident). PROJECTION: the only S4 table a rebuild
// drops + recreates (§8.0, §8.8).

export type DispatchLifecycleIncidentKind =
  | 'process_identity_mismatch'
  | 'orphan_process_unverifiable'
  | 'worktree_finalization_conflict'
  | 'orphan_worktree_unverifiable'
  | 'post_closure_settlement_conflict'

export type DispatchLifecycleIncidentRecord = {
  id: string
  correlationId: string
  orcaDispatchId: string | null
  sliceRef: string
  kind: DispatchLifecycleIncidentKind
  evidenceDigest: string
  /** Observed durable facts only — NO invented state. */
  detailJson: string
  blocked: boolean
  resolvedAt: string | null
  resolutionNote: string | null
  raisedAt: string
}
