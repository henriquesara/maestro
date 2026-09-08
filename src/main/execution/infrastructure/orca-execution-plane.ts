import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { TaskRow } from '../../runtime/orchestration/types'
import {
  ExecutionPlaneError,
  type ExecutionPlane,
  type OpenedShadowRun
} from '../application/execution-plane'
import {
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef,
  type CorrelationId,
  type GovernanceAgentRunRef,
  type OrcaDispatchRef,
  type OrcaRunRef,
  type OrgTaskRef
} from '../domain/execution-identity'
import type { ExecutionOutcome } from '../domain/parity'
import type { ShadowExecutionResult, WorkloadSpec } from '../domain/workload-spec'
import { applyWorkload, git, initSeededWorktree, toExecutionOutcome } from './workload-git-runtime'

// Execution bounded context — infrastructure. The Orca adapter: implements the
// ExecutionPlane over a *shadow* OrchestrationDb + disposable git worktrees.
// Orca row types never leave this file (amendment §P.6). Advisory only.
//
// Blocker B2: the correlation id is written into the shadow task `spec` so it is
// durable ON THE ORCA SIDE and a crash after Dispatch creation reconciles
// deterministically. Blocker B3: settleShadow / runShadowWorkload validate that
// the Dispatch genuinely belongs to the given run on the production path.

const CORRELATION_KEY = 'orcaS1CorrelationId'

type ShadowRunState = {
  taskId: string
  runId: string
  worktreeDir: string
  baseCommit: string
}

