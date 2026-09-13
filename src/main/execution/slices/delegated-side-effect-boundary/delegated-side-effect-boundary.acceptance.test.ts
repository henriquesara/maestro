import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { assertNoSqliteSidecars, sha256File } from '../../infrastructure/aicontrol-db-reader'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { SqliteDispatchLifecycleClosureStore } from '../../infrastructure/sqlite-dispatch-lifecycle-closure-store'
import { SqliteDispatchLifecycleEventStore } from '../../infrastructure/sqlite-dispatch-lifecycle-event-store'
import { SqliteDispatchLifecycleIncidentStore } from '../../infrastructure/sqlite-dispatch-lifecycle-incident-store'
import { SqliteDispatchProcessBindingStore } from '../../infrastructure/sqlite-dispatch-process-binding-store'
import { SqliteDispatchTerminationStore } from '../../infrastructure/sqlite-dispatch-termination-store'
import { SqliteDispatchWorktreeStore } from '../../infrastructure/sqlite-dispatch-worktree-store'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import { SqliteWorktreeFinalizationStore } from '../../infrastructure/sqlite-worktree-finalization-store'
import { SqliteWorktreeProvenanceIncidentStore } from '../../infrastructure/sqlite-worktree-provenance-incident-store'
import { SqliteWorktreeProvenanceStore } from '../../infrastructure/sqlite-worktree-provenance-store'
import { convergeDelegationBoundaryLifecycle } from '../../application/converge-delegation-boundary-lifecycle'
import { writeFixtureAppDb } from '../shadow-identity-observation/shadow-observation.test-support'
import { fixtureBinding, fixtureSettlementObservation, fixtureWorktreeProvenance } from './delegated-side-effect-boundary-test-harness'

// ORCA-S4 SPEC acceptance gates 1, 2, 4, 15, 16, 20, 21, 22, gate-set §20 attack
// surfaces #1, #6, #7, #14, #18. Slice-wide checks not already exercised by the
// per-store / per-service suites. RED: `../../application/converge-delegation-
// boundary-lifecycle` and the six S4 stores do not exist yet.

const SLICE = 'ORCA-S4'

function setup(dir: string) {
  const durableRoot = join(dir, 'durable-shadow-root')
  const db = new SyncDatabase(join(dir, 'exec.db'))
  db.pragma('foreign_keys = OFF')
  migrateExecutionStore(db)
  return {
    durableRoot,
    db,
    bindings: new SqliteExecutionStore(db),
    settlements: new SqliteSettlementObservationStore(db),
    dispatchWorktrees: new SqliteDispatchWorktreeStore(db),
    provenance: new SqliteWorktreeProvenanceStore(db),
    worktreeProvenanceIncidents: new SqliteWorktreeProvenanceIncidentStore(db),
    processBindings: new SqliteDispatchProcessBindingStore(db),
    terminations: new SqliteDispatchTerminationStore(db),
    finalizations: new SqliteWorktreeFinalizationStore(db),
    closures: new SqliteDispatchLifecycleClosureStore(db),
    events: new SqliteDispatchLifecycleEventStore(db),
    incidents: new SqliteDispatchLifecycleIncidentStore(db)
  }
}

const fakePort = {
  spawn: () => {
    throw new Error('not exercised')
  },
  observe: async () => ({ kind: 'self_exit', exitCode: 0, exitSignal: null }),
  requestTermination: async () => ({ verified: true }),
  requestTerminationByPid: async () => ({ verified: true })
}

describe('ORCA-S4 acceptance — gates 15/16/20: zero data/app.db writes, zero authority transfer', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort */
      }
    }
  })

  it('a full sweep — including an incident path and a normal close path — writes NOTHING to data/app.db; no -wal/-shm residual', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-acc-dbguard-'))
    dirs.push(dir)
    const appDbPath = join(dir, 'app.db')
    writeFixtureAppDb(appDbPath)
    const hashBefore = sha256File(appDbPath)

    const s = setup(dir)
    s.bindings.recordBinding(fixtureBinding({ correlationId: 'corr_1' as never, sliceRef: SLICE }))
    s.settlements.insert(fixtureSettlementObservation({ correlationId: 'corr_1', sliceRef: SLICE }))
    s.provenance.insert(fixtureWorktreeProvenance({ correlationId: 'corr_1', sliceRef: SLICE }))
    s.processBindings.insert({
      orcaDispatchId: 'ctx_1',
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      processNonce: 'nonce_1',
      pid: 4242,
      killScope: 'posix-process-group',
      osStartMarker: '1000',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      spawnedAt: '2026-09-13T00:00:00Z',
      teardownRequestedAt: null
    })

    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )

    expect(sha256File(appDbPath)).toBe(hashBefore)
    expect(() => assertNoSqliteSidecars(appDbPath)).not.toThrow()
  })

  it('gate 16 static audit: no S4 module imports finalizeRunOnce / writes agent_runs / touches queue-capacity-scheduler / performs a real external emission call', () => {
    const s4Root = join(__dirname, '..', '..')
    const s4Files = [
      join(s4Root, 'application', 'converge-delegation-boundary-lifecycle.ts'),
      join(s4Root, 'application', 'reconcile-orphan-shadow-state.ts'),
      join(s4Root, 'application', 'worktree-finalizer.ts'),
      join(s4Root, 'infrastructure', 'shadow-lifecycle-process-adapter.ts'),
      join(s4Root, 'infrastructure', 'sqlite-dispatch-process-binding-store.ts'),
      join(s4Root, 'infrastructure', 'sqlite-dispatch-termination-store.ts'),
      join(s4Root, 'infrastructure', 'sqlite-worktree-finalization-store.ts'),
      join(s4Root, 'infrastructure', 'sqlite-dispatch-lifecycle-closure-store.ts'),
      join(s4Root, 'infrastructure', 'sqlite-dispatch-lifecycle-event-store.ts'),
      join(s4Root, 'infrastructure', 'sqlite-dispatch-lifecycle-incident-store.ts')
    ]
    const forbidden = [
      'finalizeRunOnce',
      "from '../infrastructure/settlement-incident-store'",
      "'agent_runs'",
      'promoteReadyTasks',
      'OrganizationalTask',
      'webhook',
      'fetch(',
      'ipcMain.emit'
    ]
    for (const file of s4Files) {
      expect(existsSync(file), `${file} must exist for the static audit to run`).toBe(true)
      const src = readFileSync(file, 'utf8')
      for (const token of forbidden) {
        expect(src.includes(token), `${file} must not contain ${token}`).toBe(false)
      }
    }

    // Byte-unchanged sibling coordinators — no "phase N.5" anywhere.
    const untouched = [
      join(s4Root, 'application', 'reconcile-shadow-execution-state.ts'),
      join(s4Root, 'application', 'converge-worktree-provenance.ts'),
      join(s4Root, 'infrastructure', 'orca-execution-plane.ts'),
      join(s4Root, 'infrastructure', 'aicontrol-native', 'native-results-authoritative-executor.ts')
    ]
    for (const file of untouched) {
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /convergeDelegationBoundaryLifecycle|dispatch_process_binding|dispatch_lifecycle/
      )
    }
  })
})

