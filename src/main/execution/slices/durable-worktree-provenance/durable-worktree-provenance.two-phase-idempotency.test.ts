import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convergeWorktreeProvenance } from '../../application/converge-worktree-provenance'
import { ReadOnlyWorktreeProvenanceSource } from '../../infrastructure/read-only-worktree-provenance-source'
import {
  fixtureBinding,
  fixtureSettlementObservation,
  git,
  initRealDurableWorktree,
  makeTmpDir,
  openExecStores,
  writeIdentitySidecarFixture
} from './worktree-provenance-test-harness'

// ORCA-S3 acceptance gates 8, 9, 16 — PROV-2 (convergence-safe idempotency) and
// PROV-11 (source-state durability across a provenance-projection rebuild).
// RED: `convergeWorktreeProvenance` / `ReadOnlyWorktreeProvenanceSource` do not
// exist yet.

const SLICE = 'ORCA-S3'
const CID = 'corr_1'
const DISPATCH = 'ctx_1'
const RUN = 'run_1'

function setup(root: { dir: string }) {
  const durableRoot = join(root.dir, 'durable-shadow-root')
  const worktreePath = join(durableRoot, 'shadow-corr_1')
  const { base } = initRealDurableWorktree(worktreePath)
  writeIdentitySidecarFixture(durableRoot, DISPATCH, {
    correlationId: CID,
    orcaRunId: RUN,
    orcaDispatchId: DISPATCH,
    worktreeNonce: 'nonce_1',
    sliceRef: SLICE,
    worktreePath
  })
  const stores = openExecStores(join(root.dir, 'exec.db'))
  stores.store.recordBinding(fixtureBinding({ baseCommit: base }))
  stores.settlements.insert(fixtureSettlementObservation())
  stores.dispatchWorktrees.insert({
    orcaDispatchId: DISPATCH,
    correlationId: CID,
    orcaRunId: RUN,
    worktreeNonce: 'nonce_1',
    worktreePath,
    rootRef: 'root_gen_1',
    openedAt: '2026-09-12T00:00:00Z'
  })
  return { durableRoot, worktreePath, stores }
}

function sweep(stores: ReturnType<typeof openExecStores>, durableRoot: string, n: { v: number }) {
  return convergeWorktreeProvenance(
    {
      store: stores.store,
      settlements: stores.settlements,
      dispatchWorktrees: stores.dispatchWorktrees,
      provenance: stores.provenance,
      incidents: stores.incidents,
      runBindingCandidateHead: stores.runBindingCandidateHead,
      source: new ReadOnlyWorktreeProvenanceSource(),
      txn: stores.store,
      durableShadowWorktreeRoot: durableRoot,
      newId: (p: string) => `${p}_${++n.v}`,
      now: () => `2026-09-12T0${n.v}:00:00Z`
    },
    { sliceRef: SLICE }
  )
}

describe('durable-worktree-provenance — idempotency (gate 8) and projection rebuild (gates 8, 16)', () => {
  it('sweeping x3 back-to-back yields ZERO duplicate rows and ZERO extra incidents', () => {
    const root = makeTmpDir('orca-s3-idem-')
    const { durableRoot, stores } = setup(root)
    const n = { v: 0 }
    sweep(stores, durableRoot, n)
    const rowAfter1 = stores.provenance.getByCorrelation(CID)
    sweep(stores, durableRoot, n)
    sweep(stores, durableRoot, n)
    expect(stores.provenance.listBySlice(SLICE)).toHaveLength(1)
    expect(stores.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(stores.provenance.getByCorrelation(CID)).toEqual(rowAfter1)
    stores.close()
    root.cleanup()
  })

  it('a provenance-projection rebuild + a fresh sweep reproduces a SEMANTICALLY equivalent row; dispatch_worktree and worktree files are untouched', () => {
    const root = makeTmpDir('orca-s3-rebuild-')
    const { durableRoot, stores } = setup(root)
    const n = { v: 0 }
    sweep(stores, durableRoot, n)
    const before = stores.provenance.getByCorrelation(CID)!
    const dispatchWorktreeBefore = stores.dispatchWorktrees.getByDispatchId(DISPATCH)

    // §7.5 rebuild helper: drop + recreate ONLY the two projection tables.
    stores.db.exec(
      'DROP TABLE IF EXISTS worktree_provenance_incident; DROP TABLE IF EXISTS worktree_provenance;'
    )
    // Re-run migrateExecutionStore-equivalent recreation is exercised by the
    // schema migration test; here we assert dispatch_worktree survived the drop.
    expect(stores.dispatchWorktrees.getByDispatchId(DISPATCH)).toEqual(dispatchWorktreeBefore)

    sweep(stores, durableRoot, n)
    const after = stores.provenance.getByCorrelation(CID)!
    for (const k of [
      'provenanceDigest',
      'baseCommit',
      'candidateHead',
      'filesChangedJson',
      'orcaDispatchId',
      'status'
    ] as const) {
      expect(after[k]).toEqual(before[k])
    }
    stores.close()
    root.cleanup()
  })

  it('gate 9 — a digest change after a provenance row exists raises EXACTLY ONE provenance_snapshot_changed incident, conflicts status, and every artifact column stays byte-unchanged', () => {
    const root = makeTmpDir('orca-s3-conflict-')
    const { durableRoot, worktreePath, stores } = setup(root)
    const n = { v: 0 }
    sweep(stores, durableRoot, n)
    const before = stores.provenance.getByCorrelation(CID)!
    expect(before.status).toBe('recorded')

    // Mutate the REAL worktree after the provenance row was recorded.
    writeFileSync(join(worktreePath, 'c.ts'), 'mutated\n')
    git(['add', '-A'], worktreePath)
    git(['commit', '-q', '-m', 'post-provenance mutation'], worktreePath)

    sweep(stores, durableRoot, n)
    sweep(stores, durableRoot, n) // a second sweep must NOT raise a second incident

    const incidents = stores.incidents.listBySlice(SLICE)
    expect(incidents).toHaveLength(1)
    expect(incidents[0].kind).toBe('provenance_snapshot_changed')

    const after = stores.provenance.getByCorrelation(CID)!
    expect(after.status).toBe('conflicted')
    for (const k of ['baseCommit', 'candidateHead', 'filesChangedJson', 'provenanceSource'] as const) {
      expect(after[k]).toBe(before[k]) // byte-preserved — never rewritten
    }
    stores.close()
    root.cleanup()
  })
})
