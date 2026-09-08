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
  /** Dimensions the authoritative side did not record — not compared, not a divergence. */
  notComparable: readonly ParityDimension[]
}

function filesLabel(set: FilesChangedSet | null): string {
  return set === null ? '<unrecorded>' : `[${set.join(', ')}]`
}

/**
 * Compares the four required dimensions (amendment §S gate 8). A null
 * `filesChanged` on either side is reported as a `files_changed` divergence
 * (recorded outcome unavailable) rather than silently skipped.
 */
export function compareOutcomes(
  authoritative: ExecutionOutcome,
  shadow: ExecutionOutcome
): ParityResult {
  const divergences: Divergence[] = []

  if (authoritative.terminalOutcome !== shadow.terminalOutcome) {
    divergences.push({
      dimension: 'terminal_outcome',
      authoritative: authoritative.terminalOutcome,
      shadow: shadow.terminalOutcome
    })
  }
  if (authoritative.exitDisposition !== shadow.exitDisposition) {
    divergences.push({
      dimension: 'exit_disposition',
      authoritative: authoritative.exitDisposition,
      shadow: shadow.exitDisposition
    })
  }
  if (authoritative.cancellationBehavior !== shadow.cancellationBehavior) {
    divergences.push({
      dimension: 'cancellation',
      authoritative: authoritative.cancellationBehavior,
      shadow: shadow.cancellationBehavior
    })
  }
  const notComparable: ParityDimension[] = []
  if (authoritative.filesChanged === null) {
    // Legacy authoritative rows did not record a files-changed set: not compared.
    notComparable.push('files_changed')
  } else {
    const shadowFiles = shadow.filesChanged ?? []
    const filesEqual =
      authoritative.filesChanged.length === shadowFiles.length &&
      authoritative.filesChanged.every((p, i) => p === shadowFiles[i])
    if (!filesEqual) {
      divergences.push({
        dimension: 'files_changed',
        authoritative: filesLabel(authoritative.filesChanged),
        shadow: filesLabel(shadow.filesChanged)
      })
    }
  }

  return { match: divergences.length === 0, divergences, notComparable }
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
 * root-caused.
 */
export function assertObservationComplete(observation: ParityObservation): void {
  if (!observation.parity.match && (observation.rootCause ?? '').trim().length === 0) {
    throw new ParityObservationError(
      `ParityObservation ${observation.id} has ${observation.parity.divergences.length} divergence(s) and no root cause.`
    )
  }
}

export function bindingDispatchKey(binding: RunBinding): string {
  return String(binding.orcaDispatchId)
}
