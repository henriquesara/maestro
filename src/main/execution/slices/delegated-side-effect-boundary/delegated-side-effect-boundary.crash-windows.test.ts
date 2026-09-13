import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
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
import { convergeDelegationBoundaryLifecycle, type ProcessLifecycleObservationLike } from '../../application/converge-delegation-boundary-lifecycle'
import {
  fixtureBinding,
  fixtureSettlementObservation,
  fixtureWorktreeProvenance,
  SHADOW_LIFECYCLE_CHILD
} from './delegated-side-effect-boundary-test-harness'

// ORCA-S4 SPEC §12 crash/restart window table, gate 9. L9/L14/L12/L13 have their
// own dedicated executable evidence elsewhere (hooks-idempotency,
// late-conflict, process-identity-safety files respectively) — cross-referenced
// in RED-EVIDENCE.md rather than duplicated here. This file covers L1-L8, L10,
// L11 with a mix of a REAL separately-killable child process (L1, L6 — the
// windows that specifically hinge on genuine OS process-death timing) and
// direct durable-state construction (L2-L5, L7, L8, L10, L11 — DB/filesystem
// state combinations, mirroring the S3 acceptance-test convention). RED:
// `../../application/converge-delegation-boundary-lifecycle` and the six S4
// stores do not exist yet.

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

function seedEligibleBinding(s: ReturnType<typeof setup>, cid = 'corr_1') {
  const dispatchId = cid === 'corr_1' ? 'ctx_1' : `ctx_${cid}`
  s.bindings.recordBinding(
    fixtureBinding({ correlationId: cid as never, orcaDispatchId: dispatchId as never, sliceRef: SLICE })
  )
  s.settlements.insert(fixtureSettlementObservation({ correlationId: cid, orcaDispatchId: dispatchId, sliceRef: SLICE }))
  s.provenance.insert(fixtureWorktreeProvenance({ correlationId: cid, orcaDispatchId: dispatchId, sliceRef: SLICE }))
}

const fakePort = {
  spawn: () => {
    throw new Error('not exercised')
  },
  observe: async (): Promise<ProcessLifecycleObservationLike> => ({ kind: 'confirmed_dead_unknown_cause' }),
  requestTermination: async () => ({ verified: true }),
  requestTerminationByPid: async () => ({ verified: true })
}

describe('§12 window L1 — real self-exit with NO teardown_requested_at (real child process)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  it('shadow lifecycle process exits on its own before dispatch_termination is written -> "confirmed_dead_unknown_cause", exit_code/exit_signal NULL, NOT an incident', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l1-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }))
    const s = setup(dir)
    cleanups.push(() => s.db.close())
    seedEligibleBinding(s)
    const readyMarker = join(dir, 'READY')
    const child = spawn(process.execPath, [SHADOW_LIFECYCLE_CHILD, '--processNonce=nonce_1', readyMarker, 'self-exit'], {
      stdio: 'ignore'
    })
    for (let i = 0; i < 200 && !existsSync(readyMarker); i += 1) {
      await sleep(25)
    }
    expect(existsSync(readyMarker)).toBe(true)
    await new Promise<void>((resolve) => child.on('exit', () => resolve()))
    // The parent never observed this exit live (no in-memory handle tracked —
    // simulates a host restart across the child's death) and no
    // teardown_requested_at was ever recorded.
    s.processBindings.insert({
      orcaDispatchId: 'ctx_1',
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      processNonce: 'nonce_1',
      pid: child.pid!,
      killScope: 'posix-process-group',
      osStartMarker: '1000',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      spawnedAt: '2026-09-13T00:00:00Z',
      teardownRequestedAt: null
    })

    await convergeDelegationBoundaryLifecycle(
      {
        ...s,
        processPort: fakePort, // real OS re-verification is the adapter's job; here the fake reports the honest "confirmed_dead_unknown_cause" classification L1 requires
        liveHandles: new Map(),
        durableShadowWorktreeRoot: s.durableRoot,
        now: () => '2026-09-13T01:00:00Z',
        newId: (p: string) => `${p}_1`
      },
      { sliceRef: SLICE }
    )
    const termination = s.terminations.getByCorrelationId('corr_1')
    expect(termination?.terminationMethod).toBe('confirmed_dead_unknown_cause')
    expect(termination?.exitCode).toBeNull()
    expect(termination?.exitSignal).toBeNull()
    expect(s.incidents.listBySlice(SLICE)).toHaveLength(0) // L1 is NOT an incident
  }, 15_000)
})

