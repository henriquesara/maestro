import { convergeSettlements, type SettlementConvergenceReport } from './converge-settlements'
import type { DurableSettlementSource } from './durable-settlement-source'
import type { ExecutionPlane } from './execution-plane'
import type { ExecutionStore } from './execution-store'
import type { ExecutionTransactionRunner } from './execution-transaction-runner'
import {
  reconcileIncompleteReservations,
  type ReconcileOutcome
} from './reconcile-incomplete-reservations'
import type { ReservationStore } from './reservation-store'
import type { SettlementIncidentStore } from './settlement-incident-store'
import type { SettlementObservationStore } from './settlement-observation-store'

// Execution bounded context — application. ORCA-S2 §15 — the SINGLE reconciliation
// coordinator. Threaded through runShadowObservation where reconcileIncompleteReservations
// ran today. Three phases in STRICT order, from durable state only:
//   1. converge terminal durable Dispatches   — convergeSettlements Phase A
//   2. verify already-observed bindings        — convergeSettlements Phase B
//   3. abandon remainder                       — the MODIFIED reconcileIncompleteReservations
// There is NO independent competing S2 startup root and NO separate unconditional
// abandon pass running in parallel with convergence.

export type ShadowSettlementDeps = {
  source: DurableSettlementSource
  observations: SettlementObservationStore
  incidents: SettlementIncidentStore
  txn: ExecutionTransactionRunner
  sourceDbPath: string
}

export type ShadowExecutionStateDeps = {
  plane: ExecutionPlane
  store: ExecutionStore
  reservations: ReservationStore
  /** Present when S2 convergence is composed (a real durable shadow orchestration.db). */
  settlement?: ShadowSettlementDeps
}

export type ShadowExecutionStateReport = {
  sliceRef: string
  convergence: SettlementConvergenceReport | null
  reconcile: ReconcileOutcome
  abandoned: { correlationId: string; reason: string }[]
}

function defaultNewId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function reconcileShadowExecutionState(
  deps: ShadowExecutionStateDeps,
  input: {
    sliceRef: string
    now: () => string
    newId?: (prefix: string) => string
    staleAfter?: number
  }
): ShadowExecutionStateReport {
  const newId = input.newId ?? defaultNewId

  // Phases 1–2 — convergence. Runs to completion BEFORE phase 3 (synchronous).
  let convergence: SettlementConvergenceReport | null = null
  if (deps.settlement) {
    convergence = convergeSettlements(
      {
        store: deps.store,
        reservations: deps.reservations,
        observations: deps.settlement.observations,
        incidents: deps.settlement.incidents,
        source: deps.settlement.source,
        txn: deps.settlement.txn,
        sourceDbPath: deps.settlement.sourceDbPath,
        newId,
        now: input.now
      },
      { sliceRef: input.sliceRef }
    )
  }

  // Phase 3 — abandon remainder. The MODIFIED reconcileIncompleteReservations:
  // its terminal-Dispatch case is no longer unconditionally abandoned (phase 1
  // handled it); a reservation phase 1 advanced to 'observed' is no longer in
  // listIncomplete when this reads.
  const reconcile = reconcileIncompleteReservations(
    {
      plane: deps.plane,
      store: deps.store,
      reservations: deps.reservations,
      incidents: deps.settlement?.incidents
    },
    { sliceRef: input.sliceRef, now: input.now(), staleAfter: input.staleAfter }
  )

  return {
    sliceRef: input.sliceRef,
    convergence,
    reconcile,
    abandoned: reconcile.abandoned.map((correlationId) => ({
      correlationId,
      reason: 'reconciled: abandon-remainder (phase 3)'
    }))
  }
}
