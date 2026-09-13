import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { WorktreeFinalizationRecord } from '../domain/worktree-finalization'
import { migrateExecutionStore } from './execution-schema'
import { SqliteWorktreeFinalizationStore } from './sqlite-worktree-finalization-store'

// ORCA-S4 SPEC §8.3, §10.2 — worktree_finalization is durable SOURCE state.
// intent_recorded is written BEFORE any filesystem deletion; the one-time PK
// insert forbids a second intent (§12 window L8, §14 LIFE-7). RED:
// `./sqlite-worktree-finalization-store` does not exist yet.

function intent(over: Partial<WorktreeFinalizationRecord> = {}): WorktreeFinalizationRecord {
  return {
    correlationId: 'corr_1',
    orcaDispatchId: 'ctx_1',
    sliceRef: 'ORCA-S4',
    eligibilityDigest: 'd'.repeat(64),
    intentRecordedAt: '2026-09-13T00:00:00Z',
    status: 'intent_recorded',
    finalizedAt: null,
    outcomeDetailJson: null,
    conflictedAt: null,
    ...over
  }
}

describe('SqliteWorktreeFinalizationStore (§8.3, §10.2)', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-wf-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return { db, store: new SqliteWorktreeFinalizationStore(db) }
  }

  it('insertIntent writes status="intent_recorded" and reads it back by correlation_id', () => {
    const { store } = open()
    store.insertIntent(intent())
    expect(store.getByCorrelationId('corr_1')).toEqual(intent())
  })

  it('correlation_id is the PRIMARY KEY — a second insertIntent throws (§12 window L8, LIFE-7: duplicate finalization is a no-op, never a double-delete)', () => {
    const { store } = open()
    store.insertIntent(intent())
    expect(() => store.insertIntent(intent({ eligibilityDigest: 'e'.repeat(64) }))).toThrow()
  })

  it('markFinalized transitions intent_recorded -> finalized and stamps finalized_at + outcome_detail_json', () => {
    const { store } = open()
    store.insertIntent(intent())
    store.markFinalized('corr_1', { finalizedAt: '2026-09-13T00:05:00Z', outcomeDetailJson: '{"deleted":true}' })
    const row = store.getByCorrelationId('corr_1')
    expect(row?.status).toBe('finalized')
    expect(row?.finalizedAt).toBe('2026-09-13T00:05:00Z')
    expect(row?.outcomeDetailJson).toBe('{"deleted":true}')
  })

  it('markFinalized is safe to call twice with the same outcome (idempotent retry from L3/L4/L5, §10.2)', () => {
    const { store } = open()
    store.insertIntent(intent())
    store.markFinalized('corr_1', { finalizedAt: '2026-09-13T00:05:00Z', outcomeDetailJson: '{}' })
    expect(() =>
      store.markFinalized('corr_1', { finalizedAt: '2026-09-13T00:05:00Z', outcomeDetailJson: '{}' })
    ).not.toThrow()
  })

  it('markSkippedNotEligible transitions intent_recorded -> skipped_not_eligible directly, no filesystem act (legacy binding, §10.2)', () => {
    const { store } = open()
    store.insertIntent(intent())
    store.markSkippedNotEligible('corr_1')
    expect(store.getByCorrelationId('corr_1')?.status).toBe('skipped_not_eligible')
  })

  it('markConflicted transitions intent_recorded -> conflicted and stamps conflicted_at; the filesystem act is NOT attempted for this pass (§10.2 Phase-B re-verify mismatch)', () => {
    const { store } = open()
    store.insertIntent(intent())
    store.markConflicted('corr_1', '2026-09-13T00:05:00Z')
    const row = store.getByCorrelationId('corr_1')
    expect(row?.status).toBe('conflicted')
    expect(row?.conflictedAt).toBe('2026-09-13T00:05:00Z')
  })

  it('is preserved by a projection rebuild byte-for-byte (§8.8, LIFE-4)', () => {
    const { db, store } = open()
    store.insertIntent(intent())
    db.exec('DROP TABLE IF EXISTS dispatch_lifecycle_incident;')
    migrateExecutionStore(db)
    expect(store.getByCorrelationId('corr_1')).toEqual(intent())
  })

  it('returns undefined for an unknown correlation id', () => {
    const { store } = open()
    expect(store.getByCorrelationId('nope')).toBeUndefined()
  })
})
