import SyncDatabase from '../../sqlite/sync-database'
import type { ExecutionStore, WorkloadExclusion } from '../application/execution-store'
import type { RunBinding } from '../domain/execution-identity'
import type { ParityObservation } from '../domain/parity'

// Execution bounded context — infrastructure. SqliteExecutionStore: the only
// writer of run_binding / parity_observation / workload_exclusion.
// RED: methods not implemented yet.

export class SqliteExecutionStore implements ExecutionStore {
  private readonly db: SyncDatabase

  constructor(path: (string & {}) | ':memory:') {
    this.db = new SyncDatabase(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    // migrateExecutionStore is applied by the slice composition root; kept out of
    // the constructor so a test can assert migration is explicit.
  }

  get database(): SyncDatabase {
    return this.db
  }

  recordBinding(_binding: RunBinding): void {
    throw new Error('NOT_IMPLEMENTED: I3 recordBinding')
  }

  getBindingByDispatch(_orcaDispatchId: string): RunBinding | undefined {
    throw new Error('NOT_IMPLEMENTED: getBindingByDispatch')
  }

  listBindings(_sliceRef: string): RunBinding[] {
    throw new Error('NOT_IMPLEMENTED: listBindings')
  }

  recordParityObservation(_observation: ParityObservation): void {
    throw new Error('NOT_IMPLEMENTED: recordParityObservation')
  }

  listParityObservations(_sliceRef: string): ParityObservation[] {
    throw new Error('NOT_IMPLEMENTED: listParityObservations')
  }

  recordExclusion(_exclusion: WorkloadExclusion): void {
    throw new Error('NOT_IMPLEMENTED: recordExclusion')
  }

  listExclusions(_sliceRef: string): WorkloadExclusion[] {
    throw new Error('NOT_IMPLEMENTED: listExclusions')
  }

  close(): void {
    this.db.close()
  }
}
