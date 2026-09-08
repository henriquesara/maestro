// Execution bounded context — application. The port the domain talks to.
// NO Orca row types here (amendment §P.6). Only opaque refs + value objects.

import type {
  GovernanceAgentRunRef,
  OrcaDispatchRef,
  OrcaRunRef,
  OrgTaskRef
} from '../domain/execution-identity'
import type { ExecutionOutcome } from '../domain/parity'

/** A deterministic, repo-local, code-only workload — the only kind this slice dispatches. */
export type WorkloadStep =
  | { op: 'write'; path: string; content: string }
  | { op: 'delete'; path: string }
  | { op: 'exit'; code: number }
  | { op: 'cancel'; midFlight: boolean }

export type SyntheticWorkload = {
  id: string
  steps: readonly WorkloadStep[]
}

export type ShadowExecutionResult = {
  exitCode: number | null
  filesChanged: readonly string[]
  cancelled: boolean
  cancelledMidFlight: boolean
  error?: string
}

export type ExecutionPlaneErrorCode =
  | 'dispatch_mismatch'
  | 'open_failed'
  | 'run_failed'
  | 'settle_failed'

export class ExecutionPlaneError extends Error {
  constructor(
    readonly code: ExecutionPlaneErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ExecutionPlaneError'
  }
}

/**
 * The shadow execution plane. An implementation is an infrastructure adapter
 * (e.g. the Orca adapter). Advisory only — nothing here touches an authoritative
 * run or `data/app.db`.
 */
export type ExecutionPlane = {
  openShadowRun(input: {
    sliceRef: string
    workloadId: string
    baseCommit: string
    governanceAgentRunId: GovernanceAgentRunRef
  }): Promise<{ orcaRunRef: OrcaRunRef; orcaDispatchRef: OrcaDispatchRef; orgTaskRef: OrgTaskRef }>

  runShadowWorkload(input: {
    orcaDispatchRef: OrcaDispatchRef
    workload: SyntheticWorkload
    worktreeDir: string
  }): Promise<ShadowExecutionResult>

  settleShadow(input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    result: ShadowExecutionResult
  }): Promise<{ candidateHead: string; outcome: ExecutionOutcome }>

  abandonShadow(input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    reason: string
  }): Promise<void>
}
