// ORCA-S5 Post-Cutover Lifecycle — RED-ONLY fixtures: a REAL, disposable,
// migrated Execution SQLite file DB, and a delegated run whose
// `delegation_cutover` was durably committed through the accepted Cutover-Core
// application APIs (`establishDelegatedCutoverReservation` +
// `commitDelegatedCutover`). Authority is DERIVED from that durable row, never
// a flag (mission §3). Test-only: never production behavior.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SyncDatabase from '../../../sqlite/sync-database'
import { commitDelegatedCutover } from '../../application/delegated-cutover-commit-step'
import { establishDelegatedCutoverReservation } from '../../application/delegated-cutover-reservation-step'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { SqliteDelegationCutoverStore } from '../../infrastructure/sqlite-delegation-cutover-store'
import { SqliteDispatchLifecycleClosureStore } from '../../infrastructure/sqlite-dispatch-lifecycle-closure-store'
import { SqliteDispatchLifecycleEventStore } from '../../infrastructure/sqlite-dispatch-lifecycle-event-store'
import { SqliteDispatchLifecycleIncidentStore } from '../../infrastructure/sqlite-dispatch-lifecycle-incident-store'
import { SqliteDispatchProcessBindingStore } from '../../infrastructure/sqlite-dispatch-process-binding-store'
import { SqliteDispatchTerminationStore } from '../../infrastructure/sqlite-dispatch-termination-store'
import { SqliteDispatchWorktreeStore } from '../../infrastructure/sqlite-dispatch-worktree-store'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import { SqliteWorktreeFinalizationStore } from '../../infrastructure/sqlite-worktree-finalization-store'
import { SqliteWorktreeProvenanceIncidentStore } from '../../infrastructure/sqlite-worktree-provenance-incident-store'
import { SqliteWorktreeProvenanceStore } from '../../infrastructure/sqlite-worktree-provenance-store'
import {
  fixtureSettlementObservation,
  fixtureWorktreeProvenance
} from '../delegated-side-effect-boundary/delegated-side-effect-boundary-test-harness'
import {
  DELEGATED_CUTOVER_CORE_SLICE_REF,
  FakeAiControlFenceClient,
  fixtureProcessIdentity,
  fixtureRunBinding
} from './cutover-core-test-harness'

export {
  DELEGATED_CUTOVER_CORE_SLICE_REF,
  FakeAiControlCancellationAuthority,
  FakeAiControlFenceClient
} from './cutover-core-test-harness'

export type TeardownReason = 'user_cancel' | 'timeout'

// ── Real, disposable Execution DB ───────────────────────────────────────────

export function openLifecycleStores(dbPath: string) {
  const db = new SyncDatabase(dbPath)
  migrateExecutionStore(db)
  return {
    db,
    store: new SqliteExecutionStore(db),
    reservations: new SqliteReservationStore(db),
    settlements: new SqliteSettlementObservationStore(db),
    dispatchWorktrees: new SqliteDispatchWorktreeStore(db),
    provenance: new SqliteWorktreeProvenanceStore(db),
    worktreeProvenanceIncidents: new SqliteWorktreeProvenanceIncidentStore(db),
    processBindings: new SqliteDispatchProcessBindingStore(db),
    terminations: new SqliteDispatchTerminationStore(db),
    finalizations: new SqliteWorktreeFinalizationStore(db),
    closures: new SqliteDispatchLifecycleClosureStore(db),
    events: new SqliteDispatchLifecycleEventStore(db),
    incidents: new SqliteDispatchLifecycleIncidentStore(db),
    delegationCutovers: new SqliteDelegationCutoverStore(db)
  }
}
export type LifecycleStores = ReturnType<typeof openLifecycleStores>

export type LifecycleFixture = {
  dir: string
  dbPath: string
  stores: LifecycleStores
  fence: FakeAiControlFenceClient
  clock: () => string
  /** Close the DB and reopen it with FRESH store objects — a host restart. No in-memory state survives. */
  reopen: () => LifecycleStores
  cleanup: () => void
}

export function openLifecycleFixture(): LifecycleFixture {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s5-postcutover-'))
  const dbPath = join(dir, 'execution.db')
  let tick = 0
  const fx: LifecycleFixture = {
    dir,
    dbPath,
    stores: openLifecycleStores(dbPath),
    fence: new FakeAiControlFenceClient(),
    clock: () => new Date(Date.UTC(2026, 8, 21, 0, 0, ++tick)).toISOString(),
    reopen: () => {
      fx.stores.db.close()
      fx.stores = openLifecycleStores(dbPath)
      return fx.stores
    },
    cleanup: () => {
      try {
        fx.stores.db.close()
      } catch {
        /* already closed */
      }
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* Windows may hold a transient handle */
      }
    }
  }
  return fx
}

// ── A delegated run that has ALREADY durably committed its cutover ─────────

export type DelegatedRun = {
  n: number
  correlationId: string
  orcaDispatchId: string
  orcaRunId: string
  orgTaskId: string
  aicontrolRunId: string
  fenceToken: string
  pid: number
  osStartMarker: string
  osStartMarkerSource: 'windows_creation_time' | 'posix_proc_stat_starttime'
  killScope: 'win-taskkill-tree' | 'posix-process-group'
  /** A REAL directory on disk standing in for the real dispatch worktree (SPEC §13). */
  worktreePath: string
  worktreeSentinel: string
}

