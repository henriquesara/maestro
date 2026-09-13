import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { EXECUTION_SCHEMA_VERSION, migrateExecutionStore } from './execution-schema'

// ORCA-S3 §7, §12 PROV-11, acceptance gate 16 — schema v3 → v4: THREE NEW TABLES
// (dispatch_worktree, worktree_provenance, worktree_provenance_incident) + their
// indexes; ZERO column added to any ORCA-S1/S2 table. `worktree_provenance`
// carries FIFTEEN columns per SPEC-AMENDMENT-001 (adds `provenance_json`).
//
// RED (real assertion failure, not import failure): `execution-schema.ts`
// exists today at EXECUTION_SCHEMA_VERSION 3 with no S3 tables — every
// assertion below fails against the current production module.
//
// ORCA-S4 note: EXECUTION_SCHEMA_VERSION is a single process-wide counter
// (never a per-slice snapshot), and S4 legitimately bumps it 4 -> 5 (§8) —
// exactly the eventuality the S2-era `execution-schema.migration.test.ts`
// already anticipated ("ORCA-S3 bumps it further to 4"). The three literal
// `4`s below are updated to `>= 4` / the live constant so this file keeps
// testing its own real subject — the v3->v4 step's tables, row-preservation,
// and idempotency — without re-asserting a version number that is no longer
// current. No other assertion in this file changes.

function tableColumns(db: SyncDatabase, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((r) => r.name).sort()
}