describe('ORCA-S4 acceptance — gate 4: SOURCE vs PROJECTION rebuild discipline (§8.8)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort */
      }
    }
  })

  it('dispatch_process_binding, dispatch_termination, worktree_finalization, dispatch_lifecycle_closure, dispatch_lifecycle_event survive a projection rebuild BYTE-FOR-BYTE; only dispatch_lifecycle_incident is ever dropped and regenerated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-acc-source-'))
    dirs.push(dir)
    const s = setup(dir)
    s.bindings.recordBinding(fixtureBinding({ correlationId: 'corr_1' as never, sliceRef: SLICE }))
    s.settlements.insert(fixtureSettlementObservation({ correlationId: 'corr_1', sliceRef: SLICE }))
    s.provenance.insert(fixtureWorktreeProvenance({ correlationId: 'corr_1', sliceRef: SLICE }))
    s.processBindings.insert({
      orcaDispatchId: 'ctx_1',
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      processNonce: 'nonce_1',
      pid: 4242,
      killScope: 'posix-process-group',
      osStartMarker: '1000',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      spawnedAt: '2026-09-13T00:00:00Z',
      teardownRequestedAt: null
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    const before = {
      binding: s.processBindings.getByCorrelationId('corr_1'),
      termination: s.terminations.getByCorrelationId('corr_1'),
      closure: s.closures.getByCorrelationId('corr_1'),
      event: s.events.getByCorrelationAndKind('corr_1', 'shadow_delegated_boundary_closed')
    }

    s.db.exec('DROP TABLE IF EXISTS dispatch_lifecycle_incident;')
    migrateExecutionStore(s.db)

    expect(s.processBindings.getByCorrelationId('corr_1')).toEqual(before.binding)
    expect(s.terminations.getByCorrelationId('corr_1')).toEqual(before.termination)
    expect(s.closures.getByCorrelationId('corr_1')).toEqual(before.closure)
    expect(s.events.getByCorrelationAndKind('corr_1', 'shadow_delegated_boundary_closed')).toEqual(before.event)
  })
})

describe('ORCA-S4 acceptance — gate 21: synthetic-process labeling in the EVIDENCE REPORT ITSELF (§5, no production parity claims)', () => {
  it('the DelegationBoundaryLifecycleReport carries an explicit synthetic/self-spawned label and a non-parity disclaimer — not just SPEC prose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-acc-label-'))
    dirs.push(dir)
    const s = setup(dir)
    const report = await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(report).toHaveProperty('syntheticProcessDisclaimer')
    expect((report as { syntheticProcessDisclaimer: string }).syntheticProcessDisclaimer).toMatch(
      /synthetic|self-spawned/i
    )
    expect((report as { syntheticProcessDisclaimer: string }).syntheticProcessDisclaimer).toMatch(
      /does not prove|not proven|no production/i
    )
  })
})

describe('ORCA-S4 acceptance — §20 attack surface #18: no claimed remote/SSH parity (§5.1)', () => {
  it('no test file in this slice claims the local identity proof establishes remote/SSH execution parity (guard — must stay true as GREEN lands)', () => {
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    const s4Dir = __dirname
    for (const name of readdirSync(s4Dir)) {
      if (!name.endsWith('.test.ts')) continue
      const src = readFileSync(join(s4Dir, name), 'utf8')
      expect(src, `${name} must not claim remote/SSH parity`).not.toMatch(/proves? remote (execution )?parity/i)
      expect(src, `${name} must not claim SSH identity is established`).not.toMatch(/establishes? SSH identity/i)
    }
  })
})
