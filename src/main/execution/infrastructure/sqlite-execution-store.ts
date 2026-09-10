import type SyncDatabase from '../../sqlite/sync-database'
import type { ExecutionStore, WorkloadExclusion } from '../application/execution-store'
import {
  makeAiControlRunRef,
  makeCorrelationId,
  makeGovernanceAgentRunRef,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef,
  RunBindingError,
  type RunBinding
} from '../domain/execution-identity'
import type { ParityObservation } from '../domain/parity'
import { DEFAULT_BUSY_RETRY_BUDGET, runWithImmediateTransaction } from './with-immediate-transaction'

// Execution bounded context — infrastructure. SqliteExecutionStore: the only
// writer of run_binding / parity_observation / workload_exclusion (amendment §L).
// Shares its SyncDatabase handle with SqliteReservationStore (one Execution store
// file, opened once by the composition root after the path-alias guard).

type BindingRow = {
  orca_dispatch_id: string
  correlation_id: string
  governance_agent_run_id: string
  aicontrol_run_id: string | null
  orca_run_id: string
  org_task_id: string
  slice_ref: string
  base_commit: string
  candidate_head: string | null
  bound_at: string
}

function toBinding(row: BindingRow): RunBinding {
  return {
    correlationId: makeCorrelationId(row.correlation_id),
    governanceAgentRunId: makeGovernanceAgentRunRef(row.governance_agent_run_id),
    aicontrolRunId:
      row.aicontrol_run_id === null ? null : makeAiControlRunRef(row.aicontrol_run_id),
    orcaRunId: makeOrcaRunRef(row.orca_run_id),
    orcaDispatchId: makeOrcaDispatchRef(row.orca_dispatch_id),
    orgTaskId: makeOrgTaskRef(row.org_task_id),
    sliceRef: row.slice_ref,
    baseCommit: row.base_commit,
    candidateHead: row.candidate_head,
    boundAt: row.bound_at
  }
}

type ObservationRow = {
  id: string
  run_binding_dispatch_id: string
  slice_ref: string
  workload_id: string
  authoritative_json: string
  shadow_json: string
  parity_json: string
  adjudications_json: string
  observed_at: string
}

export class SqliteExecutionStore implements ExecutionStore {
  constructor(private readonly db: SyncDatabase) {}

  get database(): SyncDatabase {
    return this.db
  }

  /** §16.1 — bounded SQLITE_BUSY acquisition retry budget for withImmediateTransaction. */
  readonly busyRetryBudget = DEFAULT_BUSY_RETRY_BUDGET

  /**
   * ORCA-S2 §16.1 — additive seam. BEGIN IMMEDIATE; fn(); COMMIT / ROLLBACK on
   * throw. Serialises Execution-store writers. On SQLITE_BUSY retry-budget
   * exhaustion throws ExecutionStoreBusyError with no partial state and no open
   * transaction. No existing method changes.
   */
  withImmediateTransaction<T>(fn: () => T): T {
    return runWithImmediateTransaction(this.db, fn, this.busyRetryBudget)
  }

