import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { DispatchProcessBindingRecord } from '../domain/dispatch-process-binding'
import { migrateExecutionStore } from './execution-schema'
import { SqliteDispatchProcessBindingStore } from './sqlite-dispatch-process-binding-store'

// ORCA-S5 SPEC §8.2, §9.1, §12, X13 — `teardown_requested_at` and `teardown_reason` are written in
// ONE statement guarded by `teardown_requested_at IS NULL`: FIRST WRITER WINS, a conflicting later
// reason never overwrites, and there is never intent without its reason.

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

const record = (
  over: Partial<DispatchProcessBindingRecord> = {}
): DispatchProcessBindingRecord => ({
  orcaDispatchId: 'ctx_1',
  correlationId: 'corr_1',
  orcaRunId: 'run_1',
  processNonce: 'nonce_1',
  pid: 4242,
  killScope: 'posix-process-group',
  osStartMarker: '1000',
  osStartMarkerSource: 'posix_proc_stat_starttime',
  spawnedAt: '2026-09-21T00:00:00Z',
  teardownRequestedAt: null,
  ...over
})

function open() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s5-binding-store-'))
  const db = new SyncDatabase(join(dir, 'exec.db'))
  db.pragma('foreign_keys = OFF')
  migrateExecutionStore(db)
  cleanups.push(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
  const store = new SqliteDispatchProcessBindingStore(db)
  const raw = () =>
    db
      .prepare(
        'SELECT teardown_requested_at, teardown_reason FROM dispatch_process_binding WHERE orca_dispatch_id = ?'
      )
      .get('ctx_1')
  return { store, raw }
}

describe('markTeardownRequested — first writer wins (X13)', () => {
  it('writes intent and reason together and reports that THIS call won', () => {
    const { store, raw } = open()
    store.insert(record())
    expect(store.markTeardownRequested('ctx_1', 't1', 'user_cancel')).toEqual({ applied: true })
    expect(raw()).toEqual({ teardown_requested_at: 't1', teardown_reason: 'user_cancel' })
  })

  it.each([
    { first: 'user_cancel', second: 'timeout' },
    { first: 'timeout', second: 'user_cancel' }
  ] as const)(
    '$first then $second: the loser is a silent no-op that never overwrites',
    ({ first, second }) => {
      const { store, raw } = open()
      store.insert(record())
      store.markTeardownRequested('ctx_1', 't1', first)
      expect(store.markTeardownRequested('ctx_1', 't2', second)).toEqual({ applied: false })
      expect(raw()).toEqual({ teardown_requested_at: 't1', teardown_reason: first })
    }
  )

  it('the same request repeated converges (first timestamp preserved)', () => {
    const { store, raw } = open()
    store.insert(record())
    store.markTeardownRequested('ctx_1', 't1', 'timeout')
    expect(store.markTeardownRequested('ctx_1', 't9', 'timeout')).toEqual({ applied: false })
    expect(raw()).toEqual({ teardown_requested_at: 't1', teardown_reason: 'timeout' })
  })

  it('a reason-less request (ORCA-S4 shadow) is unchanged and blocks a later reasoned request', () => {
    const { store, raw } = open()
    store.insert(record())
    expect(store.markTeardownRequested('ctx_1', 't1')).toEqual({ applied: true })
    expect(store.markTeardownRequested('ctx_1', 't2', 'user_cancel')).toEqual({ applied: false })
    expect(raw()).toEqual({ teardown_requested_at: 't1', teardown_reason: null })
  })

  it('an unknown dispatch id is a no-op, not an error', () => {
    const { store } = open()
    expect(store.markTeardownRequested('nope', 't1', 'timeout')).toEqual({ applied: false })
  })
})

describe('record shape', () => {
  it('teardownReason appears on a read-back ONLY when set, so every ORCA-S4 record keeps its exact shape', () => {
    const { store } = open()
    store.insert(record())
    expect(store.getByDispatchId('ctx_1')).toEqual(record())
    expect(store.getByDispatchId('ctx_1')).not.toHaveProperty('teardownReason')
    store.markTeardownRequested('ctx_1', 't1', 'user_cancel')
    expect(store.getByDispatchId('ctx_1')).toMatchObject({
      teardownRequestedAt: 't1',
      teardownReason: 'user_cancel'
    })
  })

  it('a record inserted WITH a reason persists it in the single INSERT', () => {
    const { store, raw } = open()
    store.insert(record({ teardownRequestedAt: 't0', teardownReason: 'timeout' }))
    expect(raw()).toEqual({ teardown_requested_at: 't0', teardown_reason: 'timeout' })
  })
})
