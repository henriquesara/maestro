import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convergeWorktreeProvenance } from '../../application/converge-worktree-provenance'
import { ExecutionStoreBusyError } from '../../infrastructure/with-immediate-transaction'
import { ReadOnlyWorktreeProvenanceSource } from '../../infrastructure/read-only-worktree-provenance-source'
import {
  fixtureBinding,
  fixtureSettlementObservation,
  initRealDurableWorktree,
  makeTmpDir,
  openExecStores,
  writeIdentitySidecarFixture
} from './worktree-provenance-test-harness'

// ORCA-S3 acceptance gate 17 — retryable taxonomy. Each of
// WORKTREE_SOURCE_OPERATIONAL_RETRYABLE, WORKTREE_SOURCE_UNSTABLE_RETRYABLE,
// EXECUTION_STORE_BUSY_RETRYABLE writes NO durable row, raises NO incident,
// blocks NOTHING, and is surfaced with an attempt count. Exercised here against
// REAL sqlite + a REAL git worktree with only the git RUNNER faked (never
// "missing" for a transient failure). RED: `convergeWorktreeProvenance` /
// `ReadOnlyWorktreeProvenanceSource` do not exist yet.

const SLICE = 'ORCA-S3'
const CID = 'corr_1'
const DISPATCH = 'ctx_1'
const RUN = 'run_1'

function scenario(root: { dir: string }) {
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
  return { durableRoot, stores }
}

describe('worktree-source-instability — retryable taxonomy (gate 17)', () => {
  it('WORKTREE_SOURCE_OPERATIONAL_RETRYABLE — git spawn/IO failure: no row, no incident, not blocked, surfaced', () => {
    const root = makeTmpDir('orca-s3-op-')
    const { durableRoot, stores } = scenario(root)
    const source = new ReadOnlyWorktreeProvenanceSource({
      runGit: () => ({ code: null, stdout: '', stderr: 'spawn failed', timedOut: true })
    })
    const report = convergeWorktreeProvenance(
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
    expect(stores.provenance.getByCorrelation(CID)).toBeUndefined()
    expect(stores.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(report.retryable).toContainEqual(
      expect.objectContaining({
        correlationId: CID,
        reason: 'WORKTREE_SOURCE_OPERATIONAL_RETRYABLE'
      })
    )
  })

  it('WORKTREE_SOURCE_UNSTABLE_RETRYABLE — a disagreeing double-read of HEAD: no row, no incident, not blocked', () => {
    const root = makeTmpDir('orca-s3-unstable-')
    const { durableRoot, stores } = scenario(root)
    let call = 0
    const source = new ReadOnlyWorktreeProvenanceSource({
      runGit: (args) => {
        call += 1
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return {
            code: 0,
            stdout: `${`${call % 2 === 0 ? 'a' : 'b'}`.repeat(40)}\n`,
            stderr: '',
            timedOut: false
          }
        }
        return { code: 0, stdout: '', stderr: '', timedOut: false }
      }
    })
    const report = convergeWorktreeProvenance(
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
    expect(stores.provenance.getByCorrelation(CID)).toBeUndefined()
    expect(stores.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(report.retryable).toContainEqual(
      expect.objectContaining({ correlationId: CID, reason: 'WORKTREE_SOURCE_UNSTABLE_RETRYABLE' })
    )
  })

  it('EXECUTION_STORE_BUSY_RETRYABLE — write-txn not acquired: no row, no incident, not blocked, attempt count surfaced', () => {
    const root = makeTmpDir('orca-s3-busy-')
    const { durableRoot, stores } = scenario(root)
    const report = convergeWorktreeProvenance(
      {
        store: stores.store,
        settlements: stores.settlements,
        dispatchWorktrees: stores.dispatchWorktrees,
        provenance: stores.provenance,
        incidents: stores.incidents,
        runBindingCandidateHead: stores.runBindingCandidateHead,
        source: new ReadOnlyWorktreeProvenanceSource(),
        txn: {
          withImmediateTransaction: () => {
            throw new ExecutionStoreBusyError(5)
          }
        },
        durableShadowWorktreeRoot: durableRoot,
        newId: (p: string) => `${p}_1`,
        now: () => '2026-09-12T00:00:00Z'
      },
      { sliceRef: SLICE }
    )
    expect(stores.provenance.getByCorrelation(CID)).toBeUndefined()
    expect(stores.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(report.retryable).toContainEqual(
      expect.objectContaining({
        correlationId: CID,
        reason: 'EXECUTION_STORE_BUSY_RETRYABLE',
        attempts: 5
      })
    )
  })
})
