// Execution bounded context — domain. Pure.
// ORCA-S4 SPEC §8.0, §8.2 — the durable, one-time capture of an ephemeral,
// non-replayable OS event (a process's exit). SOURCE state: no Phase-B
// re-verify exists, every column immutable after insert (§14 LIFE-6).

export type TerminationMethod = 'self_exit' | 'signalled' | 'confirmed_dead_unknown_cause'

export type DispatchTerminationRecord = {
  correlationId: string
  orcaDispatchId: string
  terminationMethod: TerminationMethod
  /** NULL when unknown (confirmed_dead_unknown_cause) — never invented. */
  exitCode: number | null
  exitSignal: string | null
  /** 1 = signalProcessTree / self-exit confirmed; 0 = root-only confirmation (§9.3). */
  treeVerified: boolean
  observedAt: string
}
