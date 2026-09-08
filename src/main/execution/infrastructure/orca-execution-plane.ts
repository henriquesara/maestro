import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runProcessSync } from '../../../shared/child-process/run-process'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import {
  ExecutionPlaneError,
  type ExecutionPlane,
  type ShadowExecutionResult,
  type SyntheticWorkload
} from '../application/execution-plane'
import {
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef,
  type GovernanceAgentRunRef,
  type OrcaDispatchRef,
  type OrcaRunRef,
  type OrgTaskRef
} from '../domain/execution-identity'
import { filesChangedSet, type ExecutionOutcome } from '../domain/parity'

// Execution bounded context — infrastructure. The Orca adapter: implements the
// ExecutionPlane port over a *shadow* OrchestrationDb + disposable git worktrees.
// Orca row types never leave this file (amendment §P.6). Advisory only — this
// never touches an authoritative run or data/app.db.

type ShadowRunState = {
  taskId: string
  runId: string
  worktreeDir: string
  baseCommit: string
}

function git(args: string[], cwd: string): string {
  const result = runProcessSync({ program: 'git', args, cwd, timeoutMs: 20_000 })
  if (result.code !== 0) {
    throw new ExecutionPlaneError(
      'run_failed',
      `git ${args.join(' ')} failed: ${result.stderr.trim()}`
    )
  }
  return result.stdout.trim()
}

export class OrcaExecutionPlane implements ExecutionPlane {
  private readonly runs = new Map<string, ShadowRunState>()

  constructor(
    private readonly orchestration: OrchestrationDb,
    private readonly coordinatorPaneKey: string,
    private readonly worktreeFactory: (workloadId: string) => string
  ) {}

  async openShadowRun(input: {
    sliceRef: string
    workloadId: string
    baseCommit: string
    governanceAgentRunId: GovernanceAgentRunRef
  }): Promise<{
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    orgTaskRef: OrgTaskRef
  }> {
    try {
      const run = this.orchestration.createRun({
        objective: `${input.sliceRef} shadow: ${input.workloadId}`,
        coordinatorHandle: 'term_shadow_coord',
        coordinatorPaneKey: this.coordinatorPaneKey
      })
      const task = this.orchestration.createTask({
        spec: `shadow workload ${input.workloadId}`,
        runId: run.id
      })
      const dispatch = this.orchestration.createDispatchContext({
        taskId: task.id,
        assigneeHandle: `term_shadow_${input.workloadId}`,
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER
      })

      const worktreeDir = this.worktreeFactory(input.workloadId)
      mkdirSync(worktreeDir, { recursive: true })
      git(['init', '-q'], worktreeDir)
      git(['config', 'user.email', 'shadow@orca-s1.local'], worktreeDir)
      git(['config', 'user.name', 'orca-s1-shadow'], worktreeDir)
      git(['config', 'commit.gpgsign', 'false'], worktreeDir)
      writeFileSync(join(worktreeDir, '.orca-s1-seed'), 'seed\n')
      git(['add', '-A'], worktreeDir)
      git(['commit', '-q', '-m', 'shadow base'], worktreeDir)
      const baseCommit = git(['rev-parse', 'HEAD'], worktreeDir)

      this.runs.set(String(dispatch.id), {
        taskId: task.id,
        runId: run.id,
        worktreeDir,
        baseCommit
      })
      return {
        orcaRunRef: makeOrcaRunRef(run.id),
        orcaDispatchRef: makeOrcaDispatchRef(dispatch.id),
        orgTaskRef: makeOrgTaskRef(task.id)
      }
    } catch (error) {
      if (error instanceof ExecutionPlaneError) {
        throw error
      }
      throw new ExecutionPlaneError('open_failed', `openShadowRun failed: ${String(error)}`)
    }
  }

  async runShadowWorkload(input: {
    orcaDispatchRef: OrcaDispatchRef
    workload: SyntheticWorkload
    worktreeDir: string
  }): Promise<ShadowExecutionResult> {
    const state = this.requireRun(input.orcaDispatchRef)
    let exitCode: number | null = null
    let cancelled = false
    let cancelledMidFlight = false
    const touched: string[] = []

    for (const step of input.workload.steps) {
      if (step.op === 'write') {
        const full = join(state.worktreeDir, step.path)
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, step.content)
        touched.push(step.path)
      } else if (step.op === 'delete') {
        rmSync(join(state.worktreeDir, step.path), { force: true })
        touched.push(step.path)
      } else if (step.op === 'exit') {
        exitCode = step.code
        break
      } else if (step.op === 'cancel') {
        cancelled = true
        cancelledMidFlight = step.midFlight
        break
      }
    }

    git(['add', '-A'], state.worktreeDir)
    // Allow an empty commit so a pure cancel still advances HEAD deterministically.
    git(['commit', '-q', '--allow-empty', '-m', `shadow ${input.workload.id}`], state.worktreeDir)
    const filesChanged = git(
      ['diff', '--name-only', `${state.baseCommit}..HEAD`],
      state.worktreeDir
    )
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    return {
      exitCode: cancelled ? null : exitCode,
      filesChanged: filesChangedSet([...touched, ...filesChanged]),
      cancelled,
      cancelledMidFlight
    }
  }

  async settleShadow(input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    result: ShadowExecutionResult
  }): Promise<{ candidateHead: string; outcome: ExecutionOutcome }> {
    const state = this.requireRun(input.orcaDispatchRef)
    // I4 — Orca itself rejects a settlement whose (taskId, dispatchId) do not
    // match; this guard makes the check explicit and testable at the port.
    const dispatchRow = this.orchestration.getDispatchContextById(String(input.orcaDispatchRef))
    if (!dispatchRow || dispatchRow.task_id !== state.taskId) {
      throw new ExecutionPlaneError(
        'dispatch_mismatch',
        `Dispatch ${input.orcaDispatchRef} does not belong to shadow task ${state.taskId}.`
      )
    }

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

    return {
      candidateHead,
      outcome: mapShadowOutcome(input.result)
    }
  }

  async abandonShadow(input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    reason: string
  }): Promise<void> {
    const state = this.runs.get(String(input.orcaDispatchRef))
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
      // Advisory-only teardown: a shadow abandon that itself fails is not
      // allowed to escape — the authoritative side is untouched regardless.
    }
    this.runs.delete(String(input.orcaDispatchRef))
  }

  private requireRun(dispatchRef: OrcaDispatchRef): ShadowRunState {
    const state = this.runs.get(String(dispatchRef))
    if (!state) {
      throw new ExecutionPlaneError('dispatch_mismatch', `Unknown shadow Dispatch ${dispatchRef}.`)
    }
    return state
  }
}

function mapShadowOutcome(result: ShadowExecutionResult): ExecutionOutcome {
  if (result.cancelled) {
    return {
      terminalOutcome: 'cancelled',
      exitDisposition: 'no_exit',
      cancellationBehavior: result.cancelledMidFlight ? 'cancelled_mid_flight' : 'cancelled_clean',
      filesChanged: filesChangedSet(result.filesChanged)
    }
  }
  const zero = result.exitCode === 0
  return {
    terminalOutcome: zero ? 'completed' : 'failed',
    exitDisposition: result.exitCode === null ? 'no_exit' : zero ? 'zero_exit' : 'non_zero_exit',
    cancellationBehavior: 'not_cancelled',
    filesChanged: filesChangedSet(result.filesChanged)
  }
}
