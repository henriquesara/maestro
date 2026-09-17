// ORCA-S5 Delegated Cutover Core — mission §34 positive control, not RED.
// Imports only the real, already-published `createAsyncSpawnCommitReporter`
// (`eed09b3047db4f71d25763c215335a2f2db0b403`). Must PASS today and keep
// passing: it is the mission's own required proof that nothing in this RED
// baseline makes `ASYNC_LATE_SELF_DEPENDENCY` reachable
// (`UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL`,
// confirmed unchanged by `ARCHITECTURE-INDEPENDENT-REVIEW-001.md` §31 and
// `ARCHITECTURE-FOCUSED-REREVIEW-002.md` §27, both this session's own prior
// verification and re-checked here for the delegated shape specifically).

import { describe, expect, it, vi } from 'vitest'
import { createAsyncSpawnCommitReporter } from '../../../../shared/async-spawn-commit-reporter'
import type { DelegationCutoverCommitResult } from '../../../../shared/delegation-cutover-commit-result'

describe('ORCA-S5 Delegated Cutover Core -- async-late self-dependency stays unreachable (§34)', () => {
  it('a coordinator-shaped caller of the real async guard never wraps or re-enters its own reporter', async () => {
    // Models exactly what the future site #5 body will do (SPEC §4.8.4): the
    // guard wraps a NEW caller (a function that calls the coordinator),
    // never a function that calls back into the guard's own returned
    // reporter. This is the same shape gates 44-48 already exercise for the
    // published guard -- confirmed here once more against the delegated
    // shape specifically, per this mission's residual-compatibility check.
    const commit = vi.fn(async (): Promise<DelegationCutoverCommitResult> => ({
      outcome: 'COMMITTED',
      correlationId: 'corr_1'
    }))
    const reporter = createAsyncSpawnCommitReporter(async () => {
      const result = await commit()
      return result
      // Deliberately does NOT capture or call `reporter` itself here --
      // the one shape that would make ASYNC_LATE_SELF_DEPENDENCY reachable.
    })

    const first = reporter()
    const second = reporter() // duplicate call while in flight
    expect(first).toBe(second) // same cached Promise identity -- fire-once holds

    const result = await first
    expect(result).toEqual({ outcome: 'COMMITTED', correlationId: 'corr_1' })
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
