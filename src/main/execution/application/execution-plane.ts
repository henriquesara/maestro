// Execution bounded context — application. The port the domain talks to.
// NO Orca row types here (amendment §P.6). Only opaque refs + value objects.

import type {
  CorrelationId,
  GovernanceAgentRunRef,
  OrcaDispatchRef,
  OrcaRunRef,
  OrgTaskRef
} from '../domain/execution-identity'
import type { ExecutionOutcome } from '../domain/parity'
import type { ShadowExecutionResult, WorkloadSpec } from '../domain/workload-spec'

export type { ShadowExecutionResult, WorkloadSpec } from '../domain/workload-spec'

export type ExecutionPlaneErrorCode =
  | 'dispatch_mismatch'
  | 'run_dispatch_pair_mismatch'
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

export type OpenedShadowRun = {
  orcaRunRef: OrcaRunRef
  orcaDispatchRef: OrcaDispatchRef
  orgTaskRef: OrgTaskRef
  baseCommit: string
}

/**
 * The shadow execution plane. An implementation is an infrastructure adapter
 * (the Orca adapter). Advisory only — nothing here touches an authoritative run
 * or `data/app.db`.
 */
export type ExecutionPlane = {
  openShadowRun(input: {
    sliceRef: string
    workloadId: string
    correlationId: CorrelationId
    governanceAgentRunId: GovernanceAgentRunRef
    worktreeDir: string
    seededFiles: readonly { path: string; content: string }[]
    /** Untracked-after-base content the shadow input worktree carried (amendment 001 §4). */
    postBaseFiles: readonly { path: string; content: string }[]
  }): Promise<OpenedShadowRun>

  runShadowWorkload(input: {
    orcaRunRef: OrcaRunRef
    orcaDispatchRef: OrcaDispatchRef
    workload: WorkloadSpec
  }): Promise<ShadowExecutionResult>

  /**
   * Blocker B3 — validates that `orcaDispatchRef` genuinely belongs to
   * `orcaRunRef` (a valid-but-foreign Dispatch, or a stale one, is rejected)
   * on the production path, before any settlement write.
   */
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

  /**
   * Reconciliation lookup (blocker B2) — resolves a durable correlation id to
   * the shadow run/dispatch state, reading the marker persisted on the Orca
   * side. Returns undefined when no shadow Dispatch was ever created.
   */
  findShadowRunByCorrelation(correlationId: CorrelationId):
    | {
        orcaRunRef: OrcaRunRef
        orcaDispatchRef: OrcaDispatchRef
        orgTaskRef: OrgTaskRef
        settled: boolean
      }
    | undefined
}
