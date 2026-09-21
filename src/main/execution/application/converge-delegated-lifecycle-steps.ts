import { createHash } from 'node:crypto'
import { EVIDENCE_JOINER } from '../domain/settlement-incident'
import {
  PROJECTION_OUTCOME_TO_STATUS,
  type AiControlProjectionOutcome
} from '../domain/aicontrol-terminal-projection'
import { SHADOW_DELEGATED_BOUNDARY_CLOSED } from '../domain/dispatch-lifecycle-event'
import type { DispatchLifecycleIncidentKind } from '../domain/dispatch-lifecycle-incident'
import type { DelegationCutoverRecord } from '../domain/delegation-cutover'
import type { SqliteAiControlTerminalProjectionStore } from '../infrastructure/sqlite-aicontrol-terminal-projection-store'
import type { SqliteDispatchLifecycleClosureStore } from '../infrastructure/sqlite-dispatch-lifecycle-closure-store'
import type { SqliteDispatchLifecycleEventStore } from '../infrastructure/sqlite-dispatch-lifecycle-event-store'
import type { SqliteDispatchTerminationStore } from '../infrastructure/sqlite-dispatch-termination-store'
import type { ExecutionStore } from './execution-store'

// Execution bounded context — application. ORCA-S5 post-cutover lifecycle steps
// layered onto the ORCA-S4 sweep (SPEC §8.3, §10, §14 X6-X8/X12, §15). Everything
// here derives from DURABLE facts; nothing consults an in-memory flag or a Promise.

// ── Shared sweep helpers (moved from the S4 sweep to keep it under the max-lines ceiling) ──

export const LIFECYCLE_RETRYABLE_CODES = new Set([
  'LIFECYCLE_STORE_BUSY_RETRYABLE',
  'LIFECYCLE_FS_OPERATIONAL_RETRYABLE',
  'LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE'
])

export function sanitizeSweepError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg
}

export function lifecycleEvidenceDigest(parts: string[]): string {
  return createHash('sha256').update(parts.join(EVIDENCE_JOINER)).digest('hex')
}

// ── X12 — compatible-race convergence ──────────────────────────────────────

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555
const SQLITE_CONSTRAINT_UNIQUE = 2067

/** A benign write race (PK/UNIQUE) — NOT a deliberately aborted write (trigger/ABORT) and not a busy error. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  const code = (error as { errcode?: number } | null)?.errcode
  return code === SQLITE_CONSTRAINT_PRIMARYKEY || code === SQLITE_CONSTRAINT_UNIQUE
}

export class LifecycleRaceConflictError extends Error {
  constructor(readonly what: string) {
    super(`lifecycle_race_conflict: ${what}`)
    this.name = 'LifecycleRaceConflictError'
  }
}

/**
 * SPEC X12 — "whichever path commits first wins; the loser is a PK-collision
 * no-op". The loser re-reads the CANONICAL row: if it belongs to this same
 * lifecycle (`isCompatible`) the race has converged; if it does not, that is a
 * real conflict and fails closed. A collision with no readable canonical row is
 * not a race at all — the original error propagates untouched.
 */
export async function insertOrConverge<T>(
  write: () => void | Promise<void>,
  readCanonical: () => T | undefined,
  isCompatible: (canonical: T) => boolean,
  what: string
): Promise<'inserted' | 'converged'> {
  try {
    await write()
    return 'inserted'
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) {
      throw error
    }
    const canonical = readCanonical()
    if (canonical === undefined) {
      throw error
    }
    if (!isCompatible(canonical)) {
      throw new LifecycleRaceConflictError(what)
    }
    return 'converged'
  }
}

// ── Phase 6 — Maestro-side terminal-projection outbox (SPEC §8.3, §10, §14 X6-X8) ──

/** The shape of aiControl's real published `projectDelegatedTerminalResult` input (SPEC §10) — copies only. */
export type AiControlProjectionInput = {
  runId: string
  token: string
  status: string
  finishedAt: string
}

/** The transport port. No production HTTP adapter exists (SPEC §4.8.5 is later integration). */
export type AiControlDelegationProjectionPort = {
  projectDelegatedTerminalResult(
    input: AiControlProjectionInput
  ): Promise<{ outcome: AiControlProjectionOutcome }>
}

export type DelegationCutoverReader = {
  get(
    correlationId: string
  ): Pick<DelegationCutoverRecord, 'aicontrolRunId' | 'fenceToken' | 'orcaDispatchId'> | undefined
}

export type TerminalProjectionOutboxDeps = {
  bindings: Pick<ExecutionStore, 'listBindings'>
  closures: Pick<SqliteDispatchLifecycleClosureStore, 'getByCorrelationId'>
  terminations: Pick<SqliteDispatchTerminationStore, 'getByCorrelationId'>
  events: Pick<SqliteDispatchLifecycleEventStore, 'getByCorrelationAndKind'>
  delegationCutovers: DelegationCutoverReader
  projections: SqliteAiControlTerminalProjectionStore
  projectionWriter?: AiControlDelegationProjectionPort
  now: () => string
}

