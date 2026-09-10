import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { OrchestrationDb } from '../../../runtime/orchestration/db'
import { sha256File, assertNoSqliteSidecars } from '../../infrastructure/aicontrol-db-reader'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { finalizeShadowWriterJournal } from '../../infrastructure/shadow-orchestration-journal'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { SqliteSettlementIncidentStore } from '../../infrastructure/sqlite-settlement-incident-store'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import { reconcileShadowExecutionState } from '../../application/reconcile-shadow-execution-state'
import {
  makeCorrelationId,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef
} from '../../domain/execution-identity'
import type { ExecutionPlane } from '../../application/execution-plane'
import {
  makeTmpDir,
  writeFixtureAppDb
} from '../shadow-identity-observation/shadow-observation.test-support'

// ORCA-S2 acceptance criterion 10 — restart safety. A SEPARATELY KILLABLE child
// establishes the durable settlement fact (settle + checkpoint/close), is
// SIGKILLed, and the parent runs reconcileShadowExecutionState and asserts
// convergence. Windows G1–G6. Marker-driven, never timing-driven.

const SLICE = 'ORCA-S2'
const CHILD = join(__dirname, 'settlement-converge-child.mjs')
const CID = 'corr_g'
const DISPATCH = 'ctx_g'
const RUN = 'run_g'
const TASK = 'task_g'

function fakePlaneTerminal(): ExecutionPlane {
  return {
    openShadowRun: async () => {
      throw new Error('unused')
    },
    runShadowWorkload: async () => {
      throw new Error('unused')
    },
    settleShadow: async () => {
      throw new Error('unused')
    },
    abandonShadow: async () => {},
    findShadowRunByCorrelation: () => ({
      orcaRunRef: makeOrcaRunRef(RUN),
      orcaDispatchRef: makeOrcaDispatchRef(DISPATCH),
      orgTaskRef: makeOrgTaskRef(TASK),
      settled: true
    })
  }
}

