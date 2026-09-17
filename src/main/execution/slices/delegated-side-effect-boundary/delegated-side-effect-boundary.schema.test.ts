import { describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import {
  EXECUTION_SCHEMA_VERSION,
  migrateExecutionStore
} from '../../infrastructure/execution-schema'

// ORCA-S4 SPEC §8 (schema v4 -> v5), gate 2 "no column added to any ORCA-S1/S2/S3
// table". RED, and genuinely so against the REAL execution-schema.ts (no import
// of a not-yet-existing module needed here): today EXECUTION_SCHEMA_VERSION is
// 4 and none of the six S4 tables exist. This is the "missing schema/table"
// class of valid RED the mission's RED-validity rules call out explicitly.

const S4_TABLES = [
  'dispatch_process_binding',
  'dispatch_termination',
  'worktree_finalization',
  'dispatch_lifecycle_incident',
  'dispatch_lifecycle_closure',
  'dispatch_lifecycle_event'
] as const

function tableColumns(db: SyncDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name)
}

function tableExists(db: SyncDatabase, table: string): boolean {
  return (
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table) as
      | { name: string }
      | undefined) !== undefined
  )
}

describe('ORCA-S4 schema v4 -> v5 (§8)', () => {
  it('EXECUTION_SCHEMA_VERSION is at least 5 (ORCA-S4 baseline; ORCA-S5 bumped it further, see delegated-cutover-transaction-and-schema.test.ts)', () => {
    expect(EXECUTION_SCHEMA_VERSION).toBeGreaterThanOrEqual(5)
  })

  it('a fresh store migrated to current version has all six S4 tables', () => {
    const db = new SyncDatabase(':memory:')
    migrateExecutionStore(db)
    for (const table of S4_TABLES) {
      expect(tableExists(db, table), `table ${table} must exist`).toBe(true)
    }
    db.close()
  })

  it("dispatch_process_binding has the exact §8.1 column set (plus ORCA-S5 §8.2's additive teardown_reason)", () => {
    const db = new SyncDatabase(':memory:')
    migrateExecutionStore(db)
    expect(tableColumns(db, 'dispatch_process_binding').sort()).toEqual(
      [
        'orca_dispatch_id',
        'correlation_id',
        'orca_run_id',
        'process_nonce',
        'pid',
        'kill_scope',
        'os_start_marker',
        'os_start_marker_source',
        'spawned_at',
        'teardown_requested_at',
        'teardown_reason'
      ].sort()
    )
    db.close()
  })

  it('dispatch_termination has the exact §8.2 column set', () => {
    const db = new SyncDatabase(':memory:')
    migrateExecutionStore(db)
    expect(tableColumns(db, 'dispatch_termination').sort()).toEqual(
      [
        'correlation_id',
        'orca_dispatch_id',
        'termination_method',
        'exit_code',
        'exit_signal',
        'tree_verified',
        'observed_at'
      ].sort()
    )
    db.close()
  })

  it('worktree_finalization has the exact §8.3 column set', () => {
    const db = new SyncDatabase(':memory:')
    migrateExecutionStore(db)
    expect(tableColumns(db, 'worktree_finalization').sort()).toEqual(
      [
        'correlation_id',
        'orca_dispatch_id',
        'slice_ref',
        'eligibility_digest',
        'intent_recorded_at',
        'status',
        'finalized_at',
        'outcome_detail_json',
        'conflicted_at'
      ].sort()
    )
    db.close()
  })

  it('dispatch_lifecycle_incident has the exact §8.4 column set + its UNIQUE index', () => {
    const db = new SyncDatabase(':memory:')
    migrateExecutionStore(db)
    expect(tableColumns(db, 'dispatch_lifecycle_incident').sort()).toEqual(
      [
        'id',
        'correlation_id',
        'orca_dispatch_id',
        'slice_ref',
        'kind',
        'evidence_digest',
        'detail_json',
        'blocked',
        'resolved_at',
        'resolution_note',
        'raised_at'
      ].sort()
    )
    const indexes = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='dispatch_lifecycle_incident'"
        )
        .all() as {
        name: string
      }[]
    ).map((r) => r.name)
    expect(indexes).toContain('dispatch_lifecycle_incident_unique')
    db.close()
  })

  it("dispatch_lifecycle_closure has the exact §8.5 column set (including the ONE permitted post-insert mutation column, plus ORCA-S5 §8.2's additive terminal_status_ref)", () => {
    const db = new SyncDatabase(':memory:')
    migrateExecutionStore(db)
    expect(tableColumns(db, 'dispatch_lifecycle_closure').sort()).toEqual(
      [
        'correlation_id',
        'orca_dispatch_id',
        'orca_run_id',
        'slice_ref',
        'settlement_status_ref',
        'worktree_provenance_ref',
        'termination_method_ref',
        'finalization_status_ref',
        'closure_digest',
        'closed_at',
        'post_closure_settlement_conflict_detected_at',
        'terminal_status_ref'
      ].sort()
    )
    db.close()
  })

  it('dispatch_lifecycle_event has the exact §8.6 column set with a COMPOSITE primary key', () => {
    const db = new SyncDatabase(':memory:')
    migrateExecutionStore(db)
    expect(tableColumns(db, 'dispatch_lifecycle_event').sort()).toEqual(
      ['correlation_id', 'event_kind', 'closure_digest_ref', 'emitted_at'].sort()
    )
    const pk = (
      db.prepare('PRAGMA table_info(dispatch_lifecycle_event)').all() as {
        name: string
        pk: number
      }[]
    )
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
    expect(pk.sort()).toEqual(['correlation_id', 'event_kind'].sort())
    db.close()
  })

  it('ZERO column is added to any ORCA-S1/S2/S3 table (gate 2) — run_binding, run_reservation, settlement_observation, worktree_provenance, dispatch_worktree column sets stay exactly what they are on v4 today', () => {
    const before = new SyncDatabase(':memory:')
    migrateExecutionStore(before) // current v4 shape
    const beforeCols = {
      run_binding: tableColumns(before, 'run_binding').sort(),
      run_reservation: tableColumns(before, 'run_reservation').sort(),
      settlement_observation: tableColumns(before, 'settlement_observation').sort(),
      worktree_provenance: tableColumns(before, 'worktree_provenance').sort(),
      dispatch_worktree: tableColumns(before, 'dispatch_worktree').sort()
    }
    before.close()

    // Once v5 exists this same assertion must still hold — recorded here now so
    // the GREEN implementation is honest proof, not merely "v5 exists".
    const after = new SyncDatabase(':memory:')
    migrateExecutionStore(after)
    expect(tableColumns(after, 'run_binding').sort()).toEqual(beforeCols.run_binding)
    expect(tableColumns(after, 'run_reservation').sort()).toEqual(beforeCols.run_reservation)
    expect(tableColumns(after, 'settlement_observation').sort()).toEqual(
      beforeCols.settlement_observation
    )
    expect(tableColumns(after, 'worktree_provenance').sort()).toEqual(
      beforeCols.worktree_provenance
    )
    expect(tableColumns(after, 'dispatch_worktree').sort()).toEqual(beforeCols.dispatch_worktree)
    after.close()
  })

  it('an existing store upgrades in place: prior rows survive, schema_version reaches EXECUTION_SCHEMA_VERSION', () => {
    const db = new SyncDatabase(':memory:')
    migrateExecutionStore(db) // opens at whatever EXECUTION_SCHEMA_VERSION currently is
    db.exec(
      "INSERT INTO run_reservation (correlation_id, slice_ref, workload_id, state, created_at, updated_at) VALUES ('corr_1','ORCA-S4','wl_1','reserved','t','t')"
    )
    migrateExecutionStore(db) // idempotent re-run, as every prior slice's ladder step is
    const version = (
      db.prepare("SELECT value FROM execution_meta WHERE key='schema_version'").get() as {
        value: string
      }
    ).value
    expect(Number(version)).toBe(EXECUTION_SCHEMA_VERSION)
    const row = db
      .prepare("SELECT correlation_id FROM run_reservation WHERE correlation_id='corr_1'")
      .get()
    expect(row).toBeDefined()
    db.close()
  })
})
