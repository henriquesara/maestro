import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './durable-settlement-snapshot'
import {
  canonicalizesInsideRoot,
  identityEquals,
  computeProvenanceDigest,
  observedIdentityDigest,
  provenanceSnapshotChangedEvidenceDigest,
  worktreeDispatchMismatchEvidenceDigest,
  worktreeMissingEvidenceDigest,
  type WorktreeIdentity,
  type WorktreeProvenanceSnapshot
} from './worktree-provenance'

// ORCA-S3 §7.1, §7.2, §12 PROV-1/PROV-2/PROV-3 — pure domain logic. RED: the
// `./worktree-provenance` module does not exist yet.

function identity(over: Partial<WorktreeIdentity> = {}): WorktreeIdentity {
  return {
    correlationId: 'corr_1',
    orcaRunId: 'run_1',
    orcaDispatchId: 'ctx_1',
    worktreeNonce: 'nonce_1',
    ...over
  }
}

function snapshot(over: Partial<WorktreeProvenanceSnapshot> = {}): WorktreeProvenanceSnapshot {
  return {
    baseCommit: 'b'.repeat(40),
    candidateHead: 'c'.repeat(40),
    filesChanged: ['a.ts', 'b.ts'],
    ...over
  }
}

describe('computeProvenanceDigest (§7.1, PROV-2 — excludes every local path / timestamp / incident id by construction)', () => {
  it('is a 64-char lowercase hex sha256 string', () => {
    const digest = computeProvenanceDigest(snapshot())
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for identical content', () => {
    expect(computeProvenanceDigest(snapshot())).toBe(computeProvenanceDigest(snapshot()))
  })

  it('changes when baseCommit differs', () => {
    const a = computeProvenanceDigest(snapshot())
    const b = computeProvenanceDigest(snapshot({ baseCommit: 'd'.repeat(40) }))
    expect(a).not.toBe(b)
  })

  it('changes when candidateHead differs', () => {
    const a = computeProvenanceDigest(snapshot())
    const b = computeProvenanceDigest(snapshot({ candidateHead: 'd'.repeat(40) }))
    expect(a).not.toBe(b)
  })

  it('changes when filesChanged differs', () => {
    const a = computeProvenanceDigest(snapshot())
    const b = computeProvenanceDigest(snapshot({ filesChanged: ['a.ts'] }))
    expect(a).not.toBe(b)
  })

  it('changes when filesChanged order differs (caller is responsible for canonical ordering, e.g. filesChangedSet)', () => {
    const a = computeProvenanceDigest(snapshot({ filesChanged: ['a.ts', 'b.ts'] }))
    const b = computeProvenanceDigest(snapshot({ filesChanged: ['b.ts', 'a.ts'] }))
    expect(a).not.toBe(b)
  })

  it('matches an independent SHA-256 over the canonical serialisation of exactly {baseCommit, candidateHead, filesChanged}', () => {
    const s = snapshot()
    const expected = createHash('sha256')
      .update(
        canonicalSerialize({
          baseCommit: s.baseCommit,
          candidateHead: s.candidateHead,
          filesChanged: s.filesChanged
        })
      )
      .digest('hex')
    expect(computeProvenanceDigest(s)).toBe(expected)
  })
})

describe('identityEquals (§12 PROV-3 — exact match of all four discriminator fields)', () => {
  it('is true for two identical identities', () => {
    expect(identityEquals(identity(), identity())).toBe(true)
  })

  it.each(['correlationId', 'orcaRunId', 'orcaDispatchId', 'worktreeNonce'] as const)(
    'is false when %s differs',
    (field) => {
      expect(identityEquals(identity(), identity({ [field]: 'different' }))).toBe(false)
    }
  )
})

describe('canonicalizesInsideRoot (§7.2, §12 PROV-3 — sidecar worktreePath must resolve inside the durable root)', () => {
  it('is true for a direct child path', () => {
    expect(canonicalizesInsideRoot('/durable/root/shadow-corr_1', '/durable/root')).toBe(true)
  })

  it('is true for a path that normalizes inside the root via internal ".."', () => {
    expect(canonicalizesInsideRoot('/durable/root/a/../b', '/durable/root')).toBe(true)
  })

  it('is false for a path that escapes the root via a leading ".."', () => {
    expect(canonicalizesInsideRoot('/durable/root/../evil', '/durable/root')).toBe(false)
  })

  it('is false for a sibling directory with the root as a string prefix but not a path ancestor', () => {
    expect(canonicalizesInsideRoot('/durable/root-evil/x', '/durable/root')).toBe(false)
  })

  it('is true for the root itself', () => {
    expect(canonicalizesInsideRoot('/durable/root', '/durable/root')).toBe(true)
  })
})

describe('evidence digests (§7.3 — canonical per incident kind)', () => {
  it('observedIdentityDigest hashes the discriminator when present', () => {
    const id = identity()
    expect(observedIdentityDigest(id)).toBe(createHash('sha256').update(canonicalSerialize(id)).digest('hex'))
  })

  it('observedIdentityDigest hashes the literal "<absent>" when the identity is null', () => {
    expect(observedIdentityDigest(null)).toBe(
      createHash('sha256').update('<absent>').digest('hex')
    )
  })

  it('observedIdentityDigest differs between an absent and a present identity', () => {
    expect(observedIdentityDigest(null)).not.toBe(observedIdentityDigest(identity()))
  })

  it('worktreeMissingEvidenceDigest is stable for the same (correlationId, boundDispatchId) and changes otherwise', () => {
    const a = worktreeMissingEvidenceDigest('corr_1', 'ctx_1')
    const b = worktreeMissingEvidenceDigest('corr_1', 'ctx_1')
    const c = worktreeMissingEvidenceDigest('corr_2', 'ctx_1')
    const d = worktreeMissingEvidenceDigest('corr_1', 'ctx_2')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toBe(d)
  })

  it('worktreeDispatchMismatchEvidenceDigest changes with failedCheck and observedIdentityDigest', () => {
    const base = worktreeDispatchMismatchEvidenceDigest(
      'corr_1',
      'ctx_1',
      observedIdentityDigest(null),
      'identity_discriminator_absent'
    )
    const differentCheck = worktreeDispatchMismatchEvidenceDigest(
      'corr_1',
      'ctx_1',
      observedIdentityDigest(null),
      'identity_discriminator_mismatch'
    )
    const differentObserved = worktreeDispatchMismatchEvidenceDigest(
      'corr_1',
      'ctx_1',
      observedIdentityDigest(identity()),
      'identity_discriminator_absent'
    )
    expect(base).not.toBe(differentCheck)
    expect(base).not.toBe(differentObserved)
  })

  it('provenanceSnapshotChangedEvidenceDigest IS the new stable conflicting digest, verbatim', () => {
    const newDigest = computeProvenanceDigest(snapshot({ candidateHead: 'e'.repeat(40) }))
    expect(provenanceSnapshotChangedEvidenceDigest(newDigest)).toBe(newDigest)
  })
})
