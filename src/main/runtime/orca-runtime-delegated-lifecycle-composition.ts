import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type SyncDatabase from '../sqlite/sync-database'
import {
  convergeDelegationBoundaryLifecycle,
  type DelegationBoundaryLifecycleDeps,
  type DelegationBoundaryLifecycleReport
} from '../execution/application/converge-delegation-boundary-lifecycle'
import type { AiControlDelegationProjectionPort } from '../execution/application/converge-delegated-lifecycle-steps'
import type { TeardownReason } from '../execution/domain/dispatch-process-binding'
import { SqliteAiControlTerminalProjectionStore } from '../execution/infrastructure/sqlite-aicontrol-terminal-projection-store'
import { SqliteDelegationCutoverStore } from '../execution/infrastructure/sqlite-delegation-cutover-store'
import { SqliteDispatchLifecycleClosureStore } from '../execution/infrastructure/sqlite-dispatch-lifecycle-closure-store'
import { SqliteDispatchLifecycleEventStore } from '../execution/infrastructure/sqlite-dispatch-lifecycle-event-store'
import { SqliteDispatchLifecycleIncidentStore } from '../execution/infrastructure/sqlite-dispatch-lifecycle-incident-store'
import { SqliteDispatchProcessBindingStore } from '../execution/infrastructure/sqlite-dispatch-process-binding-store'
import { SqliteDispatchTerminationStore } from '../execution/infrastructure/sqlite-dispatch-termination-store'
import { SqliteDispatchWorktreeStore } from '../execution/infrastructure/sqlite-dispatch-worktree-store'
import { SqliteExecutionStore } from '../execution/infrastructure/sqlite-execution-store'
import { SqliteSettlementObservationStore } from '../execution/infrastructure/sqlite-settlement-observation-store'
import { SqliteWorktreeFinalizationStore } from '../execution/infrastructure/sqlite-worktree-finalization-store'
import { SqliteWorktreeProvenanceIncidentStore } from '../execution/infrastructure/sqlite-worktree-provenance-incident-store'
import { SqliteWorktreeProvenanceStore } from '../execution/infrastructure/sqlite-worktree-provenance-store'

// ORCA-S5 SPEC §4.8.1 / §11 — the ONE post-cutover recovery/reconciliation
// composition, owned by the accepted `DelegatedCutoverCoordinator` (not a second
// composition root). It assembles the S4 sweep's dependencies over the
// coordinator's OWN persistent Execution connection and runs ONE pass.
//
// Cadence is deliberately NOT frozen (SPEC §11, §21 item 7): this exposes a single
// reconciliation pass; correctness derives only from durable facts, so repeated
// calls / restarts reach the same fixed point. No timer is started here.

export type DelegatedLifecycleReconcilerDeps = {
  db: SyncDatabase
  sliceRef: string
  processPort: DelegationBoundaryLifecycleDeps['processPort']
  /** Absent ⇒ outbox rows stay `pending`: no network transport exists (SPEC §4.8.5 is later integration). */
  projectionWriter?: AiControlDelegationProjectionPort
  /** Directory for the (deletion-free) roots the shared S4 sweep signature still requires. */
  userDataDir: string
  now?: () => string
}

export type DelegatedTeardownRequest =
  | { outcome: 'REQUESTED' }
  | { outcome: 'ALREADY_REQUESTED'; reason: TeardownReason | null }
  | { outcome: 'ALREADY_TERMINAL' }

export class DelegatedTeardownRejectedError extends Error {
  constructor(readonly reason: 'no_durable_cutover') {
    super(`delegated_teardown_rejected: ${reason}`)
    this.name = 'DelegatedTeardownRejectedError'
  }
}

export function createDelegatedLifecycleReconciler(deps: DelegatedLifecycleReconcilerDeps) {
  const { db, sliceRef } = deps
  const now = deps.now ?? (() => new Date().toISOString())
  const bindings = new SqliteExecutionStore(db)
  const processBindings = new SqliteDispatchProcessBindingStore(db)
  const terminations = new SqliteDispatchTerminationStore(db)
  const delegationCutovers = new SqliteDelegationCutoverStore(db)
  const sweepDeps: DelegationBoundaryLifecycleDeps = {
    bindings,
    settlements: new SqliteSettlementObservationStore(db),
    dispatchWorktrees: new SqliteDispatchWorktreeStore(db),
    provenance: new SqliteWorktreeProvenanceStore(db),
    worktreeProvenanceIncidents: new SqliteWorktreeProvenanceIncidentStore(db),
    processBindings,
    terminations,
    finalizations: new SqliteWorktreeFinalizationStore(db),
    closures: new SqliteDispatchLifecycleClosureStore(db),
    events: new SqliteDispatchLifecycleEventStore(db),
    incidents: new SqliteDispatchLifecycleIncidentStore(db),
    processPort: deps.processPort,
    liveHandles: new Map(),
    // A delegated run's real worktree is never reaped (SPEC §13); these roots exist only to
    // satisfy the shared S4 signature and are never a deletion target for a delegated run.
    durableShadowWorktreeRoot: join(deps.userDataDir, 'delegated-lifecycle', 'worktrees'),
    durableShadowLifecycleRoot: join(deps.userDataDir, 'delegated-lifecycle', 'process'),
    now,
    newId: (prefix) => `${prefix}_${randomUUID()}`,
    delegationCutovers,
    projections: new SqliteAiControlTerminalProjectionStore(db),
    projectionWriter: deps.projectionWriter
  }

  return {
    /** ONE reconciliation pass — from durable facts only, never a prior Promise or JS object. */
    reconcile(): Promise<DelegationBoundaryLifecycleReport> {
      return convergeDelegationBoundaryLifecycle(sweepDeps, { sliceRef })
    },

    /**
     * SPEC §9.1/§12 — durably record the teardown INTENT with its reason (ONE statement, first
     * writer wins, X13). It never signals: the sweep signals, and only the exact verified
     * identity. Only the CURRENT authority may act: a run with no durable `delegation_cutover`
     * is rejected and nothing is written. The reason is an already-DECIDED cause — the timeout
     * SLA source/policy is unfrozen (§12, §21 item 1) and is deliberately not modelled here.
     */
    requestTeardown(input: {
      correlationId: string
      reason: TeardownReason
    }): DelegatedTeardownRequest {
      const cutover = delegationCutovers.get(input.correlationId)
      if (!cutover) {
        throw new DelegatedTeardownRejectedError('no_durable_cutover')
      }
      if (terminations.getByCorrelationId(input.correlationId)) {
        return { outcome: 'ALREADY_TERMINAL' }
      }
      const { applied } = processBindings.markTeardownRequested(
        cutover.orcaDispatchId,
        now(),
        input.reason
      )
      if (applied) {
        return { outcome: 'REQUESTED' }
      }
      return {
        outcome: 'ALREADY_REQUESTED',
        reason: processBindings.getByDispatchId(cutover.orcaDispatchId)?.teardownReason ?? null
      }
    }
  }
}
