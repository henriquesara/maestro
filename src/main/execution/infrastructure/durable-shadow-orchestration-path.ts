import { existsSync } from 'node:fs'
import type SyncDatabase from '../../sqlite/sync-database'
import { SETTLEMENT_PROJECTION_SQL } from './execution-schema'
import {
  ShadowSettlementSourceMissingError,
  ShadowSourcePathMismatchError
} from './shadow-settlement-source-errors'

// Execution bounded context — infrastructure. ORCA-S2 §17 — the ONE stable
// durable shadow orchestration.db for this Maestro shadow-migration environment.
// It lives OUTSIDE DisposableShadowRoot; its canonical configured absolute path is
// persisted in the EXISTING execution_meta key/value table (no new column) and
// re-verified on every startup. Rollback / settlement-projection rebuild never
// auto-delete it.

export const SHADOW_ORCHESTRATION_PATH_KEY = 'shadow_orchestration_path'

export function persistedShadowOrchestrationPath(execDb: SyncDatabase): string | undefined {
  const row = execDb
    .prepare('SELECT value FROM execution_meta WHERE key = ?')
    .get(SHADOW_ORCHESTRATION_PATH_KEY) as { value: string } | undefined
  return row?.value
}

function hasDurableBindingsOrHistory(execDb: SyncDatabase): boolean {
  const b = execDb.prepare('SELECT 1 FROM run_binding LIMIT 1').get()
  if (b !== undefined) {
    return true
  }
  const r = execDb.prepare('SELECT 1 FROM run_reservation LIMIT 1').get()
  return r !== undefined
}

function persistPath(execDb: SyncDatabase, path: string): void {
  execDb
    .prepare(
      `INSERT INTO execution_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(SHADOW_ORCHESTRATION_PATH_KEY, path)
}

/**
 * §17 — resolve + re-verify the durable shadow orchestration.db path, failing
 * closed. Returns the path to use; the caller opens the writer / read-only reader.
 *
 * - first-init (key absent, empty env): persist the configured path BEFORE first use.
 * - key absent, history present, file missing: ShadowSettlementSourceMissingError.
 * - key present, configured != persisted: ShadowSourcePathMismatchError.
 * - key present, file missing, history present: ShadowSettlementSourceMissingError (NO replacement).
 * - key present, file present: continue.
 */
export function resolveDurableShadowOrchestrationPath(
  execDb: SyncDatabase,
  configuredPath: string
): string {
  const persisted = persistedShadowOrchestrationPath(execDb)

  if (persisted === undefined) {
    if (!existsSync(configuredPath) && hasDurableBindingsOrHistory(execDb)) {
      // The env already produced durable bindings but the configured DB is not
      // there — do NOT silently create a replacement.
      throw new ShadowSettlementSourceMissingError(configuredPath)
    }
    persistPath(execDb, configuredPath)
    return configuredPath
  }

  if (persisted !== configuredPath) {
    throw new ShadowSourcePathMismatchError(configuredPath, persisted)
  }

  if (!existsSync(persisted) && hasDurableBindingsOrHistory(execDb)) {
    throw new ShadowSettlementSourceMissingError(persisted)
  }

  return persisted
}

/**
 * §17 — settlement-projection rebuild: drop and recreate ONLY the two S2-owned
 * projection tables. run_binding, run_reservation, parity_observation,
 * workload_exclusion, execution_meta (incl. shadow_orchestration_path) and the
 * durable shadow orchestration.db file itself are all preserved.
 */
export function rebuildSettlementProjection(execDb: SyncDatabase): void {
  execDb.exec(
    `DROP TABLE IF EXISTS settlement_incident;
     DROP TABLE IF EXISTS settlement_observation;
     ${SETTLEMENT_PROJECTION_SQL}`
  )
}
