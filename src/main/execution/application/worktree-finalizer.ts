import { rmSync } from 'node:fs'
import { isInside } from '../domain/path-confinement'
import type { SqliteWorktreeFinalizationStore } from '../infrastructure/sqlite-worktree-finalization-store'

// Execution bounded context — application. ORCA-S4 SPEC §10 — governed reap of
// a durable ORCA-S3 shadow worktree. Intent recorded BEFORE any filesystem
// deletion (§10.2 step 1, LIFE-3); the filesystem act is idempotent by
// construction (§10.2 step 3); every deletion target is `isInside`-guarded
// (mirrors ORCA-S3 §7.2/§9's own confinement discipline).

export type WorktreeFinalizerDeps = {
  finalizations: SqliteWorktreeFinalizationStore
  durableShadowWorktreeRoot: string
}

export type WorktreeFinalizationInput = {
  correlationId: string
  orcaDispatchId: string
  sliceRef: string
  eligibilityDigest: string
  /** null = a legacy/pre-S3 binding with no durable worktree at all. */
  worktreePath: string | null
  /**
   * ORCA-S5 SPEC §13/§17, X14, gate 24 — the binding is a REAL delegated dispatch worktree
   * (a durable `delegation_cutover` exists). The S4 real-deletion arm NEVER fires for it: the
   * decision is recorded as `skipped_not_eligible` and the filesystem is never touched, whether
   * the path lies inside or outside the shadow root.
   */
  realDelegatedWorktree?: boolean
  now: () => string
}

/**
 * Advances one binding's worktree-finalization state by exactly one step per
 * call, mirroring the sweep's own per-pass, per-binding cadence (§11 Phase 2).
 * A crash between any two steps leaves durable state the next call safely
 * resumes from (§12 windows L3-L5).
 */
export async function advanceWorktreeFinalization(
  deps: WorktreeFinalizerDeps,
  input: WorktreeFinalizationInput
): Promise<void> {
  const existing = deps.finalizations.getByCorrelationId(input.correlationId)

  if (!existing) {
    // §10.2 step 1 — durable intent BEFORE any filesystem deletion is attempted.
    deps.finalizations.insertIntent({
      correlationId: input.correlationId,
      orcaDispatchId: input.orcaDispatchId,
      sliceRef: input.sliceRef,
      eligibilityDigest: input.eligibilityDigest,
      intentRecordedAt: input.now(),
      status: 'intent_recorded',
      finalizedAt: null,
      outcomeDetailJson: null,
      conflictedAt: null
    })
    if (input.worktreePath === null || input.realDelegatedWorktree) {
      // Legacy binding (never had a durable worktree) or a real delegated worktree
      // (§13). No filesystem act.
      deps.finalizations.markSkippedNotEligible(input.correlationId)
    }
    return
  }

  if (existing.status !== 'intent_recorded') {
    // Already terminal (finalized / skipped_not_eligible / conflicted) — no-op.
    return
  }

  if (input.worktreePath === null || input.realDelegatedWorktree) {
    deps.finalizations.markSkippedNotEligible(input.correlationId)
    return
  }

  // §10.2 step 2 — Phase-B re-verify against current durable state.
  if (existing.eligibilityDigest !== input.eligibilityDigest) {
    deps.finalizations.markConflicted(input.correlationId, input.now())
    return
  }

  // §7 forbidden / LIFE-3 — fail closed on any path that would escape the
  // configured durable root, checked immediately before the deletion itself.
  if (!isInside(input.worktreePath, deps.durableShadowWorktreeRoot)) {
    throw new Error(
      `worktree finalization refused: ${input.worktreePath} does not resolve inside the configured durable shadow-worktree root`
    )
  }

  // §10.2 step 3 — idempotent by construction: an already-absent target is a
  // success, never an error.
  rmSync(input.worktreePath, { recursive: true, force: true })

  // §10.2 step 4.
  deps.finalizations.markFinalized(input.correlationId, {
    finalizedAt: input.now(),
    outcomeDetailJson: JSON.stringify({ deleted: true })
  })
}
