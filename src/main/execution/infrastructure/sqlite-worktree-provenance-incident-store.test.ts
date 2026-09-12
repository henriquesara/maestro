import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { WorktreeProvenanceIncidentRecord } from '../domain/worktree-provenance'
import { migrateExecutionStore } from './execution-schema'
import { SqliteWorktreeProvenanceIncidentStore } from './sqlite-worktree-provenance-incident-store'

// ORCA-S3 §7.3, B1, §12 PROV-10 — the S3-ONLY incident channel. Never
// auto-resolved; a retry that reads the same evidence is a no-op via the
// UNIQUE (correlation_id, kind, evidence_digest) index; genuinely different
// evidence is a NEW row, old rows retained. RED: `./sqlite-worktree-provenance-incident-store`
// does not exist yet.

function record(over: Partial<WorktreeProvenanceIncidentRecord> = {}): WorktreeProvenanceIncidentRecord {
  return {
    id: 'wpi_1',
    correlationId: 'corr_1',
    orcaDispatchId: 'ctx_1',
    sliceRef: 'ORCA-S3',
    kind: 'worktree_missing',
    evidenceDigest: 'e'.repeat(64),
    detailJson: JSON.stringify({ observed: 'non_repository' }),
    blocked: true,
    resolvedAt: null,
    resolutionNote: null,
    raisedAt: '2026-09-12T00:00:00Z',
    ...over
  }
}

describe('SqliteWorktreeProvenanceIncidentStore (§7.3)', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-s3-wpi-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    // No parent run_reservation row is seeded — matches the established S2
    // harness pattern (settlement-test-harness.ts) for standalone store tests.
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return { db, store: new SqliteWorktreeProvenanceIncidentStore(db) }
  }

  it('inserts a row and lists it by slice', () => {
    const { store } = open()
    store.insert(record())
    expect(store.listBySlice('ORCA-S3')).toEqual([record()])
  })

  it('hasOpenIncident is true while resolved_at IS NULL', () => {
    const { store } = open()
    store.insert(record())
    expect(store.hasOpenIncident('corr_1')).toBe(true)
  })

  it('hasOpenIncident is false once resolved', () => {
    const { store } = open()
    store.insert(record())
    store.resolve('wpi_1', { resolvedAt: '2026-09-12T01:00:00Z', resolutionNote: 'operator note' })
    expect(store.hasOpenIncident('corr_1')).toBe(false)
  })

  it('a retry that reads the SAME evidence (correlation_id, kind, evidence_digest) is a no-op, not a second row', () => {
    const { store } = open()
    const first = store.insert(record())
    const second = store.insert(record())
    expect(first.inserted).toBe(true)
    expect(second.inserted).toBe(false)
    expect(store.listBySlice('ORCA-S3')).toHaveLength(1)
  })

  it('genuinely different evidence is a NEW row; the old row is retained', () => {
    const { store } = open()
    store.insert(record())
    store.insert(record({ id: 'wpi_2', evidenceDigest: 'f'.repeat(64) }))
    expect(store.listBySlice('ORCA-S3')).toHaveLength(2)
  })

  it('is never auto-resolved — resolve requires an explicit resolutionNote and is the only mutation path', () => {
    const { store } = open()
    store.insert(record())
    store.resolve('wpi_1', { resolvedAt: '2026-09-12T01:00:00Z', resolutionNote: 'fixed by operator' })
    const after = store.listBySlice('ORCA-S3')[0]
    expect(after.resolvedAt).toBe('2026-09-12T01:00:00Z')
    expect(after.resolutionNote).toBe('fixed by operator')
    expect(after.blocked).toBe(false)
  })

  it.each(['worktree_missing', 'worktree_dispatch_mismatch', 'provenance_snapshot_changed'] as const)(
    'stores the %s kind verbatim',
    (kind) => {
      const { store } = open()
      store.insert(record({ kind }))
      expect(store.listBySlice('ORCA-S3')[0].kind).toBe(kind)
    }
  )
})
