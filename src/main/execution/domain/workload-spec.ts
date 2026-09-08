// Execution bounded context — domain. A WorkloadSpec is the replayable unit of
// work compared under two executors (amendment 001 §3). Deterministic,
// side-effect-safe, repo-local. No Orca types.

export type WorkloadStep =
  | { op: 'write'; path: string; content: string }
  | { op: 'delete'; path: string }
  | { op: 'exit'; code: number }
  | { op: 'cancel'; midFlight: boolean }

export type WorkloadSpec = {
  id: string
  steps: readonly WorkloadStep[]
  /**
   * Files the shadow adapter's *input* worktree is pre-seeded with in addition
   * to the reference executor's — used to induce a genuine, explained
   * files-changed divergence (amendment 001 §4 row 2). Empty for a MATCH spec.
   */
  shadowInputExtras?: readonly { path: string; content: string }[]
  /** Pre-seeded files present in BOTH input worktrees (e.g. a file a step then deletes). */
  seededFiles?: readonly { path: string; content: string }[]
}

export type ShadowExecutionResult = {
  exitCode: number | null
  filesChanged: readonly string[]
  cancelled: boolean
  cancelledMidFlight: boolean
  error?: string
}
