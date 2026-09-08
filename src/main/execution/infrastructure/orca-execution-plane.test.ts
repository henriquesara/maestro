import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrcaExecutionPlane } from './orca-execution-plane'
import { DisposableShadowRoot } from './disposable-shadow-root'
import { ExecutionPlaneError } from '../application/execution-plane'
import { makeCorrelationId, makeGovernanceAgentRunRef } from '../domain/execution-identity'
import {
  SHADOW_COORD_PANE_KEY,
  workloadSpec
} from '../slices/shadow-identity-observation/shadow-observation.test-support'

// Integration: the real Orca adapter over a real (in-memory) OrchestrationDb and
// a real disposable shadow root. Proves open/run/settle, B3 (run/dispatch pair),
// and B2 (durable correlation marker on the Orca side).
describe('OrcaExecutionPlane (shadow, advisory only)', () => {
  let orch: OrchestrationDb | undefined
  let root: DisposableShadowRoot | undefined

  afterEach(() => {
    orch?.close()
    orch = undefined
    root?.cleanup()
    root = undefined
  })

  function makePlane() {
    orch = new OrchestrationDb(':memory:')
    root = DisposableShadowRoot.create()
    return new OrcaExecutionPlane(orch, SHADOW_COORD_PANE_KEY)
  }

  async function open(plane: OrcaExecutionPlane, workloadId: string, correlation: string) {
    return plane.openShadowRun({
      sliceRef: 'ORCA-S1',
      workloadId,
      correlationId: makeCorrelationId(correlation),
      governanceAgentRunId: makeGovernanceAgentRunRef(`gar_${workloadId}`),
      worktreeDir: root!.worktreeDir(`shadow-${workloadId}`),
      seededFiles: [],
      postBaseFiles: []
    })
  }

  it('opens, runs a synthetic workload, and settles — reporting real files_changed + a real candidate HEAD', async () => {
    const plane = makePlane()
    const opened = await open(plane, 'w1', 'corr_1')
    const result = await plane.runShadowWorkload({
      orcaRunRef: opened.orcaRunRef,
      orcaDispatchRef: opened.orcaDispatchRef,
      workload: workloadSpec('w1', [
        { op: 'write', path: 'src/a.txt', content: '1' },
        { op: 'write', path: 'src/b.txt', content: '2' },
        { op: 'exit', code: 0 }
      ])
    })
    expect([...result.filesChanged].sort()).toEqual(['src/a.txt', 'src/b.txt'])
    const settled = await plane.settleShadow({
      orcaRunRef: opened.orcaRunRef,
      orcaDispatchRef: opened.orcaDispatchRef,
      result
    })
    expect(settled.outcome.terminalOutcome).toBe('completed')
    expect(settled.candidateHead).toMatch(/^[0-9a-f]{40}$/)
  })

  it('B8: an attempted delete of a nonexistent path is NOT counted as a changed file', async () => {
    const plane = makePlane()
    const opened = await open(plane, 'wdel', 'corr_del')
    const result = await plane.runShadowWorkload({
      orcaRunRef: opened.orcaRunRef,
      orcaDispatchRef: opened.orcaDispatchRef,
      workload: workloadSpec('wdel', [
        { op: 'write', path: 'src/real.txt', content: '1' },
        { op: 'delete', path: 'src/does-not-exist.txt' },
        { op: 'exit', code: 0 }
      ])
    })
    expect([...result.filesChanged]).toEqual(['src/real.txt'])
  })

  it('B3: settling run A with a VALID Dispatch that belongs to run B is rejected on the production path', async () => {
    const plane = makePlane()
    const a = await open(plane, 'wA', 'corr_A')
    const b = await open(plane, 'wB', 'corr_B')
    await plane.runShadowWorkload({
      orcaRunRef: a.orcaRunRef,
      orcaDispatchRef: a.orcaDispatchRef,
      workload: workloadSpec('wA', [{ op: 'exit', code: 0 }])
    })
    let thrown: unknown
    try {
      await plane.settleShadow({
        orcaRunRef: a.orcaRunRef, // run A
        orcaDispatchRef: b.orcaDispatchRef, // but B's (valid) Dispatch
        result: { exitCode: 0, filesChanged: [], cancelled: false, cancelledMidFlight: false }
      })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ExecutionPlaneError)
    expect((thrown as ExecutionPlaneError).code).toBe('run_dispatch_pair_mismatch')
  })

  it('B2: the correlation id is durable on the Orca side — findShadowRunByCorrelation resolves it', async () => {
    const plane = makePlane()
    const opened = await open(plane, 'wc', 'corr_marker')
    const found = plane.findShadowRunByCorrelation(makeCorrelationId('corr_marker'))
    expect(found).toBeDefined()
    expect(String(found!.orcaDispatchRef)).toBe(String(opened.orcaDispatchRef))
    expect(found!.settled).toBe(false)
    expect(plane.findShadowRunByCorrelation(makeCorrelationId('never'))).toBeUndefined()
  })
})
