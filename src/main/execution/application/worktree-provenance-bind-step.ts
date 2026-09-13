import type { DispatchWorktreeStore } from './dispatch-worktree-store'
import type { DurableWorktreeSource } from './durable-worktree-source'
import type { ExecutionStore } from './execution-store'
import type { ExecutionTransactionRunner } from './execution-transaction-runner'
import type { RunBindingCandidateHeadStore } from './run-binding-candidate-head-store'
import type { WorktreeProvenanceIncidentStore } from './worktree-provenance-incident-store'
import type { WorktreeProvenanceStore } from './worktree-provenance-store'
import type { ChildProcessHandle } from '../../../shared/child-process/process-spec'
import type { RunBinding } from '../domain/execution-identity'
import type { DispatchProcessBindingRecord } from '../domain/dispatch-process-binding'
import {
  processIdentitySidecarPath,
  writeProcessIdentitySidecarAtomically
} from '../infrastructure/durable-shadow-lifecycle-root'
import { writeIdentitySidecarAtomically } from '../infrastructure/identity-sidecar-store'
import type { ShadowLifecycleProcessPort } from '../infrastructure/shadow-lifecycle-process-adapter'
import type { SqliteDispatchProcessBindingStore } from '../infrastructure/sqlite-dispatch-process-binding-store'

// Execution bounded context — application. ORCA-S3 §7.2, §7.6 — the bind-time
// write step, split out of shadow-observation-service.ts for the max-lines
// ratchet (same module, same contract; mirrors converge-worktree-provenance-steps.ts).
// Pinned ordering: (2) atomically write the Execution-owned identity sidecar
// BEFORE opening the transaction; then (4-5) INSERT run_binding + INSERT
// dispatch_worktree in ONE withImmediateTransaction. SQLite and filesystem
// writes are NOT one atomic commit — a committed dispatch_worktree row implies
// the sidecar was already written, never the reverse.
//
// ORCA-S4 §9.2 — extends this SAME seam, optionally: two more pre-transaction
// steps (write the process identity sidecar; spawn the synthetic shadow
// lifecycle process) and one more insert inside the SAME transaction
// (dispatch_process_binding). Present only when `delegationBoundary` is
// supplied — omitting it reproduces the exact pre-S4 behavior byte-for-byte.

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

/** ORCA-S4 §9.2 — present only when S4 is composed (requires `WorktreeProvenanceDeps` too). */
export type DelegationBoundaryBindDeps = {
  processBindings: SqliteDispatchProcessBindingStore
  processPort: ShadowLifecycleProcessPort
  durableShadowLifecycleRoot: string
}

export function bindDispatchWorktree(
  deps: WorktreeProvenanceDeps,
  store: ExecutionStore,
  binding: RunBinding,
  ids: { orcaDispatchId: string; orcaRunId: string; correlationId: string },
  shadowWorktree: string,
  sliceRef: string,
  now: () => string,
  newId: (prefix: string) => string,
  delegationBoundary?: DelegationBoundaryBindDeps
): { spawnedHandle?: ChildProcessHandle } {
  const worktreeNonce = newId('wtnonce')
  writeIdentitySidecarAtomically(deps.durableShadowWorktreeRoot, ids.orcaDispatchId, {
    correlationId: ids.correlationId,
    orcaRunId: ids.orcaRunId,
    orcaDispatchId: ids.orcaDispatchId,
    worktreeNonce,
    sliceRef,
    worktreePath: shadowWorktree
  })

  let processBindingRow: DispatchProcessBindingRecord | undefined
  let spawnedHandle: ChildProcessHandle | undefined
  if (delegationBoundary) {
    const processNonce = newId('pnonce')
    const sidecarPath = processIdentitySidecarPath(delegationBoundary.durableShadowLifecycleRoot, ids.orcaDispatchId)
    // §9.2 step 3 — sidecar written BEFORE the process exists.
    writeProcessIdentitySidecarAtomically(delegationBoundary.durableShadowLifecycleRoot, ids.orcaDispatchId, {
      correlationId: ids.correlationId,
      orcaRunId: ids.orcaRunId,
      orcaDispatchId: ids.orcaDispatchId,
      processNonce,
      spawnedAt: null,
      pid: null,
      osStartMarker: null,
      osStartMarkerSource: null
    })
    // §9.2 step 4 — spawn, obtain pid + OS-observable marker, rewrite the sidecar.
    const spawned = delegationBoundary.processPort.spawn({
      correlationId: ids.correlationId,
      orcaRunId: ids.orcaRunId,
      orcaDispatchId: ids.orcaDispatchId,
      processNonce,
      identitySidecarPath: sidecarPath
    })
    spawnedHandle = spawned.handle
    const spawnedAt = now()
    writeProcessIdentitySidecarAtomically(delegationBoundary.durableShadowLifecycleRoot, ids.orcaDispatchId, {
      correlationId: ids.correlationId,
      orcaRunId: ids.orcaRunId,
      orcaDispatchId: ids.orcaDispatchId,
      processNonce,
      spawnedAt,
      pid: spawned.pid,
      osStartMarker: spawned.osStartMarker,
      osStartMarkerSource: spawned.osStartMarkerSource
    })
    processBindingRow = {
      orcaDispatchId: ids.orcaDispatchId,
      correlationId: ids.correlationId,
      orcaRunId: ids.orcaRunId,
      processNonce,
      pid: spawned.pid,
      killScope: spawned.killScope,
      osStartMarker: spawned.osStartMarker,
      osStartMarkerSource: spawned.osStartMarkerSource,
      spawnedAt,
      teardownRequestedAt: null
    }
  }

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
    if (delegationBoundary && processBindingRow) {
      delegationBoundary.processBindings.insert(processBindingRow)
    }
  })

  return { spawnedHandle }
}
