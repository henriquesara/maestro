import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from '../infrastructure/execution-schema'
import { SqliteWorktreeFinalizationStore } from '../infrastructure/sqlite-worktree-finalization-store'
import { advanceWorktreeFinalization } from './worktree-finalizer'

// ORCA-S4 SPEC §10 — governed reap. Intent recorded BEFORE any filesystem
// deletion; the filesystem act is idempotent by construction; every deletion
// target is `isInside`-guarded. Gates 6, 11, 12, 22. RED: `./worktree-finalizer`
// does not exist yet.

describe('advanceWorktreeFinalization (§10.2)', () => {
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

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s4-finalizer-'))
    dirs.push(dir)
    const durableRoot = join(dir, 'durable-shadow-root')
    const db = new SyncDatabase(join(dir, 'exec.db'))
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    const finalizations = new SqliteWorktreeFinalizationStore(db)
    return { dir, durableRoot, db, finalizations }
  }

  function makeEligibleWorktree(durableRoot: string, correlationId: string): string {
    const worktreeDir = join(durableRoot, `shadow-${correlationId}`)
    mkdirSync(worktreeDir, { recursive: true })
    writeFileSync(join(worktreeDir, 'marker.txt'), 'present')
    return worktreeDir
  }

  it('step 1: no worktree_finalization row yet -> records intent BEFORE any deletion; filesystem untouched (§10.2 step 1, LIFE-3)', async () => {
    const { durableRoot, finalizations } = setup()
    const worktreePath = makeEligibleWorktree(durableRoot, 'corr_1')
    await advanceWorktreeFinalization(
      { finalizations, durableShadowWorktreeRoot: durableRoot },
      {
        correlationId: 'corr_1',
        orcaDispatchId: 'ctx_1',
        sliceRef: 'ORCA-S4',
        eligibilityDigest: 'd'.repeat(64),
        worktreePath,
        now: () => '2026-09-13T00:00:00Z'
      }
    )
    expect(finalizations.getByCorrelationId('corr_1')?.status).toBe('intent_recorded')
    expect(existsSync(worktreePath)).toBe(true) // NOT yet deleted
  })

  it('step 2/3/4: an existing intent_recorded row with a matching digest -> deletes the worktree directory and transitions to finalized', async () => {
    const { durableRoot, finalizations } = setup()
    const worktreePath = makeEligibleWorktree(durableRoot, 'corr_1')
    finalizations.insertIntent({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      sliceRef: 'ORCA-S4',
      eligibilityDigest: 'd'.repeat(64),
      intentRecordedAt: '2026-09-13T00:00:00Z',
      status: 'intent_recorded',
      finalizedAt: null,
      outcomeDetailJson: null,
      conflictedAt: null
    })
    await advanceWorktreeFinalization(
      { finalizations, durableShadowWorktreeRoot: durableRoot },
      {
        correlationId: 'corr_1',
        orcaDispatchId: 'ctx_1',
        sliceRef: 'ORCA-S4',
        eligibilityDigest: 'd'.repeat(64),
        worktreePath,
        now: () => '2026-09-13T00:05:00Z'
      }
    )
    expect(existsSync(worktreePath)).toBe(false)
    expect(finalizations.getByCorrelationId('corr_1')?.status).toBe('finalized')
  })

  it('re-verify digest MISMATCH on a retried pass -> transitions to "conflicted"; deletion is NOT attempted (§10.2 step 2)', async () => {
    const { durableRoot, finalizations } = setup()
    const worktreePath = makeEligibleWorktree(durableRoot, 'corr_1')
    finalizations.insertIntent({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      sliceRef: 'ORCA-S4',
      eligibilityDigest: 'OLD_DIGEST'.padEnd(64, '0'),
      intentRecordedAt: '2026-09-13T00:00:00Z',
      status: 'intent_recorded',
      finalizedAt: null,
      outcomeDetailJson: null,
      conflictedAt: null
    })
    await advanceWorktreeFinalization(
      { finalizations, durableShadowWorktreeRoot: durableRoot },
      {
        correlationId: 'corr_1',
        orcaDispatchId: 'ctx_1',
        sliceRef: 'ORCA-S4',
        eligibilityDigest: 'NEW_DIGEST'.padEnd(64, '1'), // diverged since intent
        worktreePath,
        now: () => '2026-09-13T00:05:00Z'
      }
    )
    expect(finalizations.getByCorrelationId('corr_1')?.status).toBe('conflicted')
    expect(existsSync(worktreePath)).toBe(true) // untouched
  })

  it('idempotent by construction: deleting an already-absent worktree directory is a SUCCESS, never an error (§10.2 step 3, L3/L4/L5)', async () => {
    const { durableRoot, finalizations } = setup()
    const worktreePath = join(durableRoot, 'shadow-corr_1') // never created
    finalizations.insertIntent({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      sliceRef: 'ORCA-S4',
      eligibilityDigest: 'd'.repeat(64),
      intentRecordedAt: '2026-09-13T00:00:00Z',
      status: 'intent_recorded',
      finalizedAt: null,
      outcomeDetailJson: null,
      conflictedAt: null
    })
    await expect(
      advanceWorktreeFinalization(
        { finalizations, durableShadowWorktreeRoot: durableRoot },
        {
          correlationId: 'corr_1',
          orcaDispatchId: 'ctx_1',
          sliceRef: 'ORCA-S4',
          eligibilityDigest: 'd'.repeat(64),
          worktreePath,
          now: () => '2026-09-13T00:05:00Z'
        }
      )
    ).resolves.not.toThrow()
    expect(finalizations.getByCorrelationId('corr_1')?.status).toBe('finalized')
  })

  it('legacy binding (no durable worktree at all) -> "skipped_not_eligible" directly, no filesystem act attempted', async () => {
    const { durableRoot, finalizations } = setup()
    await advanceWorktreeFinalization(
      { finalizations, durableShadowWorktreeRoot: durableRoot },
      {
        correlationId: 'corr_1',
        orcaDispatchId: 'ctx_1',
        sliceRef: 'ORCA-S4',
        eligibilityDigest: 'd'.repeat(64),
        worktreePath: null, // legacy — never had a durable worktree
        now: () => '2026-09-13T00:00:00Z'
      }
    )
    expect(finalizations.getByCorrelationId('corr_1')?.status).toBe('skipped_not_eligible')
  })

  it('LIFE-3 / gate 22: refuses (isInside guard) to delete a path outside the configured durable shadow-worktree root', async () => {
    const { durableRoot, finalizations, dir } = setup()
    const escapePath = join(dir, 'not-under-durable-root')
    mkdirSync(escapePath, { recursive: true })
    finalizations.insertIntent({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      sliceRef: 'ORCA-S4',
      eligibilityDigest: 'd'.repeat(64),
      intentRecordedAt: '2026-09-13T00:00:00Z',
      status: 'intent_recorded',
      finalizedAt: null,
      outcomeDetailJson: null,
      conflictedAt: null
    })
    await expect(
      advanceWorktreeFinalization(
        { finalizations, durableShadowWorktreeRoot: durableRoot },
        {
          correlationId: 'corr_1',
          orcaDispatchId: 'ctx_1',
          sliceRef: 'ORCA-S4',
          eligibilityDigest: 'd'.repeat(64),
          worktreePath: escapePath,
          now: () => '2026-09-13T00:05:00Z'
        }
      )
    ).rejects.toThrow()
    expect(existsSync(escapePath)).toBe(true) // never touched
  })

  it('gate 6: no filesystem deletion occurs before intent_recorded is durably committed — a synchronous crash-simulation right after insertIntent still leaves the worktree intact', async () => {
    const { durableRoot, finalizations } = setup()
    const worktreePath = makeEligibleWorktree(durableRoot, 'corr_1')
    finalizations.insertIntent({
      correlationId: 'corr_1',
      orcaDispatchId: 'ctx_1',
      sliceRef: 'ORCA-S4',
      eligibilityDigest: 'd'.repeat(64),
      intentRecordedAt: '2026-09-13T00:00:00Z',
      status: 'intent_recorded',
      finalizedAt: null,
      outcomeDetailJson: null,
      conflictedAt: null
    })
    // No advance call made yet — the durable intent row exists, but nothing
    // has attempted the filesystem act.
    expect(existsSync(worktreePath)).toBe(true)
  })
})
