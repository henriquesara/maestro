import type { WorkloadDescriptor } from '../../domain/shadow-safety-policy'
import type { WorkloadSpec } from '../../domain/workload-spec'
import type { NativeWorkloadRequest } from '../../infrastructure/aicontrol-native/disposable-aicontrol-env'

// The frozen ORCA-S1 same-workload sample (SPEC-AMENDMENT-002 §4-§6):
// N = 6 controlled workloads across M = 3 controlled aiControl agent profiles,
// 2 per profile. Each workload is executed on BOTH sides:
//   - aiControl NATIVE: `createRun({command}) -> runAgent` in a disposable env;
//   - Orca SHADOW: the equivalent exit/cancel WorkloadSpec in a disposable
//     git worktree.
// All six are expected to match naturally on all four parity dimensions. No
// divergence is injected (AMENDMENT-002 §6) — the two AMENDMENT-001 deliberate
// divergences are removed.

export const SHADOW_IDENTITY_OBSERVATION_SLICE_REF = 'ORCA-S1'
export const PARITY_SAMPLE_N = 6
export const PARITY_SAMPLE_M = 3

const synthetic = (id: string): WorkloadDescriptor => ({
  id,
  kind: 'synthetic',
  declaredCapabilities: []
})

export type FrozenSlot = {
  profileIndex: number // 0..M-1
  occurrence: number // 0 or 1
  descriptor: WorkloadDescriptor
  /** aiControl native provider command. */
  providerCommand: string
  cancel: boolean
  /** The semantically-equivalent Orca shadow workload. */
  workload: WorkloadSpec
}

const exitOnly = (id: string, code: number): WorkloadSpec => ({
  id,
  steps: [{ op: 'exit', code }]
})
const cancelClean = (id: string): WorkloadSpec => ({
  id,
  steps: [{ op: 'cancel', midFlight: false }]
})

export const FROZEN_SLOTS: readonly FrozenSlot[] = [
  {
    profileIndex: 0,
    occurrence: 0,
    descriptor: synthetic('s1'),
    providerCommand: 'mock',
    cancel: false,
    workload: exitOnly('s1', 0)
  },
  {
    profileIndex: 0,
    occurrence: 1,
    descriptor: synthetic('s2'),
    providerCommand: 'mock',
    cancel: false,
    workload: exitOnly('s2', 0)
  },
  {
    profileIndex: 1,
    occurrence: 0,
    descriptor: synthetic('s3'),
    providerCommand: 'mock exit=2',
    cancel: false,
    workload: exitOnly('s3', 2)
  },
  {
    profileIndex: 1,
    occurrence: 1,
    descriptor: synthetic('s4'),
    providerCommand: 'mock exit=5',
    cancel: false,
    workload: exitOnly('s4', 5)
  },
  {
    profileIndex: 2,
    occurrence: 0,
    descriptor: synthetic('s5'),
    providerCommand: 'mock',
    cancel: true,
    workload: cancelClean('s5')
  },
  {
    profileIndex: 2,
    occurrence: 1,
    descriptor: synthetic('s6'),
    providerCommand: 'mock',
    cancel: true,
    workload: cancelClean('s6')
  }
]

/** The requests handed to the disposable aiControl native harness. */
export const NATIVE_WORKLOAD_REQUESTS: readonly NativeWorkloadRequest[] = FROZEN_SLOTS.map((s) => ({
  workloadId: s.workload.id,
  command: s.providerCommand,
  cancel: s.cancel,
  profileIndex: s.profileIndex
}))

// AMENDMENT-002 §6: the acceptance sample injects no divergence. Any observed
// divergence must be genuinely root-caused or the sample fails.
export const EXPECTED_DIVERGENCES: readonly {
  workloadId: string
  dimension: 'files_changed' | 'cancellation' | 'terminal_outcome' | 'exit_disposition'
  classifiedCause: string
}[] = []
