import type SyncDatabase from '../../sqlite/sync-database'

// Execution bounded context — infrastructure. The Execution-owned migration.
// Standalone from every other schema in the fork. run_reservation /
// run_binding / parity_observation / workload_exclusion belong to this context
// (amendment §L, §P.13; run_reservation added by amendment 001 §5 / blocker B2).
//
// ORCA-S2 (§11): schema v2 → v3 — NEW TABLES ONLY (settlement_observation,
// settlement_incident). No column added to any ORCA-S1 table. The versioned
// upgrade ladder (version compare + explicit bump) is defined now even though v3
// needs no ALTER, so a later v4 has a real ladder to extend.
//
// ORCA-S3 (§7, SPEC-AMENDMENT-001 §6): schema v3 → v4 — THREE NEW TABLES
// (dispatch_worktree, worktree_provenance, worktree_provenance_incident) + their
// indexes. Zero column added to any ORCA-S1/S2 table.

export const EXECUTION_SCHEMA_VERSION = 4

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS run_reservation (
  correlation_id        TEXT PRIMARY KEY,
  slice_ref             TEXT NOT NULL,
  authoritative_run_ref TEXT,
  workload_id           TEXT NOT NULL,
  state                 TEXT NOT NULL,
  orca_run_id           TEXT,
  orca_dispatch_id      TEXT,
  org_task_id           TEXT,
  candidate_head        TEXT,
  last_error            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_reservation_by_slice_state ON run_reservation(slice_ref, state);
-- At most one NON-abandoned reservation per (slice, authoritative row, workload):
-- a re-run after an abandoned reservation gets a fresh row + correlation id.
CREATE UNIQUE INDEX IF NOT EXISTS run_reservation_authoritative_workload
  ON run_reservation(slice_ref, authoritative_run_ref, workload_id)
  WHERE state != 'abandoned';

CREATE TABLE IF NOT EXISTS run_binding (
  orca_dispatch_id        TEXT PRIMARY KEY,
  correlation_id          TEXT NOT NULL UNIQUE REFERENCES run_reservation(correlation_id),
  governance_agent_run_id TEXT NOT NULL,
  aicontrol_run_id        TEXT,
  orca_run_id             TEXT NOT NULL,
  org_task_id             TEXT NOT NULL,
  slice_ref               TEXT NOT NULL,
  base_commit             TEXT NOT NULL,
  candidate_head          TEXT,
  bound_at                TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS run_binding_aicontrol_run_unique
  ON run_binding(aicontrol_run_id) WHERE aicontrol_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS run_binding_by_slice ON run_binding(slice_ref);

CREATE TABLE IF NOT EXISTS parity_observation (
  id                       TEXT PRIMARY KEY,
  run_binding_dispatch_id  TEXT NOT NULL REFERENCES run_binding(orca_dispatch_id),
  slice_ref                TEXT NOT NULL,
  workload_id              TEXT NOT NULL,
  authoritative_json       TEXT NOT NULL,
  shadow_json              TEXT NOT NULL,
  parity_json              TEXT NOT NULL,
  adjudications_json       TEXT NOT NULL,
  observed_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS parity_observation_by_slice ON parity_observation(slice_ref);

CREATE TABLE IF NOT EXISTS workload_exclusion (
  id           TEXT PRIMARY KEY,
  slice_ref    TEXT NOT NULL,
  workload_id  TEXT NOT NULL,
  code         TEXT NOT NULL,
  reason       TEXT NOT NULL,
  excluded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workload_exclusion_by_slice ON workload_exclusion(slice_ref);

CREATE TABLE IF NOT EXISTS execution_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/**
 * ORCA-S2 v3 — the two new tables + indexes (§11.1). Kept as a separate constant
 * so the settlement-projection rebuild (§17) recreates EXACTLY the same shape it
 * drops — one source of truth, no drift.
 */
export const SETTLEMENT_PROJECTION_SQL = `
CREATE TABLE IF NOT EXISTS settlement_observation (
  correlation_id               TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id             TEXT NOT NULL,
  orca_run_id                  TEXT NOT NULL,
  org_task_id                  TEXT NOT NULL,
  slice_ref                    TEXT NOT NULL,
  status                       TEXT NOT NULL DEFAULT 'observed',
  source_dispatch_status       TEXT NOT NULL,
  source_dispatch_completed_at TEXT,
  source_task_status           TEXT NOT NULL,
  source_task_completed_at     TEXT,
  source_digest                TEXT NOT NULL,
  observed_outcome_json        TEXT NOT NULL,
  provenance_json              TEXT NOT NULL,
  first_seen_at                TEXT NOT NULL,
  observed_at                  TEXT NOT NULL,
  conflicted_at                TEXT
);
CREATE INDEX IF NOT EXISTS settlement_observation_by_slice ON settlement_observation(slice_ref);

CREATE TABLE IF NOT EXISTS settlement_incident (
  id               TEXT PRIMARY KEY,
  correlation_id   TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  orca_dispatch_id TEXT,
  slice_ref        TEXT NOT NULL,
  kind             TEXT NOT NULL,
  evidence_digest  TEXT NOT NULL,
  detail_json      TEXT NOT NULL,
  blocked          INTEGER NOT NULL DEFAULT 1,
  resolved_at      TEXT,
  resolution_note  TEXT,
  raised_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS settlement_incident_unique
  ON settlement_incident(correlation_id, kind, evidence_digest);
CREATE INDEX IF NOT EXISTS settlement_incident_by_slice ON settlement_incident(slice_ref);
`

/**
 * ORCA-S3 §7.2 — dispatch_worktree is durable SOURCE state (never rebuilt,
 * §7.5, PROV-11): the row is written once, at bind time, in the same
 * transaction as run_binding. Kept as its own constant so the S3 sqlite store
 * can defensively re-ensure it exists (never touched by the projection
 * rebuild, unlike SETTLEMENT_PROJECTION_SQL / WORKTREE_PROVENANCE_PROJECTION_SQL).
 * No REFERENCES run_reservation — unit-level store tests exercise this table
 * standalone, without a parent reservation row; the composition-boundary
 * always inserts it alongside run_binding within one already-referenced tree.
 */
export const DISPATCH_WORKTREE_SQL = `
CREATE TABLE IF NOT EXISTS dispatch_worktree (
  orca_dispatch_id  TEXT PRIMARY KEY,
  correlation_id    TEXT NOT NULL,
  orca_run_id       TEXT NOT NULL,
  worktree_nonce    TEXT NOT NULL,
  worktree_path     TEXT NOT NULL,
  root_ref          TEXT NOT NULL,
  opened_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dispatch_worktree_by_correlation ON dispatch_worktree(correlation_id);
`

/**
 * ORCA-S3 §7.1 / §7.3, SPEC-AMENDMENT-001 §3 — the two S3-owned PROJECTION
 * tables (worktree_provenance, worktree_provenance_incident). Kept as one
 * source of truth so the provenance-projection rebuild (§7.5) recreates
 * EXACTLY the same shape it drops.
 */
export const WORKTREE_PROVENANCE_PROJECTION_SQL = `
CREATE TABLE IF NOT EXISTS worktree_provenance (
  correlation_id      TEXT PRIMARY KEY,
  orca_dispatch_id    TEXT NOT NULL,
  orca_run_id         TEXT NOT NULL,
  slice_ref           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'recorded',
  base_commit         TEXT NOT NULL,
  candidate_head      TEXT NOT NULL,
  files_changed_json  TEXT NOT NULL,
  provenance_source   TEXT NOT NULL,
  worktree_path_ref   TEXT NOT NULL,
  provenance_digest   TEXT NOT NULL,
  provenance_json     TEXT NOT NULL,
  first_seen_at       TEXT NOT NULL,
  observed_at         TEXT NOT NULL,
  conflicted_at       TEXT
);
CREATE INDEX IF NOT EXISTS worktree_provenance_by_slice ON worktree_provenance(slice_ref);

CREATE TABLE IF NOT EXISTS worktree_provenance_incident (
  id               TEXT PRIMARY KEY,
  correlation_id   TEXT NOT NULL,
  orca_dispatch_id TEXT,
  slice_ref        TEXT NOT NULL,
  kind             TEXT NOT NULL,
  evidence_digest  TEXT NOT NULL,
  detail_json      TEXT NOT NULL,
  blocked          INTEGER NOT NULL DEFAULT 1,
  resolved_at      TEXT,
  resolution_note  TEXT,
  raised_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS worktree_provenance_incident_unique
  ON worktree_provenance_incident(correlation_id, kind, evidence_digest);
CREATE INDEX IF NOT EXISTS worktree_provenance_incident_by_slice
  ON worktree_provenance_incident(slice_ref);
`

function readSchemaVersion(db: SyncDatabase): number | undefined {
  const row = db.prepare("SELECT value FROM execution_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined
  return row ? Number(row.value) : undefined
}

/**
 * §11.1 / ORCA-S3 §7 — versioned upgrade. Idempotent and transactional. An
 * existing store opens, keeps every prior row untouched, and gains any table
 * introduced by a newer schema version; a store upgraded to the current
 * version and a freshly created store at that version are structurally
 * identical.
 */
export function migrateExecutionStore(db: SyncDatabase): void {
  const alreadyInTransaction = db.isTransaction
  if (!alreadyInTransaction) {
    db.exec('BEGIN IMMEDIATE')
  }
  try {
    db.exec(CREATE_SQL)
    db.exec(SETTLEMENT_PROJECTION_SQL)
    db.exec(DISPATCH_WORKTREE_SQL)
    db.exec(WORKTREE_PROVENANCE_PROJECTION_SQL)
    const current = readSchemaVersion(db)
    if (current === undefined) {
      db.prepare("INSERT INTO execution_meta (key, value) VALUES ('schema_version', ?)").run(
        String(EXECUTION_SCHEMA_VERSION)
      )
    } else if (current < EXECUTION_SCHEMA_VERSION) {
      // Both the v2->v3 and v3->v4 steps are only "ensure the new tables +
      // indexes exist" — done by the CREATE statements above, because neither
      // S2 nor S3 adds a column and therefore neither needs an ALTER TABLE.
      db.prepare("UPDATE execution_meta SET value = ? WHERE key = 'schema_version'").run(
        String(EXECUTION_SCHEMA_VERSION)
      )
    }
    if (!alreadyInTransaction) {
      db.exec('COMMIT')
    }
  } catch (error) {
    if (!alreadyInTransaction) {
      db.exec('ROLLBACK')
    }
    throw error
  }
}