function parseCorrelation(spec: string): string | undefined {
  try {
    const parsed = JSON.parse(spec) as Record<string, unknown>
    const value = parsed[CORRELATION_KEY]
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

export class OrcaExecutionPlane implements ExecutionPlane {
  // Within-call cache ONLY — never the correctness authority (blocker B2). Every
  // path falls back to the shadow OrchestrationDb keyed by correlation id.
  private readonly cache = new Map<string, ShadowRunState>()

  constructor(
    private readonly orchestration: OrchestrationDb,
    private readonly coordinatorPaneKey: string
  ) {}

  async openShadowRun(input: {
    sliceRef: string
    workloadId: string
    correlationId: CorrelationId
    governanceAgentRunId: GovernanceAgentRunRef
    worktreeDir: string
    seededFiles: readonly { path: string; content: string }[]
    postBaseFiles: readonly { path: string; content: string }[]
  }): Promise<OpenedShadowRun> {
    try {
      const run = this.orchestration.createRun({
        objective: `${input.sliceRef} shadow ${input.workloadId}`,
        coordinatorHandle: 'term_orca_s1_shadow_coord',
        coordinatorPaneKey: this.coordinatorPaneKey
      })
      const task = this.orchestration.createTask({
        spec: JSON.stringify({
          [CORRELATION_KEY]: String(input.correlationId),
          sliceRef: input.sliceRef,
          workloadId: input.workloadId
        }),
        runId: run.id
      })
      const dispatch = this.orchestration.createDispatchContext({
        taskId: task.id,
        assigneeHandle: `term_orca_s1_shadow_${input.workloadId}`,
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER
      })

      const baseCommit = initSeededWorktree(
        input.worktreeDir,
        input.seededFiles,
        input.postBaseFiles
      )
      this.cache.set(String(dispatch.id), {
        taskId: task.id,
        runId: run.id,
        worktreeDir: input.worktreeDir,
        baseCommit
      })
      return {
        orcaRunRef: makeOrcaRunRef(run.id),
        orcaDispatchRef: makeOrcaDispatchRef(dispatch.id),
        orgTaskRef: makeOrgTaskRef(task.id),
        baseCommit
      }
    } catch (error) {
      if (error instanceof ExecutionPlaneError) {
        throw error
      }
      throw new ExecutionPlaneError('open_failed', `openShadowRun failed: ${String(error)}`)
    }
  }

  async runShadowWorkload(input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    workload: WorkloadSpec
  }): Promise<ShadowExecutionResult> {
    const state = this.requirePair(input.orcaRunRef, input.orcaDispatchRef)
    const result = applyWorkload(input.workload, state.worktreeDir, state.baseCommit)
    return {
      exitCode: result.exitCode,
      filesChanged: result.filesChanged,
      cancelled: result.cancelled,
      cancelledMidFlight: result.cancelledMidFlight
    }
  }

  async settleShadow(input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    result: ShadowExecutionResult
  }): Promise<{ candidateHead: string; outcome: ExecutionOutcome }> {
    const state = this.requirePair(input.orcaRunRef, input.orcaDispatchRef)

    const worklikeOutcome: 'succeeded' | 'failed' =
      input.result.cancelled || input.result.exitCode === null
        ? 'failed'
        : input.result.exitCode === 0
          ? 'succeeded'
          : 'failed'

    const settlement = this.orchestration.settleWorkerReport({
      taskId: state.taskId,
      dispatchId: String(input.orcaDispatchRef),
      outcome: worklikeOutcome,
      result: JSON.stringify({
        provenance: 'orca_s1_shadow',
        exitCode: input.result.exitCode,
        cancelled: input.result.cancelled
      })
    })
    if (settlement.action === 'rejected') {
      throw new ExecutionPlaneError(
        'settle_failed',
        `Orca rejected shadow settlement: ${settlement.code}`
      )
    }
    const candidateHead = git(['rev-parse', 'HEAD'], state.worktreeDir)
    return { candidateHead, outcome: mapShadowOutcome(input.result) }
  }

  async abandonShadow(input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    reason: string
  }): Promise<void> {
    const state =
      this.cache.get(String(input.orcaDispatchRef)) ??
      this.hydrateFromDb(String(input.orcaDispatchRef))
    if (!state) {
      return
    }
    try {
      this.orchestration.settleWorkerReport({
        taskId: state.taskId,
        dispatchId: String(input.orcaDispatchRef),
        outcome: 'failed',
        result: JSON.stringify({ provenance: 'orca_s1_shadow_abandon', reason: input.reason })
      })
    } catch {
      // advisory-only teardown — a failure here never reaches the authoritative side
    }
    this.cache.delete(String(input.orcaDispatchRef))
  }

  findShadowRunByCorrelation(correlationId: CorrelationId):
    | {
        orcaRunRef: OrcaRunRef
        orcaDispatchRef: OrcaDispatchRef
        orgTaskRef: OrgTaskRef
        settled: boolean
      }
    | undefined {
    const task = this.orchestration
      .listTasks()
      .find((t: TaskRow) => parseCorrelation(t.spec) === String(correlationId))
    if (!task) {
      return undefined
    }
    const dispatch = this.orchestration.getDispatchContext(task.id)
    if (!dispatch) {
      return undefined
    }
    const settled =
      dispatch.status === 'completed' ||
      dispatch.status === 'failed' ||
      dispatch.status === 'circuit_broken'
    return {
      orcaRunRef: makeOrcaRunRef(task.run_id),
      orcaDispatchRef: makeOrcaDispatchRef(dispatch.id),
      orgTaskRef: makeOrgTaskRef(task.id),
      settled
    }
  }

  private requirePair(runRef: OrcaRunRef, dispatchRef: OrcaDispatchRef): ShadowRunState {
    const dispatchRow = this.orchestration.getDispatchContextById(String(dispatchRef))
    if (!dispatchRow) {
      throw new ExecutionPlaneError('dispatch_mismatch', `Unknown shadow Dispatch ${dispatchRef}.`)
    }
    // Blocker B3 — a valid Dispatch that belongs to a DIFFERENT run is rejected.
    if (dispatchRow.run_id !== String(runRef)) {
      throw new ExecutionPlaneError(
        'run_dispatch_pair_mismatch',
        `Dispatch ${dispatchRef} belongs to run ${dispatchRow.run_id}, not ${runRef}.`
      )
    }
    return (
      this.cache.get(String(dispatchRef)) ??
      this.hydrateFromDb(String(dispatchRef)) ??
      (() => {
        throw new ExecutionPlaneError(
          'dispatch_mismatch',
          `No shadow worktree state for Dispatch ${dispatchRef}.`
        )
      })()
    )
  }

  private hydrateFromDb(dispatchId: string): ShadowRunState | undefined {
    const dispatchRow = this.orchestration.getDispatchContextById(dispatchId)
    if (!dispatchRow) {
      return undefined
    }
    const task = this.orchestration.getTask(dispatchRow.task_id)
    if (!task) {
      return undefined
    }
    // Worktree dir / baseCommit are within-call state; a reconciler only needs
    // to know the run exists and settle/abandon it — it never re-executes.
    return { taskId: task.id, runId: task.run_id, worktreeDir: '', baseCommit: '' }
  }
}

function mapShadowOutcome(result: ShadowExecutionResult): ExecutionOutcome {
  return toExecutionOutcome({
    baseCommit: '',
    headCommit: '',
    exitCode: result.exitCode,
    cancelled: result.cancelled,
    cancelledMidFlight: result.cancelledMidFlight,
    filesChanged: result.filesChanged
  })
}
