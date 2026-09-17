import { createHash } from 'node:crypto'
import type { DispatchProcessBindingRecord } from '../domain/dispatch-process-binding'
import { EVIDENCE_JOINER } from '../domain/settlement-incident'
import type { RunBinding } from '../domain/execution-identity'
import type { DelegationCutoverCommitResult } from '../../../shared/delegation-cutover-commit-result'
import { SqliteDelegationCutoverStore } from '../infrastructure/sqlite-delegation-cutover-store'
import type SyncDatabase from '../../sqlite/sync-database'

// Execution bounded context — application. ORCA-S5 Delegated Cutover Core
// (SPEC.md §5.4/§8.1, §4.8.4, corrected round 5). The S5.4 atomic
// bind+cutover transaction — mirrors `worktree-provenance-bind-step.ts`'s
// `bindDispatchWorktree` exactly (same `withImmediateTransaction` primitive,
// same "the durable commit is the one authority-transfer instant" shape).
// `run_reservation` is deliberately NOT one of this transaction's inserts —
// it must already exist (written earlier by
// `delegated-cutover-reservation-step.ts`, at S2).

export type DispatchWorktreeInsert = {
  orcaDispatchId: string
  correlationId: string
  orcaRunId: string
  worktreeNonce: string
  worktreePath: string
  rootRef: string
  openedAt: string
}

export type DelegatedCutoverCommitDeps = {
  store: { database: SyncDatabase; recordBinding(binding: RunBinding): void }
  dispatchWorktrees: { insert(record: DispatchWorktreeInsert): void }
  processBindings: { insert(record: DispatchProcessBindingRecord): void }
  txn: { withImmediateTransaction<T>(fn: () => T): T }
  /** Narrow pre-cutover cancellation check (SPEC's own not-yet-authority
   *  aiControl-native cancellation path, mission §29/§30). Optional — a
   *  caller with no cancellation source simply never rejects on this basis. */
  cancellation?: { isCancelled(aicontrolRunId: string): boolean }
}

export type DelegatedCutoverCommitInput = {
  correlationId: string
  aicontrolRunId: string
  fenceToken: string
  binding: RunBinding
  worktree: DispatchWorktreeInsert
  processIdentity: DispatchProcessBindingRecord | null | undefined
}

export class DelegatedCutoverCommitRejectedError extends Error {
  constructor(
    readonly reason: 'cancelled_pre_commit' | 'process_identity_required' | 'conflicting_identity',
    cause?: unknown
  ) {
    super(`delegated_cutover_commit_rejected: ${reason}`)
    this.name = 'DelegatedCutoverCommitRejectedError'
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

function cutoverDigest(fenceToken: string, aicontrolRunId: string, orcaDispatchId: string): string {
  return createHash('sha256')
    .update([fenceToken, aicontrolRunId, orcaDispatchId].join(EVIDENCE_JOINER))
    .digest('hex')
}

/**
 * Success means the atomic transaction (`run_binding` + `dispatch_worktree` +
 * `dispatch_process_binding` + `delegation_cutover`) has durably COMMITTED —
 * the sole authority-transfer instant (SPEC §5.4/§16, unchanged by this
 * implementation). Rejection (thrown) means the held workload must remain
 * withheld; no partial state ever escapes `withImmediateTransaction`'s own
 * commit/rollback boundary.
 */
export async function commitDelegatedCutover(
  deps: DelegatedCutoverCommitDeps,
  input: DelegatedCutoverCommitInput
): Promise<DelegationCutoverCommitResult> {
  if (deps.cancellation?.isCancelled(input.aicontrolRunId)) {
    throw new DelegatedCutoverCommitRejectedError('cancelled_pre_commit')
  }
  if (!input.processIdentity) {
    throw new DelegatedCutoverCommitRejectedError('process_identity_required')
  }
  const processIdentity = input.processIdentity

  const delegationCutovers = new SqliteDelegationCutoverStore(deps.store.database)
  const existing = delegationCutovers.get(input.correlationId)
  if (existing) {
    const sameIdentity =
      existing.aicontrolRunId === input.aicontrolRunId &&
      existing.fenceToken === input.fenceToken &&
      existing.orcaDispatchId === processIdentity.orcaDispatchId
    if (sameIdentity) {
      return { outcome: 'ALREADY_COMMITTED_SAME_IDENTITY', correlationId: input.correlationId }
    }
    throw new DelegatedCutoverCommitRejectedError('conflicting_identity')
  }

  const cutoverAt = new Date().toISOString()
  const digest = cutoverDigest(
    input.fenceToken,
    input.aicontrolRunId,
    processIdentity.orcaDispatchId
  )

  deps.txn.withImmediateTransaction(() => {
    deps.store.recordBinding(input.binding)
    deps.dispatchWorktrees.insert(input.worktree)
    deps.processBindings.insert(processIdentity)
    delegationCutovers.insert({
      correlationId: input.correlationId,
      orcaDispatchId: processIdentity.orcaDispatchId,
      orcaRunId: processIdentity.orcaRunId,
      aicontrolRunId: input.aicontrolRunId,
      fenceToken: input.fenceToken,
      cutoverDigest: digest,
      cutoverAt
    })
  })

  return { outcome: 'COMMITTED', correlationId: input.correlationId }
}
