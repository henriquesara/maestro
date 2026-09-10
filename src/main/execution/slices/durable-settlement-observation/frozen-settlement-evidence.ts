import type { SettlementConvergenceReport } from '../../application/converge-settlements'
import type { SettlementObservedOutcome } from '../../domain/settlement-observed-outcome'

// ORCA-S2 §10 — the frozen acceptance sample. N = 3, all `synthetic` /
// `repo_local_code_only` (§I). No file-mutating workload: S2 reads NO Git state.

export const DURABLE_SETTLEMENT_SLICE_REF = 'ORCA-S2-durable-settlement-observation'

export const FROZEN_SETTLEMENT_SAMPLE_N = 3

export type FrozenSettlementCase = {
  correlationId: string
  outcome: 'succeeded' | 'failed'
  result: Record<string, unknown>
  expectedObserved: SettlementObservedOutcome
}

export const FROZEN_SETTLEMENT_CASES: readonly FrozenSettlementCase[] = [
  {
    correlationId: 'orca_s2_frozen_completed',
    outcome: 'succeeded',
    result: { provenance: 'orca_s1_shadow', exitCode: 0 },
    expectedObserved: {
      terminalOutcome: 'completed',
      exitDisposition: 'zero_exit',
      cancellation: 'not_cancelled'
    }
  },
  {
    correlationId: 'orca_s2_frozen_failed',
    outcome: 'failed',
    result: { provenance: 'orca_s1_shadow', exitCode: 7 },
    expectedObserved: {
      terminalOutcome: 'failed',
      exitDisposition: 'non_zero_exit',
      cancellation: 'not_cancelled'
    }
  },
  {
    correlationId: 'orca_s2_frozen_cancelled',
    outcome: 'failed',
    result: { provenance: 'orca_s1_shadow', cancelled: true },
    expectedObserved: {
      terminalOutcome: 'cancelled',
      exitDisposition: 'no_exit',
      cancellation: 'cancelled'
    }
  }
]

export type SettlementEvidenceBundle = {
  sliceRef: string
  sampleN: number
  authorityBefore: 'AICONTROL_NATIVE'
  authorityAfter: 'AICONTROL_NATIVE'
  orcaModeBefore: 'ORCA_SHADOW_ADVISORY'
  orcaModeAfter: 'ORCA_SHADOW_ADVISORY'
  coupling: 'EXECUTION_OWNED_SCHEMA_COUPLED_READER'
  convergence: Pick<
    SettlementConvergenceReport,
    | 'scannedPhaseA'
    | 'scannedPhaseB'
    | 'observed'
    | 'conflicted'
    | 'incidents'
    | 'noop'
    | 'retryable'
    | 'sweepErrors'
  >
  sourceGuard: SettlementConvergenceReport['sourceGuard']
  observations: {
    correlationId: string
    orcaDispatchId: string
    status: string
    sourceDigest: string
    observedOutcome: SettlementObservedOutcome
    provenanceComplete: boolean
  }[]
  dbGuard: {
    aicontrolDbSha256Before: string
    aicontrolDbSha256After: string
    sidecarsAfter: boolean
    unchanged: boolean
  }
  parityObservationsWrittenByS2: number
}
