// Execution bounded context — domain. Pure. No OS reads — every input is
// already-observed data (the adapter's own `ps -p <pid> -o lstart= -o
// command=` read, §9.1.3, reusing this repository's existing
// `getPsProcessIdentity` / `daemon-process-identity-query.ts` precedent).
//
// ORCA-S4 SPEC §9.1.3, §12 window L12 macOS sub-case, gate 25. BSD
// `ps -o lstart=` is whole-second resolution, so a same-wall-clock-second pid
// reuse can make `lstart` agree between an exited process A and an unrelated
// live process B. `pid` + `lstart` agreement must NEVER be sufficient on
// macOS — this function is the mandatory escalation checks 1-3 alone cannot
// skip.

export type MacosCompoundIdentityInput = {
  pidExists: boolean
  lstartMatches: boolean
  /** null = unreadable (permission / transient `ps` failure). */
  argv: string | null
  expectedShapePrefix: string
  expectedProcessNonce: string
}

export type MacosCompoundIdentityResult = { kind: 'verified' } | { kind: 'identity_unverifiable'; reason: string }

function unverifiable(reason: string): MacosCompoundIdentityResult {
  return { kind: 'identity_unverifiable', reason }
}

const PROCESS_NONCE_FLAG = '--processNonce='

/**
 * Extracts the EXACT, boundary-anchored `--processNonce=<token>` value from a
 * whitespace-tokenized argv string. Never a substring test — this is exactly
 * the accepted macOS hardening residual: a nonce that only appears as part of
 * a longer argument, or an expected nonce that is only a prefix of the live
 * token, must never match.
 */
function extractProcessNonceToken(argv: string): string | null {
  const token = argv.split(/\s+/).find((part) => part.startsWith(PROCESS_NONCE_FLAG))
  return token ? token.slice(PROCESS_NONCE_FLAG.length) : null
}

/**
 * §9.1.3 — when, and only when, os_start_marker_source = 'posix_ps_lstart',
 * ALL of: (1) pid exists; (2) live lstart exactly matches the durable marker;
 * (3) live command/argv is successfully read; (4) that argv matches the
 * expected synthetic shadow-lifecycle-process shape; (5) that argv contains,
 * verbatim and exactly (never as a substring), the durable processNonce
 * token. Any one failing routes to identity_unverifiable — no partial credit.
 */
export function evaluateMacosCompoundIdentityProof(
  input: MacosCompoundIdentityInput
): MacosCompoundIdentityResult {
  if (!input.pidExists) {
    return unverifiable('target pid does not currently exist')
  }
  if (!input.lstartMatches) {
    return unverifiable('lstart does not match the durably stored spawn-time marker')
  }
  if (input.argv === null) {
    return unverifiable('live command/argv could not be read')
  }
  if (!input.argv.includes(input.expectedShapePrefix)) {
    return unverifiable('live command/argv does not match the expected synthetic shadow-lifecycle-process shape')
  }
  const liveNonce = extractProcessNonceToken(input.argv)
  if (liveNonce === null) {
    return unverifiable('live command/argv is missing the processNonce token entirely')
  }
  if (liveNonce !== input.expectedProcessNonce) {
    return unverifiable('live processNonce token does not exactly match the durable binding (boundary-anchored, never a substring match)')
  }
  return { kind: 'verified' }
}
