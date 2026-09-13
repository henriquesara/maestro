import { evaluateMacosCompoundIdentityProof } from './macos-argv-identity-proof'
import type { OsStartMarkerSource } from './dispatch-process-binding'

// Execution bounded context — domain. Pure. No infrastructure, no Orca types,
// no OS reads — every input here is already-observed data, exactly the shape
// the adapter (§9.1) hands this function after doing its own local-host reads.
//
// ORCA-S4 SPEC §9.1, §9.1.2, §12 windows L12/L13, §14 LIFE-2 — the
// restart-recovered path's checks 1-3 (sidecar/nonce match, pid-exists,
// OS-observable process-instance discriminator match), with the macOS-only
// compound proof (§9.1.3) as a mandatory, non-bypassable escalation when
// os_start_marker_source = 'posix_ps_lstart'. On Windows/Linux, checks 1-3
// alone are sufficient — this correction leaves that rule exactly as
// previously accepted.

export type DurableProcessIdentity = {
  correlationId: string
  orcaRunId: string
  orcaDispatchId: string
  processNonce: string
  pid: number
  osStartMarker: string | null
  osStartMarkerSource: OsStartMarkerSource
}

/** null = sidecar missing, unreadable, or corrupt. */
export type SidecarSnapshot = {
  correlationId: string
  orcaRunId: string
  orcaDispatchId: string
  processNonce: string
} | null

export type MacosArgvObservation = {
  /** null = unreadable (permission / transient `ps` failure). */
  argv: string | null
  expectedShapePrefix: string
}

export type RestartRecoveredIdentityInput = {
  durable: DurableProcessIdentity
  sidecar: SidecarSnapshot
  pidExists: boolean
  /** Re-read from the OS at corroboration time — never trusted from the sidecar or the DB. null = unreadable. */
  currentOsStartMarker: string | null
  /** Required and consulted ONLY when durable.osStartMarkerSource === 'posix_ps_lstart'. */
  macos?: MacosArgvObservation
}

export type IdentityVerificationResult = { kind: 'verified' } | { kind: 'identity_unverifiable'; reason: string }

function unverifiable(reason: string): IdentityVerificationResult {
  return { kind: 'identity_unverifiable', reason }
}

function sidecarMatches(sidecar: SidecarSnapshot, durable: DurableProcessIdentity): boolean {
  return (
    sidecar !== null &&
    sidecar.correlationId === durable.correlationId &&
    sidecar.orcaRunId === durable.orcaRunId &&
    sidecar.orcaDispatchId === durable.orcaDispatchId &&
    sidecar.processNonce === durable.processNonce
  )
}

/**
 * §9.1.2 — ALL of: (1) sidecar still exists, parses, and exactly equals the
 * durable identity; (2) the target pid currently exists; (3) the target pid's
 * CURRENT OS-observable process-instance discriminator, re-read from the OS,
 * exactly equals the durably stored spawn-time value. On macOS
 * (`posix_ps_lstart`), checks 1-3 are necessary but NOT sufficient — §9.1.3's
 * compound argv/nonce proof is mandatory before any signal is authorized.
 * Sidecar-plus-pid-exists alone is never sufficient on any platform (§4).
 */
export function verifyRestartRecoveredIdentity(input: RestartRecoveredIdentityInput): IdentityVerificationResult {
  const { durable, sidecar, pidExists, currentOsStartMarker, macos } = input

  // Check 1 — sidecar/nonce match.
  if (!sidecarMatches(sidecar, durable)) {
    return unverifiable('process identity sidecar missing, unreadable, or does not match the durable binding')
  }

  // Check 2 — pid-exists.
  if (!pidExists) {
    return unverifiable('target pid does not currently exist')
  }

  // §12 window L13 — no durable baseline was ever captured for this binding.
  // Unconditionally unverifiable: there is nothing to compare against.
  if (durable.osStartMarkerSource === 'unavailable') {
    return unverifiable('no durable OS-observable process-instance discriminator baseline for this binding')
  }

  // Check 3 — the OS-observable process-instance discriminator, re-read from
  // the OS, must exactly equal the durably stored spawn-time value.
  if (
    currentOsStartMarker === null ||
    durable.osStartMarker === null ||
    currentOsStartMarker !== durable.osStartMarker
  ) {
    return unverifiable('OS-observable process-instance discriminator unreadable or disagrees with the durable spawn-time value')
  }

  // §9.1.3 — macOS: checks 1-3 passing is NOT enough. Mandatory compound
  // argv/nonce escalation, with no partial-credit path.
  if (durable.osStartMarkerSource === 'posix_ps_lstart') {
    if (!macos) {
      return unverifiable('macOS compound argv/nonce proof was not evaluated')
    }
    return evaluateMacosCompoundIdentityProof({
      pidExists: true,
      lstartMatches: true,
      argv: macos.argv,
      expectedShapePrefix: macos.expectedShapePrefix,
      expectedProcessNonce: durable.processNonce
    })
  }

  // Windows (windows_creation_time) / Linux (posix_proc_stat_starttime) —
  // sub-second resolution on both, checks 1-3 alone are sufficient.
  return { kind: 'verified' }
}
