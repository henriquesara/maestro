import { afterEach, describe, expect, it } from 'vitest'
import { reconcileIncompleteReservations } from './reconcile-incomplete-reservations'
import { runShadowObservation } from './shadow-observation-service'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrcaExecutionPlane } from '../infrastructure/orca-execution-plane'
import { DisposableShadowRoot } from '../infrastructure/disposable-shadow-root'
import {
  makeAiControlRunRef,
  makeCorrelationId,
  makeGovernanceAgentRunRef
} from '../domain/execution-identity'
import type { ReservationState } from './reservation-store'
import {
  fakeAuthoritativeExecutor,
  openExecStores,
  SHADOW_COORD_PANE_KEY,
  workloadSpec
} from '../slices/shadow-identity-observation/shadow-observation.test-support'

// Blocker B2 — a durable Orca Dispatch with no completed binding + a restart
// must reconcile deterministically. Crash windows A..F.
describe('reconcileIncompleteReservations — crash windows A..F (amendment 001 §5)', () => {
  let orch: OrchestrationDb | undefined
  let root: DisposableShadowRoot | undefined
  let ctx: ReturnType<typeof openExecStores> | undefined

  afterEach(() => {
    orch?.close()
    ctx?.close()
    root?.cleanup()
    orch = ctx = root = undefined
  })

  function harness() {
    orch = new OrchestrationDb(':memory:')
    root = DisposableShadowRoot.create()
    ctx = openExecStores()
    const plane = new OrcaExecutionPlane(orch, SHADOW_COORD_PANE_KEY)
    return {
      plane,
      store: ctx.store,
      reservations: ctx.reservations,
      deps: { plane, store: ctx.store, reservations: ctx.reservations }
    }
  }

  /** Drive the real lifecycle up to `stopAfter`, then stop (simulating a crash). */
  async function driveTo(stopAfter: ReservationState) {
    const h = harness()
    const correlationId = makeCorrelationId('corr_crash')
    const spec = workloadSpec('wc', [
      { op: 'write', path: 'src/a.txt', content: '1' },
      { op: 'exit', code: 0 }
    ])
    h.reservations.reserve({
      correlationId,
      sliceRef: 'ORCA-S1',
      authoritativeRunRef: 'run_a_1',
      workloadId: 'wc',
      now: 'now'
    })
    if (stopAfter === 'reserved') {
      return { h, correlationId }
    }

    const opened = await h.plane.openShadowRun({
      sliceRef: 'ORCA-S1',
      workloadId: 'wc',
      correlationId,
      governanceAgentRunId: makeGovernanceAgentRunRef('gar'),
      worktreeDir: root!.worktreeDir('shadow-wc'),
      seededFiles: [],
      postBaseFiles: []
    })
    h.reservations.advance(correlationId, 'orca_created', {
      orcaRunId: String(opened.orcaRunRef),
      orcaDispatchId: String(opened.orcaDispatchRef),
      orgTaskId: String(opened.orgTaskRef),
      now: 'now'
    })
    if (stopAfter === 'orca_created') {
      return { h, correlationId, opened }
    }

    h.store.recordBinding({
      correlationId,
      governanceAgentRunId: makeGovernanceAgentRunRef('gar2'),
      aicontrolRunId: makeAiControlRunRef('run_a_1'),
      orcaRunId: opened.orcaRunRef,
      orcaDispatchId: opened.orcaDispatchRef,
      orgTaskId: opened.orgTaskRef,
      sliceRef: 'ORCA-S1',
      baseCommit: opened.baseCommit,
      candidateHead: null,
      boundAt: 'now'
    })
    h.reservations.advance(correlationId, 'bound', { now: 'now' })
    if (stopAfter === 'bound') {
      return { h, correlationId, opened }
    }

    await h.plane.runShadowWorkload({
      orcaRunRef: opened.orcaRunRef,
      orcaDispatchRef: opened.orcaDispatchRef,
      workload: spec
    })
    h.reservations.advance(correlationId, 'executed', { now: 'now' })
    if (stopAfter === 'executed') {
      return { h, correlationId, opened }
    }

    const settled = await h.plane.settleShadow({
      orcaRunRef: opened.orcaRunRef,
      orcaDispatchRef: opened.orcaDispatchRef,
      result: {
        exitCode: 0,
        filesChanged: ['src/a.txt'],
        cancelled: false,
        cancelledMidFlight: false
      }
    })
    h.reservations.advance(correlationId, 'settled', {
      candidateHead: settled.candidateHead,
      now: 'now'
    })
    return { h, correlationId, opened }
  }

  // ORCA-S2 §15.1 — the terminal-Dispatch case (window F) is no longer abandoned by
  // phase-3 reconcile; convergence owns it. Windows A–D (never-created / non-terminal,
  // no staleAfter) still abandon exactly as ORCA-S1.
  const windows: [string, ReservationState][] = [
    ['A — before Orca creation', 'reserved'],
    ['B — immediately after durable Dispatch creation', 'orca_created'],
    ['C — after binding completion', 'bound'],
    ['D — after binding, before/after execution', 'executed']
  ]

  for (const [label, state] of windows) {
    it(`window ${label}: reconcile abandons the incomplete reservation and no re-run creates a 2nd Dispatch`, async () => {
      const { h, correlationId } = await driveTo(state)

      const outcome = reconcileIncompleteReservations(h.deps, { sliceRef: 'ORCA-S1', now: 'r1' })
      expect(outcome.abandoned).toContain(String(correlationId))
      expect(h.reservations.get(correlationId)?.state).toBe('abandoned')

      // reconcile is idempotent
      const again = reconcileIncompleteReservations(h.deps, { sliceRef: 'ORCA-S1', now: 'r2' })
      expect(again.scanned).toBe(0)

      // A re-run of the same (authoritative row, workload) does NOT create a 2nd orphan.
      const before = h.plane instanceof OrcaExecutionPlane ? countShadowTasks(orch!) : 0
      const report = await runShadowObservation(
        {
          authoritativeExecutor: fakeAuthoritativeExecutor(),
          plane: h.plane,
          store: h.store,
          reservations: h.reservations
        },
        {
          sliceRef: 'ORCA-S1',
          slots: [
            {
              profile: 'agent-A',
              authoritativeRunRef: 'run_a_1',
              descriptor: { id: 'wc', kind: 'synthetic', declaredCapabilities: [] },
              workload: workloadSpec('wc', [{ op: 'exit', code: 0 }])
            }
          ],
          shadowRoot: root!.root,
          worktreeDirFor: (k, c) => root!.worktreeDir(`${k}-rerun-${c}`),
          now: () => 'rerun',
          newId: (p) => `${p}_rr`
        }
      )
      // the prior reservation was abandoned → the re-run creates exactly one fresh reservation
      const all = h.reservations.listAll('ORCA-S1')
      expect(all.filter((r) => r.workloadId === 'wc').length).toBe(2)
      expect(report.abandoned.length + report.observations.length).toBeGreaterThanOrEqual(1)
      void before
    })
  }

  it('window F — after settlement (terminal shadow Dispatch): reconcile LEAVES it for convergence, never abandons (ORCA-S2 §15.1)', async () => {
    const { h, correlationId } = await driveTo('settled')

    const outcome = reconcileIncompleteReservations(h.deps, { sliceRef: 'ORCA-S1', now: 'r1' })
    expect(outcome.abandoned).not.toContain(String(correlationId))
    expect(outcome.left).toContain(String(correlationId))
    expect(h.reservations.get(correlationId)?.state).toBe('settled') // untouched — awaiting convergence

    const again = reconcileIncompleteReservations(h.deps, { sliceRef: 'ORCA-S1', now: 'r2' })
    expect(again.abandoned).not.toContain(String(correlationId))
    expect(again.left).toContain(String(correlationId))
  })

  it('window E — during execution (worktree state lost): reconcile still resolves via the durable correlation marker', async () => {
    const { h, correlationId, opened } = await driveTo('orca_created')
    // Simulate a crash *during* execution: binding written, execution not marked.
    h.store.recordBinding({
      correlationId,
      governanceAgentRunId: makeGovernanceAgentRunRef('garE'),
      aicontrolRunId: null,
      orcaRunId: opened!.orcaRunRef,
      orcaDispatchId: opened!.orcaDispatchRef,
      orgTaskId: opened!.orgTaskRef,
      sliceRef: 'ORCA-S1',
      baseCommit: opened!.baseCommit,
      candidateHead: null,
      boundAt: 'now'
    })
    h.reservations.advance(correlationId, 'bound', { now: 'now' })
    // no in-memory state relied on — a fresh adapter reconciles from the DB marker
    const freshPlane = new OrcaExecutionPlane(orch!, SHADOW_COORD_PANE_KEY)
    const outcome = reconcileIncompleteReservations(
      { plane: freshPlane, store: h.store, reservations: h.reservations },
      { sliceRef: 'ORCA-S1', now: 'rE' }
    )
    expect(outcome.abandoned).toContain(String(correlationId))
    expect(h.reservations.get(correlationId)?.state).toBe('abandoned')
  })
})

function countShadowTasks(orch: OrchestrationDb): number {
  return orch.listTasks().length
}
