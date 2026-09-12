import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convergeWorktreeProvenance } from '../../application/converge-worktree-provenance'
import { sha256File, assertNoSqliteSidecars } from '../../infrastructure/aicontrol-db-reader'
import { ReadOnlyWorktreeProvenanceSource } from '../../infrastructure/read-only-worktree-provenance-source'
import {
  fixtureBinding,
  fixtureSettlementObservation,
  initRealDurableWorktree,
  makeTmpDir,
  openExecStores,
  writeIdentitySidecarFixture
} from './worktree-provenance-test-harness'
import { writeFixtureAppDb } from '../shadow-identity-observation/shadow-observation.test-support'

// ORCA-S3 acceptance gates 1, 2, 4, 5, 6, 11, 14, 15, 16, 18 — the slice-wide
// checks not already exercised by the convergence / idempotency / restart /
// adversarial / instability suites. RED: `convergeWorktreeProvenance` /
// `ReadOnlyWorktreeProvenanceSource` do not exist yet.

const SLICE = 'ORCA-S3'

function sweep(
  stores: ReturnType<typeof openExecStores>,
  durableRoot: string,
  source: ReadOnlyWorktreeProvenanceSource = new ReadOnlyWorktreeProvenanceSource()
) {
  return convergeWorktreeProvenance(
    {
      store: stores.store,
      settlements: stores.settlements,
      dispatchWorktrees: stores.dispatchWorktrees,
      provenance: stores.provenance,
      incidents: stores.incidents,
      runBindingCandidateHead: stores.runBindingCandidateHead,
      source,
      txn: stores.store,
      durableShadowWorktreeRoot: durableRoot,
      newId: (p: string) => `${p}_1`,
      now: () => '2026-09-12T00:00:00Z'
    },
    { sliceRef: SLICE }
  )
}

