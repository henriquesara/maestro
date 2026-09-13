import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { DispatchTerminationRecord } from '../domain/dispatch-termination'
import { migrateExecutionStore } from './execution-schema'
import { SqliteDispatchTerminationStore } from './sqlite-dispatch-termination-store'

// ORCA-S4 SPEC §8.2, §14 LIFE-6 — dispatch_termination is durable SOURCE state,
// the one-time capture of an EPHEMERAL, non-replayable OS event. No Phase-B
// re-verify exists; every column is immutable after insert. A duplicate
// observation is a PK-collision no-op. RED: `./sqlite-dispatch-termination-store`
// does not exist yet.

function record(over: Partial<DispatchTerminationRecord> = {}): DispatchTerminationRecord {
  return {
    correlationId: 'corr_1',
    orcaDispatchId: 'ctx_1',
    terminationMethod: 'self_exit',
    exitCode: 0,
    exitSignal: null,
    treeVerified: true,
    observedAt: '2026-09-13T00:00:00Z',
    ...over
  }
}

describe('SqliteDispatchTerminationStore (§8.2)', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-dt-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return { db, store: new SqliteDispatchTerminationStore(db) }
  }

  it('inserts a row and reads it back by correlation_id', () => {
    const { store } = open()
    store.insert(record())
    expect(store.getByCorrelationId('corr_1')).toEqual(record())
  })

  it('correlation_id is the PRIMARY KEY — a duplicate observation is a PK-collision no-op, never a fresh row (§14 LIFE-6)', () => {
    const { store } = open()
    store.insert(record())
    expect(() => store.insert(record({ terminationMethod: 'signalled' }))).toThrow()
    expect(store.getByCorrelationId('corr_1')?.terminationMethod).toBe('self_exit')
  })

  it('there is NO update/mutate method exposed on this store — every column is immutable after insert (§8.2, no Phase-B re-verify)', () => {
    const { store } = open()
    expect((store as unknown as Record<string, unknown>).update).toBeUndefined()
    expect((store as unknown as Record<string, unknown>).markVerified).toBeUndefined()
  })

  it('§8.2 "confirmed_dead_unknown_cause" — exit_code/exit_signal are honestly NULL, never invented, and tree_verified is 0', () => {
    const { store } = open()
    store.insert(
      record({
        terminationMethod: 'confirmed_dead_unknown_cause',
        exitCode: null,
        exitSignal: null,
        treeVerified: false
      })
    )
    const row = store.getByCorrelationId('corr_1')
    expect(row?.exitCode).toBeNull()
    expect(row?.exitSignal).toBeNull()
    expect(row?.treeVerified).toBe(false)
  })

  it('is preserved by a projection rebuild byte-for-byte (§8.8, LIFE-4)', () => {
    const { db, store } = open()
    store.insert(record())
    db.exec('DROP TABLE IF EXISTS dispatch_lifecycle_incident;')
    migrateExecutionStore(db)
    expect(store.getByCorrelationId('corr_1')).toEqual(record())
  })

  it('returns undefined for an unknown correlation id', () => {
    const { store } = open()
    expect(store.getByCorrelationId('nope')).toBeUndefined()
  })
})
