import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { WorktreeProvenanceRecord } from '../domain/worktree-provenance'
import { migrateExecutionStore } from './execution-schema'
import { SqliteWorktreeProvenanceStore } from './sqlite-worktree-provenance-store'

// ORCA-S3 §7.1, §12 PROV-1/PROV-2 — worktree_provenance is a write-once
// projection: every artifact column is immutable after Phase A; the ONLY
// permitted mutation is status 'recorded' -> 'conflicted' (+ conflicted_at).
// RED: `./sqlite-worktree-provenance-store` does not exist yet.

function record(over: Partial<WorktreeProvenanceRecord> = {}): WorktreeProvenanceRecord {
  return {
    correlationId: 'corr_1',
    orcaDispatchId: 'ctx_1',
    orcaRunId: 'run_1',
    sliceRef: 'ORCA-S3',
    status: 'recorded',
    baseCommit: 'b'.repeat(40),
    candidateHead: 'c'.repeat(40),
    filesChangedJson: JSON.stringify(['a.ts', 'b.ts']),
    provenanceSource: 'converged_from_worktree',
    worktreePathRef: '/durable/root/shadow-corr_1',
    provenanceDigest: 'd'.repeat(64),
    provenanceJson: JSON.stringify({ transcript: [] }),
    firstSeenAt: '2026-09-12T00:00:00Z',
    observedAt: '2026-09-12T00:00:00Z',
    conflictedAt: null,
    ...over
  }
}

describe('SqliteWorktreeProvenanceStore (§7.1)', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-s3-wp-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    // No parent run_reservation row is seeded — matches the established S2
    // harness pattern (settlement-test-harness.ts) for standalone store tests.
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return { db, store: new SqliteWorktreeProvenanceStore(db) }
  }

  it('inserts a row and reads it back by correlation_id', () => {
    const { store } = open()
    store.insert(record())
    expect(store.getByCorrelation('corr_1')).toEqual(record())
  })

  it('lists rows by slice, ordered', () => {
    const { store } = open()
    store.insert(record({ correlationId: 'corr_2', orcaDispatchId: 'ctx_2' }))
    store.insert(record({ correlationId: 'corr_1', orcaDispatchId: 'ctx_1' }))
    expect(store.listBySlice('ORCA-S3').map((r) => r.correlationId)).toEqual(['corr_1', 'corr_2'])
  })

  it('correlation_id is the PRIMARY KEY — write-once (PROV-1); a second insert for the same id is a no-op, not an error', () => {
    const { store } = open()
    store.insert(record())
    const result = store.insert(record({ candidateHead: 'z'.repeat(40) }))
    expect(result.inserted).toBe(false)
    expect(store.getByCorrelation('corr_1')!.candidateHead).toBe('c'.repeat(40)) // unchanged
  })

  it('markConflicted is the ONLY permitted mutation — every artifact column stays byte-unchanged', () => {
    const { store } = open()
    store.insert(record())
    store.markConflicted('corr_1', { conflictedAt: '2026-09-12T01:00:00Z' })
    const after = store.getByCorrelation('corr_1')!
    expect(after.status).toBe('conflicted')
    expect(after.conflictedAt).toBe('2026-09-12T01:00:00Z')
    for (const k of [
      'baseCommit',
      'candidateHead',
      'filesChangedJson',
      'provenanceSource',
      'provenanceDigest',
      'provenanceJson'
    ] as const) {
      expect(after[k]).toBe(record()[k])
    }
  })

  it('markConflicted is idempotent — a second call does not change conflictedAt', () => {
    const { store } = open()
    store.insert(record())
    store.markConflicted('corr_1', { conflictedAt: '2026-09-12T01:00:00Z' })
    store.markConflicted('corr_1', { conflictedAt: '2026-09-12T02:00:00Z' })
    expect(store.getByCorrelation('corr_1')!.conflictedAt).toBe('2026-09-12T01:00:00Z')
  })

  it('returns undefined for an unknown correlation id', () => {
    const { store } = open()
    expect(store.getByCorrelation('nope')).toBeUndefined()
  })
})
