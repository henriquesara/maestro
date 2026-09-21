import type { TeardownReason } from './dispatch-process-binding'
import type { TerminationMethod } from './dispatch-termination'

// Execution bounded context — domain. Pure. ORCA-S5 SPEC §9.2 — the fixed,
// reviewable classification of a delegated run's terminal outcome, computed from
// DURABLE facts only (never from a signal, an elapsed time, or an in-memory
// result). Orca — not aiControl — is the classification authority (§9.3).

export type DelegatedTerminalStatus = 'completed' | 'failed' | 'cancelled' | 'timeout'

export type DelegatedTerminalFacts = {
  terminationMethod: TerminationMethod
  exitCode: number | null
  /** dispatch_process_binding.teardown_reason — the durable cause captured before any signal (§9.1). */
  teardownReason: TeardownReason | null | undefined
}

const TEARDOWN_REASON_TO_STATUS: Readonly<Record<TeardownReason, DelegatedTerminalStatus>> = {
  user_cancel: 'cancelled',
  timeout: 'timeout'
}

/**
 * §9.2 — `self_exit` → exit code 0 ? completed : failed (a signal-terminated
 * self-exit has no exit code and is `failed`); `signalled` → the durable
 * teardown_reason via a fixed two-entry map; `confirmed_dead_unknown_cause`, and
 * a `signalled` termination with no durable reason, are honestly `null` — never
 * guessed, never defaulted to `failed`.
 */
export function deriveDelegatedTerminalStatus(
  facts: DelegatedTerminalFacts
): DelegatedTerminalStatus | null {
  if (facts.terminationMethod === 'self_exit') {
    return facts.exitCode === 0 ? 'completed' : 'failed'
  }
  if (facts.terminationMethod === 'signalled' && facts.teardownReason) {
    return TEARDOWN_REASON_TO_STATUS[facts.teardownReason] ?? null
  }
  return null
}