export type RaiseLifecycleIncident = (
  correlationId: string,
  orcaDispatchId: string | null,
  kind: DispatchLifecycleIncidentKind,
  detail: Record<string, unknown>
) => void

/**
 * Per delegated closure, once per pass, from durable facts only:
 *  0. only for a closure whose terminal event already exists (closure → event → projection);
 *  1. create the outbox row (`pending` iff the closure has a classification AND no post-closure
 *     conflict marker; otherwise directly `blocked_closure_contradicted`, never a transport call);
 *  2. raise `unclassifiable_terminal_status` for a NULL classification (idempotent);
 *  3. block a `pending` row whose closure was contradicted after creation (LIFE-15);
 *  4. with a transport: ONE delivery attempt per pass, attempt bookkeeping written first, and
 *     `ALREADY_TERMINAL` treated as UNVERIFIABLE (§10.2) — never as agreement.
 * A transport failure changes nothing about terminal truth or authority (§14 X6).
 */
export async function convergeTerminalProjectionOutbox(
  deps: TerminalProjectionOutboxDeps,
  opts: {
    sliceRef: string
    raiseIncident: RaiseLifecycleIncident
    /** S4 SPEC §13 — when given, a failure for one run is reported and the sweep continues; otherwise it propagates. */
    onError?: (correlationId: string, error: unknown) => void
  }
): Promise<void> {
  for (const binding of deps.bindings.listBindings(opts.sliceRef)) {
    try {
      await convergeOneRunOutbox(deps, opts, binding.correlationId)
    } catch (error) {
      if (!opts.onError) {
        throw error
      }
      opts.onError(binding.correlationId, error)
    }
  }
}

async function convergeOneRunOutbox(
  deps: TerminalProjectionOutboxDeps,
  opts: { raiseIncident: RaiseLifecycleIncident },
  correlationId: string
): Promise<void> {
  const cutover = deps.delegationCutovers.get(correlationId)
  const closure = deps.closures.getByCorrelationId(correlationId)
  // Order (SPEC §5.2 S11→S12, §15): closure → terminal event → projection. The outbox is created
  // only once the event exists, so a crash between them recovers by emitting the event first.
  if (
    !cutover ||
    !closure ||
    !deps.events.getByCorrelationAndKind(correlationId, SHADOW_DELEGATED_BOUNDARY_CLOSED)
  ) {
    return
  }
  const classified = typeof closure.terminalStatusRef === 'string'

  let row = deps.projections.get(correlationId)
  if (!row) {
    const contradicted = !classified || closure.postClosureSettlementConflictDetectedAt !== null
    deps.projections.insertIfAbsent({
      correlationId,
      aicontrolRunId: cutover.aicontrolRunId,
      fenceTokenRef: cutover.fenceToken,
      closureDigestRef: closure.closureDigest,
      status: contradicted ? 'blocked_closure_contradicted' : 'pending'
    })
    row = deps.projections.get(correlationId)
  }
  if (!row) {
    return
  }

  if (!classified) {
    opts.raiseIncident(correlationId, closure.orcaDispatchId, 'unclassifiable_terminal_status', {
      terminationMethodRef: closure.terminationMethodRef,
      reason: 'durable facts cannot legally classify completed/failed/cancelled/timeout'
    })
  }

  // Phase 5 may have marked the closure contradicted after the row was created (this closure
  // was read after Phase 5 ran, so the marker is already visible).
  if (row.status === 'pending' && closure.postClosureSettlementConflictDetectedAt) {
    deps.projections.resolve(correlationId, 'blocked_closure_contradicted', null)
    return
  }
  if (row.status !== 'pending' || !deps.projectionWriter || !classified) {
    return
  }

  deps.projections.recordAttempt(correlationId, deps.now())
  let outcome: AiControlProjectionOutcome
  try {
    const termination = deps.terminations.getByCorrelationId(correlationId)
    const result = await deps.projectionWriter.projectDelegatedTerminalResult({
      runId: row.aicontrolRunId,
      token: row.fenceTokenRef,
      status: closure.terminalStatusRef as string,
      finishedAt: termination?.observedAt ?? closure.closedAt
    })
    outcome = result.outcome
  } catch {
    return // transport failure: stays `pending`, retried next pass; terminal truth untouched
  }
  const status = PROJECTION_OUTCOME_TO_STATUS[outcome]
  if (!status) {
    return // an unknown outcome is never trusted; the row stays `pending`
  }
  deps.projections.resolve(correlationId, status, status === 'projected' ? deps.now() : null)
  if (status !== 'projected') {
    opts.raiseIncident(correlationId, closure.orcaDispatchId, 'terminal_projection_blocked', {
      outcome,
      status
    })
  }
}
