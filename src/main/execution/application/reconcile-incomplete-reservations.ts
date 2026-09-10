// Execution bounded context — application. Idempotent restart reconciliation
// (amendment 001 §5, blocker B2). Every incomplete run_reservation is resolved
// deterministically from durable state — the Execution reservation ledger plus
// the correlation marker persisted on the Orca side. No log reconstruction, no
// in-memory Map. Safe to run at the start of every observation pass and again.
//
// ORCA-S2 (§15, §21): MODIFIED. This is phase 3 of reconcileShadowExecutionState,
// run ONLY AFTER convergence phases 1–2. Its terminal-Dispatch case is no longer
// unconditionally abandoned — convergence owns that (a terminal bound Dispatch is
// converged, blocked as a foreign_dispatch incident, or left retryable; NEVER
// abandoned here). It no-ops on an incident-blocked reservation. It still
// abandons a never-created Dispatch and a stale non-terminal one.

import type { ExecutionPlane } from './execution-plane'
import type { ExecutionStore } from './execution-store'
import type { ReservationStore } from './reservation-store'
import type { SettlementIncidentStore } from './settlement-incident-store'

export type ReconcileDeps = {
  plane: ExecutionPlane
  store: ExecutionStore
  reservations: ReservationStore
  /** §15 — when present, a binding with an open settlement_incident is left untouched (blocked). */
  incidents?: SettlementIncidentStore
}

export type ReconcileOutcome = {
  scanned: number
  abandoned: string[] // correlation ids
  /** Left for convergence / a later pass: terminal-Dispatch, not-yet-stale, or incident-blocked. */
  left: string[]
  alreadyTerminal: number
}

function reservationAgeMs(updatedAt: string, now: string): number {
  const then = Date.parse(updatedAt)
  const at = Date.parse(now)
  return Number.isFinite(then) && Number.isFinite(at) ? at - then : Number.NaN
}

export function reconcileIncompleteReservations(
  deps: ReconcileDeps,
  input: { sliceRef: string; now: string; staleAfter?: number }
): ReconcileOutcome {
  const incomplete = deps.reservations.listIncomplete(input.sliceRef)
  const abandoned: string[] = []
  const left: string[] = []

  for (const reservation of incomplete) {
    const cid = String(reservation.correlationId)

    // §15 — an incident-blocked binding gets no automatic convergence AND no abandon.
    if (deps.incidents?.hasOpenIncident(cid)) {
      left.push(cid)
      continue
    }

    const shadow = deps.plane.findShadowRunByCorrelation(reservation.correlationId)

    if (!shadow) {
      // The Orca Dispatch was never created (crash window A / before ORCA CREATE).
      deps.reservations.advance(reservation.correlationId, 'abandoned', {
        lastError: 'reconciled: no shadow Dispatch was created',
        now: input.now
      })
      abandoned.push(cid)
      continue
    }

    if (shadow.settled) {
      // §15.1 — the LATEST bound Dispatch is TERMINAL. Convergence (phase 1) owns
      // this case: it is converged, or blocked as an incident, or left retryable.
      // It is NEVER abandoned here.
      left.push(cid)
      continue
    }

    // Non-terminal bound Dispatch.
    const age = reservationAgeMs(reservation.updatedAt, input.now)
    const stale =
      input.staleAfter === undefined || (Number.isFinite(age) && age >= input.staleAfter)
    if (!stale) {
      left.push(cid) // §15.2 — retried next pass
      continue
    }

    // Genuinely stuck — settle it abandoned on the Orca side, then abandon the reservation.
    void deps.plane.abandonShadow({
      orcaRunRef: shadow.orcaRunRef,
      orcaDispatchRef: shadow.orcaDispatchRef,
      reason: `reconciled: incomplete reservation in state ${reservation.state}`
    })
    deps.reservations.advance(reservation.correlationId, 'abandoned', {
      lastError: `reconciled: incomplete reservation in state ${reservation.state}`,
      now: input.now
    })
    abandoned.push(cid)
  }

  return {
    scanned: incomplete.length,
    abandoned,
    left,
    alreadyTerminal: deps.reservations.listAll(input.sliceRef).length - incomplete.length
  }
}
