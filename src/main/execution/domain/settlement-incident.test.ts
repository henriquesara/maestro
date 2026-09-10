import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_JOINER,
  foreignDispatchEvidenceDigest,
  invalidSourceEvidenceDigest
} from './settlement-incident'

describe('foreignDispatchEvidenceDigest (§13)', () => {
  it('is SHA-256 over resolved_dispatch_id, resolved_run_id, correlationId joined by the evidence joiner', () => {
    const expected = createHash('sha256')
      .update(['d1', 'r1', 'c1'].join(EVIDENCE_JOINER))
      .digest('hex')
    expect(foreignDispatchEvidenceDigest('d1', 'r1', 'c1')).toBe(expected)
  })

  it('changes when any of the three identity components changes', () => {
    const base = foreignDispatchEvidenceDigest('d1', 'r1', 'c1')
    expect(foreignDispatchEvidenceDigest('d2', 'r1', 'c1')).not.toBe(base)
    expect(foreignDispatchEvidenceDigest('d1', 'r2', 'c1')).not.toBe(base)
    expect(foreignDispatchEvidenceDigest('d1', 'r1', 'c2')).not.toBe(base)
  })
})

describe('invalidSourceEvidenceDigest (§13)', () => {
  it('is SHA-256 over the canonical serialisation of the partial/failed snapshot attempt', () => {
    const expected = createHash('sha256').update('{"a":1,"b":2}').digest('hex')
    expect(invalidSourceEvidenceDigest({ b: 2, a: 1 })).toBe(expected)
  })

  it('is stable regardless of key order in the partial attempt', () => {
    expect(invalidSourceEvidenceDigest({ a: 1, b: 2 })).toBe(
      invalidSourceEvidenceDigest({ b: 2, a: 1 })
    )
  })
})
