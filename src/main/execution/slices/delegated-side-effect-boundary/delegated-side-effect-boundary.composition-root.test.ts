import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import type { NativeRunResult } from '../../infrastructure/aicontrol-native/disposable-aicontrol-env'
import { executeShadowIdentityObservationSlice } from '../shadow-identity-observation/shadow-identity-observation'
import { writeFixtureAppDb } from '../shadow-identity-observation/shadow-observation.test-support'
import { makeTmpDir } from '../durable-worktree-provenance/worktree-provenance-test-harness'

// ORCA-S4 — real production composition-root reachability (focused fix for the
// independent-review blocker: `resolvePhase1` hardcoded `identitySidecarPath: ''`,
// so the REAL adapter could never read the REAL sidecar on the restart-recovered
// path — the only path any binding ever takes through this composition root,
// since it never persists a cross-call `liveHandles` registry). Drives THREE
// calls through `executeShadowIdentityObservationSlice` — the SAME single
// composition boundary S1/S2/S3 already use — against the SAME durable paths:
// a bind call, then two restart calls. Proves S4 is reached, and CONVERGES,
// ONLY through that real path: no direct construction of
// `convergeDelegationBoundaryLifecycle`, `ShadowLifecycleProcessAdapter`, or
// any S4 store as the feature-under-test path (a plain SyncDatabase COUNT(*)
// is used only to verify rows landed, after the fact — mirrors
// `durable-worktree-provenance.composition-root.test.ts` exactly, one level
// up). The second restart call is required, not incidental: worktree
// finalization for a binding with a real durable worktree is a genuine
// two-step act (§10.2) — durable intent is recorded on the first pass that
// reaches Phase 2, and the actual filesystem deletion + 'finalized'
// transition happens on the NEXT pass, exactly per §12 windows L3/L4.
//
// RED on 94e12c2e87: the real sidecar written by the bind-time seam under
// `<durableShadowLifecycleRoot>/process/<orcaDispatchId>.json` can never be
// read back by the restart call's sibling sweep, because `resolvePhase1` never
// receives the durable lifecycle root and passes `identitySidecarPath: ''`
// instead. The real adapter's `observe()` then fails `sidecarMatches` (sidecar
// null) and returns `identity_unverifiable` — a `process_identity_mismatch`
// incident is raised, `dispatch_termination` is never written, and neither is
// `dispatch_lifecycle_closure` / `dispatch_lifecycle_event`. Every S4-table
// assertion below fails.

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

describe('delegated-side-effect-boundary — real production composition-root reachability', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  it('a bind call then a restart call through executeShadowIdentityObservationSlice converges S4 lifecycle facts for real', async () => {
    const root = makeTmpDir('orca-s4-composition-')
    cleanups.push(root.cleanup)
    const appDbPath = join(root.dir, 'app.db')
    writeFixtureAppDb(appDbPath)
    const executionStorePath = join(root.dir, 'exec.db')
    const shadowOrchestrationPath = join(root.dir, 'shadow-orchestration.db')
    const durableShadowWorktreeRootPath = join(root.dir, 'durable-shadow-worktrees')
    const durableShadowLifecycleRootPath = join(root.dir, 'durable-shadow-lifecycle')

    let n = 0
    const shared = {
      aicontrolDbPath: appDbPath,
      executionStorePath,
      shadowOrchestrationPath,
      durableShadowWorktreeRootPath,
      durableShadowLifecycleRootPath,
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

    // §9.2 step 3 — the REAL process identity sidecar was written, atomically,
    // under the durable shadow-lifecycle root, by the REAL bind-time seam.
    const sidecarDir = join(durableShadowLifecycleRootPath, 'process')
    expect(existsSync(sidecarDir)).toBe(true)
    expect(readdirSync(sidecarDir).length).toBeGreaterThan(0)

    // Call 2 — restart, same durable paths, same native result (s1's
    // reservation is already 'observed' so it is short-circuited, not
    // re-dispatched). No in-memory ChildProcess handle survives this second,
    // independent call — every S4 identity re-verification for the binding
    // spawned in call 1 MUST go through the restart-recovered path, reading
    // the REAL sidecar back from disk.
    const restartResult = await executeShadowIdentityObservationSlice({
      ...shared,
      nativeResults: [nativeResult('s1')]
    })

    expect(restartResult.delegationBoundaryLifecycle).toBeDefined()

    // Verify durably landed — read-only, after the fact, never the
    // feature-under-test path.
    const verifyDb = new SyncDatabase(executionStorePath)
    cleanups.push(() => verifyDb.close())

    const processBindingRow = verifyDb
      .prepare('SELECT COUNT(*) c FROM dispatch_process_binding')
      .get() as { c: number }
    expect(processBindingRow.c).toBeGreaterThan(0)

    // The decisive assertion for THIS blocker: identity corroboration against
    // the REAL sidecar must actually succeed, not fail closed into a
    // permanent process_identity_mismatch incident.
    const terminationRow = verifyDb.prepare('SELECT COUNT(*) c FROM dispatch_termination').get() as {
      c: number
    }
    expect(terminationRow.c).toBeGreaterThan(0)

    // §10.2 — worktree finalization for a binding with a REAL durable
    // worktree is a genuine two-step act: this same restart call's Phase 2
    // only reaches 'intent_recorded' (durable intent BEFORE any filesystem
    // deletion, §10.2 step 1); the NEXT sweep pass re-verifies the digest and
    // performs the actual deletion + 'finalized' transition (§10.2 steps 2-4).
    // A THIRD composition-root call is that next pass — this is the SPEC's
    // own multi-pass design (§12 windows L3/L4), not a workaround.
    verifyDb.close()
    cleanups.pop()
    const secondRestartResult = await executeShadowIdentityObservationSlice({
      ...shared,
      nativeResults: [nativeResult('s1')]
    })
    expect(secondRestartResult.delegationBoundaryLifecycle).toBeDefined()

    const verifyDb2 = new SyncDatabase(executionStorePath)
    cleanups.push(() => verifyDb2.close())

    const closureRow = verifyDb2.prepare('SELECT COUNT(*) c FROM dispatch_lifecycle_closure').get() as {
      c: number
    }
    expect(closureRow.c).toBeGreaterThan(0)

    const eventRow = verifyDb2.prepare('SELECT COUNT(*) c FROM dispatch_lifecycle_event').get() as { c: number }
    expect(eventRow.c).toBeGreaterThan(0)

    // No unresolved identity-mismatch incident should have been fabricated by
    // a broken sidecar path — the real corroboration must have succeeded.
    const mismatchIncidentRow = verifyDb2
      .prepare("SELECT COUNT(*) c FROM dispatch_lifecycle_incident WHERE kind = 'process_identity_mismatch'")
      .get() as { c: number }
    expect(mismatchIncidentRow.c).toBe(0)
  }, 60_000)
})
