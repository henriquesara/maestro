import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { convergeWorktreeProvenance } from '../../application/converge-worktree-provenance'
import { ReadOnlyWorktreeProvenanceSource } from '../../infrastructure/read-only-worktree-provenance-source'
import {
  fixtureSettlementObservation,
  makeTmpDir,
  openExecStores
} from './worktree-provenance-test-harness'

// ORCA-S3 acceptance gate 10 — restart safety / crash windows §7.6 A-G. A
// SEPARATELY KILLABLE child performs the pinned write ordering (worktree ->
// sidecar -> one SQLite transaction for run_binding + dispatch_worktree) and is
// SIGKILLed at each window; the parent then runs a FRESH convergeWorktreeProvenance
// and asserts the required outcome. Marker-driven, never timing-driven. RED:
// `convergeWorktreeProvenance` / `ReadOnlyWorktreeProvenanceSource` do not
// exist yet.

const SLICE = 'ORCA-S3'
const CID = 'corr_w'
const DISPATCH = 'ctx_w'
const RUN = 'run_w'
const TASK = 'task_w'
const NONCE = 'nonce_w'
const CHILD = join(__dirname, 'worktree-provenance-converge-child.mjs')

describe('durable-worktree-provenance — restart safety (gate 10, windows A-G)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  async function runChildToHalt(haltAt: 'A' | 'B' | 'C' | 'D') {
    const root = makeTmpDir('orca-s3-restart-')
    cleanups.push(root.cleanup)
    const execDbPath = join(root.dir, 'exec.db')
    const durableRoot = join(root.dir, 'durable-shadow-root')
    const readyMarker = join(root.dir, 'READY')

    // Parent creates the schema (the raw node:sqlite child cannot run
    // migrateExecutionStore's TS module resolution).
    const init = openExecStores(execDbPath)
    init.close()

    const child = spawn(
      process.execPath,
      [CHILD, execDbPath, durableRoot, SLICE, CID, DISPATCH, RUN, TASK, NONCE, haltAt, readyMarker],
      { stdio: 'ignore' }
    )
    for (let i = 0; i < 400 && !existsSync(readyMarker); i += 1) {
      await sleep(25)
    }
    expect(existsSync(readyMarker)).toBe(true)
    const exited = new Promise<void>((r) => child.on('exit', () => r()))
    child.kill('SIGKILL')
    await exited

    return { root, execDbPath, durableRoot }
  }

  function sweep(execDbPath: string, durableRoot: string) {
    const s = openExecStores(execDbPath)
    try {
      const report = convergeWorktreeProvenance(
        {
          store: s.store,
          settlements: s.settlements,
          dispatchWorktrees: s.dispatchWorktrees,
          provenance: s.provenance,
          incidents: s.incidents,
          runBindingCandidateHead: s.runBindingCandidateHead,
          source: new ReadOnlyWorktreeProvenanceSource(),
          txn: s.store,
          durableShadowWorktreeRoot: durableRoot,
          newId: (p: string) => `${p}_1`,
          now: () => '2026-09-12T00:00:00Z'
        },
        { sliceRef: SLICE }
      )
      return {
        report,
        provenance: s.provenance.listBySlice(SLICE),
        incidents: s.incidents.listBySlice(SLICE),
        dispatchWorktree: s.dispatchWorktrees.getByDispatchId(DISPATCH),
        binding: s.store.getBindingByDispatch(DISPATCH)
      }
    } finally {
      s.close()
    }
  }

  it('A — killed after worktree creation, BEFORE the sidecar: orphan worktree, no DB rows, S3 does not act (no cleanup)', async () => {
    const { execDbPath, durableRoot } = await runChildToHalt('A')
    expect(existsSync(join(durableRoot, `shadow-${CID}`))).toBe(true) // orphan worktree left in place
    expect(existsSync(join(durableRoot, 'identity', `${DISPATCH}.json`))).toBe(false)
    const out = sweep(execDbPath, durableRoot)
    expect(out.provenance).toHaveLength(0)
    expect(out.incidents).toHaveLength(0)
    expect(out.dispatchWorktree).toBeUndefined()
    // Orphan cleanup is explicitly NOT S3's job — the directory must still exist.
    expect(existsSync(join(durableRoot, `shadow-${CID}`))).toBe(true)
  }, 60_000)

  it('B — killed after the sidecar, BEFORE the DB transaction: orphan worktree + orphan sidecar, no DB rows, S3 does not act', async () => {
    const { execDbPath, durableRoot } = await runChildToHalt('B')
    expect(existsSync(join(durableRoot, 'identity', `${DISPATCH}.json`))).toBe(true) // orphan sidecar
    const out = sweep(execDbPath, durableRoot)
    expect(out.provenance).toHaveLength(0)
    expect(out.incidents).toHaveLength(0)
    expect(out.dispatchWorktree).toBeUndefined()
    expect(existsSync(join(durableRoot, 'identity', `${DISPATCH}.json`))).toBe(true) // still not cleaned up
  }, 60_000)

  it('C — killed mid-transaction (run_binding inserted, dispatch_worktree not yet, no COMMIT): BOTH roll back, orphan filesystem state remains, S3 does not act', async () => {
    const { execDbPath, durableRoot } = await runChildToHalt('C')
    const s = openExecStores(execDbPath)
    expect(s.store.getBindingByDispatch(DISPATCH)).toBeUndefined() // rolled back
    expect(s.dispatchWorktrees.getByDispatchId(DISPATCH)).toBeUndefined() // rolled back
    s.close()
    const out = sweep(execDbPath, durableRoot)
    expect(out.provenance).toHaveLength(0)
    expect(out.incidents).toHaveLength(0)
    expect(existsSync(join(durableRoot, `shadow-${CID}`))).toBe(true) // orphan filesystem state remains
  }, 60_000)

  it('D — killed AFTER commit: restart-safe normal convergence — the next sweep resolves identity and records provenance exactly once', async () => {
    const { execDbPath, durableRoot } = await runChildToHalt('D')
    const s = openExecStores(execDbPath)
    expect(s.store.getBindingByDispatch(DISPATCH)).toBeDefined()
    expect(s.dispatchWorktrees.getByDispatchId(DISPATCH)).toBeDefined()
    s.settlements.insert(fixtureSettlementObservation({ correlationId: CID, orcaDispatchId: DISPATCH, orcaRunId: RUN, orgTaskId: TASK }))
    s.close()

    const first = sweep(execDbPath, durableRoot)
    expect(first.provenance).toHaveLength(1)
    expect(first.incidents).toHaveLength(0)
    expect(first.binding!.candidateHead).not.toBeNull()

    const second = sweep(execDbPath, durableRoot) // idempotent restart
    expect(second.provenance).toHaveLength(1)
    expect(second.provenance[0]).toEqual(first.provenance[0])
  }, 60_000)

  it('E — window D followed by the sidecar later going missing/corrupt: worktree_dispatch_mismatch, no row, no reconstruction', async () => {
    const { execDbPath, durableRoot } = await runChildToHalt('D')
    const s = openExecStores(execDbPath)
    s.settlements.insert(fixtureSettlementObservation({ correlationId: CID, orcaDispatchId: DISPATCH, orcaRunId: RUN, orgTaskId: TASK }))
    s.close()

    // Sidecar goes missing AFTER the dispatch_worktree row was already committed.
    rmSync(join(durableRoot, 'identity', `${DISPATCH}.json`), { force: true })
    const out = sweep(execDbPath, durableRoot)
    expect(out.provenance).toHaveLength(0)
    expect(out.incidents).toHaveLength(1)
    expect(out.incidents[0].kind).toBe('worktree_dispatch_mismatch')
    const detail = JSON.parse(out.incidents[0].detailJson)
    expect(detail.failed_check).toBe('identity_discriminator_absent')
  }, 60_000)

  it('F — run_binding + settlement_observation exist, dispatch_worktree absent, no worktree_provenance ever existed: LEGACY_BINDING_NOT_CONVERGEABLE, no row, no incident, no block', () => {
    const root = makeTmpDir('orca-s3-restart-f-')
    cleanups.push(root.cleanup)
    const execDbPath = join(root.dir, 'exec.db')
    const durableRoot = join(root.dir, 'durable-shadow-root')
    const s = openExecStores(execDbPath)
    s.store.recordBinding({
      correlationId: CID as never,
      governanceAgentRunId: 'gar_1' as never,
      aicontrolRunId: null,
      orcaRunId: RUN as never,
      orcaDispatchId: DISPATCH as never,
      orgTaskId: TASK as never,
      sliceRef: SLICE,
      baseCommit: 'base000',
      candidateHead: null,
      boundAt: '2026-09-12T00:00:00Z'
    })
    s.settlements.insert(
      fixtureSettlementObservation({ correlationId: CID, orcaDispatchId: DISPATCH, orcaRunId: RUN, orgTaskId: TASK })
    )
    // dispatch_worktree deliberately never inserted — the pre-S3 legacy shape.
    s.close()

    const out = sweep(execDbPath, durableRoot)
    expect(out.report.legacyNotConvergeable).toContain(CID)
    expect(out.provenance).toHaveLength(0)
    expect(out.incidents).toHaveLength(0)
  })

  it('G — an already-recorded worktree_provenance whose dispatch_worktree source row later vanishes: worktree_dispatch_mismatch(dispatch_worktree_row_absent), status unchanged, blocked, no row rewrite', async () => {
    const { execDbPath, durableRoot } = await runChildToHalt('D')
    const s = openExecStores(execDbPath)
    s.settlements.insert(fixtureSettlementObservation({ correlationId: CID, orcaDispatchId: DISPATCH, orcaRunId: RUN, orgTaskId: TASK }))
    s.close()

    sweep(execDbPath, durableRoot) // records the provenance row (post-S3 state)
    const beforeStatus = openExecStores(execDbPath)
    const before = beforeStatus.provenance.getByCorrelation(CID)!
    beforeStatus.close()
    expect(before.status).toBe('recorded')

    const dbForDelete = openExecStores(execDbPath)
    dbForDelete.db.prepare('DELETE FROM dispatch_worktree WHERE orca_dispatch_id = ?').run(DISPATCH)
    dbForDelete.close()

    const out = sweep(execDbPath, durableRoot)
    expect(out.incidents).toHaveLength(1)
    expect(out.incidents[0].kind).toBe('worktree_dispatch_mismatch')
    expect(JSON.parse(out.incidents[0].detailJson).failed_check).toBe('dispatch_worktree_row_absent')
    expect(out.provenance[0].status).toBe('recorded') // unchanged, no rewrite
  }, 60_000)
})
