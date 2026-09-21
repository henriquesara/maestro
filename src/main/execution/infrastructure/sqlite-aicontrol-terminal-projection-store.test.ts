import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from './execution-schema'
import { SqliteAiControlTerminalProjectionStore } from './sqlite-aicontrol-terminal-projection-store'

// ORCA-S5 SPEC §8.3, §14 X6-X8 — the outbox row is mutable retry bookkeeping ONLY while
// `pending`; once it leaves `pending` it is SOURCE for its own terminal state.

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

function open() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s5-outbox-store-'))
  const db = new SyncDatabase(join(dir, 'exec.db'))
  db.pragma('foreign_keys = OFF') // the closure/reservation FKs are exercised by the lifecycle suite
  migrateExecutionStore(db)
  cleanups.push(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
  return { db, store: new SqliteAiControlTerminalProjectionStore(db) }
}

const row = (over: Record<string, unknown> = {}) => ({
  correlationId: 'corr_1',
  aicontrolRunId: 'ai_run_1',
  fenceTokenRef: 'tok_1',
  closureDigestRef: 'd'.repeat(64),
  status: 'pending' as const,
  ...over
})

describe('SqliteAiControlTerminalProjectionStore', () => {
  it('creates a pending row with zeroed bookkeeping, and reads it back', () => {
    const { store } = open()
    expect(store.insertIfAbsent(row())).toEqual({ inserted: true })
    expect(store.get('corr_1')).toEqual({
      correlationId: 'corr_1',
      aicontrolRunId: 'ai_run_1',
      fenceTokenRef: 'tok_1',
      closureDigestRef: 'd'.repeat(64),
      attemptCount: 0,
      lastAttemptedAt: null,
      projectedAt: null,
      status: 'pending'
    })
  })

  it('creation is idempotent by PRIMARY KEY: a racing creator never overwrites the winner and never throws', () => {
    const { store } = open()
    store.insertIfAbsent(row())
    expect(
      store.insertIfAbsent(
        row({ closureDigestRef: 'e'.repeat(64), status: 'blocked_closure_contradicted' })
      )
    ).toEqual({
      inserted: false
    })
    expect(store.get('corr_1')).toMatchObject({
      closureDigestRef: 'd'.repeat(64),
      status: 'pending'
    })
  })

  it('one outbox row per aiControl run (unique index)', () => {
    const { store } = open()
    store.insertIfAbsent(row())
    expect(store.insertIfAbsent(row({ correlationId: 'corr_2' }))).toEqual({ inserted: false })
    expect(store.get('corr_2')).toBeUndefined()
  })

  it('attempt bookkeeping accumulates only while pending', () => {
    const { store } = open()
    store.insertIfAbsent(row())
    store.recordAttempt('corr_1', 't1')
    store.recordAttempt('corr_1', 't2')
    expect(store.get('corr_1')).toMatchObject({
      attemptCount: 2,
      lastAttemptedAt: 't2',
      status: 'pending'
    })
  })

  it('pending -> terminal status is ONE-WAY: a non-pending row can never be rewritten or re-attempted', () => {
    const { store } = open()
    store.insertIfAbsent(row())
    store.resolve('corr_1', 'projected', 't3')
    store.resolve('corr_1', 'blocked_fence_mismatch', null)
    store.recordAttempt('corr_1', 't4')
    expect(store.get('corr_1')).toMatchObject({
      status: 'projected',
      projectedAt: 't3',
      attemptCount: 0,
      lastAttemptedAt: null
    })
  })

  it('a blocked row is SOURCE for its terminal state and is likewise immutable', () => {
    const { store } = open()
    store.insertIfAbsent(row({ status: 'blocked_closure_contradicted' }))
    store.resolve('corr_1', 'projected', 't9')
    expect(store.get('corr_1')?.status).toBe('blocked_closure_contradicted')
  })
})
