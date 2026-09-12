import type SyncDatabase from '../../sqlite/sync-database'
import type {
  CandidateHeadCasResult,
  RunBindingCandidateHeadStore
} from '../application/run-binding-candidate-head-store'

// Execution bounded context — infrastructure. §7.4, R2 — the CAS write onto
// the LATENT run_binding.candidate_head column (no DDL; the column already
// exists from ORCA-S1/S2). A second, narrower writer of this column — never a
// replacement of the existing unconditional ExecutionStore.setBindingCandidateHead.

export class SqliteRunBindingCandidateHeadStore implements RunBindingCandidateHeadStore {
  constructor(private readonly db: SyncDatabase) {}

  casSetCandidateHead(orcaDispatchId: string, candidateHead: string): CandidateHeadCasResult {
    const info = this.db
      .prepare(
        'UPDATE run_binding SET candidate_head = ? WHERE orca_dispatch_id = ? AND candidate_head IS NULL'
      )
      .run(candidateHead, orcaDispatchId)
    if (Number(info.changes) > 0) {
      return 'set'
    }
    const row = this.db
      .prepare('SELECT candidate_head FROM run_binding WHERE orca_dispatch_id = ?')
      .get(orcaDispatchId) as { candidate_head: string | null } | undefined
    return row?.candidate_head === candidateHead ? 'already_equal' : 'conflict'
  }
}
