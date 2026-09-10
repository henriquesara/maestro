import { makeCorrelationId } from '../domain/execution-identity'
import {
  foreignDispatchEvidenceDigest,
  invalidSourceEvidenceDigest,
  type SettlementIncidentKind,
  type SettlementIncidentRecord
} from '../domain/settlement-incident'
import { buildProvenance, type SettlementObservationRecord } from '../domain/settlement-observation'
import { settlementObservedOutcome } from '../domain/settlement-observed-outcome'
import { ExecutionStoreBusyError } from '../infrastructure/with-immediate-transaction'
import type {
  ConvergeDeps,
  Ids,
  RetryableReason,
  SettlementConvergenceReport
} from './converge-settlements'

// Execution bounded context — application. ORCA-S2 §8 / §16 — the per-binding
// convergence STEP helpers (atomic decision, incident raising). Split from
// converge-settlements.ts for the max-lines ratchet; same module, same contract.

const ADVANCEABLE_STATES: ReadonlySet<string> = new Set([
  'orca_created',
  'bound',
  'executed',
  'settled'
])

/** The source snapshot moved between the first read and the in-transaction re-verify. */
export class SourceMovedError extends Error {
  constructor() {
    super('source snapshot changed across the read → re-verify window')
    this.name = 'SourceMovedError'
  }
}

export type StepOutcome = { kind: 'done' } | { kind: 'moved' } | { kind: 'busy'; attempts: number }

export function pushRetryable(
  report: SettlementConvergenceReport,
  correlationId: string,
  phase: 'A' | 'B',
  reason: RetryableReason,
  attempts: number
): void {
  report.retryable.push({ correlationId, phase, reason, attempts })
}

function withTransaction<T extends { kind: string }>(
  deps: ConvergeDeps,
  fn: () => T
): T | { kind: 'moved' } | { kind: 'busy'; attempts: number } {
  try {
    return deps.txn.withImmediateTransaction(fn)
  } catch (error) {
    if (error instanceof SourceMovedError) {
      return { kind: 'moved' }
    }
    if (error instanceof ExecutionStoreBusyError) {
      return { kind: 'busy', attempts: error.attempts }
    }
    throw error
  }
}

function advanceReservationToObserved(
  deps: ConvergeDeps,
  correlationId: string,
  now: string
): void {
  const cid = makeCorrelationId(correlationId)
  const reservation = deps.reservations.get(cid)
  if (reservation && ADVANCEABLE_STATES.has(reservation.state)) {
    deps.reservations.advance(cid, 'observed', { now })
  }
}

/** §8 Phase A step 4 / §16.3 — re-read inside the write txn, then insert-or-no-op atomically. */
export function commitObservation(
  deps: ConvergeDeps,
  report: SettlementConvergenceReport,
  ids: Ids,
  firstDigest: string
): StepOutcome {
  return withTransaction<StepOutcome>(deps, (): StepOutcome => {
    const reread = deps.source.readSettlement(ids)
    if (reread.kind !== 'terminal' || reread.sourceDigest !== firstDigest) {
      throw new SourceMovedError()
    }
    if (deps.observations.getByCorrelation(ids.correlationId)) {
      return { kind: 'done' }
    }
    if (deps.incidents.hasOpenIncident(ids.correlationId)) {
      return { kind: 'done' }
    }
    const snapshot = reread.snapshot
    const observedOutcome = settlementObservedOutcome(snapshot)
    const now = deps.now()
    const record: SettlementObservationRecord = {
      correlationId: ids.correlationId,
      orcaDispatchId: snapshot.orcaDispatchId,
      orcaRunId: snapshot.orcaRunId,
      orgTaskId: snapshot.orgTaskId,
      sliceRef: report.sliceRef,
      status: 'observed',
      sourceDispatchStatus: snapshot.dispatchStatus,
      sourceDispatchCompletedAt: snapshot.dispatchCompletedAt,
      sourceTaskStatus: snapshot.taskStatus,
      sourceTaskCompletedAt: snapshot.taskCompletedAt,
      sourceDigest: reread.sourceDigest,
      observedOutcomeJson: JSON.stringify(observedOutcome),
      provenanceJson: buildProvenance(snapshot, {
        resolvedDispatchId: snapshot.orcaDispatchId,
        resolvedRunId: snapshot.orcaRunId,
        sourceDbPath: deps.sourceDbPath
      }),
      firstSeenAt: now,
      observedAt: now,
      conflictedAt: null
    }
    const { inserted } = deps.observations.insert(record)
    if (!inserted) {
      return { kind: 'done' }
    }
    advanceReservationToObserved(deps, ids.correlationId, now)
    report.observed.push({
      correlationId: ids.correlationId,
      orcaDispatchId: snapshot.orcaDispatchId,
      sourceDigest: reread.sourceDigest
    })
    return { kind: 'done' }
  })
}

