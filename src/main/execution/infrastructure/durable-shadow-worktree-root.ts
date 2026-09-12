import { existsSync } from 'node:fs'
import type SyncDatabase from '../../sqlite/sync-database'

// Execution bounded context — infrastructure. §10 (B4 — retention-by-storage-
// boundary). Mirrors `durable-shadow-orchestration-path.ts` (S2 §17): resolve +
// persist the ONE durable, out-of-DisposableShadowRoot shadow-worktree root
// path in the EXISTING execution_meta table (no new column), fail closed on
// drift or an unexplained loss.

export const DURABLE_SHADOW_WORKTREE_ROOT_KEY = 'durable_shadow_worktree_root'

export class DurableShadowWorktreeRootMismatchError extends Error {
  constructor(configured: string, persisted: string) {
    super(
      `configured durable shadow-worktree root "${configured}" != persisted "${persisted}" — refusing to silently move it`
    )
    this.name = 'DurableShadowWorktreeRootMismatchError'
  }
}

export class DurableShadowWorktreeRootMissingError extends Error {
  constructor(path: string) {
    super(
      `durable shadow-worktree root "${path}" is missing but dispatch_worktree history exists — refusing to silently create a replacement`
    )
    this.name = 'DurableShadowWorktreeRootMissingError'
  }
}

function persistedDurableShadowWorktreeRoot(execDb: SyncDatabase): string | undefined {
  const row = execDb
    .prepare('SELECT value FROM execution_meta WHERE key = ?')
    .get(DURABLE_SHADOW_WORKTREE_ROOT_KEY) as { value: string } | undefined
  return row?.value
}

function hasDispatchWorktreeHistory(execDb: SyncDatabase): boolean {
  const row = execDb.prepare('SELECT 1 FROM dispatch_worktree LIMIT 1').get()
  return row !== undefined
}

function persistPath(execDb: SyncDatabase, path: string): void {
  execDb
    .prepare(
      `INSERT INTO execution_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(DURABLE_SHADOW_WORKTREE_ROOT_KEY, path)
}

/**
 * §10 — resolve + re-verify the durable shadow-worktree root path, failing
 * closed. Returns the path to use.
 *
 * - first-init (key absent, no dispatch_worktree history): persist the configured path.
 * - key absent, configured missing, history present: DurableShadowWorktreeRootMissingError.
 * - key present, configured != persisted: DurableShadowWorktreeRootMismatchError.
 * - key present, root missing, history present: DurableShadowWorktreeRootMissingError (NO replacement).
 * - key present, root present (or no history yet): continue.
 */
export function resolveDurableShadowWorktreeRoot(
  execDb: SyncDatabase,
  configuredRoot: string
): string {
  const persisted = persistedDurableShadowWorktreeRoot(execDb)

  if (persisted === undefined) {
    if (!existsSync(configuredRoot) && hasDispatchWorktreeHistory(execDb)) {
      throw new DurableShadowWorktreeRootMissingError(configuredRoot)
    }
    persistPath(execDb, configuredRoot)
    return configuredRoot
  }

  if (persisted !== configuredRoot) {
    throw new DurableShadowWorktreeRootMismatchError(configuredRoot, persisted)
  }

  if (!existsSync(persisted) && hasDispatchWorktreeHistory(execDb)) {
    throw new DurableShadowWorktreeRootMissingError(persisted)
  }

  return persisted
}