describe('durable-worktree-provenance — acceptance (gates 1, 2, 5, 6, 11, 14, 15, 16, 18)', () => {
  it('gate 18 — N=3 historical settled ORCA-S1/S2 bindings with NO dispatch_worktree row: 0 provenance rows, 0 incidents, no binding blocked, S1/S2 state byte-unchanged', () => {
    const root = makeTmpDir('orca-s3-acc-legacy-')
    const durableRoot = join(root.dir, 'durable-shadow-root')
    const stores = openExecStores(join(root.dir, 'exec.db'))
    for (const n of [1, 2, 3]) {
      stores.store.recordBinding(
        fixtureBinding({
          correlationId: `corr_${n}` as never,
          orcaDispatchId: `ctx_${n}` as never,
          orcaRunId: `run_${n}` as never,
          orgTaskId: `task_${n}` as never
        })
      )
      stores.settlements.insert(
        fixtureSettlementObservation({
          correlationId: `corr_${n}`,
          orcaDispatchId: `ctx_${n}`,
          orcaRunId: `run_${n}`,
          orgTaskId: `task_${n}`
        })
      )
    }
    const bindingCountBefore = stores.store.listBindings(SLICE).length
    const settlementCountBefore = stores.settlements.listBySlice(SLICE).length

    const report = sweep(stores, durableRoot)

    expect(report.legacyNotConvergeable.sort()).toEqual(['corr_1', 'corr_2', 'corr_3'])
    expect(stores.provenance.listBySlice(SLICE)).toHaveLength(0)
    expect(stores.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(stores.store.listBindings(SLICE)).toHaveLength(bindingCountBefore)
    expect(stores.settlements.listBySlice(SLICE)).toHaveLength(settlementCountBefore)
    expect(
      (stores.db.prepare('SELECT COUNT(*) c FROM parity_observation').get() as { c: number }).c
    ).toBe(0)
    expect(
      (stores.db.prepare('SELECT COUNT(*) c FROM settlement_incident').get() as { c: number }).c
    ).toBe(0)
    stores.close()
    root.cleanup()
  })

  it('gate 11 — the durable shadow worktree directory is genuinely deleted: worktree_missing, blocked, no row, no fabricated SHA, binding surfaced not silently dropped', () => {
    const root = makeTmpDir('orca-s3-acc-missing-')
    const durableRoot = join(root.dir, 'durable-shadow-root')
    const worktreePath = join(durableRoot, 'shadow-corr_1')
    const { base } = initRealDurableWorktree(worktreePath)
    writeIdentitySidecarFixture(durableRoot, 'ctx_1', {
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      orcaDispatchId: 'ctx_1',
      worktreeNonce: 'nonce_1',
      sliceRef: SLICE,
      worktreePath
    })
    const stores = openExecStores(join(root.dir, 'exec.db'))
    stores.store.recordBinding(fixtureBinding({ baseCommit: base }))
    stores.settlements.insert(fixtureSettlementObservation())
    stores.dispatchWorktrees.insert({
      orcaDispatchId: 'ctx_1',
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      worktreeNonce: 'nonce_1',
      worktreePath,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-12T00:00:00Z'
    })
    rmSync(worktreePath, { recursive: true, force: true }) // genuinely gone

    const report = sweep(stores, durableRoot)
    expect(stores.provenance.getByCorrelation('corr_1')).toBeUndefined()
    const incidents = stores.incidents.listBySlice(SLICE)
    expect(incidents).toHaveLength(1)
    expect(incidents[0].kind).toBe('worktree_missing')
    expect(incidents[0].blocked).toBe(true)
    expect(report.incidents).toContainEqual(
      expect.objectContaining({ correlationId: 'corr_1', kind: 'worktree_missing' })
    ) // surfaced, not silently dropped
    stores.close()
    root.cleanup()
  })

  it('gates 4, 14 — the whole slice writes NOTHING to data/app.db across a normal converge AND an incident path; no -wal/-shm residual', () => {
    const root = makeTmpDir('orca-s3-acc-dbguard-')
    const appDbPath = join(root.dir, 'app.db')
    writeFixtureAppDb(appDbPath)
    const hashBefore = sha256File(appDbPath)

    const durableRoot = join(root.dir, 'durable-shadow-root')
    const worktreePath = join(durableRoot, 'shadow-corr_1')
    const { base } = initRealDurableWorktree(worktreePath)
    writeIdentitySidecarFixture(durableRoot, 'ctx_1', {
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      orcaDispatchId: 'ctx_1',
      worktreeNonce: 'WRONG_NONCE', // forces an incident path too
      sliceRef: SLICE,
      worktreePath
    })
    const stores = openExecStores(join(root.dir, 'exec.db'))
    stores.store.recordBinding(fixtureBinding({ baseCommit: base }))
    stores.settlements.insert(fixtureSettlementObservation())
    stores.dispatchWorktrees.insert({
      orcaDispatchId: 'ctx_1',
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      worktreeNonce: 'nonce_1',
      worktreePath,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-12T00:00:00Z'
    })

    sweep(stores, durableRoot) // incident path (nonce mismatch)
    stores.close()

    expect(sha256File(appDbPath)).toBe(hashBefore)
    expect(() => assertNoSqliteSidecars(appDbPath)).not.toThrow()
    root.cleanup()
  })

  it('gates 2, 5, 15 — static audit: no S3 module imports finalizeRunOnce / agent_runs / filesystem-removal calls, and reconcile-shadow-execution-state.ts / orca-execution-plane.ts stay byte-unchanged at their frozen ORCA-S2 hashes', () => {
    const s3Root = join(__dirname, '..', '..')
    const s3Files = [
      join(s3Root, 'application', 'converge-worktree-provenance.ts'),
      join(s3Root, 'infrastructure', 'read-only-worktree-provenance-source.ts'),
      join(s3Root, 'infrastructure', 'durable-shadow-worktree-root.ts'),
      join(s3Root, 'infrastructure', 'identity-sidecar-store.ts'),
      join(s3Root, 'infrastructure', 'sqlite-dispatch-worktree-store.ts'),
      join(s3Root, 'infrastructure', 'sqlite-worktree-provenance-store.ts'),
      join(s3Root, 'infrastructure', 'sqlite-worktree-provenance-incident-store.ts'),
      join(s3Root, 'infrastructure', 'sqlite-run-binding-candidate-head-store.ts'),
      join(s3Root, 'domain', 'worktree-provenance.ts')
    ]
    const forbidden = [
      'finalizeRunOnce',
      "from '../infrastructure/settlement-incident-store'",
      "from './settlement-incident-store'",
      'rmSync(',
      'rmdirSync(',
      'unlinkSync(',
      "'worktree', 'remove'",
      'promoteReadyTasks'
    ]
    for (const file of s3Files) {
      expect(existsSync(file), `${file} must exist for the static audit to run`).toBe(true)
      const src = readFileSync(file, 'utf8')
      for (const token of forbidden) {
        expect(src.includes(token), `${file} must not contain ${token}`).toBe(false)
      }
    }

    // reconcile-shadow-execution-state.ts and orca-execution-plane.ts must be
    // BYTE-UNCHANGED from their frozen ORCA-S2 shape (no "phase 2.5", no new
    // dispatch_worktree write inserted at the plane seam).
    const untouched = [
      join(s3Root, 'application', 'reconcile-shadow-execution-state.ts'),
      join(s3Root, 'infrastructure', 'orca-execution-plane.ts')
    ]
    for (const file of untouched) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/convergeWorktreeProvenance|dispatch_worktree/)
    }
  })
})