/** §8 Phase B step 2 / §16.3 — obtain a stable digest, then no-op / raise source_snapshot_changed. */
export function verifyDigest(
  deps: ConvergeDeps,
  report: SettlementConvergenceReport,
  ids: Ids,
  firstDigest: string
): StepOutcome {
  return withTransaction<StepOutcome>(deps, (): StepOutcome => {
    const reread = deps.source.readSettlement(ids)
    if (reread.kind !== 'terminal' || reread.sourceDigest !== firstDigest) {
      throw new SourceMovedError()
    }
    const observation = deps.observations.getByCorrelation(ids.correlationId)
    if (!observation) {
      return { kind: 'done' }
    }
    if (reread.sourceDigest === observation.sourceDigest) {
      // G3 — a crash after the observation commit but before the reservation advanced
      // heals here via an idempotent CAS. No second observation.
      advanceReservationToObserved(deps, ids.correlationId, deps.now())
      report.noop += 1
      return { kind: 'done' }
    }
    const now = deps.now()
    let oldSnapshot: unknown = null
    try {
      oldSnapshot =
        (JSON.parse(observation.provenanceJson) as { snapshot?: unknown }).snapshot ?? null
    } catch {
      oldSnapshot = null
    }
    const incident: SettlementIncidentRecord = {
      id: deps.newId('sinc'),
      correlationId: ids.correlationId,
      orcaDispatchId: ids.boundDispatchId,
      sliceRef: report.sliceRef,
      kind: 'source_snapshot_changed',
      evidenceDigest: reread.sourceDigest,
      detailJson: JSON.stringify({
        old_digest: observation.sourceDigest,
        new_digest: reread.sourceDigest,
        old_snapshot: oldSnapshot,
        new_snapshot: reread.snapshot
      }),
      blocked: true,
      resolvedAt: null,
      resolutionNote: null,
      raisedAt: now
    }
    deps.incidents.insert(incident)
    deps.observations.markConflicted(ids.correlationId, now)
    report.incidents.push({
      correlationId: ids.correlationId,
      kind: 'source_snapshot_changed',
      evidenceDigest: reread.sourceDigest
    })
    report.conflicted.push({
      correlationId: ids.correlationId,
      oldDigest: observation.sourceDigest,
      newDigest: reread.sourceDigest
    })
    return { kind: 'done' }
  })
}

export type IncidentInput = {
  correlationId: string
  orcaDispatchId: string | null
  kind: SettlementIncidentKind
  evidenceDigest: string
  detail: Record<string, unknown>
}

/** §16.2 — incident precheck + insert atomically inside one withImmediateTransaction. */
export function raiseIncident(
  deps: ConvergeDeps,
  report: SettlementConvergenceReport,
  phase: 'A' | 'B',
  input: IncidentInput
): void {
  const outcome = withTransaction<{ kind: 'done'; wrote: boolean }>(deps, () => {
    if (deps.observations.getByCorrelation(input.correlationId)) {
      return { kind: 'done', wrote: false }
    }
    const record: SettlementIncidentRecord = {
      id: deps.newId('sinc'),
      correlationId: input.correlationId,
      orcaDispatchId: input.orcaDispatchId,
      sliceRef: report.sliceRef,
      kind: input.kind,
      evidenceDigest: input.evidenceDigest,
      detailJson: JSON.stringify(input.detail),
      blocked: true,
      resolvedAt: null,
      resolutionNote: null,
      raisedAt: deps.now()
    }
    deps.incidents.insert(record)
    return { kind: 'done', wrote: true }
  })
  if (outcome.kind === 'busy') {
    pushRetryable(
      report,
      input.correlationId,
      phase,
      'EXECUTION_STORE_BUSY_RETRYABLE',
      outcome.attempts
    )
    return
  }
  if (outcome.kind === 'moved') {
    return
  }
  if (outcome.wrote) {
    report.incidents.push({
      correlationId: input.correlationId,
      kind: input.kind,
      evidenceDigest: input.evidenceDigest
    })
  }
}

export { foreignDispatchEvidenceDigest, invalidSourceEvidenceDigest }
