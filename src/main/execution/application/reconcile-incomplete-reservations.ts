// Execution bounded context — application. Idempotent restart reconciliation
// (amendment 001 §5, blocker B2). Every incomplete run_reservation is resolved
// deterministically from durable state — the Execution reservation ledger plus
// the correlation marker persisted on the Orca side. No log reconstruction, no
// in-memory Map. Safe to run at the start of every observation pass and again.

import type { ExecutionPlane } from './execution-plane'
import type { ExecutionStore } from './execution-store'
import type { ReservationStore } from './reservation-store'

export type ReconcileDeps = {
  plane: ExecutionPlane
  store: ExecutionStore
  reservations: ReservationStore
}

export type ReconcileOutcome = {
  scanned: number
  abandoned: string[] // correlation ids
  alreadyTerminal: number
}

export function reconcileIncompleteReservations(
  deps: ReconcileDeps,
  input: { sliceRef: string; now: string }
): ReconcileOutcome {
  const incomplete = deps.reservations.listIncomplete(input.sliceRef)
  const abandoned: string[] = []

  for (const reservation of incomplete) {
    const shadow = deps.plane.findShadowRunByCorrelation(reservation.correlationId)

    if (!shadow) {
      // The Orca Dispatch was never created (crash window A / before ORCA CREATE).
      // Nothing on the Orca side to touch — mark the reservation abandoned.
      deps.reservations.advance(reservation.correlationId, 'abandoned', {
        lastError: 'reconciled: no shadow Dispatch was created',
        now: input.now
      })
      abandoned.push(String(reservation.correlationId))
      continue
    }

    // A shadow Dispatch exists. Settle it as abandoned if it is still unsettled,
    // then mark the reservation abandoned. A re-run will find this terminal
    // reservation and will NOT create a second orphan Dispatch.
    if (!shadow.settled) {
      void deps.plane.abandonShadow({
        orcaRunRef: shadow.orcaRunRef,
        orcaDispatchRef: shadow.orcaDispatchRef,
        reason: `reconciled: incomplete reservation in state ${reservation.state}`
      })
    }
    deps.reservations.advance(reservation.correlationId, 'abandoned', {
      lastError: `reconciled: incomplete reservation in state ${reservation.state}`,
      now: input.now
    })
    abandoned.push(String(reservation.correlationId))
  }

  return {
    scanned: incomplete.length,
    abandoned,
    alreadyTerminal: deps.reservations.listAll(input.sliceRef).length - incomplete.length
  }
}
