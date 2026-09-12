import type { DispatchWorktreeStore } from './dispatch-worktree-store'
import type { DurableWorktreeSource } from './durable-worktree-source'
import type { ExecutionStore } from './execution-store'
import type { ExecutionTransactionRunner } from './execution-transaction-runner'
import type { RunBindingCandidateHeadStore } from './run-binding-candidate-head-store'
import type { WorktreeProvenanceIncidentStore } from './worktree-provenance-incident-store'
import type { WorktreeProvenanceStore } from './worktree-provenance-store'
import type { RunBinding } from '../domain/execution-identity'
import { writeIdentitySidecarAtomically } from '../infrastructure/identity-sidecar-store'

// Execution bounded context — application. ORCA-S3 §7.2, §7.6 — the bind-time
// write step, split out of shadow-observation-service.ts for the max-lines
// ratchet (same module, same contract; mirrors converge-worktree-provenance-steps.ts).
// Pinned ordering: (2) atomically write the Execution-owned identity sidecar
// BEFORE opening the transaction; then (4-5) INSERT run_binding + INSERT
// dispatch_worktree in ONE withImmediateTransaction. SQLite and filesystem
// writes are NOT one atomic commit — a committed dispatch_worktree row implies
// the sidecar was already written, never the reverse.

/** Present when a durable shadow-worktree root is composed. */
export type WorktreeProvenanceDeps = {
  dispatchWorktrees: DispatchWorktreeStore
  provenance: WorktreeProvenanceStore
  incidents: WorktreeProvenanceIncidentStore
  runBindingCandidateHead: RunBindingCandidateHeadStore
  source: DurableWorktreeSource
  durableShadowWorktreeRoot: string
  /** Same seam ShadowSettlementDeps.txn uses — the concrete store's withImmediateTransaction. */
  txn: ExecutionTransactionRunner
}

export function bindDispatchWorktree(
  deps: WorktreeProvenanceDeps,
  store: ExecutionStore,
  binding: RunBinding,
  ids: { orcaDispatchId: string; orcaRunId: string; correlationId: string },
  shadowWorktree: string,
  sliceRef: string,
  now: () => string,
  newId: (prefix: string) => string
): void {
  const worktreeNonce = newId('wtnonce')
  writeIdentitySidecarAtomically(deps.durableShadowWorktreeRoot, ids.orcaDispatchId, {
    correlationId: ids.correlationId,
    orcaRunId: ids.orcaRunId,
    orcaDispatchId: ids.orcaDispatchId,
    worktreeNonce,
    sliceRef,
    worktreePath: shadowWorktree
  })
  deps.txn.withImmediateTransaction(() => {
    store.recordBinding(binding) // I3
    deps.dispatchWorktrees.insert({
      orcaDispatchId: ids.orcaDispatchId,
      correlationId: ids.correlationId,
      orcaRunId: ids.orcaRunId,
      worktreeNonce,
      worktreePath: shadowWorktree,
      rootRef: deps.durableShadowWorktreeRoot,
      openedAt: now()
    })
  })
}
