// Execution bounded context — domain. Pure.
// Parity value objects + comparison (amendment §S gate 8).

import type { RunBinding } from './execution-identity'

export type TerminalOutcome = 'completed' | 'failed' | 'timeout' | 'cancelled' | 'unknown'
export type ExitDisposition = 'zero_exit' | 'non_zero_exit' | 'no_exit'
export type CancellationBehavior =
  | 'not_cancelled'
  | 'cancelled_clean'
  | 'cancelled_mid_flight'
  | 'unknown'

/** Sorted, de-duplicated relative paths. */
export type FilesChangedSet = readonly string[]

export function filesChangedSet(paths: readonly string[]): FilesChangedSet {
  return [...new Set(paths.map((p) => p.trim()).filter((p) => p.length > 0))].sort()
}

export type ExecutionOutcome = {
  terminalOutcome: TerminalOutcome
  exitDisposition: ExitDisposition
  cancellationBehavior: CancellationBehavior
  filesChanged: FilesChangedSet | null
}

export type ParityDimension =
  | 'terminal_outcome'
  | 'files_changed'
  | 'exit_disposition'
  | 'cancellation'

export type Divergence = {
  dimension: ParityDimension
  authoritative: string
  shadow: string
}

export type ParityResult = {
  match: boolean
  divergences: readonly Divergence[]
}

/**
 * RED: not implemented yet. Compares the four required dimensions. A null
 * filesChanged on either side is reported as a `files_changed` divergence
 * (recorded outcome unavailable) rather than silently skipped.
 */
export function compareOutcomes(
  _authoritative: ExecutionOutcome,
  _shadow: ExecutionOutcome
): ParityResult {
  throw new Error('NOT_IMPLEMENTED: parity compareOutcomes')
}

export type ParityObservation = {
  id: string
  runBindingDispatchId: string
  sliceRef: string
  authoritative: ExecutionOutcome
  shadow: ExecutionOutcome
  parity: ParityResult
  rootCause: string | null
  observedAt: string
}

export class ParityObservationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParityObservationError'
  }
}

/**
 * I7 — an observation with a mismatch is incomplete until every divergence is
 * root-caused. RED: not implemented yet.
 */
export function assertObservationComplete(_observation: ParityObservation): void {
  throw new Error('NOT_IMPLEMENTED: I7 assertObservationComplete')
}

export function bindingDispatchKey(binding: RunBinding): string {
  return String(binding.orcaDispatchId)
}
