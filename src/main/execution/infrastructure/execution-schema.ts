import type SyncDatabase from '../../sqlite/sync-database'

// Execution bounded context — infrastructure. The Execution-owned migration.
// Standalone from every other schema in the fork. `run_binding` / `parity_observation`
// / `workload_exclusion` belong to this context (amendment §L, §P.13).

export const EXECUTION_SCHEMA_VERSION = 1

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS run_binding (
  orca_dispatch_id       TEXT PRIMARY KEY,
  governance_agent_run_id TEXT NOT NULL,
  aicontrol_run_id       TEXT,
  orca_run_id            TEXT NOT NULL,
  org_task_id            TEXT NOT NULL,
  slice_ref              TEXT NOT NULL,
  base_commit            TEXT NOT NULL,
  candidate_head         TEXT,
  bound_at               TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS run_binding_aicontrol_run_unique
  ON run_binding(aicontrol_run_id) WHERE aicontrol_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS run_binding_by_slice ON run_binding(slice_ref);

CREATE TABLE IF NOT EXISTS parity_observation (
  id                       TEXT PRIMARY KEY,
  run_binding_dispatch_id  TEXT NOT NULL REFERENCES run_binding(orca_dispatch_id),
  slice_ref                TEXT NOT NULL,
  authoritative_json       TEXT NOT NULL,
  shadow_json              TEXT NOT NULL,
  parity_json              TEXT NOT NULL,
  root_cause               TEXT,
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

export function migrateExecutionStore(db: SyncDatabase): void {
  db.exec(CREATE_SQL)
  const row = db.prepare("SELECT value FROM execution_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined
  if (!row) {
    db.prepare("INSERT INTO execution_meta (key, value) VALUES ('schema_version', ?)").run(
      String(EXECUTION_SCHEMA_VERSION)
    )
  }
}
