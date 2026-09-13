import { describe, expect, it } from 'vitest'
import { computeLifecycleClosureDigest } from './dispatch-lifecycle-closure'

// ORCA-S4 SPEC §8.5. RED: `dispatch-lifecycle-closure.ts` does not exist yet.

describe('computeLifecycleClosureDigest', () => {
  const refs = {
    settlementStatusRef: 'observed',
    worktreeProvenanceRef: 'recorded',
    terminationMethodRef: 'self_exit',
    finalizationStatusRef: 'finalized'
  }

  it('is deterministic and a 64-char lowercase hex SHA-256', () => {
    const d1 = computeLifecycleClosureDigest(refs)
    const d2 = computeLifecycleClosureDigest(refs)
    expect(d1).toBe(d2)
    expect(d1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('excludes closed_at and every id (only computed over the four *_ref columns) — passing extra fields must not change the digest', () => {
    const withExtras = computeLifecycleClosureDigest({
      ...refs,
      // @ts-expect-error — extra fields the digest must ignore, mirroring ORCA-S3 PROV-2's exclusion discipline
      correlationId: 'corr_1',
      closedAt: '2026-09-13T00:00:00Z',
      postClosureSettlementConflictDetectedAt: '2026-09-14T00:00:00Z'
    })
    expect(withExtras).toBe(computeLifecycleClosureDigest(refs))
  })

  it('changes when any single *_ref value changes', () => {
    const base = computeLifecycleClosureDigest(refs)
    expect(computeLifecycleClosureDigest({ ...refs, settlementStatusRef: 'observed_conflicted' })).not.toBe(base)
    expect(computeLifecycleClosureDigest({ ...refs, worktreeProvenanceRef: 'conflicted' })).not.toBe(base)
    expect(computeLifecycleClosureDigest({ ...refs, terminationMethodRef: 'signalled' })).not.toBe(base)
    expect(computeLifecycleClosureDigest({ ...refs, finalizationStatusRef: 'skipped_not_eligible' })).not.toBe(base)
  })
})
