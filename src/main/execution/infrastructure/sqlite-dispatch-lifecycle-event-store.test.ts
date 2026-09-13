import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { DispatchLifecycleEventRecord } from '../domain/dispatch-lifecycle-event'
import { migrateExecutionStore } from './execution-schema'
import { SqliteDispatchLifecycleEventStore } from './sqlite-dispatch-lifecycle-event-store'

// ORCA-S4 SPEC §8.6, §12 window L9, §14 LIFE-7/LIFE-8 — dispatch_lifecycle_event
// is durable SOURCE state, write-once per (correlation_id, event_kind). The
// composite PK IS the idempotency mechanism for duplicate/hook-triggered
// emission. RED: `./sqlite-dispatch-lifecycle-event-store` does not exist yet.

const EVENT_KIND = 'shadow_delegated_boundary_closed'

function event(over: Partial<DispatchLifecycleEventRecord> = {}): DispatchLifecycleEventRecord {
  return {
    correlationId: 'corr_1',
    eventKind: EVENT_KIND,
    closureDigestRef: 'f'.repeat(64),
    emittedAt: '2026-09-13T00:00:00Z',
    ...over
  }
}

describe('SqliteDispatchLifecycleEventStore (§8.6)', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-dle-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return { db, store: new SqliteDispatchLifecycleEventStore(db) }
  }

  it('inserts a row and reads it back by (correlation_id, event_kind)', () => {
    const { store } = open()
    store.insert(event())
    expect(store.getByCorrelationAndKind('corr_1', EVENT_KIND)).toEqual(event())
  })

  it('(correlation_id, event_kind) is the COMPOSITE PRIMARY KEY — a second insert for the same pair throws (§12 window L9: a duplicate/hook-triggered emission is a no-op, never a second row)', () => {
    const { store } = open()
    store.insert(event())
    expect(() => store.insert(event({ closureDigestRef: 'g'.repeat(64) }))).toThrow()
    expect(store.getByCorrelationAndKind('corr_1', EVENT_KIND)?.closureDigestRef).toBe('f'.repeat(64))
  })

  it('a DIFFERENT event_kind for the same correlation_id is a distinct row (composite key, not correlation_id alone)', () => {
    const { store } = open()
    store.insert(event())
    expect(() => store.insert(event({ eventKind: 'other_kind' }))).not.toThrow()
    expect(store.getByCorrelationAndKind('corr_1', 'other_kind')).toBeDefined()
  })

  it('is preserved by a projection rebuild byte-for-byte — NOT regenerated at all (§8.0.1, §8.8)', () => {
    const { db, store } = open()
    store.insert(event())
    db.exec('DROP TABLE IF EXISTS dispatch_lifecycle_incident;')
    migrateExecutionStore(db)
    expect(store.getByCorrelationAndKind('corr_1', EVENT_KIND)).toEqual(event())
  })

  it('returns undefined for an unknown (correlation_id, event_kind) pair', () => {
    const { store } = open()
    expect(store.getByCorrelationAndKind('nope', EVENT_KIND)).toBeUndefined()
  })
})
