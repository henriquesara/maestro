import type { SampleRequest, SampleSlot } from '../../application/authoritative-run-source'
import type { SyntheticWorkload } from '../../application/execution-plane'

// The frozen ORCA-S1 parity sample (SPEC.md §10): N = 6 shadow runs across
// M = 3 synthetic agent profiles. Declared here, not invented at acceptance.
export const SHADOW_IDENTITY_OBSERVATION_SLICE_REF = 'ORCA-S1'
export const PARITY_SAMPLE_N = 6
export const PARITY_SAMPLE_M = 3

const synthetic = (id: string) => ({ id, kind: 'synthetic', declaredCapabilities: [] }) as const

function workload(id: string, steps: SyntheticWorkload['steps']): SyntheticWorkload {
  return { id, steps }
}

function slot(
  profile: string,
  agentIndex: number,
  status: SampleSlot['status'],
  id: string,
  steps: SyntheticWorkload['steps']
): SampleSlot {
  return { profile, agentIndex, status, descriptor: synthetic(id), workload: workload(id, steps) }
}

export const FROZEN_SAMPLE_REQUEST: SampleRequest = {
  slots: [
    slot('A', 0, 'completed', 's1', [
      { op: 'write', path: 'src/a.txt', content: '1' },
      { op: 'write', path: 'src/b.txt', content: '2' },
      { op: 'exit', code: 0 }
    ]),
    slot('A', 0, 'completed', 's2', [
      { op: 'write', path: 'src/c.txt', content: '3' },
      { op: 'delete', path: 'src/a.txt' },
      { op: 'exit', code: 0 }
    ]),
    slot('B', 1, 'failed', 's3', [
      { op: 'write', path: 'src/d.txt', content: '4' },
      { op: 'exit', code: 1 }
    ]),
    slot('B', 1, 'failed', 's4', [
      { op: 'write', path: 'src/e.txt', content: '5' },
      { op: 'exit', code: 2 }
    ]),
    slot('C', 2, 'cancelled', 's5', [
      { op: 'write', path: 'src/f.txt', content: '6' },
      { op: 'cancel', midFlight: false }
    ]),
    slot('C', 2, 'cancelled', 's6', [
      { op: 'write', path: 'src/g.txt', content: '7' },
      { op: 'cancel', midFlight: true }
    ])
  ]
}

// Divergences the frozen sample deliberately expects (SPEC.md §10 rows 2, 6).
export const EXPECTED_DIVERGENCES: readonly {
  slotIndex: number
  dimension: 'files_changed' | 'cancellation'
  rootCause: string
}[] = [
  {
    slotIndex: 1,
    dimension: 'files_changed',
    rootCause: 'shadow_synthetic_workload_not_replayable'
  },
  {
    slotIndex: 5,
    dimension: 'cancellation',
    rootCause: 'authoritative_cancellation_granularity_not_recorded'
  }
]
