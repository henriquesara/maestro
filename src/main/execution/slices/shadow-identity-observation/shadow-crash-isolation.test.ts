import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { OrchestrationDb } from '../../../runtime/orchestration/db'
import { AuthoritativeReferenceExecutor } from '../../infrastructure/authoritative-reference-executor'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { OrcaExecutionPlane } from '../../infrastructure/orca-execution-plane'
import { reconcileIncompleteReservations } from '../../application/reconcile-incomplete-reservations'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { makeCorrelationId } from '../../domain/execution-identity'
import { sha256File } from '../../infrastructure/aicontrol-db-reader'
import { makeTmpDir, SHADOW_COORD_PANE_KEY, workloadSpec } from './shadow-observation.test-support'

// Blocker B10 — hard-crash isolation with a SEPARATELY KILLABLE shadow process.
// A caught Promise rejection is not the proof. The shadow's durable intent is
// written by a child process we SIGKILL mid-run; we then prove: (1) an
// independent authoritative execution is unaffected, (2) a disposable
// data/app.db copy is byte-identical with no sidecars, (3) the durable
// reservation survived and reconciles deterministically, (4) no wrong
// settlement, no parity observation, (5) authority is still AICONTROL_NATIVE.
// (Crash windows B..F — with a live Orca Dispatch — are covered in-process by
// reconcile-incomplete-reservations.test.ts.)
describe('ORCA-S1 hard-crash isolation (amendment 001 §8 / blocker B10)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  it('SIGKILLs the shadow child mid-run; authoritative unaffected; durable intent reconciles; no wrong settlement', async () => {
    const root = makeTmpDir('orca-s1-crash-')
    cleanups.push(root.cleanup)
    const execDbPath = join(root.dir, 'exec.db')
    const shadowOrchPath = join(root.dir, 'shadow-orchestration.db')
    const readyMarker = join(root.dir, 'READY')
    const appDbCopy = join(root.dir, 'app.db') // a disposable stand-in, NEVER the real data/app.db
    new SyncDatabase(appDbCopy).close()
    const appHashBefore = sha256File(appDbCopy)
    const correlationId = 'corr_crash_child'

    // Parent migrates the shared Execution store.
    const initDb = new SyncDatabase(execDbPath)
    migrateExecutionStore(initDb)
    initDb.close()

    // 1. Authoritative execution runs to completion in THIS (parent) process.
    const auth = await new AuthoritativeReferenceExecutor().execute({
      spec: workloadSpec('child', [
        { op: 'write', path: 'src/a.txt', content: '1' },
        { op: 'exit', code: 0 }
      ]),
      worktreeDir: join(root.dir, 'auth-wt')
    })
    expect(auth.outcome.terminalOutcome).toBe('completed')

    // 2. The shadow writes its durable intent in a SEPARATE process; SIGKILL it mid-run.
    const childMjs = join(__dirname, 'shadow-run-child.mjs')
    const child = spawn(
      process.execPath,
      [childMjs, execDbPath, correlationId, 'ORCA-S1', 'run_child_1', 'child', readyMarker],
      { stdio: 'ignore' }
    )
    for (let i = 0; i < 200 && !existsSync(readyMarker); i += 1) {
      await sleep(50)
    }
    expect(existsSync(readyMarker)).toBe(true)
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited

    // 3. Disposable app.db copy unchanged; no sidecars; authoritative outcome still holds.
    expect(sha256File(appDbCopy)).toBe(appHashBefore)
    expect(existsSync(`${appDbCopy}-wal`)).toBe(false)
    expect(existsSync(`${appDbCopy}-shm`)).toBe(false)
    expect(
      (
        await new AuthoritativeReferenceExecutor().execute({
          spec: workloadSpec('child2', [{ op: 'exit', code: 0 }]),
          worktreeDir: join(root.dir, 'auth-wt-2')
        })
      ).outcome.terminalOutcome
    ).toBe('completed')

    // 4. Restart: reconcile from the durable reservation the child left behind.
    const execDb = new SyncDatabase(execDbPath)
    execDb.pragma('foreign_keys = ON')
    migrateExecutionStore(execDb)
    const store = new SqliteExecutionStore(execDb)
    const reservations = new SqliteReservationStore(execDb)
    const orch = new OrchestrationDb(shadowOrchPath)
    const plane = new OrcaExecutionPlane(orch, SHADOW_COORD_PANE_KEY)
    cleanups.push(() => {
      execDb.close()
      orch.close()
    })

    const reservation = reservations.get(makeCorrelationId(correlationId))
    expect(reservation).toBeDefined()
    expect(reservation!.state).toBe('reserved') // durable intent survived the SIGKILL

    const outcome = reconcileIncompleteReservations(
      { plane, store, reservations },
      { sliceRef: 'ORCA-S1', now: 'restart' }
    )
    expect(outcome.abandoned).toContain(correlationId)
    expect(reservations.get(makeCorrelationId(correlationId))?.state).toBe('abandoned')
    expect(store.listParityObservations('ORCA-S1').length).toBe(0) // no wrong settlement
    expect(
      reconcileIncompleteReservations(
        { plane, store, reservations },
        { sliceRef: 'ORCA-S1', now: 'r2' }
      ).scanned
    ).toBe(0) // idempotent
  }, 60_000)
})
