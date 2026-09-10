import type { DurableSettlementSnapshot } from './durable-settlement-snapshot'
import type { SettlementObservedOutcome } from './settlement-observed-outcome'

// Execution bounded context — domain. The settlement-observation aggregate (§12):
// one converged DurableSettlementSnapshot for one run_binding. Advisory. Never a
// data/app.db write, never a Governance AgentRun terminal write, never a
// parity_observation write.

export type SettlementObservationStatus = 'observed' | 'observed_conflicted'

export type SettlementObservationRecord = {
  correlationId: string
  orcaDispatchId: string
  orcaRunId: string
  orgTaskId: string
  sliceRef: string
  status: SettlementObservationStatus
  sourceDispatchStatus: string
  sourceDispatchCompletedAt: string | null
  sourceTaskStatus: string
  sourceTaskCompletedAt: string | null
  sourceDigest: string
  observedOutcomeJson: string
  provenanceJson: string
  firstSeenAt: string
  observedAt: string
  conflictedAt: string | null
}

export type ResolvedSourceRefs = {
  resolvedDispatchId: string
  resolvedRunId: string
  sourceDbPath: string
}

/** §4 / §12 — provenance is the full canonical snapshot plus resolved ids + source db path. */
export function buildProvenance(
  snapshot: DurableSettlementSnapshot,
  refs: ResolvedSourceRefs
): string {
  return JSON.stringify({
    snapshot,
    resolved_dispatch_id: refs.resolvedDispatchId,
    resolved_run_id: refs.resolvedRunId,
    source_db_path: refs.sourceDbPath
  })
}

export class ObservationNotConvergedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ObservationNotConvergedError'
  }
}

const TERMINAL_OUTCOMES = new Set(['completed', 'failed', 'cancelled'])
const EXIT_DISPOSITIONS = new Set(['zero_exit', 'non_zero_exit', 'no_exit'])
const CANCELLATIONS = new Set(['cancelled', 'not_cancelled'])

function isValidObservedOutcome(value: unknown): value is SettlementObservedOutcome {
  if (!value || typeof value !== 'object') {
    return false
  }
  const o = value as Record<string, unknown>
  return (
    typeof o.terminalOutcome === 'string' &&
    TERMINAL_OUTCOMES.has(o.terminalOutcome) &&
    typeof o.exitDisposition === 'string' &&
    EXIT_DISPOSITIONS.has(o.exitDisposition) &&
    typeof o.cancellation === 'string' &&
    CANCELLATIONS.has(o.cancellation)
  )
}

const REQUIRED_SNAPSHOT_KEYS: (keyof DurableSettlementSnapshot)[] = [
  'correlationId',
  'orgTaskId',
  'orcaRunId',
  'orcaDispatchId',
  'dispatchStatus',
  'taskStatus'
]

/**
 * §21, P-S2-1, P-S2-2 — throws unless provenance is complete, the observation's
 * dispatch identity equals the bound one, and observed_outcome_json is a valid
 * SettlementObservedOutcome.
 */
export function assertObservationConverged(
  observation: SettlementObservationRecord,
  input: { boundDispatchId: string }
): void {
  if (observation.orcaDispatchId !== input.boundDispatchId) {
    throw new ObservationNotConvergedError(
      `observation dispatch ${observation.orcaDispatchId} != bound dispatch ${input.boundDispatchId}`
    )
  }

  if (!observation.provenanceJson) {
    throw new ObservationNotConvergedError('provenance_json is empty')
  }
  let provenance: Record<string, unknown>
  try {
    provenance = JSON.parse(observation.provenanceJson) as Record<string, unknown>
  } catch {
    throw new ObservationNotConvergedError('provenance_json is not valid JSON')
  }
  const snapshot = provenance.snapshot as Partial<DurableSettlementSnapshot> | undefined
  if (
    !snapshot ||
    REQUIRED_SNAPSHOT_KEYS.some((k) => snapshot[k] === undefined || snapshot[k] === '')
  ) {
    throw new ObservationNotConvergedError('provenance_json snapshot is incomplete')
  }
  if (
    typeof provenance.resolved_dispatch_id !== 'string' ||
    typeof provenance.resolved_run_id !== 'string' ||
    typeof provenance.source_db_path !== 'string' ||
    provenance.source_db_path === ''
  ) {
    throw new ObservationNotConvergedError(
      'provenance_json is missing resolved ids or source_db_path'
    )
  }
  if (provenance.resolved_dispatch_id !== observation.orcaDispatchId) {
    throw new ObservationNotConvergedError(
      'provenance_json resolved_dispatch_id disagrees with the observation dispatch id'
    )
  }

  let outcome: unknown
  try {
    outcome = JSON.parse(observation.observedOutcomeJson)
  } catch {
    throw new ObservationNotConvergedError('observed_outcome_json is not valid JSON')
  }
  if (!isValidObservedOutcome(outcome)) {
    throw new ObservationNotConvergedError(
      'observed_outcome_json is not a valid SettlementObservedOutcome'
    )
  }
}
