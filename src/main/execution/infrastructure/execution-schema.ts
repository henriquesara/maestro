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
//
// ORCA-S4 (§8): schema v4 → v5 — SIX NEW TABLES (dispatch_process_binding,
// dispatch_termination, worktree_finalization, dispatch_lifecycle_incident,
// dispatch_lifecycle_closure, dispatch_lifecycle_event) + their indexes. Zero
// column added to any ORCA-S1/S2/S3 table.

export const EXECUTION_SCHEMA_VERSION = 5

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
 * REFERENCES run_reservation(correlation_id) per SPEC §7 — standalone store
 * tests disable enforcement with `PRAGMA foreign_keys = OFF`, same as
 * settlement_observation / settlement_incident's own tests.
 */
export const DISPATCH_WORKTREE_SQL = `
CREATE TABLE IF NOT EXISTS dispatch_worktree (
  orca_dispatch_id  TEXT PRIMARY KEY,
  correlation_id    TEXT NOT NULL REFERENCES run_reservation(correlation_id),
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
  correlation_id      TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
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
CREATE UNIQUE INDEX IF NOT EXISTS worktree_provenance_incident_unique
  ON worktree_provenance_incident(correlation_id, kind, evidence_digest);
CREATE INDEX IF NOT EXISTS worktree_provenance_incident_by_slice
  ON worktree_provenance_incident(slice_ref);
`

/**
 * ORCA-S4 §8 — the six new S4 tables + indexes. Kept as its own constant, same
 * discipline as SETTLEMENT_PROJECTION_SQL / WORKTREE_PROVENANCE_PROJECTION_SQL,
 * so the projection rebuild (§8.8) recreates EXACTLY the same shape it drops
 * for `dispatch_lifecycle_incident` — the only one of the six classified
 * PROJECTION (§8.0, §8.0.1). The other five are durable SOURCE state and are
 * never touched by a rebuild.
 */
export const DELEGATION_BOUNDARY_LIFECYCLE_SQL = `
CREATE TABLE IF NOT EXISTS dispatch_process_binding (
  orca_dispatch_id  TEXT PRIMARY KEY,
  correlation_id    TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  orca_run_id       TEXT NOT NULL,
  process_nonce     TEXT NOT NULL,
  pid               INTEGER NOT NULL,
  kill_scope        TEXT NOT NULL,
  os_start_marker        TEXT,
  os_start_marker_source TEXT NOT NULL,
  spawned_at        TEXT NOT NULL,
  teardown_requested_at TEXT
);
CREATE INDEX IF NOT EXISTS dispatch_process_binding_by_correlation ON dispatch_process_binding(correlation_id);

CREATE TABLE IF NOT EXISTS dispatch_termination (
  correlation_id      TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id    TEXT NOT NULL,
  termination_method  TEXT NOT NULL,
  exit_code           INTEGER,
  exit_signal         TEXT,
  tree_verified       INTEGER NOT NULL,
  observed_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worktree_finalization (
  correlation_id       TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id     TEXT NOT NULL,
  slice_ref            TEXT NOT NULL,
  eligibility_digest   TEXT NOT NULL,
  intent_recorded_at   TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'intent_recorded',
  finalized_at         TEXT,
  outcome_detail_json  TEXT,
  conflicted_at        TEXT
);

CREATE TABLE IF NOT EXISTS dispatch_lifecycle_incident (
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
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_lifecycle_incident_unique
  ON dispatch_lifecycle_incident(correlation_id, kind, evidence_digest);
CREATE INDEX IF NOT EXISTS dispatch_lifecycle_incident_by_slice
  ON dispatch_lifecycle_incident(slice_ref);

CREATE TABLE IF NOT EXISTS dispatch_lifecycle_closure (
  correlation_id          TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id        TEXT NOT NULL,
  orca_run_id             TEXT NOT NULL,
  slice_ref               TEXT NOT NULL,
  settlement_status_ref   TEXT NOT NULL,
  worktree_provenance_ref TEXT NOT NULL,
  termination_method_ref  TEXT NOT NULL,
  finalization_status_ref TEXT NOT NULL,
  closure_digest          TEXT NOT NULL,
  closed_at               TEXT NOT NULL,
  post_closure_settlement_conflict_detected_at TEXT
);

CREATE TABLE IF NOT EXISTS dispatch_lifecycle_event (
  correlation_id      TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  event_kind          TEXT NOT NULL,
  closure_digest_ref  TEXT NOT NULL,
  emitted_at          TEXT NOT NULL,
  PRIMARY KEY (correlation_id, event_kind)
);
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
    db.exec(DELEGATION_BOUNDARY_LIFECYCLE_SQL)
    const current = readSchemaVersion(db)
    if (current === undefined) {
      db.prepare("INSERT INTO execution_meta (key, value) VALUES ('schema_version', ?)").run(
        String(EXECUTION_SCHEMA_VERSION)
      )
    } else if (current < EXECUTION_SCHEMA_VERSION) {
      // The v2->v3, v3->v4, and v4->v5 steps are all only "ensure the new
      // tables + indexes exist" — done by the CREATE statements above, because
      // none of S2/S3/S4 adds a column and therefore none needs an ALTER TABLE.
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
