// Execution bounded context — application. The authoritative side of the
// same-workload parity comparison (amendment 001 §3, blocker B7). An
// implementation executes the SAME WorkloadSpec the shadow plane runs, with
// aiControl-native terminal semantics, in its own disposable worktree, and
// derives files-changed from a real diff (blocker B8). It is a bounded
// stand-in for aiControlCenter's live native path (amendment 001 §0, R1) — it
// is never a historical row and never mutates data/app.db.

import type { ExecutionOutcome } from '../domain/parity'
import type { WorkloadSpec } from '../domain/workload-spec'

export type AuthoritativeExecutor = {
  /** Runs `spec` in `worktreeDir` (already under the disposable shadow root). */
  execute(input: { spec: WorkloadSpec; worktreeDir: string }): Promise<{
    outcome: ExecutionOutcome
    baseCommit: string
    headCommit: string
  }>
}
