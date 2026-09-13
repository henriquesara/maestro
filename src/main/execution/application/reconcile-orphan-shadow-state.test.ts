import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from '../infrastructure/execution-schema'
import { SqliteDispatchProcessBindingStore } from '../infrastructure/sqlite-dispatch-process-binding-store'
import { SqliteDispatchWorktreeStore } from '../infrastructure/sqlite-dispatch-worktree-store'
import { reconcileOrphanShadowState } from './reconcile-orphan-shadow-state'

// ORCA-S4 SPEC §10.3, §12 window L7, gate 10 — two orphan classes, NEITHER ever
// received a committed Execution-store row. Both are audit-logged only,
// governed by a bounded grace period and identity re-verification. RED:
// `./reconcile-orphan-shadow-state` does not exist yet.

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s4-orphan-'))
  const durableRoot = join(dir, 'durable-shadow-root')
  const db = new SyncDatabase(join(dir, 'exec.db'))
  db.pragma('foreign_keys = OFF')
  migrateExecutionStore(db)
  return {
    dir,
    durableRoot,
    db,
    dispatchWorktrees: new SqliteDispatchWorktreeStore(db),
    processBindings: new SqliteDispatchProcessBindingStore(db)
  }
}

const fakePort = {
  spawn: () => {
    throw new Error('not exercised')
  },
  observe: async () => ({ kind: 'confirmed_dead_unknown_cause' }),
  requestTermination: async () => ({ verified: true }),
  requestTerminationByPid: async () => ({ verified: true })
}

describe('reconcileOrphanShadowState — orphan worktree class (ORCA-S3 windows A-C, §10.3)', () => {
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

  it('a worktree directory younger than orphanGraceMs, with no matching dispatch_worktree row, is NEVER touched (defends against racing an in-flight bind)', async () => {
    const s = setup()
    dirs.push(s.dir)
    const orphanDir = join(s.durableRoot, 'worktrees', 'shadow-corr_orphan')
    mkdirSync(orphanDir, { recursive: true })
    const audit = await reconcileOrphanShadowState(
      { ...s, processPort: fakePort, durableShadowLifecycleRoot: s.durableRoot },
      { orphanGraceMs: 60_000, now: () => new Date().toISOString() }
    )
    expect(existsSync(orphanDir)).toBe(true)
    expect(audit).toHaveLength(0)
  })

  it('a worktree orphan OLDER than orphanGraceMs, with no matching dispatch_worktree row, is safely reaped and logged in the audit list', async () => {
    const s = setup()
    dirs.push(s.dir)
    const orphanDir = join(s.durableRoot, 'worktrees', 'shadow-corr_orphan')
    mkdirSync(orphanDir, { recursive: true })
    writeFileSync(join(orphanDir, 'marker.txt'), 'x')
    const audit = await reconcileOrphanShadowState(
      { ...s, processPort: fakePort, durableShadowLifecycleRoot: s.durableRoot },
      { orphanGraceMs: 0, now: () => new Date(Date.now() + 3_600_000).toISOString() }
    )
    expect(existsSync(orphanDir)).toBe(false)
    expect(audit.some((a) => a.kind === 'orphan_worktree')).toBe(true)
    expect(audit[0]).not.toHaveProperty('path') // fingerprint, never a raw absolute path
  })

  it('never fabricates a durable Execution-store row for a reaped orphan (no correlation_id-keyed row)', async () => {
    const s = setup()
    dirs.push(s.dir)
    const orphanDir = join(s.durableRoot, 'worktrees', 'shadow-corr_orphan')
    mkdirSync(orphanDir, { recursive: true })
    await reconcileOrphanShadowState(
      { ...s, processPort: fakePort, durableShadowLifecycleRoot: s.durableRoot },
      { orphanGraceMs: 0, now: () => new Date(Date.now() + 3_600_000).toISOString() }
    )
    expect(s.dispatchWorktrees.getByCorrelationId('corr_orphan')).toBeUndefined()
  })
})

describe('reconcileOrphanShadowState — orphan process class (S4 window L7, §10.3)', () => {
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

  it('a process identity sidecar with no matching committed dispatch_process_binding row, younger than orphanGraceMs, is NEVER touched', async () => {
    const s = setup()
    dirs.push(s.dir)
    const sidecarDir = join(s.durableRoot, 'process')
    mkdirSync(sidecarDir, { recursive: true })
    const sidecarPath = join(sidecarDir, 'ctx_orphan.json')
    writeFileSync(
      sidecarPath,
      JSON.stringify({
        correlationId: 'corr_orphan',
        orcaRunId: 'run_orphan',
        orcaDispatchId: 'ctx_orphan',
        processNonce: 'nonce_orphan',
        spawnedAt: new Date().toISOString(),
        pid: 999999,
        osStartMarker: '1000',
        osStartMarkerSource: 'posix_proc_stat_starttime'
      })
    )
    await reconcileOrphanShadowState(
      { ...s, processPort: fakePort, durableShadowLifecycleRoot: s.durableRoot },
      { orphanGraceMs: 60_000, now: () => new Date().toISOString() }
    )
    expect(existsSync(sidecarPath)).toBe(true)
  })

  it('a sidecar orphan OLDER than orphanGraceMs: identity is re-verified FROM THE SIDECAR ALONE (never requiring a committed DB row), then reaped and logged', async () => {
    const s = setup()
    dirs.push(s.dir)
    const sidecarDir = join(s.durableRoot, 'process')
    mkdirSync(sidecarDir, { recursive: true })
    const sidecarPath = join(sidecarDir, 'ctx_orphan.json')
    writeFileSync(
      sidecarPath,
      JSON.stringify({
        correlationId: 'corr_orphan',
        orcaRunId: 'run_orphan',
        orcaDispatchId: 'ctx_orphan',
        processNonce: 'nonce_orphan',
        spawnedAt: new Date().toISOString(),
        pid: 999999,
        osStartMarker: '1000',
        osStartMarkerSource: 'posix_proc_stat_starttime'
      })
    )
    const audit = await reconcileOrphanShadowState(
      { ...s, processPort: fakePort, durableShadowLifecycleRoot: s.durableRoot },
      { orphanGraceMs: 0, now: () => new Date(Date.now() + 3_600_000).toISOString() }
    )
    expect(audit.some((a) => a.kind === 'orphan_process')).toBe(true)
    expect(s.processBindings.getByCorrelationId('corr_orphan')).toBeUndefined() // never a fabricated row
  })

  it('identity-unverifiable orphan process (sidecar corrupt) -> skip, log, do NOT touch — an orphan sweep is not exempt from the fail-closed discipline', async () => {
    const s = setup()
    dirs.push(s.dir)
    const sidecarDir = join(s.durableRoot, 'process')
    mkdirSync(sidecarDir, { recursive: true })
    const sidecarPath = join(sidecarDir, 'ctx_corrupt.json')
    writeFileSync(sidecarPath, 'NOT VALID JSON {{{')
    const audit = await reconcileOrphanShadowState(
      { ...s, processPort: fakePort, durableShadowLifecycleRoot: s.durableRoot },
      { orphanGraceMs: 0, now: () => new Date(Date.now() + 3_600_000).toISOString() }
    )
    expect(existsSync(sidecarPath)).toBe(true) // untouched, not deleted blind
    expect(audit.some((a) => a.action === 'skipped_unverifiable')).toBe(true)
  })
})
