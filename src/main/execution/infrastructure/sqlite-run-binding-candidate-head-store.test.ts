import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from './execution-schema'
import { SqliteRunBindingCandidateHeadStore } from './sqlite-run-binding-candidate-head-store'

// ORCA-S3 §7.4, §12 R2/PROV-1 — the CAS write onto the LATENT
// `run_binding.candidate_head` column (no DDL; the column already exists from
// ORCA-S1/S2). `setBindingCandidateHead` on the existing `ExecutionStore`
// (sqlite-execution-store.ts) is an UNCONDITIONAL UPDATE and cannot express
// "never overwrite a non-null disagreeing value" (R2) — S3 needs its own
// `WHERE candidate_head IS NULL` compare-and-swap, never a second unconditional
// writer of this column. RED: `./sqlite-run-binding-candidate-head-store` does
// not exist yet.

describe('SqliteRunBindingCandidateHeadStore (§7.4 R2)', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-s3-cas-'))
    dirs.push(dir)
    const db = new SyncDatabase(join(dir, 'exec.db'))
    migrateExecutionStore(db)
    db.prepare(
      `INSERT INTO run_reservation (correlation_id, slice_ref, workload_id, state, created_at, updated_at)
       VALUES ('corr_1', 'ORCA-S3', 'w1', 'settled', 't', 't')`
    ).run()
    db.prepare(
      `INSERT INTO run_binding (orca_dispatch_id, correlation_id, governance_agent_run_id, orca_run_id, org_task_id, slice_ref, base_commit, candidate_head, bound_at)
       VALUES ('ctx_1', 'corr_1', 'gar_1', 'run_1', 'task_1', 'ORCA-S3', '${'b'.repeat(40)}', NULL, 't')`
    ).run()
    return { db, store: new SqliteRunBindingCandidateHeadStore(db) }
  }
  function currentCandidateHead(db: SyncDatabase): string | null {
    return (
      db
        .prepare('SELECT candidate_head FROM run_binding WHERE orca_dispatch_id = ?')
        .get('ctx_1') as {
        candidate_head: string | null
      }
    ).candidate_head
  }

  it('NULL -> <sha>: the CAS succeeds and returns "set"', () => {
    const { db, store } = open()
    const result = store.casSetCandidateHead('ctx_1', 'h'.repeat(40))
    expect(result).toBe('set')
    expect(currentCandidateHead(db)).toBe('h'.repeat(40))
  })

  it('already <sha> and EQUAL to the write: the CAS matches 0 rows, returns "already_equal", no error', () => {
    const { db, store } = open()
    store.casSetCandidateHead('ctx_1', 'h'.repeat(40))
    const result = store.casSetCandidateHead('ctx_1', 'h'.repeat(40))
    expect(result).toBe('already_equal')
    expect(currentCandidateHead(db)).toBe('h'.repeat(40))
  })

  it('already <sha> and DIFFERENT from the write: refuses, returns "conflict", NEVER overwrites (R2)', () => {
    const { db, store } = open()
    store.casSetCandidateHead('ctx_1', 'h'.repeat(40))
    const result = store.casSetCandidateHead('ctx_1', 'z'.repeat(40))
    expect(result).toBe('conflict')
    expect(currentCandidateHead(db)).toBe('h'.repeat(40)) // unchanged
  })
})
