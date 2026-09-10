import type { CanonicalJson, DurableSettlementSnapshot } from './durable-settlement-snapshot'

// Execution bounded context — domain. Pure. The narrowed observed outcome (§6.2),
// derived ONLY from a DurableSettlementSnapshot. No filesChanged, no candidate_head,
// no cancelled_clean vs cancelled_mid_flight — durable facts do not prove that.

export type SettlementObservedOutcome = {
  terminalOutcome: 'completed' | 'failed' | 'cancelled'
  exitDisposition: 'zero_exit' | 'non_zero_exit' | 'no_exit'
  cancellation: 'cancelled' | 'not_cancelled'
}

/** Thrown when a required derivation field is structurally absent/malformed → `invalid_or_unresolvable_source`. */
export class SettlementOutcomeUnresolvableError extends Error {
  constructor(
    readonly failedExpectation: string,
    readonly partial: Record<string, unknown>
  ) {
    super(failedExpectation)
    this.name = 'SettlementOutcomeUnresolvableError'
  }
}

function isPlainObject(v: CanonicalJson | null): v is Record<string, CanonicalJson> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function settlementObservedOutcome(
  snapshot: DurableSettlementSnapshot
): SettlementObservedOutcome {
  const body = snapshot.taskResultCanonical

  if (body !== null && !isPlainObject(body)) {
    throw new SettlementOutcomeUnresolvableError('tasks.result body is not an object', {
      correlationId: snapshot.correlationId,
      orcaDispatchId: snapshot.orcaDispatchId,
      taskResultCanonical: body
    })
  }

  const cancelledMarker = isPlainObject(body) && body.cancelled === true

  const exitCodeRaw = isPlainObject(body) ? body.exitCode : undefined
  if (
    exitCodeRaw !== undefined &&
    exitCodeRaw !== null &&
    (typeof exitCodeRaw !== 'number' || !Number.isInteger(exitCodeRaw) || exitCodeRaw < 0)
  ) {
    throw new SettlementOutcomeUnresolvableError(
      'tasks.result.exitCode is present but not a non-negative integer',
      {
        correlationId: snapshot.correlationId,
        orcaDispatchId: snapshot.orcaDispatchId,
        exitCode: exitCodeRaw
      }
    )
  }

  const terminalOutcome: SettlementObservedOutcome['terminalOutcome'] = cancelledMarker
    ? 'cancelled'
    : snapshot.dispatchStatus === 'completed' && snapshot.taskStatus === 'completed'
      ? 'completed'
      : 'failed'

  const exitDisposition: SettlementObservedOutcome['exitDisposition'] =
    cancelledMarker || exitCodeRaw === undefined || exitCodeRaw === null
      ? 'no_exit'
      : exitCodeRaw === 0
        ? 'zero_exit'
        : 'non_zero_exit'

  return {
    terminalOutcome,
    exitDisposition,
    cancellation: terminalOutcome === 'cancelled' ? 'cancelled' : 'not_cancelled'
  }
}
