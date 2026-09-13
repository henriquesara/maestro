import { describe, expect, it } from 'vitest'
import { evaluateMacosCompoundIdentityProof } from './macos-argv-identity-proof'

// ORCA-S4 SPEC §9.1.3, §12 window L12 (macOS same-second sub-case), gate 25.
// RED: `macos-argv-identity-proof.ts` does not exist yet.
//
// Gate 25's executable-evidence requirement, at the pure-function level: BSD
// `ps -o lstart=` is whole-second resolution, so a same-wall-clock-second pid
// reuse can make `lstart` agree between an exited process A and an unrelated
// live process B. `pid` + `lstart` agreement must NEVER be sufficient on
// macOS — checks 1-3 must proceed to argv/nonce evaluation before any verdict.

const SHAPE = 'shadow-lifecycle-child.mjs'
const NONCE = 'nonce_A'

describe('evaluateMacosCompoundIdentityProof — gate 25', () => {
  it('same-second lstart COLLISION ALONE is insufficient: pid exists + lstart matches must not authorize a verdict without argv/nonce evaluated', () => {
    // B's lstart happens to equal A's durably stored marker (same-second reuse).
    // Passing checks 1-3 must still route through argv evaluation, not short-circuit.
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      argv: null, // simulate argv not yet evaluated / unreadable
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('exact processNonce-bearing argv corroboration required: matching shape but DIFFERENT nonce (another genuine S4 process) -> identity_unverifiable, never signalled', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      argv: `node ${SHAPE} --processNonce=nonce_B /tmp/READY hang`,
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('positive control: matching lstart + matching shape + exact matching processNonce -> verified (the suite cannot pass by simply never signalling anything)', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      argv: `node ${SHAPE} --processNonce=${NONCE} /tmp/READY hang`,
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result).toEqual({ kind: 'verified' })
  })

  it('mismatch/unreadability fails closed: unreadable live argv (e.g. permission/transient ps failure) -> identity_unverifiable, never a fabricated pass, never a retryable', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      argv: null,
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('mismatch/unreadability fails closed: argv matches synthetic shape but is MISSING the processNonce token entirely -> identity_unverifiable', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      argv: `node ${SHAPE} /tmp/READY hang`, // no --processNonce= at all
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('nonce must be an exact, boundary-anchored token match — a nonce that appears only as a SUBSTRING of a longer, different argument must not verify (hardening residual #2)', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      // "nonce_A" is a substring of "nonce_AB999" but is NOT the exact token.
      argv: `node ${SHAPE} --processNonce=nonce_AB999 /tmp/READY hang`,
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('nonce must be exact even when the expected nonce is itself a substring of the live token in the OTHER direction (expected "nonce_AB999", live carries only "nonce_A") -> identity_unverifiable', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      argv: `node ${SHAPE} --processNonce=nonce_A /tmp/READY hang`,
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: 'nonce_AB999'
    })
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('argv does not match the expected synthetic shape at all (a genuinely unrelated process) -> identity_unverifiable regardless of lstart/nonce', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      argv: `/usr/sbin/unrelated-daemon --processNonce=${NONCE}`,
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('pid does not currently exist -> identity_unverifiable regardless of any other field', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: false,
      lstartMatches: true,
      argv: `node ${SHAPE} --processNonce=${NONCE} /tmp/READY hang`,
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('lstart does not match at all -> identity_unverifiable (the ordinary, non-same-second case still fails closed through this same function)', () => {
    const result = evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: false,
      argv: `node ${SHAPE} --processNonce=${NONCE} /tmp/READY hang`,
      expectedShapePrefix: SHAPE,
      expectedProcessNonce: NONCE
    })
    expect(result.kind).toBe('identity_unverifiable')
  })
})
