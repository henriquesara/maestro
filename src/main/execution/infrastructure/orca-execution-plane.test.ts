import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrcaExecutionPlane } from './orca-execution-plane'
import { ExecutionPlaneError } from '../application/execution-plane'
import { makeGovernanceAgentRunRef, makeOrcaDispatchRef } from '../domain/execution-identity'
import {
  COORD_PANE_KEY,
  makeTmpDir,
  syntheticWorkload
} from '../slices/shadow-identity-observation/shadow-observation.test-support'

// Integration: the real Orca adapter over a real (in-memory) OrchestrationDb and
// real disposable git worktrees. Proves open/run/settle and I4 (wrong Dispatch).
describe('OrcaExecutionPlane (shadow, advisory only)', () => {
  const cleanups: (() => void)[] = []
  let orch: OrchestrationDb | undefined

  afterEach(() => {
    orch?.close()
    orch = undefined
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  function makePlane() {
    orch = new OrchestrationDb(':memory:')
    const root = makeTmpDir('orca-s1-wt-')
    cleanups.push(root.cleanup)
    let n = 0
    const plane = new OrcaExecutionPlane(orch, COORD_PANE_KEY, (id) =>
      join(root.dir, `wt_${++n}_${id}`)
    )
    return plane
  }

  it('opens, runs a synthetic workload and settles a shadow run — reporting files changed and a real candidate HEAD', async () => {
    const plane = makePlane()
    const opened = await plane.openShadowRun({
      sliceRef: 'ORCA-S1',
      workloadId: 'w1',
      baseCommit: 'shadow-base',
      governanceAgentRunId: makeGovernanceAgentRunRef('gar_1')
    })
    const result = await plane.runShadowWorkload({
      orcaDispatchRef: opened.orcaDispatchRef,
      workload: syntheticWorkload('w1', [
        { op: 'write', path: 'src/a.txt', content: '1' },
        { op: 'write', path: 'src/b.txt', content: '2' },
        { op: 'exit', code: 0 }
      ]),
      worktreeDir: 'ignored-adapter-owns-it'
    })
    expect(result.exitCode).toBe(0)
    expect([...result.filesChanged].sort()).toEqual(['src/a.txt', 'src/b.txt'])

    const settled = await plane.settleShadow({
      orcaRunRef: opened.orcaRunRef,
      orcaDispatchRef: opened.orcaDispatchRef,
      result
    })
    expect(settled.outcome.terminalOutcome).toBe('completed')
    expect(settled.candidateHead).toMatch(/^[0-9a-f]{40}$/)
  })

  it('maps a non-zero exit to failed / non_zero_exit', async () => {
    const plane = makePlane()
    const opened = await plane.openShadowRun({
      sliceRef: 'ORCA-S1',
      workloadId: 'w2',
      baseCommit: 'shadow-base',
      governanceAgentRunId: makeGovernanceAgentRunRef('gar_2')
    })
    const result = await plane.runShadowWorkload({
      orcaDispatchRef: opened.orcaDispatchRef,
      workload: syntheticWorkload('w2', [
        { op: 'write', path: 'src/x.txt', content: '1' },
        { op: 'exit', code: 2 }
      ]),
      worktreeDir: 'x'
    })
    const settled = await plane.settleShadow({
      orcaRunRef: opened.orcaRunRef,
      orcaDispatchRef: opened.orcaDispatchRef,
      result
    })
    expect(settled.outcome.terminalOutcome).toBe('failed')
    expect(settled.outcome.exitDisposition).toBe('non_zero_exit')
  })

  it('I4: settling through a Dispatch ref that is not a known shadow run is rejected', async () => {
    const plane = makePlane()
    const opened = await plane.openShadowRun({
      sliceRef: 'ORCA-S1',
      workloadId: 'w3',
      baseCommit: 'shadow-base',
      governanceAgentRunId: makeGovernanceAgentRunRef('gar_3')
    })
    const result = await plane.runShadowWorkload({
      orcaDispatchRef: opened.orcaDispatchRef,
      workload: syntheticWorkload('w3', [{ op: 'exit', code: 0 }]),
      worktreeDir: 'x'
    })
    let thrown: unknown
    try {
      await plane.settleShadow({
        orcaRunRef: opened.orcaRunRef,
        orcaDispatchRef: makeOrcaDispatchRef('ctx_not_a_real_shadow_dispatch'),
        result
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ExecutionPlaneError)
    expect((thrown as ExecutionPlaneError).code).toBe('dispatch_mismatch')
  })
})
