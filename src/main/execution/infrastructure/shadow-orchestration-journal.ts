import { existsSync } from 'node:fs'
import SyncDatabase from '../../sqlite/sync-database'

// Execution bounded context — infrastructure. §14 WAL note — the S2
// restart/acceptance harness closes / CHECKPOINTS the shadow writer BEFORE
// opening the read-only source, so the read sees a checkpointed main file and S2
// provably creates no sidecar. This is a WRITER-SIDE finalize (the ORCA-S1
// writer's role), never part of S2's read path.

/**
 * Fully checkpoint the shadow orchestration.db WAL and finalise it to a plain
 * rollback journal, so a subsequent genuinely-read-only open needs no `-shm` /
 * `-wal` and S2's reader is provably sidecar-free. Idempotent; a no-op when the
 * file does not exist.
 */
export function finalizeShadowWriterJournal(path: string): void {
  if (path === ':memory:' || !existsSync(path)) {
    return
  }
  const db = new SyncDatabase(path)
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.pragma('journal_mode = DELETE')
  } finally {
    db.close()
  }
}
