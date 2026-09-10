import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from './execution-schema'
import { SqliteExecutionStore } from './sqlite-execution-store'
import { ExecutionStoreBusyError } from './with-immediate-transaction'

// ORCA-S2 §16.1 — additive BEGIN IMMEDIATE seam with bounded SQLITE_BUSY retry.

describe('SqliteExecutionStore.withImmediateTransaction (§16.1)', () => {
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
  function freshStore() {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s2-txn-'))
    dirs.push(dir)
    const path = join(dir, 'exec.db')
    const db = new SyncDatabase(path)
    db.pragma('journal_mode = WAL')
    migrateExecutionStore(db)
    return { db, path, store: new SqliteExecutionStore(db) }
  }

  it('commits fn() work atomically and returns its value', () => {
    const { db, store } = freshStore()
    const result = store.withImmediateTransaction(() => {
      db.prepare("INSERT INTO execution_meta (key, value) VALUES ('probe', 'v')").run()
      return 42
    })
    expect(result).toBe(42)
    expect(db.prepare("SELECT value FROM execution_meta WHERE key = 'probe'").get()).toEqual({
      value: 'v'
    })
    db.close()
  })

  it('rolls back on throw — no partial state, no open transaction', () => {
    const { db, store } = freshStore()
    expect(() =>
      store.withImmediateTransaction(() => {
        db.prepare("INSERT INTO execution_meta (key, value) VALUES ('half', 'x')").run()
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(db.prepare("SELECT value FROM execution_meta WHERE key = 'half'").get()).toBeUndefined()
    expect(db.isTransaction).toBe(false)
    db.close()
  })

  it('raises ExecutionStoreBusyError after the bounded retry budget when the write lock is held', () => {
    const { db, path, store } = freshStore()
    const contender = new SyncDatabase(path)
    contender.exec('BEGIN IMMEDIATE')
    contender.prepare("INSERT INTO execution_meta (key, value) VALUES ('lock', '1')").run()
    try {
      let ran = false
      expect(() =>
        store.withImmediateTransaction(() => {
          ran = true
        })
      ).toThrow(ExecutionStoreBusyError)
      expect(ran).toBe(false) // fn never ran — no partial state
      expect(db.isTransaction).toBe(false) // no transaction left open
    } finally {
      contender.exec('ROLLBACK')
      contender.close()
    }
    // Once the contender releases, the same call converges.
    const ok = store.withImmediateTransaction(() => 'done')
    expect(ok).toBe('done')
    db.close()
  })

  it('exposes the configured bounded attempt count (candidate: 5)', () => {
    const { db, store } = freshStore()
    expect(store.busyRetryBudget).toBe(5)
    db.close()
  })
})
