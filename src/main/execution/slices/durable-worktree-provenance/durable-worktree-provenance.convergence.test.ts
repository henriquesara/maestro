import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convergeWorktreeProvenance } from '../../application/converge-worktree-provenance'
import { ReadOnlyWorktreeProvenanceSource } from '../../infrastructure/read-only-worktree-provenance-source'
import {
  fixtureBinding,
  fixtureSettlementObservation,
  initRealDurableWorktree,
  makeTmpDir,
  openExecStores,
  writeIdentitySidecarFixture
} from './worktree-provenance-test-harness'

// ORCA-S3 acceptance gate 7 — convergence from DURABLE STATE, no hook. Settle a
// shadow Dispatch durably (real git worktree + real sqlite rows), DISCARD all
// in-memory state, construct a FRESH sibling sweep, and prove a
// worktree_provenance row with the real base_commit / candidate_head /
// files_changed / provenance_digest / full provenance_json — with no hook, no
// notification, no in-flight process, and WITHOUT invoking
// reconcileShadowExecutionState. run_binding.candidate_head is filled by the
// same transaction via the IS NULL CAS. RED: `convergeWorktreeProvenance` and
// `ReadOnlyWorktreeProvenanceSource` do not exist yet.

const SLICE = 'ORCA-S3'
const CID = 'corr_1'
const DISPATCH = 'ctx_1'
const RUN = 'run_1'

describe('durable-worktree-provenance — convergence from durable state (gate 7)', () => {
  it('converges a real worktree with no in-memory state carried over and no coordinator hook', () => {
    const root = makeTmpDir('orca-s3-conv-')
    const durableRoot = join(root.dir, 'durable-shadow-root')
    const worktreePath = join(durableRoot, 'shadow-corr_1')
    const { base, head } = initRealDurableWorktree(worktreePath)
    writeIdentitySidecarFixture(durableRoot, DISPATCH, {
      correlationId: CID,
      orcaRunId: RUN,
      orcaDispatchId: DISPATCH,
      worktreeNonce: 'nonce_1',
      sliceRef: SLICE,
      worktreePath
    })

    // --- Establish durable state (this "process") ---
    {
      const s = openExecStores(join(root.dir, 'exec.db'))
      s.store.recordBinding(fixtureBinding({ baseCommit: base }))
      s.settlements.insert(fixtureSettlementObservation())
      s.dispatchWorktrees.insert({
        orcaDispatchId: DISPATCH,
        correlationId: CID,
        orcaRunId: RUN,
        worktreeNonce: 'nonce_1',
        worktreePath,
        rootRef: 'root_gen_1',
        openedAt: '2026-09-12T00:00:00Z'
      })
      s.close()
    }

    // --- DISCARD everything above; construct a completely FRESH sibling sweep ---
    const fresh = openExecStores(join(root.dir, 'exec.db'))
    const report = convergeWorktreeProvenance(
      {
        store: fresh.store,
        settlements: fresh.settlements,
        dispatchWorktrees: fresh.dispatchWorktrees,
        provenance: fresh.provenance,
        incidents: fresh.incidents,
        runBindingCandidateHead: fresh.runBindingCandidateHead,
        source: new ReadOnlyWorktreeProvenanceSource(),
        txn: fresh.store,
        durableShadowWorktreeRoot: durableRoot,
        newId: (() => {
          let n = 0
          return (p: string) => `${p}_${++n}`
        })(),
        now: () => '2026-09-12T01:00:00Z'
      },
      { sliceRef: SLICE }
    )

    expect(report.observed).toHaveLength(1)
    const row = fresh.provenance.getByCorrelation(CID)!
    expect(row.baseCommit).toBe(base)
    expect(row.candidateHead).toBe(head)
    expect(JSON.parse(row.filesChangedJson)).toEqual(['b.ts'])
    expect(row.provenanceDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(() => JSON.parse(row.provenanceJson)).not.toThrow()
    expect(row.provenanceSource).toBe('converged_from_worktree')

    const binding = fresh.store.getBindingByDispatch(DISPATCH)
    expect(binding!.candidateHead).toBe(head) // filled by the IS NULL CAS

    fresh.close()
    root.cleanup()
  })
})