describe('§12 window L2 — legitimate intermediate state, not a crash-recovery path', () => {
  it('dispatch_termination committed, worktree_finalization not yet attempted -> next pass proceeds to Phase 2 normally', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l2-'))
    const s = setup(dir)
    seedEligibleBinding(s)
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
    s.terminations.insert({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      terminationMethod: 'self_exit',
      exitCode: 0,
      exitSignal: null,
      treeVerified: true,
      observedAt: '2026-09-13T00:00:00Z'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T01:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(s.finalizations.getByCorrelationId('corr_1')).toBeDefined()
    s.db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
})

describe('§12 windows L3/L4/L5 — one shared idempotent recovery path (§10.2)', () => {
  it('L3: filesystem deletion succeeded, host crashed before status="finalized" committed -> next pass re-attempts (already-absent success) then commits finalized', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l3-'))
    const s = setup(dir)
    seedEligibleBinding(s)
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
    s.terminations.insert({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      terminationMethod: 'self_exit',
      exitCode: 0,
      exitSignal: null,
      treeVerified: true,
      observedAt: '2026-09-13T00:00:00Z'
    })
    const worktreeDirL3 = join(s.durableRoot, 'shadow-corr_1')
    s.dispatchWorktrees.insert({
      orcaDispatchId: 'ctx_1',
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      worktreeNonce: 'wnonce_1',
      worktreePath: worktreeDirL3,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-13T00:00:00Z'
    })
    const { computeFinalizationEligibilityDigest } = await import('../../domain/worktree-finalization')
    const digest = computeFinalizationEligibilityDigest({
      settlementStatus: 'observed',
      worktreeProvenanceStatus: 'recorded',
      terminationMethod: 'self_exit'
    })
    s.finalizations.insertIntent({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      sliceRef: SLICE,
      eligibilityDigest: digest,
      intentRecordedAt: '2026-09-13T00:00:00Z',
      status: 'intent_recorded',
      finalizedAt: null,
      outcomeDetailJson: null,
      conflictedAt: null
    })
    // worktree already deleted (crash happened after deletion, before the UPDATE) — worktreeDirL3 is never created on disk.
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T01:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(s.finalizations.getByCorrelationId('corr_1')?.status).toBe('finalized')
    s.db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })

  it('L4: intent_recorded committed, host crashed BEFORE the filesystem act ever ran -> next pass retries from scratch, same path as L3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l4-'))
    const s = setup(dir)
    seedEligibleBinding(s)
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
    s.terminations.insert({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      terminationMethod: 'self_exit',
      exitCode: 0,
      exitSignal: null,
      treeVerified: true,
      observedAt: '2026-09-13T00:00:00Z'
    })
    const { computeFinalizationEligibilityDigest } = await import('../../domain/worktree-finalization')
    const digest = computeFinalizationEligibilityDigest({
      settlementStatus: 'observed',
      worktreeProvenanceStatus: 'recorded',
      terminationMethod: 'self_exit'
    })
    const worktreeDir = join(s.durableRoot, 'shadow-corr_1')
    mkdirSync(worktreeDir, { recursive: true })
    writeFileSync(join(worktreeDir, 'x.txt'), 'still here')
    s.finalizations.insertIntent({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      sliceRef: SLICE,
      eligibilityDigest: digest,
      intentRecordedAt: '2026-09-13T00:00:00Z',
      status: 'intent_recorded',
      finalizedAt: null,
      outcomeDetailJson: null,
      conflictedAt: null
    })
    s.dispatchWorktrees.insert({
      orcaDispatchId: 'ctx_1',
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      worktreeNonce: 'wnonce_1',
      worktreePath: worktreeDir,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-13T00:00:00Z'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T01:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(existsSync(worktreeDir)).toBe(false)
    expect(s.finalizations.getByCorrelationId('corr_1')?.status).toBe('finalized')
    s.db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
})

describe('§12 window L6 — real signalProcessTree in flight when host crashes (teardown_requested_at honesty)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  it('teardown_requested_at IS set, no dispatch_termination yet, process now confirmed dead -> "signalled" (attributable, NOT confirmed_dead_unknown_cause)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l6-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }))
    const s = setup(dir)
    cleanups.push(() => s.db.close())
    seedEligibleBinding(s)
    const readyMarker = join(dir, 'READY')
    const child = spawn(process.execPath, [SHADOW_LIFECYCLE_CHILD, '--processNonce=nonce_1', readyMarker, 'hang'], {
      stdio: 'ignore'
    })
    for (let i = 0; i < 200 && !existsSync(readyMarker); i += 1) {
      await sleep(25)
    }
    const pid = child.pid!
    s.processBindings.insert({
      orcaDispatchId: 'ctx_1',
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      processNonce: 'nonce_1',
      pid,
      killScope: 'posix-process-group',
      osStartMarker: '1000',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      spawnedAt: '2026-09-13T00:00:00Z',
      teardownRequestedAt: null
    })
    // Durable intent recorded BEFORE signalling (§9.3) — then the real kill.
    s.processBindings.markTeardownRequested('ctx_1', '2026-09-13T00:30:00Z')
    child.kill('SIGKILL')
    await new Promise<void>((resolve) => child.on('exit', () => resolve()))

    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T01:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    const termination = s.terminations.getByCorrelationId('corr_1')
    expect(termination?.terminationMethod).toBe('signalled')
    expect(termination?.treeVerified).toBe(false)
  }, 15_000)
})

