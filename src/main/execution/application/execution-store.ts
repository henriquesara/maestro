// Execution bounded context — application. Persistence port for Execution-owned
// state only: run_binding, parity_observation, workload_exclusion (amendment
// §L, §S). No other module may write these.

import type { RunBinding } from '../domain/execution-identity'
import type { ParityObservation } from '../domain/parity'
import type { SafetyRejectionCode } from '../domain/shadow-safety-policy'

export type WorkloadExclusion = {
  id: string
  sliceRef: string
  workloadId: string
  code: SafetyRejectionCode | 'sample_source_unavailable' | 'path_confinement'
  reason: string
  excludedAt: string
}

export type ExecutionStore = {
  /** Throws RunBindingError('duplicate_dispatch'|'duplicate_aicontrol_run') on a uniqueness violation. */
  recordBinding(binding: RunBinding): void
  setBindingCandidateHead(orcaDispatchId: string, candidateHead: string): void
  getBindingByDispatch(orcaDispatchId: string): RunBinding | undefined
  getBindingByCorrelation(correlationId: string): RunBinding | undefined
  listBindings(sliceRef: string): RunBinding[]

  recordParityObservation(observation: ParityObservation): void
  listParityObservations(sliceRef: string): ParityObservation[]

  recordExclusion(exclusion: WorkloadExclusion): void
  listExclusions(sliceRef: string): WorkloadExclusion[]
}
