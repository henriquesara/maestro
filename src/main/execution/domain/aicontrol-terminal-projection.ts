// Execution bounded context — domain. Pure. ORCA-S5 SPEC §8.3 — the Maestro-side
// terminal-projection OUTBOX row. It records the ATTEMPT to copy an
// already-final Orca verdict to aiControl; it is never the source of terminal
// truth (that is `dispatch_lifecycle_closure`, §17) and aiControl's
// acknowledgement is downstream convergence only.

export type AiControlTerminalProjectionStatus =
  | 'pending'
  | 'projected'
  | 'blocked_fence_mismatch'
  | 'blocked_already_terminal_divergent'
  | 'blocked_closure_contradicted'

export type AiControlTerminalProjectionRecord = {
  correlationId: string
  aicontrolRunId: string
  /** Copy of delegation_cutover.fence_token. */
  fenceTokenRef: string
  /** Copy of dispatch_lifecycle_closure.closure_digest at creation time. */
  closureDigestRef: string
  attemptCount: number
  lastAttemptedAt: string | null
  projectedAt: string | null
  status: AiControlTerminalProjectionStatus
}

/** The four outcomes of aiControl's real `projectDelegatedTerminalResult` (SPEC §10). */
export type AiControlProjectionOutcome =
  | 'PROJECTED'
  | 'ALREADY_TERMINAL'
  | 'FENCE_MISMATCH'
  | 'DIVERGENCE'

/**
 * §10.2 — while aiControl's projector fix is unshipped, `ALREADY_TERMINAL` is
 * UNVERIFIABLE, never confirmed agreement: it maps to a blocked status, not
 * `projected`.
 */
export const PROJECTION_OUTCOME_TO_STATUS: Readonly<
  Record<AiControlProjectionOutcome, Exclude<AiControlTerminalProjectionStatus, 'pending'>>
> = {
  PROJECTED: 'projected',
  ALREADY_TERMINAL: 'blocked_closure_contradicted',
  FENCE_MISMATCH: 'blocked_fence_mismatch',
  DIVERGENCE: 'blocked_already_terminal_divergent'
}
