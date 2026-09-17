import type SyncDatabase from '../../sqlite/sync-database'
import type {
  DelegationCutoverAckStatus,
  DelegationCutoverRecord
} from '../domain/delegation-cutover'
import { DELEGATED_CUTOVER_SQL } from './execution-schema'

// Execution bounded context — infrastructure. The only writer of
// delegation_cutover (SPEC §8.1). Durable SOURCE state — never touched by a
// projection rebuild. correlation_id is the PRIMARY KEY: a second insert for
// the same id throws (write-once), never a silent overwrite.

type Row = {
  correlation_id: string
  orca_dispatch_id: string
  orca_run_id: string
  aicontrol_run_id: string
  fence_token: string
  cutover_digest: string
  cutover_at: string
  ack_status: string
}

function toRecord(row: Row): DelegationCutoverRecord {
  return {
    correlationId: row.correlation_id,
    orcaDispatchId: row.orca_dispatch_id,
    orcaRunId: row.orca_run_id,
    aicontrolRunId: row.aicontrol_run_id,
    fenceToken: row.fence_token,
    cutoverDigest: row.cutover_digest,
    cutoverAt: row.cutover_at,
    ackStatus: row.ack_status as DelegationCutoverAckStatus
  }
}

export class SqliteDelegationCutoverStore {
  constructor(private readonly db: SyncDatabase) {}

  private ensureSchema(): void {
    this.db.exec(DELEGATED_CUTOVER_SQL)
  }

  insert(record: Omit<DelegationCutoverRecord, 'ackStatus'>): void {
    this.ensureSchema()
    this.db
      .prepare(
        `INSERT INTO delegation_cutover (
           correlation_id, orca_dispatch_id, orca_run_id, aicontrol_run_id,
           fence_token, cutover_digest, cutover_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.correlationId,
        record.orcaDispatchId,
        record.orcaRunId,
        record.aicontrolRunId,
        record.fenceToken,
        record.cutoverDigest,
        record.cutoverAt
      )
  }

  get(correlationId: string): DelegationCutoverRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM delegation_cutover WHERE correlation_id = ?')
      .get(correlationId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  getByAicontrolRun(aicontrolRunId: string): DelegationCutoverRecord | undefined {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT * FROM delegation_cutover WHERE aicontrol_run_id = ?')
      .get(aicontrolRunId) as Row | undefined
    return row ? toRecord(row) : undefined
  }
}
