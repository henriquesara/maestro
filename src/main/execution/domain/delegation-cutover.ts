// Execution bounded context — domain. Pure. No infrastructure, no Orca types.
// SPEC.md §8.1 — the sole authority-transfer fact for a delegated run. SOURCE,
// write-once, immutable except `ackStatus` (the one permitted post-insert
// mutation, out of this core slice's scope to mutate).

export type DelegationCutoverAckStatus = 'pending' | 'acknowledged'

export type DelegationCutoverRecord = {
  correlationId: string
  orcaDispatchId: string
  orcaRunId: string
  aicontrolRunId: string
  /** The exact token supplied to acquireOrcaFence. */
  fenceToken: string
  /** SHA-256(fenceToken || aicontrolRunId || orcaDispatchId). */
  cutoverDigest: string
  cutoverAt: string
  ackStatus: DelegationCutoverAckStatus
}
