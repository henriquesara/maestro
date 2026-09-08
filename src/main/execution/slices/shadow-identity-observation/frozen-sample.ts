import type { WorkloadDescriptor } from '../../domain/shadow-safety-policy'
import type { WorkloadSpec } from '../../domain/workload-spec'

// The frozen ORCA-S1 same-workload sample (SPEC.md §10 as corrected by
// SPEC-AMENDMENT-001 §4): N = 6 WorkloadSpecs across M = 3 profiles, 2 per
// profile. Each spec is executed twice (authoritative reference + Orca shadow)
// and compared. Two specs carry a deliberate, genuinely-explained divergence.

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
  workload: WorkloadSpec
}

export const FROZEN_SLOTS: readonly FrozenSlot[] = [
  {
    profileIndex: 0,
    occurrence: 0,
    descriptor: synthetic('s1'),
    workload: {
      id: 's1',
      steps: [
        { op: 'write', path: 'src/a.txt', content: '1' },
        { op: 'write', path: 'src/b.txt', content: '2' },
        { op: 'exit', code: 0 }
      ]
    }
  },
  {
    profileIndex: 0,
    occurrence: 1,
    descriptor: synthetic('s2'),
    workload: {
      // Deliberate files_changed divergence: the shadow input worktree carries
      // an extra untracked file the workload commit sweeps in.
      id: 's2',
      steps: [
        { op: 'write', path: 'src/c.txt', content: '3' },
        { op: 'exit', code: 0 }
      ],
      shadowInputExtras: [{ path: 'src/shadow-only-extra.txt', content: 'x' }]
    }
  },
  {
    profileIndex: 1,
    occurrence: 0,
    descriptor: synthetic('s3'),
    workload: {
      id: 's3',
      steps: [
        { op: 'write', path: 'src/d.txt', content: '4' },
        { op: 'exit', code: 1 }
      ]
    }
  },
  {
    profileIndex: 1,
    occurrence: 1,
    descriptor: synthetic('s4'),
    workload: {
      // Exercises a real deletion: a seeded file that a step then removes.
      id: 's4',
      seededFiles: [{ path: 'src/to-delete.txt', content: 'gone' }],
      steps: [
        { op: 'write', path: 'src/e.txt', content: '5' },
        { op: 'delete', path: 'src/to-delete.txt' },
        { op: 'exit', code: 2 }
      ]
    }
  },
  {
    profileIndex: 2,
    occurrence: 0,
    descriptor: synthetic('s5'),
    workload: {
      id: 's5',
      steps: [
        { op: 'write', path: 'src/f.txt', content: '6' },
        { op: 'cancel', midFlight: false }
      ]
    }
  },
  {
    profileIndex: 2,
    occurrence: 1,
    descriptor: synthetic('s6'),
    workload: {
      // Deliberate cancellation-behavior divergence: the reference executor
      // coarsens mid-flight cancel to clean (aiControl-native recording).
      id: 's6',
      steps: [
        { op: 'write', path: 'src/g.txt', content: '7' },
        { op: 'cancel', midFlight: true }
      ]
    }
  }
]

export const EXPECTED_DIVERGENCES: readonly {
  workloadId: string
  dimension: 'files_changed' | 'cancellation'
  classifiedCause: string
}[] = [
  {
    workloadId: 's2',
    dimension: 'files_changed',
    classifiedCause: 'shadow_input_worktree_divergence'
  },
  {
    workloadId: 's6',
    dimension: 'cancellation',
    classifiedCause: 'reference_executor_cancellation_granularity_coarse'
  }
]
