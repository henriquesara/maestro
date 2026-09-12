import { createHash } from 'node:crypto'
import { canonicalSerialize } from './durable-settlement-snapshot'
import { EVIDENCE_JOINER } from './settlement-incident'
import { isInside } from './path-confinement'

// Execution bounded context — domain. Pure. No infrastructure, no Orca types.
// ORCA-S3 §7, §12 PROV-1/PROV-2/PROV-3 — the worktree-provenance aggregates +
// the identity discriminator + every evidence-digest function. B1: S3's own
// incident channel/kinds, distinct from settlement_incident.

export type WorktreeIdentity = {
  correlationId: string
  orcaRunId: string
  orcaDispatchId: string
  worktreeNonce: string
}

export type WorktreeProvenanceSnapshot = {
  baseCommit: string
  candidateHead: string
  filesChanged: readonly string[]
}

export type WorktreeProvenanceStatus = 'recorded' | 'conflicted'
export type WorktreeProvenanceSource = 'converged_from_worktree' | 'synchronous_capture'

export type WorktreeProvenanceIncidentKind =
  | 'worktree_missing'
  | 'worktree_dispatch_mismatch'
  | 'provenance_snapshot_changed'

export type WorktreeDispatchMismatchFailedCheck =
  | 'identity_discriminator_absent'
  | 'identity_discriminator_mismatch'
  | 'dispatch_worktree_row_absent'
  | 'base_commit_disagreement'
  | 'candidate_head_disagreement'

/** §7.2 — durable SOURCE row (dispatch_worktree). Never rebuilt (PROV-11). */
export type DispatchWorktreeRecord = {
  orcaDispatchId: string
  correlationId: string
  orcaRunId: string
  worktreeNonce: string
  worktreePath: string
  rootRef: string
  openedAt: string
}

/** §7.1 — the write-once provenance projection row (SPEC-AMENDMENT-001: 15 columns). */
export type WorktreeProvenanceRecord = {
  correlationId: string
  orcaDispatchId: string
  orcaRunId: string
  sliceRef: string
  status: WorktreeProvenanceStatus
  baseCommit: string
  candidateHead: string
  filesChangedJson: string
  provenanceSource: WorktreeProvenanceSource
  worktreePathRef: string
  provenanceDigest: string
  provenanceJson: string
  firstSeenAt: string
  observedAt: string
  conflictedAt: string | null
}

/** §7.3 — the S3-only incident channel row. */
export type WorktreeProvenanceIncidentRecord = {
  id: string
  correlationId: string
  orcaDispatchId: string | null
  sliceRef: string
  kind: WorktreeProvenanceIncidentKind
  evidenceDigest: string
  detailJson: string
  blocked: boolean
  resolvedAt: string | null
  resolutionNote: string | null
  raisedAt: string
}

/** §7.1 — SHA-256 over the canonical serialisation of exactly {baseCommit, candidateHead, filesChanged}. */
export function computeProvenanceDigest(snapshot: WorktreeProvenanceSnapshot): string {
  return createHash('sha256')
    .update(
      canonicalSerialize({
        baseCommit: snapshot.baseCommit,
        candidateHead: snapshot.candidateHead,
        filesChanged: snapshot.filesChanged
      })
    )
    .digest('hex')
}

/** §12 PROV-3 — exact match of all four discriminator fields. */
export function identityEquals(a: WorktreeIdentity, b: WorktreeIdentity): boolean {
  return (
    a.correlationId === b.correlationId &&
    a.orcaRunId === b.orcaRunId &&
    a.orcaDispatchId === b.orcaDispatchId &&
    a.worktreeNonce === b.worktreeNonce
  )
}

/** §7.2, §12 PROV-3 — the sidecar's worktreePath must resolve inside the durable root. */
export function canonicalizesInsideRoot(path: string, root: string): boolean {
  return isInside(path, root)
}

const ABSENT_IDENTITY_LITERAL = '<absent>'

/** §7.3 — hashes the discriminator when present, or the literal "<absent>" when null. */
export function observedIdentityDigest(identity: WorktreeIdentity | null): string {
  return createHash('sha256')
    .update(identity === null ? ABSENT_IDENTITY_LITERAL : canonicalSerialize(identity))
    .digest('hex')
}

/** §7.3 — SHA-256(correlationId ‖ boundDispatchId ‖ "worktree_missing"). Stable per binding. */
export function worktreeMissingEvidenceDigest(
  correlationId: string,
  boundDispatchId: string
): string {
  return createHash('sha256')
    .update([correlationId, boundDispatchId, 'worktree_missing'].join(EVIDENCE_JOINER))
    .digest('hex')
}

/** §7.3 — SHA-256(correlationId ‖ boundDispatchId ‖ observedIdentityDigest ‖ failedCheck). */
export function worktreeDispatchMismatchEvidenceDigest(
  correlationId: string,
  boundDispatchId: string,
  observedIdentityDigestValue: string,
  failedCheck: WorktreeDispatchMismatchFailedCheck
): string {
  return createHash('sha256')
    .update(
      [correlationId, boundDispatchId, observedIdentityDigestValue, failedCheck].join(
        EVIDENCE_JOINER
      )
    )
    .digest('hex')
}

/** §7.3 — the new stable conflicting provenance_digest IS the evidence_digest, verbatim. */
export function provenanceSnapshotChangedEvidenceDigest(newStableProvenanceDigest: string): string {
  return newStableProvenanceDigest
}
