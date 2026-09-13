import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { DispatchLifecycleClosureRecord } from '../domain/dispatch-lifecycle-closure'
import { migrateExecutionStore } from './execution-schema'
import { SqliteDispatchLifecycleClosureStore } from './sqlite-dispatch-lifecycle-closure-store'

// ORCA-S4 SPEC §8.5, §8.0.1, §14 LIFE-5/LIFE-15 — dispatch_lifecycle_closure is
// durable SOURCE state (corrected from PROJECTION), write-once except ONE
// permitted post-insert mutation. RED:
// `./sqlite-dispatch-lifecycle-closure-store` does not exist yet.

function closure(over: Partial<DispatchLifecycleClosureRecord> = {}): DispatchLifecycleClosureRecord {
  return {
    correlationId: 'corr_1',
    orcaDispatchId: 'ctx_1',
    orcaRunId: 'run_1',
    sliceRef: 'ORCA-S4',
    settlementStatusRef: 'observed',
    worktreeProvenanceRef: 'recorded',
    terminationMethodRef: 'self_exit',
    finalizationStatusRef: 'finalized',
    closureDigest: 'f'.repeat(64),
    closedAt: '2026-09-13T00:00:00Z',
    postClosureSettlementConflictDetectedAt: null,
    ...over
  }
}

describe('SqliteDispatchLifecycleClosureStore (§8.5)', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-dlc-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return { db, store: new SqliteDispatchLifecycleClosureStore(db) }
  }

  it('inserts a row and reads it back by correlation_id', () => {
    const { store } = open()
    store.insert(closure())
    expect(store.getByCorrelationId('corr_1')).toEqual(closure())
  })

  it('correlation_id is the PRIMARY KEY — a second insert for a correlation_id that already has one THROWS, structurally forbidding a replacement closure row (§7 forbidden, LIFE-15)', () => {
    const { store } = open()
    store.insert(closure())
    expect(() => store.insert(closure({ settlementStatusRef: 'observed_conflicted' }))).toThrow()
    expect(store.getByCorrelationId('corr_1')?.settlementStatusRef).toBe('observed')
  })

  it('markPostClosureSettlementConflictDetected sets the ONE permitted mutation and touches no other column (§7, §11 Phase 5)', () => {
    const { store } = open()
    store.insert(closure())
    store.markPostClosureSettlementConflictDetected('corr_1', '2026-09-14T00:00:00Z')
    const row = store.getByCorrelationId('corr_1')
    expect(row?.postClosureSettlementConflictDetectedAt).toBe('2026-09-14T00:00:00Z')
    // Every *_ref column and closure_digest is untouched.
    expect(row?.settlementStatusRef).toBe('observed')
    expect(row?.worktreeProvenanceRef).toBe('recorded')
    expect(row?.terminationMethodRef).toBe('self_exit')
    expect(row?.finalizationStatusRef).toBe('finalized')
    expect(row?.closureDigest).toBe('f'.repeat(64))
  })

  it('markPostClosureSettlementConflictDetected is idempotent — a second call does not overwrite the first timestamp (Phase 5 fixed-point property, §11)', () => {
    const { store } = open()
    store.insert(closure())
    store.markPostClosureSettlementConflictDetected('corr_1', '2026-09-14T00:00:00Z')
    store.markPostClosureSettlementConflictDetected('corr_1', '2026-09-15T00:00:00Z')
    expect(store.getByCorrelationId('corr_1')?.postClosureSettlementConflictDetectedAt).toBe(
      '2026-09-14T00:00:00Z'
    )
  })

  it('there is no method to update any *_ref column or closure_digest — the store surface has only insert + the one marker mutation (LIFE-15)', () => {
    const { store } = open()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(store))
    expect(methods).not.toContain('update')
    expect(methods).not.toContain('rewrite')
    expect(methods).not.toContain('replace')
  })

  it('is preserved by a projection rebuild byte-for-byte — NOT regenerated at all (§8.0.1, §8.8: closure/event corrected from PROJECTION to SOURCE)', () => {
    const { db, store } = open()
    store.insert(closure())
    db.exec('DROP TABLE IF EXISTS dispatch_lifecycle_incident;')
    migrateExecutionStore(db)
    expect(store.getByCorrelationId('corr_1')).toEqual(closure())
  })

  it('returns undefined for an unknown correlation id', () => {
    const { store } = open()
    expect(store.getByCorrelationId('nope')).toBeUndefined()
  })
})
