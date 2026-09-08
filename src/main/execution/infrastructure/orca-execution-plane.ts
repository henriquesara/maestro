import type { OrchestrationDb } from '../../runtime/orchestration/db'
import {
  ExecutionPlaneError,
  type ExecutionPlane,
  type ShadowExecutionResult,
  type SyntheticWorkload
} from '../application/execution-plane'
import type {
  GovernanceAgentRunRef,
  OrcaDispatchRef,
  OrcaRunRef,
  OrgTaskRef
} from '../domain/execution-identity'
import type { ExecutionOutcome } from '../domain/parity'

// Execution bounded context — infrastructure. The Orca adapter: implements the
// ExecutionPlane port over a *shadow* OrchestrationDb. Orca row types
// (DispatchContextRow, TaskRow, RunRow) never leave this file (amendment §P.6).
// RED: not implemented yet.

export type ApplyWorkload = (input: {
  worktreeDir: string
  workload: SyntheticWorkload
}) => ShadowExecutionResult

export class OrcaExecutionPlane implements ExecutionPlane {
  constructor(
    private readonly orchestration: OrchestrationDb,
    private readonly coordinatorPaneKey: string,
    private readonly applyWorkload: ApplyWorkload
  ) {}

  openShadowRun(_input: {
    sliceRef: string
    workloadId: string
    baseCommit: string
    governanceAgentRunId: GovernanceAgentRunRef
  }): Promise<{ orcaRunRef: OrcaRunRef; orcaDispatchRef: OrcaDispatchRef; orgTaskRef: OrgTaskRef }> {
    throw new ExecutionPlaneError('open_failed', 'NOT_IMPLEMENTED: openShadowRun')
  }

  runShadowWorkload(_input: {
    orcaDispatchRef: OrcaDispatchRef
    workload: SyntheticWorkload
    worktreeDir: string
  }): Promise<ShadowExecutionResult> {
    throw new ExecutionPlaneError('run_failed', 'NOT_IMPLEMENTED: runShadowWorkload')
  }

  settleShadow(_input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    result: ShadowExecutionResult
  }): Promise<{ candidateHead: string; outcome: ExecutionOutcome }> {
    throw new ExecutionPlaneError('settle_failed', 'NOT_IMPLEMENTED: I4 settleShadow')
  }

  abandonShadow(_input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    reason: string
  }): Promise<void> {
    throw new ExecutionPlaneError('settle_failed', 'NOT_IMPLEMENTED: abandonShadow')
  }
}
