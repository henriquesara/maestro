// Execution bounded context — application. The narrow capability convergeSettlements
// needs from the Execution SQLite store (§16). Satisfied structurally by
// SqliteExecutionStore.withImmediateTransaction — BEGIN IMMEDIATE; fn(); COMMIT /
// ROLLBACK on throw; bounded SQLITE_BUSY acquisition retry → ExecutionStoreBusyError.

export type ExecutionTransactionRunner = {
  withImmediateTransaction<T>(fn: () => T): T
}
