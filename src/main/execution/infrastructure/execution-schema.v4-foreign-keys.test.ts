import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from './execution-schema'

// SPEC.md §7 / SPEC-AMENDMENT-001 §6 — dispatch_worktree.correlation_id,
// worktree_provenance.correlation_id, and worktree_provenance_incident.correlation_id
// must each carry `REFERENCES run_reservation(correlation_id)`, exactly as the frozen
// DDL prose blocks show (and exactly as settlement_observation / settlement_incident
// already do for the same column in the same table family). Focused-fix blocker 1.
//
// RED on d4bfdc8e: the production DDL omits all three REFERENCES clauses (a
// documented, deliberate deviation — RED-EVIDENCE.md "Schema DDL — one deliberate
// SPEC deviation, and why"), so none of these inserts throw and every assertion
// below fails.

describe('execution-schema v4 — frozen FK clauses (SPEC §7 / Amendment §6)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort — Windows may hold a transient handle */
      }
    }
  })
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'orca-s3-fk-'))
    dirs.push(d)
    return d
  }
  function openWithForeignKeysOn() {
    const db = new SyncDatabase(join(tmp(), 'exec.db'))
    db.pragma('foreign_keys = ON')
    migrateExecutionStore(db)
    return db
  }

  it('rejects a dispatch_worktree row whose correlation_id has no matching run_reservation row', () => {
    const db = openWithForeignKeysOn()
    expect(() =>
      db
        .prepare(
          `INSERT INTO dispatch_worktree
           (orca_dispatch_id, correlation_id, orca_run_id, worktree_nonce, worktree_path, root_ref, opened_at)
           VALUES ('ctx_1', 'corr_missing', 'run_1', 'nonce_1', '/durable/root/shadow-corr_1', 'root_gen_1', '2026-09-12T00:00:00Z')`
        )
        .run()
    ).toThrow(/FOREIGN KEY constraint failed/)
    db.close()
  })

  it('rejects a worktree_provenance row whose correlation_id has no matching run_reservation row', () => {
    const db = openWithForeignKeysOn()
    expect(() =>
      db
        .prepare(
          `INSERT INTO worktree_provenance
           (correlation_id, orca_dispatch_id, orca_run_id, slice_ref, base_commit, candidate_head,
            files_changed_json, provenance_source, worktree_path_ref, provenance_digest, provenance_json,
            first_seen_at, observed_at)
           VALUES ('corr_missing', 'ctx_1', 'run_1', 'slice_1', 'base', 'head',
            '[]', 'primary', '/durable/root/shadow-corr_1', 'digest_1', '{}',
            '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')`
        )
        .run()
    ).toThrow(/FOREIGN KEY constraint failed/)
    db.close()
  })

  it('rejects a worktree_provenance_incident row whose correlation_id has no matching run_reservation row', () => {
    const db = openWithForeignKeysOn()
    expect(() =>
      db
        .prepare(
          `INSERT INTO worktree_provenance_incident
           (id, correlation_id, slice_ref, kind, evidence_digest, detail_json, raised_at)
           VALUES ('inc_1', 'corr_missing', 'slice_1', 'worktree_missing', 'digest_1', '{}', '2026-09-12T00:00:00Z')`
        )
        .run()
    ).toThrow(/FOREIGN KEY constraint failed/)
    db.close()
  })

  it('accepts each row once a matching run_reservation row exists', () => {
    const db = openWithForeignKeysOn()
    db.prepare(
      `INSERT INTO run_reservation
       (correlation_id, slice_ref, workload_id, state, created_at, updated_at)
       VALUES ('corr_1', 'slice_1', 'workload_1', 'bound', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')`
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO dispatch_worktree
           (orca_dispatch_id, correlation_id, orca_run_id, worktree_nonce, worktree_path, root_ref, opened_at)
           VALUES ('ctx_1', 'corr_1', 'run_1', 'nonce_1', '/durable/root/shadow-corr_1', 'root_gen_1', '2026-09-12T00:00:00Z')`
        )
        .run()
    ).not.toThrow()
    db.close()
  })
})
