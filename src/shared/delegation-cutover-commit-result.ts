/** Evidence that the future durable spawn-commit transaction settled --
 *  never authority itself (orca-delegated-cutover SPEC.md §4.5.3). This
 *  PRE_IMPLEMENTATION seam only propagates this type end-to-end; no real
 *  application callback in this codebase produces anything but `void` yet.
 *  The real durable transaction (`delegation_cutover`, §8.1) and the real
 *  aiControl fence handshake are Slice-B's own later responsibility, not
 *  implemented here. */
export type DelegationCutoverCommitResult =
  | { outcome: 'COMMITTED'; correlationId: string }
  | { outcome: 'ALREADY_COMMITTED_SAME_IDENTITY'; correlationId: string }
  | {
      outcome: 'REJECTED_PRE_COMMIT'
      reason: 'fence_ineligible' | 'store_busy_retryable' | 'store_error'
    }
  | { outcome: 'DIVERGENCE'; detail: string }
  | { outcome: 'RECONCILIATION_REQUIRED' }
