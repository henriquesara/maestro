import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { DispatchWorktreeRecord } from '../domain/worktree-provenance'
import { migrateExecutionStore } from './execution-schema'
import { SqliteDispatchWorktreeStore } from './sqlite-dispatch-worktree-store'

// ORCA-S3 §7.2, §12 PROV-11 — dispatch_worktree is durable SOURCE state, the
// ONLY writer of this table, and is NEVER rebuilt by a provenance-projection
// rebuild. RED: `./sqlite-dispatch-worktree-store` does not exist yet.

function record(over: Partial<DispatchWorktreeRecord> = {}): DispatchWorktreeRecord {
  return {
    orcaDispatchId: 'ctx_1',
    correlationId: 'corr_1',
    orcaRunId: 'run_1',
    worktreeNonce: 'nonce_1',
    worktreePath: '/durable/root/shadow-corr_1',
    rootRef: 'root_gen_1',
    openedAt: '2026-09-12T00:00:00Z',
    ...over
  }
}

describe('SqliteDispatchWorktreeStore (§7.2)', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-s3-dw-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    migrateExecutionStore(db)
    return { db, store: new SqliteDispatchWorktreeStore(db) }
  }

  it('inserts a row and reads it back by orca_dispatch_id', () => {
    const { store } = open()
    store.insert(record())
    expect(store.getByDispatchId('ctx_1')).toEqual(record())
  })

  it('reads a row back by correlation_id (dispatch_worktree_by_correlation index)', () => {
    const { store } = open()
    store.insert(record())
    expect(store.getByCorrelationId('corr_1')).toEqual(record())
  })

  it('returns undefined for an unknown dispatch id / correlation id', () => {
    const { store } = open()
    expect(store.getByDispatchId('nope')).toBeUndefined()
    expect(store.getByCorrelationId('nope')).toBeUndefined()
  })

  it('orca_dispatch_id is the PRIMARY KEY — a second insert for the same id throws (never a silent overwrite)', () => {
    const { store } = open()
    store.insert(record())
    expect(() => store.insert(record({ worktreePath: '/durable/root/other' }))).toThrow()
    expect(store.getByDispatchId('ctx_1')).toEqual(record()) // unchanged
  })

  it('is preserved by a provenance-projection rebuild (§7.5 — SOURCE state, never dropped)', () => {
    const { db, store } = open()
    store.insert(record())
    // A provenance-projection rebuild drops+recreates ONLY worktree_provenance +
    // worktree_provenance_incident (§7.5) — dispatch_worktree is never touched.
    db.exec('DROP TABLE IF EXISTS worktree_provenance_incident; DROP TABLE IF EXISTS worktree_provenance;')
    migrateExecutionStore(db)
    expect(store.getByDispatchId('ctx_1')).toEqual(record())
  })
})