export async function commitDelegatedRun(
  fx: LifecycleFixture,
  n = 1,
  over: { worktreeRoot?: string; osStartMarkerSource?: 'unavailable' } = {}
): Promise<DelegatedRun> {
  const win = process.platform === 'win32'
  const run: DelegatedRun = {
    n,
    correlationId: `corr_pc_${n}`,
    orcaDispatchId: `dispatch_pc_${n}`,
    orcaRunId: `run_pc_${n}`,
    orgTaskId: `task_pc_${n}`,
    aicontrolRunId: `aicontrol_run_pc_${n}`,
    fenceToken: `token_pc_${n}`,
    pid: 990_000 + n,
    osStartMarker: `os_marker_pc_${n}`,
    osStartMarkerSource: win ? 'windows_creation_time' : 'posix_proc_stat_starttime',
    killScope: win ? 'win-taskkill-tree' : 'posix-process-group',
    worktreePath: join(
      over.worktreeRoot ?? join(fx.dir, 'real-dispatch-worktrees'),
      `dispatch_pc_${n}`
    ),
    worktreeSentinel: `real worktree content ${n}`
  }
  mkdirSync(run.worktreePath, { recursive: true })
  writeFileSync(join(run.worktreePath, 'sentinel.txt'), run.worktreeSentinel)

  fx.fence.seedEligible(run.aicontrolRunId)
  await establishDelegatedCutoverReservation(
    {
      reservations: fx.stores.reservations,
      fence: fx.fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    },
    {
      correlationId: run.correlationId,
      aicontrolRunId: run.aicontrolRunId,
      fenceToken: run.fenceToken,
      workloadId: `workload_pc_${n}`,
      providerEligible: true,
      now: '2026-09-21T00:00:00.000Z'
    }
  )
  const committed = await commitDelegatedCutover(
    {
      store: fx.stores.store,
      dispatchWorktrees: fx.stores.dispatchWorktrees,
      processBindings: fx.stores.processBindings,
      txn: fx.stores.store
    },
    {
      correlationId: run.correlationId,
      aicontrolRunId: run.aicontrolRunId,
      fenceToken: run.fenceToken,
      binding: fixtureRunBinding({
        correlationId: run.correlationId as never,
        governanceAgentRunId: `gar_pc_${n}` as never,
        orcaRunId: run.orcaRunId as never,
        orcaDispatchId: run.orcaDispatchId as never,
        orgTaskId: run.orgTaskId as never,
        baseCommit: 'b'.repeat(40)
      }),
      worktree: {
        orcaDispatchId: run.orcaDispatchId,
        correlationId: run.correlationId,
        orcaRunId: run.orcaRunId,
        worktreeNonce: `wnonce_pc_${n}`,
        worktreePath: run.worktreePath,
        rootRef: `root_pc_${n}`,
        openedAt: '2026-09-21T00:00:00.000Z'
      },
      processIdentity: fixtureProcessIdentity({
        orcaDispatchId: run.orcaDispatchId,
        correlationId: run.correlationId,
        orcaRunId: run.orcaRunId,
        processNonce: `nonce_pc_${n}`,
        pid: run.pid,
        killScope: run.killScope,
        osStartMarker: over.osStartMarkerSource === 'unavailable' ? null : run.osStartMarker,
        osStartMarkerSource: over.osStartMarkerSource ?? run.osStartMarkerSource
      })
    }
  )
  if (committed.outcome !== 'COMMITTED') {
    throw new Error(`fixture precondition failed: cutover did not commit (${committed.outcome})`)
  }
  return run
}

/** Authority is DERIVED from the durable fact, never a flag (mission §3). */
export function authorityOf(
  fx: LifecycleFixture,
  correlationId: string
): 'ORCA_DELEGATED' | 'AICONTROL_NATIVE' {
  return fx.stores.delegationCutovers.get(correlationId) ? 'ORCA_DELEGATED' : 'AICONTROL_NATIVE'
}

/** ORCA-S2 output (real store, real row) — the Orca-side settlement the closure copies. */
export function seedSettlement(
  fx: LifecycleFixture,
  run: DelegatedRun,
  status: 'observed' | 'observed_conflicted' = 'observed'
): void {
  fx.stores.settlements.insert(
    fixtureSettlementObservation({
      correlationId: run.correlationId,
      orcaDispatchId: run.orcaDispatchId,
      orcaRunId: run.orcaRunId,
      orgTaskId: run.orgTaskId,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF,
      status
    }) as never
  )
}

/** ORCA-S3 output (real store, real row) — base/candidate/files coherent with the bound worktree. */
export function seedProvenance(
  fx: LifecycleFixture,
  run: DelegatedRun,
  over: { baseCommit?: string; candidateHead?: string; filesChangedJson?: string } = {}
): void {
  fx.stores.provenance.insert(
    fixtureWorktreeProvenance({
      correlationId: run.correlationId,
      orcaDispatchId: run.orcaDispatchId,
      orcaRunId: run.orcaRunId,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF,
      worktreePathRef: run.worktreePath,
      baseCommit: over.baseCommit ?? 'b'.repeat(40),
      candidateHead: over.candidateHead ?? 'c'.repeat(40),
      filesChangedJson: over.filesChangedJson ?? '["src/a.ts"]'
    }) as never
  )
}

export function seedUpstreamTerminal(fx: LifecycleFixture, run: DelegatedRun): void {
  seedSettlement(fx, run)
  seedProvenance(fx, run)
}
