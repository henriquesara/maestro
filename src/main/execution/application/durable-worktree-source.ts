// Execution bounded context — application. The DurableWorktreeSource read port
// (§9). Verifies identity FIRST, before any provenance read, then resolves
// base_commit / candidate_head / files_changed over a read-only Git plumbing
// adapter restricted to an exact argv whitelist. NO Orca row type crosses this
// port — the adapter returns a plain DurableWorktreeRead (PROV-8).

import type { WorktreeIdentity } from '../domain/worktree-provenance'

export type DurableWorktreeReadInput = {
  correlationId: string
  boundDispatchId: string
  boundRunId: string
  boundBaseCommit: string
  /** Canonicalized; must resolve inside the durable shadow-worktree root. */
  worktreePath: string
  /** <durableShadowWorktreeRoot>/identity/<orcaDispatchId>.json — outside .git/, outside the worktree. */
  identitySidecarPath: string
  expectedIdentity: WorktreeIdentity
  /** When provided, the sidecar's own worktreePath must canonicalize inside this root (PROV-3). */
  durableShadowWorktreeRoot?: string
}

export type DurableWorktreeRead =
  | { kind: 'identity_absent' }
  | { kind: 'identity_mismatch'; observedIdentityDigest: string }
  | { kind: 'missing' }
  | { kind: 'operational_error'; detail: string }
  | { kind: 'unstable' }
  | {
      kind: 'resolved'
      baseCommit: string
      candidateHead: string
      filesChanged: readonly string[]
      provenanceDigest: string
      transcript: readonly { cmd: string; outHash: string }[]
    }

export type DurableWorktreeSource = {
  readProvenance(input: DurableWorktreeReadInput): DurableWorktreeRead
}
