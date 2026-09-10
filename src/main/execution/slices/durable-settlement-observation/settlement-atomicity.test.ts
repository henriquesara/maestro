import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { SqliteSettlementIncidentStore } from '../../infrastructure/sqlite-settlement-incident-store'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { ExecutionStoreBusyError } from '../../infrastructure/with-immediate-transaction'
import { convergeSettlements } from '../../application/converge-settlements'
import {
  makeS2TmpDir,
  recordBoundReservation,
  S2_SLICE,
  seedShadowSettlements,
  type SeededSettlement
} from './settlement-test-harness'

// ORCA-S2 acceptance criterion 13 — atomicity / concurrency. Two concurrent
// sweeps over the same stores + one binding: exactly one settlement_observation,
// via BEGIN IMMEDIATE serialisation + the in-transaction precheck (NOT by
// assuming which writer hits the PK first); never an observation + incident from
// one snapshot; a forced SQLITE_BUSY exhaustion → EXECUTION_STORE_BUSY_RETRYABLE
// with no partial state, and the retry still converges to at most one observation.

describe('settlement-atomicity — concurrent sweeps (criterion 13, I-S2-5)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  function setup() {
    const root = makeS2TmpDir('orca-s2-atomic-')
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const execPath = join(root.dir, 'exec.db')
    const [seeded] = seedShadowSettlements(shadowPath, [
      {
        correlationId: 'corr_1',
        outcome: 'succeeded',
        result: { provenance: 'orca_s1_shadow', exitCode: 0 }
      }
    ])
    // Two INDEPENDENT handle sets on the SAME file — the "two process" shape.
    const openHandles = () => {
      const db = new SyncDatabase(execPath)
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = OFF')
      migrateExecutionStore(db)
      cleanups.push(() => db.close())
      return {
        db,
        store: new SqliteExecutionStore(db),
        reservations: new SqliteReservationStore(db),
        observations: new SqliteSettlementObservationStore(db),
        incidents: new SqliteSettlementIncidentStore(db)
      }
    }
    return { shadowPath, execPath, seeded, openHandles }
  }

  const deps = (
    h: ReturnType<ReturnType<typeof setup>['openHandles']>,
    source: ReadOnlyShadowSettlementSource,
    shadowPath: string,
    txn: { withImmediateTransaction<T>(fn: () => T): T } = h.store,
    tag = 'x'
  ) => ({
    store: h.store,
    reservations: h.reservations,
    observations: h.observations,
    incidents: h.incidents,
    source,
    txn,
    sourceDbPath: shadowPath,
    newId: (p: string) => `${p}_${tag}_${Math.random().toString(36).slice(2, 8)}`,
    now: () => new Date().toISOString()
  })

  function seedBinding(
    h: ReturnType<ReturnType<typeof setup>['openHandles']>,
    s: SeededSettlement
  ) {
    recordBoundReservation(
      {
        store: h.store,
        reservations: h.reservations,
        observations: h.observations,
        incidents: h.incidents,
        db: h.db,
        close: () => {}
      },
      s,
      'settled'
    )
  }

  it('two sweeps over the same binding produce exactly ONE observation and no sweepError', () => {
    const { shadowPath, seeded, openHandles } = setup()
    const a = openHandles()
    const b = openHandles()
    seedBinding(a, seeded)
    const sourceA = new ReadOnlyShadowSettlementSource(shadowPath)
    const sourceB = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(
      () => sourceA.close(),
      () => sourceB.close()
    )

    const rA = convergeSettlements(deps(a, sourceA, shadowPath, a.store, 'A'), {
      sliceRef: S2_SLICE
    })
    const rB = convergeSettlements(deps(b, sourceB, shadowPath, b.store, 'B'), {
      sliceRef: S2_SLICE
    })

    expect(a.observations.listBySlice(S2_SLICE)).toHaveLength(1)
    expect(rA.sweepErrors).toHaveLength(0)
    expect(rB.sweepErrors).toHaveLength(0)
    // exactly one of the two sweeps did the write; the other no-op'd via the precheck
    expect(rA.observed.length + rB.observed.length).toBe(1)
    // never an observation + incident from the same snapshot
    expect(a.incidents.listBySlice(S2_SLICE)).toHaveLength(0)
  })

  it('a forced SQLITE_BUSY exhaustion → EXECUTION_STORE_BUSY_RETRYABLE, no partial state; the retry converges', () => {
    const { shadowPath, seeded, openHandles } = setup()
    const a = openHandles()
    seedBinding(a, seeded)
    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source.close())

    // First pass: a txn runner that always reports the write lock unavailable.
    const busyTxn = {
      withImmediateTransaction<T>(_fn: () => T): T {
        throw new ExecutionStoreBusyError(5)
      }
    }
    const r1 = convergeSettlements(deps(a, source, shadowPath, busyTxn, 'busy'), {
      sliceRef: S2_SLICE
    })
    expect(r1.retryable).toEqual([
      { correlationId: 'corr_1', phase: 'A', reason: 'EXECUTION_STORE_BUSY_RETRYABLE', attempts: 5 }
    ])
    expect(a.observations.listBySlice(S2_SLICE)).toHaveLength(0)
    expect(a.incidents.listBySlice(S2_SLICE)).toHaveLength(0)

    // Retry with the real (working) txn runner: the same stable snapshot converges once.
    const r2 = convergeSettlements(deps(a, source, shadowPath, a.store, 'ok'), {
      sliceRef: S2_SLICE
    })
    expect(r2.observed).toHaveLength(1)
    expect(a.observations.listBySlice(S2_SLICE)).toHaveLength(1)
  })

  it('a real competing BEGIN IMMEDIATE forces EXECUTION_STORE_BUSY_RETRYABLE, then convergence after release', () => {
    const { shadowPath, execPath, seeded, openHandles } = setup()
    const a = openHandles()
    seedBinding(a, seeded)
    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source.close())

    const contender = new SyncDatabase(execPath)
    contender.exec('BEGIN IMMEDIATE')
    contender.prepare("INSERT INTO execution_meta (key, value) VALUES ('lock', '1')").run()

    const r1 = convergeSettlements(deps(a, source, shadowPath, a.store, 'c'), {
      sliceRef: S2_SLICE
    })
    expect(r1.retryable[0]?.reason).toBe('EXECUTION_STORE_BUSY_RETRYABLE')
    expect(a.observations.listBySlice(S2_SLICE)).toHaveLength(0)

    contender.exec('ROLLBACK')
    contender.close()

    const r2 = convergeSettlements(deps(a, source, shadowPath, a.store, 'c2'), {
      sliceRef: S2_SLICE
    })
    expect(r2.observed).toHaveLength(1)
    expect(a.observations.listBySlice(S2_SLICE)).toHaveLength(1)
  })
})
