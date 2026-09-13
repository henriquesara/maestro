import { describe, expect, it } from 'vitest'
import {
  verifyRestartRecoveredIdentity,
  type RestartRecoveredIdentityInput
} from './restart-recovered-identity-verification'

// ORCA-S4 SPEC §9.1.2/§9.1.3, §4, §12 windows L12/L13, §14 LIFE-2, gates 7/24/25.
// RED: `restart-recovered-identity-verification.ts` does not exist yet.
//
// Pure-function unit tests for the restart-recovered path's checks 1-3 (sidecar
// match, pid-exists, OS-marker match) plus the macOS-only compound proof
// dispatch (§9.1.3). No DB, no filesystem, no real process — every input is
// already-observed data, exactly the shape the adapter (§9.1) hands this
// function after doing its own OS reads.

const durable = {
  correlationId: 'corr_1',
  orcaRunId: 'run_1',
  orcaDispatchId: 'ctx_1',
  processNonce: 'nonce_1',
  pid: 4242,
  osStartMarker: '1700000000000',
  osStartMarkerSource: 'posix_proc_stat_starttime' as const
}

const matchingSidecar = {
  correlationId: 'corr_1',
  orcaRunId: 'run_1',
  orcaDispatchId: 'ctx_1',
  processNonce: 'nonce_1'
}

function baseInput(over: Partial<RestartRecoveredIdentityInput> = {}): RestartRecoveredIdentityInput {
  return {
    durable,
    sidecar: matchingSidecar,
    pidExists: true,
    currentOsStartMarker: durable.osStartMarker,
    ...over
  }
}

describe('verifyRestartRecoveredIdentity — checks 1-3 (Windows/Linux sufficient, §9.1.2, LIFE-2)', () => {
  it('all three checks agree (sidecar match, pid exists, OS-marker exact match) -> verified', () => {
    expect(verifyRestartRecoveredIdentity(baseInput())).toEqual({ kind: 'verified' })
  })

  it('sidecar missing (unreadable/corrupt) -> identity_unverifiable, never a guess', () => {
    const result = verifyRestartRecoveredIdentity(baseInput({ sidecar: null }))
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('sidecar present but correlationId/orcaRunId/orcaDispatchId/processNonce mismatched -> identity_unverifiable', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({ sidecar: { ...matchingSidecar, processNonce: 'WRONG' } })
    )
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('target pid does not currently exist -> identity_unverifiable, no signal', () => {
    const result = verifyRestartRecoveredIdentity(baseInput({ pidExists: false }))
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('current OS-marker unreadable (null) -> identity_unverifiable', () => {
    const result = verifyRestartRecoveredIdentity(baseInput({ currentOsStartMarker: null }))
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('§12 window L12 — current OS-marker disagrees with durably stored spawn-time marker (PID reuse by an unrelated process B) -> identity_unverifiable, B is never authorized', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({ currentOsStartMarker: 'DIFFERENT_MARKER_BELONGS_TO_B' })
    )
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('§12 window L13 — osStartMarkerSource="unavailable" -> unconditionally identity_unverifiable, no baseline to compare against, never a fabricated pass', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({
        durable: { ...durable, osStartMarker: null, osStartMarkerSource: 'unavailable' },
        currentOsStartMarker: null
      })
    )
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('Windows source (windows_creation_time): checks 1-3 alone are SUFFICIENT when they all agree — no macOS argv escalation required', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({
        durable: { ...durable, osStartMarkerSource: 'windows_creation_time', osStartMarker: '133700000000000' },
        currentOsStartMarker: '133700000000000'
      })
    )
    expect(result).toEqual({ kind: 'verified' })
  })

  it('Linux source (posix_proc_stat_starttime): checks 1-3 alone are SUFFICIENT — sub-second resolution defeats PID reuse without argv', () => {
    const result = verifyRestartRecoveredIdentity(baseInput())
    expect(result).toEqual({ kind: 'verified' })
  })
})

describe('verifyRestartRecoveredIdentity — macOS dispatch (§9.1.3, checks 1-3 necessary but NOT sufficient)', () => {
  const macosDurable = {
    ...durable,
    osStartMarker: 'Fri Sep 13 00:00:00 2026',
    osStartMarkerSource: 'posix_ps_lstart' as const
  }

  it('checks 1-3 all pass (pid exists, sidecar matches, lstart matches) but argv is unreadable -> identity_unverifiable, no partial credit', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({
        durable: macosDurable,
        currentOsStartMarker: macosDurable.osStartMarker,
        macos: { argv: null, expectedShapePrefix: 'shadow-lifecycle-child.mjs' }
      })
    )
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('checks 1-3 pass, argv matches shape AND carries the exact processNonce -> verified (only path to a positive result on macOS)', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({
        durable: macosDurable,
        currentOsStartMarker: macosDurable.osStartMarker,
        macos: {
          argv: 'node shadow-lifecycle-child.mjs --processNonce=nonce_1 /tmp/READY hang',
          expectedShapePrefix: 'shadow-lifecycle-child.mjs'
        }
      })
    )
    expect(result).toEqual({ kind: 'verified' })
  })

  it('checks 1-3 pass, argv matches shape but carries a DIFFERENT processNonce -> identity_unverifiable (the sharper §12 L12 macOS sub-case: another genuine S4 process reusing the pid)', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({
        durable: macosDurable,
        currentOsStartMarker: macosDurable.osStartMarker,
        macos: {
          argv: 'node shadow-lifecycle-child.mjs --processNonce=SOMEONE_ELSES_NONCE /tmp/READY hang',
          expectedShapePrefix: 'shadow-lifecycle-child.mjs'
        }
      })
    )
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('checks 1-3 pass, argv does not match the expected synthetic shape at all (a genuinely unrelated process B) -> identity_unverifiable', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({
        durable: macosDurable,
        currentOsStartMarker: macosDurable.osStartMarker,
        macos: { argv: '/usr/bin/some-unrelated-daemon --flag', expectedShapePrefix: 'shadow-lifecycle-child.mjs' }
      })
    )
    expect(result.kind).toBe('identity_unverifiable')
  })

  it('macOS source but the `macos` observation is entirely omitted -> identity_unverifiable, never silently falls back to checks-1-3-only sufficiency', () => {
    const result = verifyRestartRecoveredIdentity(
      baseInput({ durable: macosDurable, currentOsStartMarker: macosDurable.osStartMarker, macos: undefined })
    )
    expect(result.kind).toBe('identity_unverifiable')
  })
})
