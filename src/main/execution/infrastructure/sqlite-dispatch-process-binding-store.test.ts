import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { DispatchProcessBindingRecord } from '../domain/dispatch-process-binding'
import { migrateExecutionStore } from './execution-schema'
import { SqliteDispatchProcessBindingStore } from './sqlite-dispatch-process-binding-store'

// ORCA-S4 SPEC §8.1 — dispatch_process_binding is durable SOURCE state, written
// ONCE at the bind-time seam (§9.2), in the SAME transaction as run_binding /
// dispatch_worktree. Never dropped by a projection rebuild (§8.8, LIFE-4).
// RED: `./sqlite-dispatch-process-binding-store` does not exist yet.

function record(over: Partial<DispatchProcessBindingRecord> = {}): DispatchProcessBindingRecord {
  return {
    orcaDispatchId: 'ctx_1',
    correlationId: 'corr_1',
    orcaRunId: 'run_1',
    processNonce: 'nonce_1',
    pid: 4242,
    killScope: 'posix-process-group',
    osStartMarker: '1700000000000',
    osStartMarkerSource: 'posix_proc_stat_starttime',
    spawnedAt: '2026-09-13T00:00:00Z',
    teardownRequestedAt: null,
    ...over
  }
}

describe('SqliteDispatchProcessBindingStore (§8.1)', () => {
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
  function open() {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-dpb-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return { db, store: new SqliteDispatchProcessBindingStore(db) }
  }

  it('inserts a row and reads it back by orca_dispatch_id and correlation_id', () => {
    const { store } = open()
    store.insert(record())
    expect(store.getByDispatchId('ctx_1')).toEqual(record())
    expect(store.getByCorrelationId('corr_1')).toEqual(record())
  })

  it('orca_dispatch_id is the PRIMARY KEY — a second insert for the same id throws, never a silent overwrite (write-once, §7)', () => {
    const { store } = open()
    store.insert(record())
    expect(() => store.insert(record({ pid: 9999 }))).toThrow()
    expect(store.getByDispatchId('ctx_1')).toEqual(record())
  })

  it('os_start_marker may be NULL with os_start_marker_source="unavailable" (§12 window L13 — host could not supply a marker at spawn time)', () => {
    const { store } = open()
    store.insert(record({ osStartMarker: null, osStartMarkerSource: 'unavailable' }))
    expect(store.getByDispatchId('ctx_1')?.osStartMarker).toBeNull()
    expect(store.getByDispatchId('ctx_1')?.osStartMarkerSource).toBe('unavailable')
  })

  it('teardown_requested_at is the ONE permitted post-insert mutation, set durably BEFORE signalProcessTree is called (§9.3, window L6)', () => {
    const { store } = open()
    store.insert(record())
    store.markTeardownRequested('ctx_1', '2026-09-13T01:00:00Z')
    expect(store.getByDispatchId('ctx_1')?.teardownRequestedAt).toBe('2026-09-13T01:00:00Z')
  })

  it('markTeardownRequested is idempotent — calling it twice does not overwrite an already-set timestamp (a second signal attempt is not a fresh "request")', () => {
    const { store } = open()
    store.insert(record())
    store.markTeardownRequested('ctx_1', '2026-09-13T01:00:00Z')
    store.markTeardownRequested('ctx_1', '2026-09-13T02:00:00Z')
    expect(store.getByDispatchId('ctx_1')?.teardownRequestedAt).toBe('2026-09-13T01:00:00Z')
  })

  it('is preserved by a projection rebuild byte-for-byte (§8.8, LIFE-4) — only dispatch_lifecycle_incident is ever dropped', () => {
    const { db, store } = open()
    store.insert(record())
    db.exec('DROP TABLE IF EXISTS dispatch_lifecycle_incident;')
    migrateExecutionStore(db)
    expect(store.getByDispatchId('ctx_1')).toEqual(record())
  })

  it('returns undefined for an unknown dispatch id / correlation id', () => {
    const { store } = open()
    expect(store.getByDispatchId('nope')).toBeUndefined()
    expect(store.getByCorrelationId('nope')).toBeUndefined()
  })
})
