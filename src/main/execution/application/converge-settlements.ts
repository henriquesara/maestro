import type { SettlementIncidentKind } from '../domain/settlement-incident'
import {
  commitObservation,
  foreignDispatchEvidenceDigest,
  invalidSourceEvidenceDigest,
  pushRetryable,
  raiseIncident,
  verifyDigest
} from './converge-settlement-steps'
import type { DurableSettlementSource, SourceGuardCounters } from './durable-settlement-source'
import type { ExecutionStore } from './execution-store'
import type { ExecutionTransactionRunner } from './execution-transaction-runner'
import type { ReservationStore } from './reservation-store'
import type { SettlementIncidentStore } from './settlement-incident-store'
import type { SettlementObservationStore } from './settlement-observation-store'

// Execution bounded context — application. ORCA-S2 §8 — the two-phase
// convergence sweep. Pure, idempotent function of (Execution store state, shadow
// orchestration.db state, now). Performs NO abandon and NO abandonShadow (those
// are the state machine's, §15). Performs NO Git call of any kind.

const REVERIFY_BUDGET = 3 // §16.3 candidate

export type ConvergeDeps = {
  store: ExecutionStore
  reservations: ReservationStore
  observations: SettlementObservationStore
  incidents: SettlementIncidentStore
  source: DurableSettlementSource
  txn: ExecutionTransactionRunner
  sourceDbPath: string
  newId: (prefix: string) => string
  now: () => string
}

export type Ids = { correlationId: string; boundDispatchId: string; boundRunId: string }

export type ObservedRef = {
  correlationId: string
  orcaDispatchId: string
  sourceDigest: string
}
export type ConflictedRef = { correlationId: string; oldDigest: string; newDigest: string }
export type IncidentRef = {
  correlationId: string
  kind: SettlementIncidentKind
  evidenceDigest: string
}
export type RetryableReason = 'SOURCE_UNSTABLE_RETRYABLE' | 'EXECUTION_STORE_BUSY_RETRYABLE'
export type RetryableRef = {
  correlationId: string
  phase: 'A' | 'B'
  reason: RetryableReason
  attempts: number
}
export type SweepErrorRef = { correlationId: string; phase: 'A' | 'B'; error: string }

export type SettlementConvergenceReport = {
  sliceRef: string
  scannedPhaseA: number
  scannedPhaseB: number
  observed: ObservedRef[]
  conflicted: ConflictedRef[]
  incidents: IncidentRef[]
  noop: number
  sweepErrors: SweepErrorRef[]
  retryable: RetryableRef[]
  sourceGuard: SourceGuardCounters
}

function sanitize(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg
}

export function convergeSettlements(
  deps: ConvergeDeps,
  input: { sliceRef: string }
): SettlementConvergenceReport {
  const report: SettlementConvergenceReport = {
    sliceRef: input.sliceRef,
    scannedPhaseA: 0,
    scannedPhaseB: 0,
    observed: [],
    conflicted: [],
    incidents: [],
    noop: 0,
    sweepErrors: [],
    retryable: [],
    sourceGuard: deps.source.sourceGuard()
  }

  const bindings = deps.store.listBindings(input.sliceRef)

  // Phase A — bindings with NO settlement_observation.
  for (const binding of bindings) {
    const cid = String(binding.correlationId)
    if (deps.observations.getByCorrelation(cid)) {
      continue
    }
    if (deps.reservations.get(binding.correlationId)?.state === 'abandoned') {
      continue
    }
    if (deps.incidents.hasOpenIncident(cid)) {
      continue
    }
    report.scannedPhaseA += 1
    try {
      sweepBinding(deps, report, 'A', {
        correlationId: cid,
        boundDispatchId: String(binding.orcaDispatchId),
        boundRunId: String(binding.orcaRunId)
      })
    } catch (error) {
      report.sweepErrors.push({ correlationId: cid, phase: 'A', error: sanitize(error) })
    }
  }

  // Phase B — bindings WITH a settlement_observation.
  for (const binding of bindings) {
    const cid = String(binding.correlationId)
    if (!deps.observations.getByCorrelation(cid)) {
      continue
    }
    report.scannedPhaseB += 1
    if (deps.incidents.hasOpenIncident(cid)) {
      continue // blocked — no automatic convergence (§7, §15.2)
    }
    try {
      sweepBinding(deps, report, 'B', {
        correlationId: cid,
        boundDispatchId: String(binding.orcaDispatchId),
        boundRunId: String(binding.orcaRunId)
      })
    } catch (error) {
      report.sweepErrors.push({ correlationId: cid, phase: 'B', error: sanitize(error) })
    }
  }

  return report
}

function sweepBinding(
  deps: ConvergeDeps,
  report: SettlementConvergenceReport,
  phase: 'A' | 'B',
  ids: Ids
): void {
  for (let attempt = 1; attempt <= REVERIFY_BUDGET; attempt += 1) {
    const read = deps.source.readSettlement(ids)

    if (read.kind === 'foreign') {
      raiseIncident(deps, report, phase, {
        correlationId: ids.correlationId,
        orcaDispatchId: ids.boundDispatchId,
        kind: 'foreign_dispatch',
        evidenceDigest: foreignDispatchEvidenceDigest(
          read.resolvedDispatchId,
          read.resolvedRunId,
          ids.correlationId
        ),
        detail: {
          resolved_dispatch_id: read.resolvedDispatchId,
          resolved_run_id: read.resolvedRunId,
          bound_dispatch_id: ids.boundDispatchId,
          bound_run_id: ids.boundRunId,
          failed_check: read.failedCheck
        }
      })
      return
    }

    if (read.kind === 'unresolvable') {
      raiseIncident(deps, report, phase, {
        correlationId: ids.correlationId,
        orcaDispatchId: ids.boundDispatchId,
        kind: 'invalid_or_unresolvable_source',
        evidenceDigest: invalidSourceEvidenceDigest(read.partial),
        detail: { partial: read.partial, failed_expectation: read.failedExpectation }
      })
      return
    }

    if (read.kind === 'no_task' || read.kind === 'no_dispatch' || read.kind === 'non_terminal') {
      // Phase A: never-created / non-terminal → left for the coordinator abandon phase / a later pass.
      // Phase B: an already-observed binding whose source no longer yields a stable terminal
      //          snapshot — NOT a "stable different digest", so NOT source_snapshot_changed.
      if (phase === 'B' && attempt === REVERIFY_BUDGET) {
        pushRetryable(report, ids.correlationId, 'B', 'SOURCE_UNSTABLE_RETRYABLE', attempt)
      }
      if (phase === 'B') {
        continue
      }
      return
    }

    // read.kind === 'terminal'
    const outcome =
      phase === 'A'
        ? commitObservation(deps, report, ids, read.sourceDigest)
        : verifyDigest(deps, report, ids, read.sourceDigest)

    if (outcome.kind === 'done') {
      return
    }
    if (outcome.kind === 'busy') {
      pushRetryable(
        report,
        ids.correlationId,
        phase,
        'EXECUTION_STORE_BUSY_RETRYABLE',
        outcome.attempts
      )
      return
    }
    // outcome.kind === 'moved' — retry the whole attempt against a fresh read
    if (attempt === REVERIFY_BUDGET) {
      pushRetryable(report, ids.correlationId, phase, 'SOURCE_UNSTABLE_RETRYABLE', attempt)
    }
  }
}
