import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { EXECUTION_SCHEMA_VERSION, migrateExecutionStore } from './execution-schema'

// ORCA-S2 acceptance criterion 15 — real migration v2 → v3.

const V2_CREATE_SQL = `
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
CREATE TABLE IF NOT EXISTS parity_observation (
  id TEXT PRIMARY KEY, run_binding_dispatch_id TEXT NOT NULL REFERENCES run_binding(orca_dispatch_id),
  slice_ref TEXT NOT NULL, workload_id TEXT NOT NULL, authoritative_json TEXT NOT NULL,
  shadow_json TEXT NOT NULL, parity_json TEXT NOT NULL, adjudications_json TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workload_exclusion (
  id TEXT PRIMARY KEY, slice_ref TEXT NOT NULL, workload_id TEXT NOT NULL, code TEXT NOT NULL,
  reason TEXT NOT NULL, excluded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS execution_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

function tableColumns(db: SyncDatabase, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((r) => r.name).sort()
}

/**
 * A STRUCTURAL fingerprint (criterion 15 — "structurally identical", not
 * byte-identical DDL text): table/index names, and for each table its column
 * defs, primary key, foreign keys, and index membership. SQLite keeps the
 * original CREATE text verbatim in sqlite_master.sql, so two stores built from
 * differently-formatted-but-equivalent DDL must still compare equal here.
 */
function schemaFingerprint(db: SyncDatabase): string {
  const objects = db
    .prepare(
      "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index') ORDER BY type, name"
    )
    .all() as { type: string; name: string }[]
  const tables = objects.filter((o) => o.type === 'table').map((o) => o.name)
  const structure = tables.map((table) => ({
    table,
    columns: (
      db.pragma(`table_info(${table})`) as {
        name: string
        type: string
        notnull: number
        dflt_value: unknown
        pk: number
      }[]
    )
      .map((c) => `${c.name}:${c.type}:nn=${c.notnull}:def=${String(c.dflt_value)}:pk=${c.pk}`)
      .sort(),
    foreignKeys: (
      db.pragma(`foreign_key_list(${table})`) as { table: string; from: string; to: string }[]
    )
      .map((f) => `${f.from}->${f.table}.${f.to}`)
      .sort(),
    indexes: (
      db.pragma(`index_list(${table})`) as { name: string; unique: number; origin: string }[]
    )
      .map(
        (i) =>
          `${i.name}:uniq=${i.unique}:origin=${i.origin}:cols=${(
            db.pragma(`index_info(${i.name})`) as { name: string }[]
          )
            .map((c) => c.name)
            .join(',')}`
      )
      .sort()
  }))
  return JSON.stringify({ objects, structure })
}

describe('migrateExecutionStore — v2 → v3 versioned upgrade (§11.1)', () => {
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
    const d = mkdtempSync(join(tmpdir(), 'orca-s2-mig-'))
    dirs.push(d)
    return d
  }

  it('EXECUTION_SCHEMA_VERSION is at least 3 (ORCA-S3 bumps it further to 4)', () => {
    expect(EXECUTION_SCHEMA_VERSION).toBeGreaterThanOrEqual(3)
  })

  it('opens an existing v2 store, preserves every S1 row, adds the two S2 tables, bumps to the current version', () => {
    const path = join(tmp(), 'exec.db')
    const v2 = new SyncDatabase(path)
    v2.exec(V2_CREATE_SQL)
    v2.prepare("INSERT INTO execution_meta (key, value) VALUES ('schema_version', '2')").run()
    v2.prepare(
      `INSERT INTO run_reservation (correlation_id, slice_ref, authoritative_run_ref, workload_id, state, created_at, updated_at)
       VALUES ('c1','ORCA-S1','r1','w1','observed','t','t')`
    ).run()
    v2.prepare(
      `INSERT INTO run_binding (orca_dispatch_id, correlation_id, governance_agent_run_id, orca_run_id, org_task_id, slice_ref, base_commit, bound_at)
       VALUES ('d1','c1','g1','run1','task1','ORCA-S1','base','t')`
    ).run()
    const s1ReservationBefore = v2.prepare('SELECT * FROM run_reservation').all()
    const s1BindingBefore = v2.prepare('SELECT * FROM run_binding').all()
    const s1TableCols = {
      run_reservation: tableColumns(v2, 'run_reservation'),
      run_binding: tableColumns(v2, 'run_binding'),
      parity_observation: tableColumns(v2, 'parity_observation'),
      workload_exclusion: tableColumns(v2, 'workload_exclusion')
    }
    v2.close()

    const db = new SyncDatabase(path)
    db.pragma('foreign_keys = ON')
    migrateExecutionStore(db)

    expect(db.prepare('SELECT * FROM run_reservation').all()).toEqual(s1ReservationBefore)
    expect(db.prepare('SELECT * FROM run_binding').all()).toEqual(s1BindingBefore)
    expect(tableColumns(db, 'run_reservation')).toEqual(s1TableCols.run_reservation)
    expect(tableColumns(db, 'run_binding')).toEqual(s1TableCols.run_binding)
    expect(tableColumns(db, 'parity_observation')).toEqual(s1TableCols.parity_observation)
    expect(tableColumns(db, 'workload_exclusion')).toEqual(s1TableCols.workload_exclusion)

    expect(tableColumns(db, 'settlement_observation').length).toBeGreaterThan(0)
    expect(tableColumns(db, 'settlement_incident').length).toBeGreaterThan(0)
    expect(
      db.prepare("SELECT value FROM execution_meta WHERE key = 'schema_version'").get()
    ).toEqual({ value: String(EXECUTION_SCHEMA_VERSION) })
    db.close()
  })

  it('a v2-upgraded store and a freshly created store at the current version are structurally identical', () => {
    const upgradedPath = join(tmp(), 'upgraded.db')
    const u = new SyncDatabase(upgradedPath)
    u.exec(V2_CREATE_SQL)
    u.prepare("INSERT INTO execution_meta (key, value) VALUES ('schema_version', '2')").run()
    u.close()
    const upgraded = new SyncDatabase(upgradedPath)
    migrateExecutionStore(upgraded)
    const upgradedFp = schemaFingerprint(upgraded)
    upgraded.close()

    const freshPath = join(tmp(), 'fresh.db')
    const fresh = new SyncDatabase(freshPath)
    migrateExecutionStore(fresh)
    const freshFp = schemaFingerprint(fresh)
    fresh.close()

    expect(upgradedFp).toBe(freshFp)
  })

  it('is idempotent — a second migrate is a no-op and keeps the current schema_version', () => {
    const path = join(tmp(), 'idem.db')
    const db = new SyncDatabase(path)
    migrateExecutionStore(db)
    const fp1 = schemaFingerprint(db)
    migrateExecutionStore(db)
    migrateExecutionStore(db)
    expect(schemaFingerprint(db)).toBe(fp1)
    expect(
      db.prepare("SELECT value FROM execution_meta WHERE key = 'schema_version'").get()
    ).toEqual({ value: String(EXECUTION_SCHEMA_VERSION) })
    db.close()
  })

  it('settlement_observation enforces write-once identity: correlation_id PRIMARY KEY', () => {
    const path = join(tmp(), 'pk.db')
    const db = new SyncDatabase(path)
    migrateExecutionStore(db)
    const cols = db.pragma('table_info(settlement_observation)') as { name: string; pk: number }[]
    expect(cols.find((c) => c.name === 'correlation_id')?.pk).toBe(1)
    db.close()
  })

  it('settlement_incident has a UNIQUE (correlation_id, kind, evidence_digest) index', () => {
    const path = join(tmp(), 'uq.db')
    const db = new SyncDatabase(path)
    migrateExecutionStore(db)
    const idxList = db.pragma('index_list(settlement_incident)') as {
      name: string
      unique: number
    }[]
    const unique = idxList.find((i) => i.unique === 1)
    expect(unique).toBeDefined()
    const idxCols = (db.pragma(`index_info(${unique!.name})`) as { name: string }[]).map(
      (r) => r.name
    )
    expect(idxCols).toEqual(['correlation_id', 'kind', 'evidence_digest'])
    db.close()
  })
})
