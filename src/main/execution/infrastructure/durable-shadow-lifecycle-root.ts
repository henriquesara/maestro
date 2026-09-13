import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type SyncDatabase from '../../sqlite/sync-database'
import type { ProcessIdentitySidecar } from '../domain/dispatch-process-binding'

// Execution bounded context — infrastructure. ORCA-S4 SPEC §9.2 — resolve +
// persist the ONE durable shadow-lifecycle root (the process identity sidecar
// home), mirroring `durable-shadow-worktree-root.ts` (§10) exactly: same
// execution_meta persistence discipline, same fail-closed drift/loss handling.
// No new top-level durable root is invented beyond this — see SPEC §9.2.

export const DURABLE_SHADOW_LIFECYCLE_ROOT_KEY = 'durable_shadow_lifecycle_root'

export class DurableShadowLifecycleRootMismatchError extends Error {
  constructor(configured: string, persisted: string) {
    super(
      `configured durable shadow-lifecycle root "${configured}" != persisted "${persisted}" — refusing to silently move it`
    )
    this.name = 'DurableShadowLifecycleRootMismatchError'
  }
}

export class DurableShadowLifecycleRootMissingError extends Error {
  constructor(path: string) {
    super(
      `durable shadow-lifecycle root "${path}" is missing but dispatch_process_binding history exists — refusing to silently create a replacement`
    )
    this.name = 'DurableShadowLifecycleRootMissingError'
  }
}

function persistedDurableShadowLifecycleRoot(execDb: SyncDatabase): string | undefined {
  const row = execDb
    .prepare('SELECT value FROM execution_meta WHERE key = ?')
    .get(DURABLE_SHADOW_LIFECYCLE_ROOT_KEY) as { value: string } | undefined
  return row?.value
}

function hasProcessBindingHistory(execDb: SyncDatabase): boolean {
  const row = execDb.prepare('SELECT 1 FROM dispatch_process_binding LIMIT 1').get()
  return row !== undefined
}

function persistPath(execDb: SyncDatabase, path: string): void {
  execDb
    .prepare(
      `INSERT INTO execution_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(DURABLE_SHADOW_LIFECYCLE_ROOT_KEY, path)
}

/** §9.2 — resolve + re-verify the durable shadow-lifecycle root path, failing closed. */
export function resolveDurableShadowLifecycleRoot(execDb: SyncDatabase, configuredRoot: string): string {
  const persisted = persistedDurableShadowLifecycleRoot(execDb)

  if (persisted === undefined) {
    if (!existsSync(configuredRoot) && hasProcessBindingHistory(execDb)) {
      throw new DurableShadowLifecycleRootMissingError(configuredRoot)
    }
    persistPath(execDb, configuredRoot)
    return configuredRoot
  }

  if (persisted !== configuredRoot) {
    throw new DurableShadowLifecycleRootMismatchError(configuredRoot, persisted)
  }

  if (!existsSync(persisted) && hasProcessBindingHistory(execDb)) {
    throw new DurableShadowLifecycleRootMissingError(persisted)
  }

  return persisted
}

export function processIdentitySidecarPath(durableShadowLifecycleRoot: string, orcaDispatchId: string): string {
  return join(durableShadowLifecycleRoot, 'process', `${orcaDispatchId}.json`)
}

/** §9.2 step 3 — atomic temp-file + rename, within the same durable root. No Git command. */
export function writeProcessIdentitySidecarAtomically(
  durableShadowLifecycleRoot: string,
  orcaDispatchId: string,
  identity: ProcessIdentitySidecar
): void {
  const processDir = join(durableShadowLifecycleRoot, 'process')
  mkdirSync(processDir, { recursive: true })
  const finalPath = processIdentitySidecarPath(durableShadowLifecycleRoot, orcaDispatchId)
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, JSON.stringify(identity))
  renameSync(tmpPath, finalPath)
}

export function readProcessIdentitySidecar(
  durableShadowLifecycleRoot: string,
  orcaDispatchId: string
): ProcessIdentitySidecar | undefined {
  try {
    const raw = readFileSync(processIdentitySidecarPath(durableShadowLifecycleRoot, orcaDispatchId), 'utf8')
    return JSON.parse(raw) as ProcessIdentitySidecar
  } catch {
    return undefined
  }
}
