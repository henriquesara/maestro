import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { OrchestrationDb } from '../../../runtime/orchestration/db'
import {
  resolveCanonicalAiControlRepo,
  startAiControlNativeFixture
} from '../../infrastructure/aicontrol-native/disposable-aicontrol-env'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { OrcaExecutionPlane } from '../../infrastructure/orca-execution-plane'
import { reconcileIncompleteReservations } from '../../application/reconcile-incomplete-reservations'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { makeCorrelationId } from '../../domain/execution-identity'
import { sha256File } from '../../infrastructure/aicontrol-db-reader'
import { makeTmpDir, SHADOW_COORD_PANE_KEY } from './shadow-observation.test-support'

// Blocker B10 / SPEC-AMENDMENT-002 §8 — hard-crash isolation with the
// AUTHORITATIVE side an ACTUAL aiControl native execution running in its OWN OS
// process (the disposable-env vitest subprocess). The Orca shadow's durable
// intent is written by a SEPARATE child process we SIGKILL *while the
// authoritative native run is still in progress*. We then prove: the
// authoritative run finished on its own with a valid terminal state and a real
// disposable agent_run; canonical data/app.db is byte-identical with no
// sidecars; the shadow reservation survived and reconciles deterministically;
// no fabricated binding; no wrong settlement; authority stays AICONTROL_NATIVE.

const FORK_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')
const repo = resolveCanonicalAiControlRepo(FORK_ROOT)
const canonicalDbPath = join(repo.repoPath, 'data', 'app.db')
const CAN_RUN = repo.ok && existsSync(canonicalDbPath)

if (!CAN_RUN) {
  // eslint-disable-next-line no-console
  console.warn(
    `[ORCA-S1 crash isolation] SKIPPED — ${repo.reason ?? 'canonical data/app.db missing'}.`
  )
}

describe.skipIf(!CAN_RUN)(
  'ORCA-S1 hard-crash isolation — native authoritative (AMENDMENT-002 §8)',
  () => {
    const cleanups: (() => void)[] = []
    afterEach(() => {
      while (cleanups.length) {
        cleanups.pop()?.()
      }
    })

    it('SIGKILLs the shadow child while a real native aiControl run is in progress; native unaffected; reservation reconciles', async () => {
      const root = makeTmpDir('orca-s1-crash-native-')
      cleanups.push(root.cleanup)
      const execDbPath = join(root.dir, 'exec.db')
      const readyMarker = join(root.dir, 'READY')
      const correlationId = 'corr_crash_native_child'

      const dbHashBefore = sha256File(canonicalDbPath)

      // Parent migrates the shared Execution store the shadow child writes into.
      const initDb = new SyncDatabase(execDbPath)
      migrateExecutionStore(initDb)
      initDb.close()

      // 1. Start a REAL aiControl native run in its own OS process. Non-blocking.
      const native = startAiControlNativeFixture({
        repoPath: repo.repoPath,
        requests: [{ workloadId: 'crash', command: 'mock', cancel: false, profileIndex: 0 }],
        scratchDir: join(tmpdir(), 'orca-s1-crash-native')
      })
      cleanups.push(native.cleanup)
      let nativeSettled = false
      const nativeDone = native.done.then((v) => {
        nativeSettled = true
        return v
      })

      // 2. Start the Orca shadow's durable intent in a SEPARATE child; SIGKILL it.
      const childMjs = join(__dirname, 'shadow-run-child.mjs')
      const child = spawn(
        process.execPath,
        [
          childMjs,
          execDbPath,
          correlationId,
          'ORCA-S1',
          'run_native_crash_1',
          'crash',
          readyMarker
        ],
        { stdio: 'ignore' }
      )
      for (let i = 0; i < 200 && !existsSync(readyMarker); i += 1) {
        await sleep(50)
      }
      expect(existsSync(readyMarker)).toBe(true)

      // The native authoritative run must STILL be running when we kill the shadow.
      expect(nativeSettled).toBe(false)
      expect(native.pid).toBeGreaterThan(0)

      const exited = new Promise<void>((r) => child.on('exit', () => r()))
      child.kill('SIGKILL')
      await exited

      // 3. The native authoritative run finishes on its own.
      const outcome = await nativeDone
      expect(outcome.results.length).toBe(1)
      expect(outcome.results[0].status).toBe('completed') // not cancelled, not interrupted
      expect(outcome.results[0].aicontrolRunId).toMatch(/[0-9a-f-]{16,}/)
      expect(outcome.distinctRunIds.length).toBe(1)

      // 4. Canonical data/app.db untouched; no sidecars.
      expect(sha256File(canonicalDbPath)).toBe(dbHashBefore)
      expect(existsSync(`${canonicalDbPath}-wal`)).toBe(false)
      expect(existsSync(`${canonicalDbPath}-shm`)).toBe(false)

      // 5. Restart: reconcile from the durable reservation the SIGKILLed child left.
      const execDb = new SyncDatabase(execDbPath)
      execDb.pragma('foreign_keys = ON')
      migrateExecutionStore(execDb)
      const store = new SqliteExecutionStore(execDb)
      const reservations = new SqliteReservationStore(execDb)
      const orch = new OrchestrationDb(join(root.dir, 'shadow-orchestration.db'))
      const plane = new OrcaExecutionPlane(orch, SHADOW_COORD_PANE_KEY)
      cleanups.push(() => {
        execDb.close()
        orch.close()
      })

      const reservation = reservations.get(makeCorrelationId(correlationId))
      expect(reservation).toBeDefined()
      expect(reservation!.state).toBe('reserved') // durable intent survived the SIGKILL

      const rec = reconcileIncompleteReservations(
        { plane, store, reservations },
        { sliceRef: 'ORCA-S1', now: 'restart' }
      )
      expect(rec.abandoned).toContain(correlationId)
      expect(reservations.get(makeCorrelationId(correlationId))?.state).toBe('abandoned')
      expect(store.listBindings('ORCA-S1').length).toBe(0) // no fabricated binding
      expect(store.listParityObservations('ORCA-S1').length).toBe(0) // no wrong settlement
      expect(
        reconcileIncompleteReservations(
          { plane, store, reservations },
          { sliceRef: 'ORCA-S1', now: 'r2' }
        ).scanned
      ).toBe(0) // idempotent
      // Authority never transitioned: nothing in this flow writes one, and the
      // canonical DB hash above is unchanged.
    }, 300_000)
  }
)
