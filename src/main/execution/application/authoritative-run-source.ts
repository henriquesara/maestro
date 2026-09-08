// Execution bounded context — application. Read-only source of authoritative
// execution facts (amendment §S: "pode ler data/app.db"; "NÃO pode escrever").
// This port has NO write method by construction (I1).

import type { ExecutionOutcome } from '../domain/parity'
import type { WorkloadDescriptor } from '../domain/shadow-safety-policy'
import type { SyntheticWorkload } from './execution-plane'

export type AuthoritativeRunRecord = {
  /** aiControlCenter `agent_runs.id` — the authoritative execution identity. */
  aicontrolRunId: string
  agentId: string
  /** Outcome recorded by the authoritative plane. `filesChanged` is null on legacy rows. */
  recordedOutcome: ExecutionOutcome
  /** Safety classification input for the shadow side (from the frozen slice sample). */
  descriptor: WorkloadDescriptor
  /** The synthetic, side-effect-safe equivalent workload for the shadow side. */
  workload: SyntheticWorkload
}

export type SampleSlot = {
  profile: string
  agentIndex: number
  status: 'completed' | 'failed' | 'cancelled'
  descriptor: WorkloadDescriptor
  workload: SyntheticWorkload
}

export type SampleRequest = {
  /** (profile, terminal status) slots the frozen sample needs, in order. */
  slots: readonly SampleSlot[]
}

export type SampleEntry =
  | { kind: 'record'; record: AuthoritativeRunRecord; profile: string }
  | { kind: 'unavailable'; profile: string; reason: 'sample_source_unavailable' }

export interface AuthoritativeRunSource {
  /** Read-only. Resolves each requested slot to a real authoritative row, or marks it unavailable. */
  resolveSample(request: SampleRequest): SampleEntry[]
}
