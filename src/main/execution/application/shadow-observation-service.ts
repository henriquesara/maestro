// Execution bounded context — application. Orchestrates ORCA-S1: resolve the
// frozen sample, classify each workload, dispatch only the eligible subset via
// the ExecutionPlane, record run_binding + parity_observation, root-cause every
// divergence. Advisory only — never touches an authoritative run.

import type { AuthoritativeRunSource, SampleRequest } from './authoritative-run-source'
import type { ExecutionPlane } from './execution-plane'
import type { ExecutionStore } from './execution-store'
import type { RunBinding } from '../domain/execution-identity'
import type { ParityObservation } from '../domain/parity'

export type ShadowObservationInput = {
  sliceRef: string
  request: SampleRequest
  worktreeRoot: string
  /** Mints a fresh disposable worktree dir for a shadow run. */
  makeWorktreeDir: (runId: string) => string
  now: () => string
  newId: (prefix: string) => string
}

export type ShadowObservationReport = {
  sliceRef: string
  bindings: readonly RunBinding[]
  observations: readonly ParityObservation[]
  exclusionCount: number
  divergences: readonly { dispatchId: string; dimension: string; rootCause: string }[]
  abandoned: readonly { workloadId: string; reason: string }[]
}

export type ShadowObservationDeps = {
  source: AuthoritativeRunSource
  plane: ExecutionPlane
  store: ExecutionStore
}

/**
 * RED: not implemented yet. Must guarantee:
 *  I2 — an ineligible workload never reaches `plane`;
 *  I5 — a throw from `plane` or within a run is caught, recorded, and never
 *       propagates out of the per-entry loop (crash isolation);
 *  I7 — a mismatched ParityObservation carries a non-empty rootCause.
 */
export function runShadowObservation(
  _deps: ShadowObservationDeps,
  _input: ShadowObservationInput
): Promise<ShadowObservationReport> {
  throw new Error('NOT_IMPLEMENTED: I2/I5/I7 runShadowObservation')
}
