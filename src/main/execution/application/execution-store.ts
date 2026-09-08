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
  code: SafetyRejectionCode | 'sample_source_unavailable'
  reason: string
  excludedAt: string
}

export interface ExecutionStore {
  /** Throws RunBindingError('duplicate_dispatch'|'duplicate_aicontrol_run') on a uniqueness violation. */
  recordBinding(binding: RunBinding): void
  getBindingByDispatch(orcaDispatchId: string): RunBinding | undefined
  listBindings(sliceRef: string): RunBinding[]

  recordParityObservation(observation: ParityObservation): void
  listParityObservations(sliceRef: string): ParityObservation[]

  recordExclusion(exclusion: WorkloadExclusion): void
  listExclusions(sliceRef: string): WorkloadExclusion[]
}
