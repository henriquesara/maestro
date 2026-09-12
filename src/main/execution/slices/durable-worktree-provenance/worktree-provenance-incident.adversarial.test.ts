import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convergeWorktreeProvenance } from '../../application/converge-worktree-provenance'
import { reconcileIncompleteReservations } from '../../application/reconcile-incomplete-reservations'
import { ReadOnlyWorktreeProvenanceSource } from '../../infrastructure/read-only-worktree-provenance-source'
import {
  fixtureBinding,
  fixtureSettlementObservation,
  initRealDurableWorktree,
  makeTmpDir,
  openExecStores,
  writeIdentitySidecarFixture
} from './worktree-provenance-test-harness'

// ORCA-S3 acceptance gates 12, 13 — identity adversarial cases (PROV-3) + no
// parity / settlement_incident writes anywhere (PROV-4, PROV-7) + incident
// isolation (PROV-10). RED: `convergeWorktreeProvenance` /
// `ReadOnlyWorktreeProvenanceSource` do not exist yet.

const SLICE = 'ORCA-S3'
const CID = 'corr_1'
const DISPATCH = 'ctx_1'
const RUN = 'run_1'

function scenario(root: { dir: string }) {
  const durableRoot = join(root.dir, 'durable-shadow-root')
  const worktreePath = join(durableRoot, 'shadow-corr_1')
  const { base } = initRealDurableWorktree(worktreePath)
  const stores = openExecStores(join(root.dir, 'exec.db'))
  stores.store.recordBinding(fixtureBinding({ baseCommit: base }))
  stores.settlements.insert(fixtureSettlementObservation())
  return { durableRoot, worktreePath, stores }
}

function sweepOnce(stores: ReturnType<typeof openExecStores>, durableRoot: string) {
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
      newId: (p: string) => `${p}_1`,
      now: () => '2026-09-12T00:00:00Z'
    },
    { sliceRef: SLICE }
  )
}

