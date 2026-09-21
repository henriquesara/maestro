import { createHash } from 'node:crypto'
import { EVIDENCE_JOINER } from './settlement-incident'

// Execution bounded context — domain. Pure.
// ORCA-S4 SPEC §8.0.1, §8.5 — the Maestro-native, Execution-owned, advisory
// analogue of "execution-attempt closure". SOURCE state (corrected from
// PROJECTION, §8.0.1): a write-once reference aggregate that copies, never
// re-decides, already-durable facts.

export type DispatchLifecycleClosureRecord = {
  correlationId: string
  orcaDispatchId: string
  orcaRunId: string
  sliceRef: string
  /** Copy of settlement_observation.status at closure time. */
  settlementStatusRef: string
  /** 'recorded' | 'conflicted' | 'legacy_not_convergeable'. */
  worktreeProvenanceRef: string
  /** Copy of dispatch_termination.termination_method. */
  terminationMethodRef: string
  /** Copy of worktree_finalization.status. */
  finalizationStatusRef: string
  /**
   * ORCA-S5 SPEC §8.2/§9.2 — `completed | failed | cancelled | timeout`, or NULL when the
   * outcome is honestly unclassifiable. Absent for every ORCA-S4 shadow closure; present on a
   * read-back only when non-NULL.
   */
  terminalStatusRef?: string | null
  closureDigest: string
  closedAt: string
  /** The ONE permitted post-insert mutation (§7, §11 Phase 5). NULL unless Phase 5 detects divergence. */
  postClosureSettlementConflictDetectedAt: string | null
}

export type ClosureDigestInput = {
  settlementStatusRef: string
  worktreeProvenanceRef: string
  terminationMethodRef: string
  finalizationStatusRef: string
  /**
   * ORCA-S5 §9.2 — the FIFTH digest field. `undefined` = an ORCA-S4 shadow closure, whose
   * four-field digest stays byte-identical. A delegated closure ALWAYS passes it: a status
   * string, or `null` for the honest unclassifiable case (encoded as the empty string).
   */
  terminalStatusRef?: string | null
}

/**
 * §8.5 — SHA-256 over EXACTLY the four *_ref columns (ORCA-S5 §9.2 appends
 * `terminal_status_ref` as the fifth, in that fixed order, for a delegated
 * closure). Excludes closed_at and
 * every id, and excludes post_closure_settlement_conflict_detected_at (local
 * metadata added after the digest's own inputs were fixed) — mirrors ORCA-S3
 * PROV-2's exclusion discipline exactly. Only the four named fields are ever
 * read, so any extra property on the input object is silently ignored.
 */
export function computeLifecycleClosureDigest(input: ClosureDigestInput): string {
  const fields = [
    input.settlementStatusRef,
    input.worktreeProvenanceRef,
    input.terminationMethodRef,
    input.finalizationStatusRef
  ]
  if (input.terminalStatusRef !== undefined) {
    fields.push(input.terminalStatusRef ?? '')
  }
  return createHash('sha256').update(fields.join(EVIDENCE_JOINER)).digest('hex')
}
