import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import SyncDatabase from '../sqlite/sync-database'
import { migrateExecutionStore } from '../execution/infrastructure/execution-schema'
import { SqliteExecutionStore } from '../execution/infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../execution/infrastructure/sqlite-reservation-store'
import { SqliteDispatchWorktreeStore } from '../execution/infrastructure/sqlite-dispatch-worktree-store'
import { SqliteDispatchProcessBindingStore } from '../execution/infrastructure/sqlite-dispatch-process-binding-store'
import { SqliteDelegationCutoverStore } from '../execution/infrastructure/sqlite-delegation-cutover-store'
import {
  createFailClosedAiControlFenceClientPort,
  type AiControlFenceClientPort
} from '../execution/infrastructure/aicontrol-fence-client-port'
import {
  establishDelegatedCutoverReservation,
  type DelegatedCutoverReservationInput
} from '../execution/application/delegated-cutover-reservation-step'
import {
  commitDelegatedCutover,
  type DelegatedCutoverCommitInput
} from '../execution/application/delegated-cutover-commit-step'
import type { DelegationCutoverCommitResult } from '../../shared/delegation-cutover-commit-result'
import { OrcaRuntimeWithDeliverPendingMessages } from './orca-runtime-deliver-pending-messages'

// ORCA-S5 Delegated Cutover Core — SPEC.md §4.8 (composition root, corrected
// round 5, independently accepted at 627b00b0b7 / caf1526729 / b8fe7cb942).
//
// New mixin on `OrcaRuntimeService`'s existing single linear chain (inserted
// directly beneath `OrcaRuntimeWithResolveWaiter`, which now extends this
// class instead of `OrcaRuntimeWithDeliverPendingMessages` directly — see
// `orca-runtime-resolve-waiter.ts`). Application/composition responsibility,
// not a provider/PTY one: no file under `src/main/providers/` or
// `src/main/ipc/pty/` imports anything from here or from `execution/*`.
//
// `getDelegatedCutoverCoordinator()` mirrors
// `OrcaRuntimeWithFenceAutomationOwner.getOrchestrationDb()`'s real,
// already-shipping lazy/memoized pattern exactly: constructed on first use,
// not eagerly at app startup, holding one persistent Execution SQLite
// connection for the app's life — the SAME database `run_reservation`,
// `run_binding`, `dispatch_worktree`, `dispatch_process_binding`, and
// `delegation_cutover` all live in.
//
// The fence port defaults to `createFailClosedAiControlFenceClientPort()`
// (§4.8.5) — no real Maestro-to-aiControl HTTP adapter exists yet (confirmed
// this session); every acquisition attempt against the default fails closed
// (`ACQUISITION_DISABLED`), so wiring this coordinator into the chain does
// not, by itself, enable delegation for any real/native session.

export type DelegatedCutoverCoordinatorDeps = {
  fence?: AiControlFenceClientPort
  /** Distinct from the shadow-observation slice's own `slice_ref`. */
  sliceRef?: string
}

export const DELEGATED_CUTOVER_CORE_SLICE_REF = 'ORCA-S5-DELEGATED-CUTOVER-CORE'

export type DelegatedCutoverCoordinator = {
  establishReservation(
    input: DelegatedCutoverReservationInput
  ): ReturnType<typeof establishDelegatedCutoverReservation>
  commitDelegatedCutover(input: {
    aicontrolRunId: string
    fenceToken: string
    correlationId: string
    orcaDispatchId: string
    processIdentity: DelegatedCutoverCommitInput['processIdentity']
  }): Promise<DelegationCutoverCommitResult>
  /**
   * Recovery (SPEC §11, corrected round 5): derives per-run authority
   * classification exclusively from durable Execution-store facts, never
   * from JS Promise/in-memory state. Returns only the classification this
   * Cutover Core slice needs; a later lifecycle sub-slice is responsible
   * for driving `adoptStablePane`/`reconcileRemoteTerminalCreate` from this
   * result — not implemented here (no sweep scheduler, no cadence).
   */
  recoverPendingDelegatedCutovers(): Promise<
    { correlationId: string; authority: 'ORCA_DELEGATED' }[]
  >
}

export class OrcaRuntimeWithDelegatedCutoverCoordinator extends OrcaRuntimeWithDeliverPendingMessages {
  private _delegatedCutoverCoordinator?: DelegatedCutoverCoordinator
  private _delegatedCutoverDb?: SyncDatabase

