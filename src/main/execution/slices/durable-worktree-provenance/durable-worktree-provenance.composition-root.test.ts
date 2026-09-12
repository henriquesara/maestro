import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import type { NativeRunResult } from '../../infrastructure/aicontrol-native/disposable-aicontrol-env'
import { executeShadowIdentityObservationSlice } from '../shadow-identity-observation/shadow-identity-observation'
import { writeFixtureAppDb } from '../shadow-identity-observation/shadow-observation.test-support'
import { makeTmpDir } from './worktree-provenance-test-harness'

// ORCA-S3 — real production composition-root reachability (focused-fix blocker 2).
// Drives TWO calls through `executeShadowIdentityObservationSlice` — the SAME
// single composition boundary S1/S2 already use — against the SAME durable
// paths: a bind call, then a restart call. Proves S3 is reached ONLY through
// that real path: no direct construction of `convergeWorktreeProvenance` or any
// S3 store as the feature-under-test path (a plain SyncDatabase COUNT(*) is used
// only to verify the row landed, after the fact).
//
// RED on d4bfdc8e: `executeShadowIdentityObservationSlice` never constructs a
// durable shadow-worktree root, never writes an identity sidecar, never inserts
// `dispatch_worktree`, and never invokes `convergeWorktreeProvenance` — S3 is
// entirely unreachable from this composition root. Every assertion below fails.

function nativeResult(workloadId: string): NativeRunResult {
  return {
    workloadId,
    profileIndex: 0,
    aicontrolRunId: `fixture_${workloadId}`,
    agentId: 'fixture-agent',
    status: 'completed',
    attemptStatus: 'completed',
    attemptExitCode: 0,
    attemptErrorClassification: null,
    gitDiffAfterEmpty: true,
    filesChanged: [],
    baseCommit: 'f'.repeat(40),
    headCommit: 'f'.repeat(40)
  }
}

describe('durable-worktree-provenance — real production composition-root reachability', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  it('a bind call then a restart call through executeShadowIdentityObservationSlice converges S3 provenance for real', async () => {
    const root = makeTmpDir('orca-s3-composition-')
    cleanups.push(root.cleanup)
    const appDbPath = join(root.dir, 'app.db')
    writeFixtureAppDb(appDbPath)
    const executionStorePath = join(root.dir, 'exec.db')
    const shadowOrchestrationPath = join(root.dir, 'shadow-orchestration.db')
    const durableShadowWorktreeRootPath = join(root.dir, 'durable-shadow-worktrees')

    let n = 0
    const shared = {
      aicontrolDbPath: appDbPath,
      executionStorePath,
      shadowOrchestrationPath,
      durableShadowWorktreeRootPath,
      now: () => '2026-09-12T00:00:00Z',
      newId: (p: string) => `${p}_${++n}`
    }

    // Call 1 — bind. Only workload 's1' carries a matching native result; the
    // other five are abandoned (NativeResultsAuthoritativeExecutor rejects an
    // unmatched workload id) — harmless, exercised elsewhere.
    const bindResult = await executeShadowIdentityObservationSlice({
      ...shared,
      nativeResults: [nativeResult('s1')]
    })
    expect(bindResult.bindings.length).toBeGreaterThan(0)

    // The durable shadow-worktree root exists OUT OF DisposableShadowRoot and
    // survives its cleanup() (already run, inside the call above).
    expect(existsSync(durableShadowWorktreeRootPath)).toBe(true)

    // Call 2 — restart, same durable paths, same native result (s1's reservation
    // is already 'observed' so it is short-circuited, not re-dispatched).
    // reconcileShadowExecutionState converges the now-terminal S2 settlement;
    // the S3 sibling sweep — wired immediately after it, never inside it —
    // converges provenance for the bound worktree.
    const restartResult = await executeShadowIdentityObservationSlice({
      ...shared,
      nativeResults: [nativeResult('s1')]
    })

    expect(restartResult.worktreeProvenanceConvergence).toBeDefined()
    expect(restartResult.worktreeProvenanceConvergence!.observed.length).toBeGreaterThan(0)
    expect(restartResult.worktreeProvenanceConvergence!.sweepErrors).toEqual([])

    // Verify durably landed — read-only, after the fact, never the
    // feature-under-test path.
    const verifyDb = new SyncDatabase(executionStorePath)
    cleanups.push(() => verifyDb.close())
    const provenanceRow = verifyDb
      .prepare('SELECT COUNT(*) c FROM worktree_provenance')
      .get() as { c: number }
    expect(provenanceRow.c).toBeGreaterThan(0)
    const dispatchWorktreeRow = verifyDb
      .prepare('SELECT COUNT(*) c FROM dispatch_worktree')
      .get() as { c: number }
    expect(dispatchWorktreeRow.c).toBeGreaterThan(0)
  }, 60_000)
})
