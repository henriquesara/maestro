// Execution bounded context — domain. Pure.
// ORCA-S4 SPEC §8.0.1, §8.6 — the durable, idempotent record that a terminal
// event would be emitted exactly once under shadow. SOURCE state (corrected
// from PROJECTION): captures a discrete historical act, not a value a rebuild
// may recompute.

export const SHADOW_DELEGATED_BOUNDARY_CLOSED = 'shadow_delegated_boundary_closed' as const

export type DispatchLifecycleEventRecord = {
  correlationId: string
  /** 'shadow_delegated_boundary_closed' — the only kind S4 defines. */
  eventKind: string
  /** Copy of dispatch_lifecycle_closure.closure_digest. */
  closureDigestRef: string
  emittedAt: string
}