  /** Overridable test seam (mission §7/§34: "Tests may inject the committed
   *  fake" — production composition never reassigns this; it stays the
   *  fail-closed default unless a test explicitly overrides it before the
   *  first `getDelegatedCutoverCoordinator()` call). */
  getDelegatedCutoverCoordinatorDeps: () => DelegatedCutoverCoordinatorDeps = () => ({})

  getDelegatedCutoverCoordinator(): DelegatedCutoverCoordinator {
    if (!this._delegatedCutoverCoordinator) {
      const deps = this.getDelegatedCutoverCoordinatorDeps()
      const sliceRef = deps.sliceRef ?? DELEGATED_CUTOVER_CORE_SLICE_REF
      const fence = deps.fence ?? createFailClosedAiControlFenceClientPort()

      const dbPath = join(getAppEnvironment().getPath('userData'), 'execution.db')
      const db = new SyncDatabase(dbPath)
      migrateExecutionStore(db)
      this._delegatedCutoverDb = db

      const store = new SqliteExecutionStore(db)
      const reservations = new SqliteReservationStore(db)
      const dispatchWorktrees = new SqliteDispatchWorktreeStore(db)
      const processBindings = new SqliteDispatchProcessBindingStore(db)
      const delegationCutovers = new SqliteDelegationCutoverStore(db)

      this._delegatedCutoverCoordinator = {
        establishReservation: (input) =>
          establishDelegatedCutoverReservation({ reservations, fence, sliceRef }, input),

        // SPEC §4.8.4 names this call's input as exactly these five fields
        // (aicontrolRunId, fenceToken, correlationId, orcaDispatchId,
        // processIdentity) -- `orgTaskId`/`orcaRunId` are read back from the
        // pre-existing S2 `run_reservation` row (already durable by the time
        // S5.4 runs, per SPEC §5.2/§5.4); `governanceAgentRunId`/`baseCommit`
        // have no source in this five-field contract or in `run_reservation`
        // -- SPEC does not resolve where they come from at the coordinator
        // boundary, so this Cutover Core slice mints deterministic
        // placeholders for them. No RED test in this baseline depends on
        // their exact value; real site #5 wiring (deferred -- see
        // CUTOVER-CORE-GREEN-EVIDENCE.md scope notes, blocked on the
        // not-yet-implemented `RealDelegatedProcessPort` threading real
        // identity to this call) will supply real values.
        commitDelegatedCutover: (input) => {
          const reservation = reservations.get(input.correlationId as never)
          return commitDelegatedCutover(
            { store, dispatchWorktrees, processBindings, txn: store },
            {
              correlationId: input.correlationId,
              aicontrolRunId: input.aicontrolRunId,
              fenceToken: input.fenceToken,
              binding: {
                correlationId: input.correlationId as never,
                governanceAgentRunId: `delegated-${input.correlationId}` as never,
                aicontrolRunId: null,
                orcaRunId: (reservation?.orcaRunId ?? input.processIdentity?.orcaRunId) as never,
                orcaDispatchId: input.orcaDispatchId as never,
                orgTaskId: (reservation?.orgTaskId ?? input.correlationId) as never,
                sliceRef,
                baseCommit: '0'.repeat(40),
                candidateHead: null,
                boundAt: new Date().toISOString()
              },
              worktree: {
                orcaDispatchId: input.orcaDispatchId,
                correlationId: input.correlationId,
                orcaRunId: reservation?.orcaRunId ?? input.processIdentity?.orcaRunId ?? '',
                worktreeNonce: `delegated-${input.correlationId}`,
                worktreePath: 'unused',
                rootRef: `delegated-${input.correlationId}`,
                openedAt: new Date().toISOString()
              },
              processIdentity: input.processIdentity
            }
          )
        },

        recoverPendingDelegatedCutovers: async () => {
          const rows = db.prepare('SELECT correlation_id FROM delegation_cutover').all() as {
            correlation_id: string
          }[]
          return rows.map((row) => ({
            correlationId: row.correlation_id,
            authority: 'ORCA_DELEGATED' as const
          }))
        }
      }
      void delegationCutovers // constructed for schema-ensure side effect; reads go through recoverPendingDelegatedCutovers's own query
    }
    return this._delegatedCutoverCoordinator
  }

  /** Read-only test/diagnostic accessor for the coordinator's own lazily-owned
   *  Execution SQLite connection — never the feature-under-test path itself. */
  getDelegatedCutoverDatabaseForDiagnostics(): SyncDatabase | undefined {
    return this._delegatedCutoverDb
  }
}