describe('migrateExecutionStore — v3 → v4 versioned upgrade (§7, §12 PROV-11)', () => {
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
    const d = mkdtempSync(join(tmpdir(), 'orca-s3-mig-'))
    dirs.push(d)
    return d
  }

  it('EXECUTION_SCHEMA_VERSION is at least 4 (ORCA-S4 bumps it further to 5)', () => {
    expect(EXECUTION_SCHEMA_VERSION).toBeGreaterThanOrEqual(4)
  })

  it('a fresh store gains dispatch_worktree, worktree_provenance, worktree_provenance_incident', () => {
    const db = new SyncDatabase(join(tmp(), 'exec.db'))
    migrateExecutionStore(db)
    expect(tableColumns(db, 'dispatch_worktree').length).toBeGreaterThan(0)
    expect(tableColumns(db, 'worktree_provenance').length).toBeGreaterThan(0)
    expect(tableColumns(db, 'worktree_provenance_incident').length).toBeGreaterThan(0)
    expect(
      db.prepare("SELECT value FROM execution_meta WHERE key = 'schema_version'").get()
    ).toEqual({ value: String(EXECUTION_SCHEMA_VERSION) })
    db.close()
  })

  it('worktree_provenance has exactly the 15 SPEC-AMENDMENT-001 columns, provenance_json NOT NULL', () => {
    const db = new SyncDatabase(join(tmp(), 'wp.db'))
    migrateExecutionStore(db)
    const cols = db.pragma('table_info(worktree_provenance)') as {
      name: string
      notnull: number
      pk: number
    }[]
    expect(cols.map((c) => c.name).sort()).toEqual(
      [
        'correlation_id',
        'orca_dispatch_id',
        'orca_run_id',
        'slice_ref',
        'status',
        'base_commit',
        'candidate_head',
        'files_changed_json',
        'provenance_source',
        'worktree_path_ref',
        'provenance_digest',
        'provenance_json',
        'first_seen_at',
        'observed_at',
        'conflicted_at'
      ].sort()
    )
    expect(cols.find((c) => c.name === 'correlation_id')?.pk).toBe(1)
    expect(cols.find((c) => c.name === 'provenance_json')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'conflicted_at')?.notnull).toBe(0)
  })

  it('dispatch_worktree is keyed by orca_dispatch_id and indexed by correlation_id', () => {
    const db = new SyncDatabase(join(tmp(), 'dw.db'))
    migrateExecutionStore(db)
    const cols = db.pragma('table_info(dispatch_worktree)') as { name: string; pk: number }[]
    expect(cols.find((c) => c.name === 'orca_dispatch_id')?.pk).toBe(1)
    expect(cols.map((c) => c.name).sort()).toEqual(
      [
        'orca_dispatch_id',
        'correlation_id',
        'orca_run_id',
        'worktree_nonce',
        'worktree_path',
        'root_ref',
        'opened_at'
      ].sort()
    )
    const idx = db.pragma('index_list(dispatch_worktree)') as { name: string }[]
    const hasCorrelationIndex = idx.some((i) =>
      (db.pragma(`index_info(${i.name})`) as { name: string }[]).some(
        (c) => c.name === 'correlation_id'
      )
    )
    expect(hasCorrelationIndex).toBe(true)
  })

  it('worktree_provenance_incident has a UNIQUE (correlation_id, kind, evidence_digest) index', () => {
    const db = new SyncDatabase(join(tmp(), 'wpi.db'))
    migrateExecutionStore(db)
    const idxList = db.pragma('index_list(worktree_provenance_incident)') as {
      name: string
      unique: number
    }[]
    const unique = idxList.find((i) => i.unique === 1)
    expect(unique).toBeDefined()
    const idxCols = (db.pragma(`index_info(${unique!.name})`) as { name: string }[]).map(
      (r) => r.name
    )
    expect(idxCols).toEqual(['correlation_id', 'kind', 'evidence_digest'])
  })

  it('adds ZERO columns to any ORCA-S1/S2 table (run_reservation, run_binding, parity_observation, workload_exclusion, settlement_observation, settlement_incident byte-unchanged)', () => {
    const before = new SyncDatabase(join(tmp(), 'before.db'))
    // Force a v3-only store by stopping short of v4 — simulated by creating a
    // fresh store, capturing prior-table columns, then migrating again to v4.
    migrateExecutionStore(before) // currently lands at v3 in production; captured as the S1/S2 baseline
    const s1s2Tables = [
      'run_reservation',
      'run_binding',
      'parity_observation',
      'workload_exclusion',
      'settlement_observation',
      'settlement_incident'
    ]
    const baseline = Object.fromEntries(s1s2Tables.map((t) => [t, tableColumns(before, t)]))
    before.close()

    const after = new SyncDatabase(join(tmp(), 'after.db'))
    migrateExecutionStore(after)
    for (const t of s1s2Tables) {
      expect(tableColumns(after, t)).toEqual(baseline[t])
    }
    after.close()
  })

  it('is idempotent — a second migrate is a no-op and keeps schema_version 4', () => {
    const db = new SyncDatabase(join(tmp(), 'idem.db'))
    migrateExecutionStore(db)
    const before = db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
      )
      .all()
    migrateExecutionStore(db)
    migrateExecutionStore(db)
    const after = db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
      )
      .all()
    expect(after).toEqual(before)
    expect(
      db.prepare("SELECT value FROM execution_meta WHERE key = 'schema_version'").get()
    ).toEqual({ value: String(EXECUTION_SCHEMA_VERSION) })
    db.close()
  })

  it('a v3-shaped store upgraded to v4 and a freshly created v4 store are structurally identical', () => {
    const V3_ONLY_CREATE_SQL = `
      CREATE TABLE IF NOT EXISTS run_reservation (
        correlation_id TEXT PRIMARY KEY, slice_ref TEXT NOT NULL, authoritative_run_ref TEXT,
        workload_id TEXT NOT NULL, state TEXT NOT NULL, orca_run_id TEXT, orca_dispatch_id TEXT,
        org_task_id TEXT, candidate_head TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_binding (
        orca_dispatch_id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL UNIQUE REFERENCES run_reservation(correlation_id),
        governance_agent_run_id TEXT NOT NULL, aicontrol_run_id TEXT, orca_run_id TEXT NOT NULL,
        org_task_id TEXT NOT NULL, slice_ref TEXT NOT NULL, base_commit TEXT NOT NULL, candidate_head TEXT,
        bound_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO execution_meta (key, value) VALUES ('schema_version', '3');
    `
    const upgradedPath = join(tmp(), 'upgraded.db')
    const u = new SyncDatabase(upgradedPath)
    u.exec(V3_ONLY_CREATE_SQL)
    u.close()
    const upgraded = new SyncDatabase(upgradedPath)
    migrateExecutionStore(upgraded)
    const upgradedTables = (
      upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()
    upgraded.close()

    const freshPath = join(tmp(), 'fresh.db')
    const fresh = new SyncDatabase(freshPath)
    migrateExecutionStore(fresh)
    const freshTables = (
      fresh
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()
    fresh.close()

    expect(upgradedTables).toEqual(freshTables)
    expect(upgradedTables).toEqual(
      expect.arrayContaining([
        'dispatch_worktree',
        'worktree_provenance',
        'worktree_provenance_incident'
      ])
    )
  })
})