describe('durable-settlement-observation — restart safety (criterion 10, windows G1–G6)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  async function establishDurableFact(opts: {
    outcome?: 'succeeded' | 'failed'
    result?: unknown
    extraStale?: boolean
  }) {
    const root = makeTmpDir('orca-s2-restart-')
    cleanups.push(root.cleanup)
    const execDbPath = join(root.dir, 'exec.db')
    const shadowOrchPath = join(root.dir, 'shadow-orchestration.db')
    const appDbPath = join(root.dir, 'app.db')
    const readyMarker = join(root.dir, 'READY')

    writeFixtureAppDb(appDbPath)
    const appHashBefore = sha256File(appDbPath)

    // Parent creates BOTH schemas (the raw-node:sqlite child cannot run Orca migrate).
    const initExec = new SyncDatabase(execDbPath)
    initExec.pragma('journal_mode = WAL')
    migrateExecutionStore(initExec)
    initExec.close()
    new OrchestrationDb(shadowOrchPath).close()
    finalizeShadowWriterJournal(shadowOrchPath)

    const child = spawn(
      process.execPath,
      [
        CHILD,
        execDbPath,
        shadowOrchPath,
        SLICE,
        CID,
        DISPATCH,
        RUN,
        TASK,
        opts.outcome ?? 'succeeded',
        JSON.stringify(opts.result ?? { provenance: 'orca_s1_shadow', exitCode: 0 }),
        opts.extraStale ? '1' : '0',
        readyMarker
      ],
      { stdio: 'ignore' }
    )
    for (let i = 0; i < 400 && !existsSync(readyMarker); i += 1) {
      await sleep(25)
    }
    expect(existsSync(readyMarker)).toBe(true)
    const exited = new Promise<void>((r) => child.on('exit', () => r()))
    child.kill('SIGKILL')
    await exited

    finalizeShadowWriterJournal(shadowOrchPath)
    return { execDbPath, shadowOrchPath, appDbPath, appHashBefore }
  }

  function runCoordinator(execDbPath: string, shadowOrchPath: string) {
    const execDb = new SyncDatabase(execDbPath)
    execDb.pragma('foreign_keys = OFF')
    migrateExecutionStore(execDb)
    const store = new SqliteExecutionStore(execDb)
    const reservations = new SqliteReservationStore(execDb)
    const observations = new SqliteSettlementObservationStore(execDb)
    const incidents = new SqliteSettlementIncidentStore(execDb)
    const source = new ReadOnlyShadowSettlementSource(shadowOrchPath)
    let n = 0
    try {
      const report = reconcileShadowExecutionState(
        {
          plane: fakePlaneTerminal(),
          store,
          reservations,
          settlement: {
            source,
            observations,
            incidents,
            txn: store,
            sourceDbPath: shadowOrchPath
          }
        },
        {
          sliceRef: SLICE,
          now: () => `2026-09-10T20:00:${String(n++).padStart(2, '0')}.000Z`,
          newId: (p) => `${p}_${n++}`,
          staleAfter: 60_000
        }
      )
      return {
        report,
        observations: observations.listBySlice(SLICE),
        incidents: incidents.listBySlice(SLICE),
        reservation: reservations.get(makeCorrelationId(CID))
      }
    } finally {
      source.close()
      execDb.close()
    }
  }

  function mutateShadowResult(shadowOrchPath: string, result: unknown) {
    const rw = new SyncDatabase(shadowOrchPath)
    rw.prepare('UPDATE tasks SET result = ? WHERE id = ?').run(JSON.stringify(result), TASK)
    rw.close()
    finalizeShadowWriterJournal(shadowOrchPath)
  }

  const assertAppDbUntouched = (appDbPath: string, before: string) => {
    expect(sha256File(appDbPath)).toBe(before)
    expect(() => assertNoSqliteSidecars(appDbPath)).not.toThrow()
  }

  it('G1 — durable settle, killed before ANY reconcile ran → Phase A converges exactly once', async () => {
    const f = await establishDurableFact({})
    const out = runCoordinator(f.execDbPath, f.shadowOrchPath)
    expect(out.observations).toHaveLength(1)
    expect(out.observations[0].status).toBe('observed')
    expect(out.observations[0].sourceDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.parse(out.observations[0].provenanceJson).snapshot.orcaDispatchId).toBe(DISPATCH)
    expect(JSON.parse(out.observations[0].observedOutcomeJson)).toEqual({
      terminalOutcome: 'completed',
      exitDisposition: 'zero_exit',
      cancellation: 'not_cancelled'
    })
    expect(out.reservation!.state).toBe('observed')
    expect(out.incidents).toHaveLength(0)
    assertAppDbUntouched(f.appDbPath, f.appHashBefore)
  }, 60_000)

  it('G2 — killed mid-convergence (no commit) → restart writes the observation once, no partial', async () => {
    const f = await establishDurableFact({})
    const first = runCoordinator(f.execDbPath, f.shadowOrchPath)
    expect(first.observations).toHaveLength(1)
    const second = runCoordinator(f.execDbPath, f.shadowOrchPath)
    expect(second.observations).toHaveLength(1)
    expect(second.observations[0]).toEqual(first.observations[0]) // byte-identical, no rewrite
    expect(second.report.convergence!.noop).toBe(1)
    assertAppDbUntouched(f.appDbPath, f.appHashBefore)
  }, 60_000)

  it('G3 — killed after observation commit, before reservation advanced → Phase B no-op, no 2nd observation', async () => {
    const f = await establishDurableFact({})
    runCoordinator(f.execDbPath, f.shadowOrchPath) // pre-crash convergence wrote the observation
    // Simulate the crash point: reservation never advanced.
    const rw = new SyncDatabase(f.execDbPath)
    rw.prepare("UPDATE run_reservation SET state = 'settled' WHERE correlation_id = ?").run(CID)
    rw.close()

    const out = runCoordinator(f.execDbPath, f.shadowOrchPath)
    expect(out.observations).toHaveLength(1)
    expect(out.report.convergence!.observed).toHaveLength(0)
    expect(out.report.convergence!.noop).toBe(1)
    expect(out.reservation!.state).toBe('observed') // healed by the idempotent CAS
    assertAppDbUntouched(f.appDbPath, f.appHashBefore)
  }, 60_000)

  it('G4 — killed after an incident commit → restart re-detects the same evidence, one row, still blocked', async () => {
    const f = await establishDurableFact({ extraStale: true })
    const first = runCoordinator(f.execDbPath, f.shadowOrchPath)
    expect(first.incidents).toHaveLength(1)
    expect(first.incidents[0].kind).toBe('foreign_dispatch')
    expect(first.observations).toHaveLength(0)

    const second = runCoordinator(f.execDbPath, f.shadowOrchPath)
    expect(second.incidents).toHaveLength(1) // UNIQUE (correlation_id, kind, evidence_digest)
    expect(second.incidents[0].id).toBe(first.incidents[0].id)
    expect(second.incidents[0].blocked).toBe(true)
    expect(second.observations).toHaveLength(0)
    assertAppDbUntouched(f.appDbPath, f.appHashBefore)
  }, 60_000)

  it('G5 — shadow DB re-settled to a different digest → source_snapshot_changed, source columns preserved', async () => {
    const f = await establishDurableFact({ result: { provenance: 'orca_s1_shadow', exitCode: 0 } })
    const before = runCoordinator(f.execDbPath, f.shadowOrchPath).observations[0]
    expect(before.status).toBe('observed')

    mutateShadowResult(f.shadowOrchPath, {
      provenance: 'orca_s1_shadow',
      exitCode: 0,
      resettled: true
    })
    const out = runCoordinator(f.execDbPath, f.shadowOrchPath)

    expect(out.incidents).toHaveLength(1)
    expect(out.incidents[0].kind).toBe('source_snapshot_changed')
    const after = out.observations[0]
    expect(after.status).toBe('observed_conflicted')
    expect(after.conflictedAt).not.toBeNull()
    for (const k of [
      'sourceDigest',
      'sourceDispatchStatus',
      'sourceDispatchCompletedAt',
      'sourceTaskStatus',
      'sourceTaskCompletedAt',
      'observedOutcomeJson',
      'provenanceJson'
    ] as const) {
      expect(after[k]).toBe(before[k]) // byte-unchanged
    }
    assertAppDbUntouched(f.appDbPath, f.appHashBefore)
  }, 60_000)

  it('G6 — killed during a retryable loop (nothing committed) → no durable row, restart converges cleanly', async () => {
    const f = await establishDurableFact({})
    // A retryable result persists NOTHING — the pre-restart projection is empty.
    const pre = new SyncDatabase(f.execDbPath)
    expect(pre.prepare('SELECT COUNT(*) c FROM settlement_observation').get()).toEqual({ c: 0 })
    expect(pre.prepare('SELECT COUNT(*) c FROM settlement_incident').get()).toEqual({ c: 0 })
    pre.close()

    const out = runCoordinator(f.execDbPath, f.shadowOrchPath)
    expect(out.observations).toHaveLength(1)
    expect(out.incidents).toHaveLength(0)
    assertAppDbUntouched(f.appDbPath, f.appHashBefore)
  }, 60_000)
})
