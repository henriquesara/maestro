import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import {
  DurableShadowWorktreeRootMismatchError,
  DurableShadowWorktreeRootMissingError,
  DURABLE_SHADOW_WORKTREE_ROOT_KEY,
  resolveDurableShadowWorktreeRoot
} from './durable-shadow-worktree-root'
import { migrateExecutionStore } from './execution-schema'

// ORCA-S3 §10 (B4 — retention-by-storage-boundary) — mirrors
// `durable-shadow-orchestration-path.ts` (S2 §17): resolve + persist the ONE
// durable, out-of-DisposableShadowRoot shadow-worktree root path in the
// EXISTING execution_meta table (no new column), fail closed on drift. RED:
// `./durable-shadow-worktree-root` does not exist yet.

describe('resolveDurableShadowWorktreeRoot (§10)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort */
      }
    }
  })
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'orca-s3-root-'))
    dirs.push(d)
    return d
  }
  function openExecDb(): { db: SyncDatabase; dir: string } {
    const dir = tmp()
    const db = new SyncDatabase(join(dir, 'exec.db'))
    // No parent run_reservation row is seeded — matches the established S2
    // harness pattern (settlement-test-harness.ts) for standalone store tests.
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return { db, dir }
  }

  it('first init — no persisted key, no prior dispatch_worktree history: persists the configured path', () => {
    const { db, dir } = openExecDb()
    const configured = join(dir, 'durable-shadow-root')
    mkdirSync(configured, { recursive: true })
    const resolved = resolveDurableShadowWorktreeRoot(db, configured)
    expect(resolved).toBe(configured)
    const row = db
      .prepare('SELECT value FROM execution_meta WHERE key = ?')
      .get(DURABLE_SHADOW_WORKTREE_ROOT_KEY)
    expect(row).toEqual({ value: configured })
  })

  it('key present, configured matches persisted: returns the path', () => {
    const { db, dir } = openExecDb()
    const configured = join(dir, 'durable-shadow-root')
    mkdirSync(configured, { recursive: true })
    resolveDurableShadowWorktreeRoot(db, configured)
    expect(resolveDurableShadowWorktreeRoot(db, configured)).toBe(configured)
  })

  it('key present, configured != persisted: fails closed with DurableShadowWorktreeRootMismatchError', () => {
    const { db, dir } = openExecDb()
    const first = join(dir, 'root-a')
    mkdirSync(first, { recursive: true })
    resolveDurableShadowWorktreeRoot(db, first)
    const second = join(dir, 'root-b')
    mkdirSync(second, { recursive: true })
    expect(() => resolveDurableShadowWorktreeRoot(db, second)).toThrow(
      DurableShadowWorktreeRootMismatchError
    )
  })

  it('key absent, configured path missing, but dispatch_worktree history exists: refuses to silently create a replacement root', () => {
    const { db, dir } = openExecDb()
    db.prepare(
      `INSERT INTO dispatch_worktree (orca_dispatch_id, correlation_id, orca_run_id, worktree_nonce, worktree_path, root_ref, opened_at)
       VALUES ('ctx_1', 'corr_1', 'run_1', 'nonce_1', '/gone/shadow-corr_1', 'root_gen_0', '2026-09-12T00:00:00Z')`
    ).run()
    const missingConfigured = join(dir, 'never-created')
    expect(() => resolveDurableShadowWorktreeRoot(db, missingConfigured)).toThrow(
      DurableShadowWorktreeRootMissingError
    )
  })

  it('key present, root directory missing, dispatch_worktree history exists: fails closed, no replacement', () => {
    const { db, dir } = openExecDb()
    const configured = join(dir, 'root-to-vanish')
    mkdirSync(configured, { recursive: true })
    resolveDurableShadowWorktreeRoot(db, configured)
    db.prepare(
      `INSERT INTO dispatch_worktree (orca_dispatch_id, correlation_id, orca_run_id, worktree_nonce, worktree_path, root_ref, opened_at)
       VALUES ('ctx_1', 'corr_1', 'run_1', 'nonce_1', '${join(configured, 'shadow-corr_1').replace(/\\/g, '\\\\')}', 'root_gen_1', '2026-09-12T00:00:00Z')`
    ).run()
    rmSync(configured, { recursive: true, force: true })
    expect(() => resolveDurableShadowWorktreeRoot(db, configured)).toThrow(
      DurableShadowWorktreeRootMissingError
    )
  })

  it('is idempotent across repeated resolves with no history and no directory yet (a first-run-before-any-bind race)', () => {
    const { db, dir } = openExecDb()
    const configured = join(dir, 'root-lazy')
    const a = resolveDurableShadowWorktreeRoot(db, configured)
    const b = resolveDurableShadowWorktreeRoot(db, configured)
    expect(a).toBe(configured)
    expect(b).toBe(configured)
  })
})
