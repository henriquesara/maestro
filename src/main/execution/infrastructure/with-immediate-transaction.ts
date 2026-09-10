import type SyncDatabase from '../../sqlite/sync-database'

// Execution bounded context — infrastructure. ORCA-S2 §16.1 — the additive
// `BEGIN IMMEDIATE` transaction seam. `BEGIN IMMEDIATE` serialises Execution-store
// writers. SQLITE_BUSY on acquiring the write lock is a BOUNDED retryable
// condition: retry the acquisition a small fixed number of times, then give up
// and signal EXECUTION_STORE_BUSY_RETRYABLE (no transaction left open, no partial
// state). No ORCA-S1 method changes.

/** Signal for EXECUTION_STORE_BUSY_RETRYABLE — the write transaction could not be acquired. */
export class ExecutionStoreBusyError extends Error {
  constructor(readonly attempts: number) {
    super(`Execution store write transaction not acquired after ${attempts} attempts (SQLITE_BUSY)`)
    this.name = 'ExecutionStoreBusyError'
  }
}

export const DEFAULT_BUSY_RETRY_BUDGET = 5

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const e = error as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown }
  return (
    e.code === 'SQLITE_BUSY' ||
    e.errcode === 5 ||
    (typeof e.errstr === 'string' && /busy|locked/i.test(e.errstr)) ||
    (typeof e.message === 'string' && /SQLITE_BUSY|database is locked/i.test(e.message))
  )
}

/** A short synchronous pause between busy retries (node:sqlite is fully synchronous). */
function syncPause(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const until = Date.now() + ms
    while (Date.now() < until) {
      /* spin */
    }
  }
}

/**
 * BEGIN IMMEDIATE; fn(); COMMIT (ROLLBACK on throw). On SQLITE_BUSY while
 * acquiring the write lock, retry up to `budget` times, then throw
 * ExecutionStoreBusyError with nothing written and no open transaction.
 */
export function runWithImmediateTransaction<T>(
  db: SyncDatabase,
  fn: () => T,
  budget: number = DEFAULT_BUSY_RETRY_BUDGET
): T {
  let attempt = 0
  for (;;) {
    attempt += 1
    try {
      db.exec('BEGIN IMMEDIATE')
    } catch (error) {
      if (isSqliteBusy(error)) {
        if (attempt >= budget) {
          throw new ExecutionStoreBusyError(attempt)
        }
        syncPause(10 * attempt)
        continue
      }
      throw error
    }
    // Lock acquired — the body and commit are not part of the busy-retry budget.
    try {
      const value = fn()
      db.exec('COMMIT')
      return value
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* the transaction may already be gone */
      }
      throw error
    }
  }
}
