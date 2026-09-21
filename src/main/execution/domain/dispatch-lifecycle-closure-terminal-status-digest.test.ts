import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  computeLifecycleClosureDigest,
  type ClosureDigestInput
} from './dispatch-lifecycle-closure'
import { EVIDENCE_JOINER } from './settlement-incident'

// ORCA-S5 SPEC §9.2 — `terminal_status_ref` is the FIFTH digest field. Encoding is pinned here
// independently of the implementation: SHA-256 over the fields joined by EVIDENCE_JOINER, in the
// fixed order settlement, provenance, termination, finalization, terminal_status.

const refs = {
  settlementStatusRef: 'observed',
  worktreeProvenanceRef: 'recorded',
  terminationMethodRef: 'self_exit',
  finalizationStatusRef: 'skipped_not_eligible'
}
const sha = (fields: string[]) =>
  createHash('sha256').update(fields.join(EVIDENCE_JOINER)).digest('hex')
const ordered = (r: typeof refs) => [
  r.settlementStatusRef,
  r.worktreeProvenanceRef,
  r.terminationMethodRef,
  r.finalizationStatusRef
]

describe('closure digest — four-field (ORCA-S4 shadow) is byte-identical', () => {
  it('omitting terminalStatusRef reproduces the exact S4 digest', () => {
    expect(computeLifecycleClosureDigest(refs)).toBe(sha(ordered(refs)))
    expect(computeLifecycleClosureDigest({ ...refs, terminalStatusRef: undefined })).toBe(
      sha(ordered(refs))
    )
  })
})

describe('closure digest — five-field (ORCA-S5 delegated)', () => {
  it('appends terminal_status_ref as the fifth field in the fixed order', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'timeout']) {
      expect(computeLifecycleClosureDigest({ ...refs, terminalStatusRef: status })).toBe(
        sha([...ordered(refs), status])
      )
    }
  })

  it('an unclassifiable closure (null) is encoded as the empty fifth field — distinct from the four-field digest', () => {
    expect(computeLifecycleClosureDigest({ ...refs, terminalStatusRef: null })).toBe(
      sha([...ordered(refs), ''])
    )
    expect(computeLifecycleClosureDigest({ ...refs, terminalStatusRef: null })).not.toBe(
      computeLifecycleClosureDigest(refs)
    )
  })

  it('same values -> same digest (deterministic, restart-stable)', () => {
    const input: ClosureDigestInput = { ...refs, terminalStatusRef: 'timeout' }
    expect(computeLifecycleClosureDigest(input)).toBe(computeLifecycleClosureDigest({ ...input }))
  })

  it.each(Object.keys(refs))('a difference in %s changes the digest', (field) => {
    const base = computeLifecycleClosureDigest({ ...refs, terminalStatusRef: 'completed' })
    const changed = computeLifecycleClosureDigest({
      ...refs,
      [field]: 'something_else',
      terminalStatusRef: 'completed'
    })
    expect(changed).not.toBe(base)
  })

  it('every distinct terminal status yields a distinct digest (no collisions between the four outcomes or null)', () => {
    const digests = ['completed', 'failed', 'cancelled', 'timeout', null].map((terminalStatusRef) =>
      computeLifecycleClosureDigest({ ...refs, terminalStatusRef })
    )
    expect(new Set(digests).size).toBe(digests.length)
  })

  it('mutable / non-authoritative fields never enter the digest', () => {
    const noisy = {
      ...refs,
      terminalStatusRef: 'failed',
      closedAt: 'now',
      postClosureSettlementConflictDetectedAt: 'later',
      id: 'x'
    }
    expect(computeLifecycleClosureDigest(noisy)).toBe(
      computeLifecycleClosureDigest({ ...refs, terminalStatusRef: 'failed' })
    )
  })

  it('field ORDER matters: swapping two field values changes the digest', () => {
    const swapped = {
      ...refs,
      settlementStatusRef: refs.worktreeProvenanceRef,
      worktreeProvenanceRef: refs.settlementStatusRef
    }
    expect(computeLifecycleClosureDigest({ ...swapped, terminalStatusRef: 'completed' })).not.toBe(
      computeLifecycleClosureDigest({ ...refs, terminalStatusRef: 'completed' })
    )
  })
})
