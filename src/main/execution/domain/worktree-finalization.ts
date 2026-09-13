import { createHash } from 'node:crypto'
import { EVIDENCE_JOINER } from './settlement-incident'

// Execution bounded context — domain. Pure.
// ORCA-S4 SPEC §8.0, §8.3, §10 — the governed reap of a durable ORCA-S3 shadow
// worktree. Durable SOURCE state: the deletion, once done, cannot be
// re-derived from anything else (§8.8).

export type WorktreeFinalizationStatus = 'intent_recorded' | 'finalized' | 'skipped_not_eligible' | 'conflicted'

export type WorktreeFinalizationRecord = {
  correlationId: string
  orcaDispatchId: string
  sliceRef: string
  eligibilityDigest: string
  intentRecordedAt: string
  status: WorktreeFinalizationStatus
  finalizedAt: string | null
  outcomeDetailJson: string | null
  conflictedAt: string | null
}

export type EligibilityDigestInput = {
  settlementStatus: string
  /** ORCA-S3 status, or the 'legacy_not_convergeable' sentinel (§10.1). */
  worktreeProvenanceStatus: string
  terminationMethod: string
}

/** §10.1 — SHA-256(settlementStatus ‖ worktreeProvenanceStatus ‖ terminationMethod). */
export function computeFinalizationEligibilityDigest(input: EligibilityDigestInput): string {
  return createHash('sha256')
    .update([input.settlementStatus, input.worktreeProvenanceStatus, input.terminationMethod].join(EVIDENCE_JOINER))
    .digest('hex')
}
