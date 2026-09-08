import type { AuthoritativeExecutor } from '../../application/authoritative-executor'
import { filesChangedSet, type ExecutionOutcome } from '../../domain/parity'
import type { WorkloadSpec } from '../../domain/workload-spec'
import type { NativeRunResult } from './disposable-aicontrol-env'

// Execution bounded context — infrastructure. The authoritative side of ORCA-S1
// Gate 8 parity (SPEC-AMENDMENT-002). It serves the REAL terminal results of
// aiControlCenter native `agent_runs` collected from the disposable-env harness
// — it never executes anything itself, never re-implements aiControl semantics,
// and never reads/writes data/app.db. An observed native result is passed
// through verbatim; the WorkloadSpec is used only as the join key.

export function nativeOutcome(r: NativeRunResult): ExecutionOutcome {
  const cancelled = r.status === 'cancelled'
  return {
    terminalOutcome: r.status,
    exitDisposition: cancelled
      ? 'no_exit'
      : r.attemptExitCode === 0
        ? 'zero_exit'
        : 'non_zero_exit',
    cancellationBehavior: cancelled ? 'cancelled_clean' : 'not_cancelled',
    filesChanged: filesChangedSet(r.filesChanged)
  }
}

export class NativeResultsAuthoritativeExecutor implements AuthoritativeExecutor {
  private readonly byWorkloadId: Map<string, NativeRunResult>

  constructor(results: readonly NativeRunResult[]) {
    this.byWorkloadId = new Map(results.map((r) => [r.workloadId, r]))
  }

  execute(input: {
    spec: WorkloadSpec
    worktreeDir: string
  }): Promise<{ outcome: ExecutionOutcome; baseCommit: string; headCommit: string }> {
    const r = this.byWorkloadId.get(input.spec.id)
    if (!r) {
      return Promise.reject(
        new Error(`ORCA-S1: no aiControl native result recorded for workload ${input.spec.id}`)
      )
    }
    return Promise.resolve({
      outcome: nativeOutcome(r),
      baseCommit: r.baseCommit,
      headCommit: r.headCommit
    })
  }
}