  recordBinding(binding: RunBinding): void {
    try {
      this.db
        .prepare(
          `INSERT INTO run_binding (
             orca_dispatch_id, correlation_id, governance_agent_run_id, aicontrol_run_id,
             orca_run_id, org_task_id, slice_ref, base_commit, candidate_head, bound_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(binding.orcaDispatchId),
          String(binding.correlationId),
          String(binding.governanceAgentRunId),
          binding.aicontrolRunId === null ? null : String(binding.aicontrolRunId),
          String(binding.orcaRunId),
          String(binding.orgTaskId),
          binding.sliceRef,
          binding.baseCommit,
          binding.candidateHead,
          binding.boundAt
        )
    } catch (error) {
      const message = String(error)
      if (
        message.includes('run_binding.aicontrol_run_id') ||
        message.includes('run_binding_aicontrol_run_unique')
      ) {
        throw new RunBindingError(
          'duplicate_aicontrol_run',
          `aiControlCenter run ${binding.aicontrolRunId} is already bound.`
        )
      }
      if (
        message.includes('run_binding.orca_dispatch_id') ||
        message.includes('run_binding.correlation_id') ||
        message.includes('UNIQUE constraint failed: run_binding') ||
        message.includes('PRIMARY KEY')
      ) {
        throw new RunBindingError(
          'duplicate_dispatch',
          `Dispatch ${binding.orcaDispatchId} / correlation ${binding.correlationId} is already bound.`
        )
      }
      throw error
    }
  }

  getBindingByDispatch(orcaDispatchId: string): RunBinding | undefined {
    const row = this.db
      .prepare('SELECT * FROM run_binding WHERE orca_dispatch_id = ?')
      .get(orcaDispatchId) as BindingRow | undefined
    return row ? toBinding(row) : undefined
  }

  getBindingByCorrelation(correlationId: string): RunBinding | undefined {
    const row = this.db
      .prepare('SELECT * FROM run_binding WHERE correlation_id = ?')
      .get(correlationId) as BindingRow | undefined
    return row ? toBinding(row) : undefined
  }

  setBindingCandidateHead(orcaDispatchId: string, candidateHead: string): void {
    this.db
      .prepare('UPDATE run_binding SET candidate_head = ? WHERE orca_dispatch_id = ?')
      .run(candidateHead, orcaDispatchId)
  }

  listBindings(sliceRef: string): RunBinding[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM run_binding WHERE slice_ref = ? ORDER BY bound_at, orca_dispatch_id'
        )
        .all(sliceRef) as BindingRow[]
    ).map(toBinding)
  }

  recordParityObservation(observation: ParityObservation): void {
    this.db
      .prepare(
        `INSERT INTO parity_observation (
           id, run_binding_dispatch_id, slice_ref, workload_id, authoritative_json,
           shadow_json, parity_json, adjudications_json, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        observation.id,
        observation.runBindingDispatchId,
        observation.sliceRef,
        observation.workloadId,
        JSON.stringify(observation.authoritative),
        JSON.stringify(observation.shadow),
        JSON.stringify(observation.parity),
        JSON.stringify(observation.adjudications),
        observation.observedAt
      )
  }

  listParityObservations(sliceRef: string): ParityObservation[] {
    return (
      this.db
        .prepare('SELECT * FROM parity_observation WHERE slice_ref = ? ORDER BY observed_at, id')
        .all(sliceRef) as ObservationRow[]
    ).map((row) => ({
      id: row.id,
      runBindingDispatchId: row.run_binding_dispatch_id,
      sliceRef: row.slice_ref,
      workloadId: row.workload_id,
      authoritative: JSON.parse(row.authoritative_json) as ParityObservation['authoritative'],
      shadow: JSON.parse(row.shadow_json) as ParityObservation['shadow'],
      parity: JSON.parse(row.parity_json) as ParityObservation['parity'],
      adjudications: JSON.parse(row.adjudications_json) as ParityObservation['adjudications'],
      observedAt: row.observed_at
    }))
  }

  recordExclusion(exclusion: WorkloadExclusion): void {
    this.db
      .prepare(
        `INSERT INTO workload_exclusion (id, slice_ref, workload_id, code, reason, excluded_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        exclusion.id,
        exclusion.sliceRef,
        exclusion.workloadId,
        exclusion.code,
        exclusion.reason,
        exclusion.excludedAt
      )
  }

  listExclusions(sliceRef: string): WorkloadExclusion[] {
    return (
      this.db
        .prepare('SELECT * FROM workload_exclusion WHERE slice_ref = ? ORDER BY excluded_at, id')
        .all(sliceRef) as {
        id: string
        slice_ref: string
        workload_id: string
        code: string
        reason: string
        excluded_at: string
      }[]
    ).map((row) => ({
      id: row.id,
      sliceRef: row.slice_ref,
      workloadId: row.workload_id,
      code: row.code as WorkloadExclusion['code'],
      reason: row.reason,
      excludedAt: row.excluded_at
    }))
  }
}
