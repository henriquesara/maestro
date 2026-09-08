import SyncDatabase from '../../sqlite/sync-database'
import type { ExecutionStore, WorkloadExclusion } from '../application/execution-store'
import {
  makeAiControlRunRef,
  makeGovernanceAgentRunRef,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef,
  RunBindingError,
  type RunBinding
} from '../domain/execution-identity'
import type { ParityObservation } from '../domain/parity'

// Execution bounded context — infrastructure. SqliteExecutionStore: the only
// writer of run_binding / parity_observation / workload_exclusion (amendment §L).

type BindingRow = {
  orca_dispatch_id: string
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

export class SqliteExecutionStore implements ExecutionStore {
  private readonly db: SyncDatabase

  constructor(path: (string & {}) | ':memory:') {
    this.db = new SyncDatabase(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
  }

  get database(): SyncDatabase {
    return this.db
  }

  recordBinding(binding: RunBinding): void {
    try {
      this.db
        .prepare(
          `INSERT INTO run_binding (
             orca_dispatch_id, governance_agent_run_id, aicontrol_run_id, orca_run_id,
             org_task_id, slice_ref, base_commit, candidate_head, bound_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(binding.orcaDispatchId),
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
        message.includes('UNIQUE constraint failed: run_binding') ||
        message.includes('PRIMARY KEY')
      ) {
        throw new RunBindingError(
          'duplicate_dispatch',
          `Dispatch ${binding.orcaDispatchId} is already bound.`
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
           id, run_binding_dispatch_id, slice_ref, authoritative_json, shadow_json,
           parity_json, root_cause, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        observation.id,
        observation.runBindingDispatchId,
        observation.sliceRef,
        JSON.stringify(observation.authoritative),
        JSON.stringify(observation.shadow),
        JSON.stringify(observation.parity),
        observation.rootCause,
        observation.observedAt
      )
  }

  listParityObservations(sliceRef: string): ParityObservation[] {
    return (
      this.db
        .prepare('SELECT * FROM parity_observation WHERE slice_ref = ? ORDER BY observed_at, id')
        .all(sliceRef) as {
        id: string
        run_binding_dispatch_id: string
        slice_ref: string
        authoritative_json: string
        shadow_json: string
        parity_json: string
        root_cause: string | null
        observed_at: string
      }[]
    ).map((row) => ({
      id: row.id,
      runBindingDispatchId: row.run_binding_dispatch_id,
      sliceRef: row.slice_ref,
      authoritative: JSON.parse(row.authoritative_json) as ParityObservation['authoritative'],
      shadow: JSON.parse(row.shadow_json) as ParityObservation['shadow'],
      parity: JSON.parse(row.parity_json) as ParityObservation['parity'],
      rootCause: row.root_cause,
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

  close(): void {
    this.db.close()
  }
}
