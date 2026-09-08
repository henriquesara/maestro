import type { AuthoritativeExecutor } from '../application/authoritative-executor'
import type { ExecutionOutcome } from '../domain/parity'
import type { WorkloadSpec } from '../domain/workload-spec'
import { applyWorkload, initSeededWorktree, toExecutionOutcome } from './workload-git-runtime'

// Execution bounded context — infrastructure. The authoritative side of the
// same-workload parity comparison (amendment 001 §3, §0 R1). It executes the
// SAME WorkloadSpec the shadow adapter runs, in its own disposable worktree,
// with aiControl-native terminal semantics, and derives files_changed from a
// real git diff. It is a bounded stand-in for aiControlCenter's live native
// executor — never a historical row, never a data/app.db write.

export class AuthoritativeReferenceExecutor implements AuthoritativeExecutor {
  async execute(input: {
    spec: WorkloadSpec
    worktreeDir: string
  }): Promise<{ outcome: ExecutionOutcome; baseCommit: string; headCommit: string }> {
    // The authoritative worktree is seeded ONLY with the spec's shared files —
    // never the shadow-only post-base extras (those exist to induce an explained
    // divergence in amendment 001 §4 row 2).
    const baseCommit = initSeededWorktree(input.worktreeDir, input.spec.seededFiles ?? [])
    const result = applyWorkload(input.spec, input.worktreeDir, baseCommit)
    const outcome = toExecutionOutcome(result)
    // aiControl-native recording is coarse on cancellation granularity: a
    // mid-flight cancel is recorded as a clean one (amendment 001 §4 row 6).
    if (outcome.cancellationBehavior === 'cancelled_mid_flight') {
      outcome.cancellationBehavior = 'cancelled_clean'
    }
    return { outcome, baseCommit, headCommit: result.headCommit }
  }
}