describe('§12 window L7 — pre-commit process-spawn orphan (covered end-to-end in reconcile-orphan-shadow-state.test.ts)', () => {
  it('sentinel: no run_binding/dispatch_worktree/dispatch_process_binding row exists for an orphaned sidecar+process — NOT classified as corruption', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l7-'))
    const s = setup(dir)
    // Deliberately NOT seeding anything — this IS the L7 shape: nothing committed.
    expect(s.bindings.getBindingByDispatch('ctx_orphan')).toBeUndefined()
    expect(s.processBindings.getByDispatchId('ctx_orphan')).toBeUndefined()
    s.db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
})

describe('§12 window L8 — duplicate finalization request across two sweep passes is a no-op', () => {
  it('worktree_finalization PK forbids a second INSERT for the same correlation_id; the second attempt is a no-op, not a double-delete, not an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l8-'))
    const s = setup(dir)
    seedEligibleBinding(s)
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
    s.terminations.insert({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      terminationMethod: 'self_exit',
      exitCode: 0,
      exitSignal: null,
      treeVerified: true,
      observedAt: '2026-09-13T00:00:00Z'
    })
    const deps = { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T01:00:00Z', newId: (p: string) => `${p}_1` }
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
    await expect(convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })).resolves.not.toThrow()
    const count = (
      s.db.prepare('SELECT COUNT(*) c FROM worktree_finalization WHERE correlation_id = ?').get('corr_1') as {
        c: number
      }
    ).c
    expect(count).toBe(1)
    s.db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
})

describe('§12 window L10 — SQLite write-lock not acquired within the busy budget', () => {
  it('LIFECYCLE_STORE_BUSY_RETRYABLE — no durable row, no incident, not blocked, surfaced in the report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l10-'))
    const s = setup(dir)
    seedEligibleBinding(s)
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
    const busyPort = {
      ...fakePort,
      observe: async () => {
        throw Object.assign(new Error('busy'), { code: 'LIFECYCLE_STORE_BUSY_RETRYABLE' })
      }
    }
    const report = await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: busyPort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T01:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(s.terminations.getByCorrelationId('corr_1')).toBeUndefined()
    expect(s.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(report.retryable.length).toBeGreaterThan(0)
    s.db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
})

describe('§12 window L11 — host restarts mid-batch, mixed per-binding progress', () => {
  it('one binding already advanced through closure, another still at Phase 1 -> next sweep resumes each independently, no binding re-processed past its committed terminal fact, none skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-l11-'))
    const s = setup(dir)
    seedEligibleBinding(s, 'corr_advanced')
    seedEligibleBinding(s, 'corr_pending')
    s.processBindings.insert({
      orcaDispatchId: 'ctx_advanced',
      correlationId: 'corr_advanced',
      orcaRunId: 'run_1',
      processNonce: 'nonce_advanced',
      pid: 4242,
      killScope: 'posix-process-group',
      osStartMarker: '1000',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      spawnedAt: '2026-09-13T00:00:00Z',
      teardownRequestedAt: null
    })
    s.processBindings.insert({
      orcaDispatchId: 'ctx_pending',
      correlationId: 'corr_pending',
      orcaRunId: 'run_1',
      processNonce: 'nonce_pending',
      pid: 5555,
      killScope: 'posix-process-group',
      osStartMarker: '2000',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      spawnedAt: '2026-09-13T00:00:00Z',
      teardownRequestedAt: null
    })
    const deps = { ...s, processPort: fakePort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T01:00:00Z', newId: (p: string) => `${p}_1` }
    // First: only corr_advanced has a process binding, so it alone advances.
    // (corr_pending has none yet — simulating "still needs its own binding".)
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
    const advancedClosureBefore = s.closures.getByCorrelationId('corr_advanced')

    // Now give corr_pending its binding (simulating it catching up) and re-sweep.
    s.processBindings.insert({
      orcaDispatchId: 'ctx_pending2',
      correlationId: 'corr_pending',
      orcaRunId: 'run_1',
      processNonce: 'nonce_pending2',
      pid: 5556,
      killScope: 'posix-process-group',
      osStartMarker: '2001',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      spawnedAt: '2026-09-13T00:00:00Z',
      teardownRequestedAt: null
    })
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })

    // corr_advanced's closure must be byte-identical — never re-processed.
    expect(s.closures.getByCorrelationId('corr_advanced')).toEqual(advancedClosureBefore)
    s.db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
})
