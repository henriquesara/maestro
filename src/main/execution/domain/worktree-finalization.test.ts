import { describe, expect, it } from 'vitest'
import { computeFinalizationEligibilityDigest } from './worktree-finalization'

// ORCA-S4 SPEC §10.1, §10.2. RED: `worktree-finalization.ts` does not exist yet.

describe('computeFinalizationEligibilityDigest', () => {
  const input = {
    settlementStatus: 'observed',
    worktreeProvenanceStatus: 'recorded',
    terminationMethod: 'self_exit'
  }

  it('is deterministic: same inputs -> same digest', () => {
    expect(computeFinalizationEligibilityDigest(input)).toBe(computeFinalizationEligibilityDigest(input))
  })

  it('is a 64-char lowercase hex SHA-256 (mirrors ORCA-S3 PROV-2 digest shape)', () => {
    const digest = computeFinalizationEligibilityDigest(input)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when settlementStatus changes (§10.1 — the one field that can legitimately mutate later, §8.0.1)', () => {
    const a = computeFinalizationEligibilityDigest(input)
    const b = computeFinalizationEligibilityDigest({ ...input, settlementStatus: 'observed_conflicted' })
    expect(a).not.toBe(b)
  })

  it('changes when worktreeProvenanceStatus changes', () => {
    const a = computeFinalizationEligibilityDigest(input)
    const b = computeFinalizationEligibilityDigest({ ...input, worktreeProvenanceStatus: 'conflicted' })
    expect(a).not.toBe(b)
  })

  it('changes when terminationMethod changes', () => {
    const a = computeFinalizationEligibilityDigest(input)
    const b = computeFinalizationEligibilityDigest({ ...input, terminationMethod: 'signalled' })
    expect(a).not.toBe(b)
  })

  it('supports the legacy worktree-provenance sentinel ("legacy_not_convergeable") as a distinct input value', () => {
    const legacy = computeFinalizationEligibilityDigest({
      ...input,
      worktreeProvenanceStatus: 'legacy_not_convergeable'
    })
    expect(legacy).not.toBe(computeFinalizationEligibilityDigest(input))
    expect(legacy).toMatch(/^[0-9a-f]{64}$/)
  })
})