describe('worktree-provenance-incident — adversarial identity + isolation (gates 12, 13)', () => {
  it('a reused filesystem path with the WRONG sidecar (bad nonce) never converges', () => {
    const root = makeTmpDir('orca-s3-adv-nonce-')
    const { durableRoot, worktreePath, stores } = scenario(root)
    stores.dispatchWorktrees.insert({
      orcaDispatchId: DISPATCH,
      correlationId: CID,
      orcaRunId: RUN,
      worktreeNonce: 'REAL_NONCE',
      worktreePath,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-12T00:00:00Z'
    })
    writeIdentitySidecarFixture(durableRoot, DISPATCH, {
      correlationId: CID,
      orcaRunId: RUN,
      orcaDispatchId: DISPATCH,
      worktreeNonce: 'WRONG_NONCE',
      sliceRef: SLICE,
      worktreePath
    })
    sweepOnce(stores, durableRoot)
    expect(stores.provenance.getByCorrelation(CID)).toBeUndefined()
    expect(stores.incidents.listBySlice(SLICE)[0]?.kind).toBe('worktree_dispatch_mismatch')
  })

  it('a sidecar with NO sidecar file at all never converges (identity_discriminator_absent)', () => {
    const root = makeTmpDir('orca-s3-adv-absent-')
    const { durableRoot, worktreePath, stores } = scenario(root)
    stores.dispatchWorktrees.insert({
      orcaDispatchId: DISPATCH,
      correlationId: CID,
      orcaRunId: RUN,
      worktreeNonce: 'nonce_1',
      worktreePath,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-12T00:00:00Z'
    })
    sweepOnce(stores, durableRoot) // no sidecar ever written
    expect(stores.provenance.getByCorrelation(CID)).toBeUndefined()
    expect(stores.incidents.listBySlice(SLICE)[0]?.kind).toBe('worktree_dispatch_mismatch')
  })

  it('a sidecar whose worktreePath canonicalizes OUTSIDE the durable root never converges — behaves the same for a linked worktree (.git is a file)', () => {
    const root = makeTmpDir('orca-s3-adv-escape-')
    const { durableRoot, worktreePath, stores } = scenario(root)
    stores.dispatchWorktrees.insert({
      orcaDispatchId: DISPATCH,
      correlationId: CID,
      orcaRunId: RUN,
      worktreeNonce: 'nonce_1',
      worktreePath,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-12T00:00:00Z'
    })
    const outside = makeTmpDir('orca-s3-outside-')
    writeIdentitySidecarFixture(durableRoot, DISPATCH, {
      correlationId: CID,
      orcaRunId: RUN,
      orcaDispatchId: DISPATCH,
      worktreeNonce: 'nonce_1',
      sliceRef: SLICE,
      worktreePath: join(outside.dir, 'escaped-shadow-corr_1')
    })
    sweepOnce(stores, durableRoot)
    expect(stores.provenance.getByCorrelation(CID)).toBeUndefined()
    outside.cleanup()
  })

  it('PROV-12 / window F vs window G — no dispatch_worktree row + no prior provenance is legacy (0 incidents); an existing provenance whose dispatch_worktree later vanishes IS an incident', () => {
    const root = makeTmpDir('orca-s3-adv-fg-')
    const { durableRoot, worktreePath, stores } = scenario(root)

    // Window F first: no dispatch_worktree row at all yet.
    const legacyReport = sweepOnce(stores, durableRoot)
    expect(legacyReport.legacyNotConvergeable).toContain(CID)
    expect(stores.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(stores.provenance.getByCorrelation(CID)).toBeUndefined()

    // Now genuinely bind + converge (post-S3 state), then delete the source row: window G.
    stores.dispatchWorktrees.insert({
      orcaDispatchId: DISPATCH,
      correlationId: CID,
      orcaRunId: RUN,
      worktreeNonce: 'nonce_1',
      worktreePath,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-12T00:00:00Z'
    })
    writeIdentitySidecarFixture(durableRoot, DISPATCH, {
      correlationId: CID,
      orcaRunId: RUN,
      orcaDispatchId: DISPATCH,
      worktreeNonce: 'nonce_1',
      sliceRef: SLICE,
      worktreePath
    })
    sweepOnce(stores, durableRoot)
    expect(stores.provenance.getByCorrelation(CID)).toBeDefined()

    stores.db.prepare('DELETE FROM dispatch_worktree WHERE orca_dispatch_id = ?').run(DISPATCH)
    sweepOnce(stores, durableRoot)
    const incidents = stores.incidents.listBySlice(SLICE)
    expect(incidents).toHaveLength(1)
    expect(incidents[0].kind).toBe('worktree_dispatch_mismatch')
    expect(JSON.parse(incidents[0].detailJson).failed_check).toBe('dispatch_worktree_row_absent')
    expect(stores.provenance.getByCorrelation(CID)!.status).toBe('recorded') // unchanged, no rewrite
  })

  it('PROV-4 / PROV-7 — after inducing three different S3 incidents, settlement_incident and parity_observation stay at zero rows', () => {
    const root = makeTmpDir('orca-s3-adv-isolation-')
    const { durableRoot, worktreePath, stores } = scenario(root)
    stores.dispatchWorktrees.insert({
      orcaDispatchId: DISPATCH,
      correlationId: CID,
      orcaRunId: RUN,
      worktreeNonce: 'WRONG',
      worktreePath,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-12T00:00:00Z'
    })
    // No sidecar -> identity_discriminator_absent incident.
    sweepOnce(stores, durableRoot)
    expect(
      (stores.db.prepare('SELECT COUNT(*) c FROM settlement_incident').get() as { c: number }).c
    ).toBe(0)
    expect(
      (stores.db.prepare('SELECT COUNT(*) c FROM parity_observation').get() as { c: number }).c
    ).toBe(0)
  })

  it('PROV-10 — an open worktree_provenance_incident for one binding is invisible to reconcileIncompleteReservations (a DIFFERENT incident channel entirely)', () => {
    const root = makeTmpDir('orca-s3-adv-prov10-')
    const { durableRoot, worktreePath, stores } = scenario(root)
    stores.dispatchWorktrees.insert({
      orcaDispatchId: DISPATCH,
      correlationId: CID,
      orcaRunId: RUN,
      worktreeNonce: 'WRONG',
      worktreePath,
      rootRef: 'root_gen_1',
      openedAt: '2026-09-12T00:00:00Z'
    })
    sweepOnce(stores, durableRoot) // raises an S3 incident (identity mismatch)
    expect(stores.incidents.hasOpenIncident(CID)).toBe(true)

    // reconcileIncompleteReservations (REAL S2 module) is only ever handed
    // settlement_incident (S2's own channel) — it has no
    // `worktree_provenance_incident` awareness by construction. An open S3
    // incident must never make it treat this reservation as blocked.
    stores.reservations.reserve({
      correlationId: stores.store.getBindingByCorrelation(CID)!.correlationId,
      sliceRef: SLICE,
      authoritativeRunRef: null,
      workloadId: 'w1',
      now: '2026-09-12T00:00:00Z'
    })
    const outcome = reconcileIncompleteReservations(
      {
        plane: {
          openShadowRun: async () => {
            throw new Error('unused')
          },
          runShadowWorkload: async () => {
            throw new Error('unused')
          },
          settleShadow: async () => {
            throw new Error('unused')
          },
          abandonShadow: async () => {},
          findShadowRunByCorrelation: () => ({
            orcaRunRef: { toString: () => RUN } as never,
            orcaDispatchRef: { toString: () => DISPATCH } as never,
            orgTaskRef: { toString: () => 'task_1' } as never,
            settled: true
          })
        },
        store: stores.store,
        reservations: stores.reservations
        // NOTE: no `incidents` dep passed — S2 never sees the S3 channel.
      },
      { sliceRef: SLICE, now: '2026-09-12T00:00:00Z' }
    )
    // settled + terminal -> left for convergence, never abandoned; unaffected
    // by the S3-only block.
    expect(outcome.abandoned).toHaveLength(0)
  })
})
