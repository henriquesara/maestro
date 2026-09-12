import {
  convergeWorktreeProvenance,
  type WorktreeProvenanceConvergenceReport
} from './converge-worktree-provenance'
import type { ExecutionStore } from './execution-store'
import type { SettlementObservationStore } from './settlement-observation-store'
import type { WorktreeProvenanceDeps } from './worktree-provenance-bind-step'

// Execution bounded context — application. ORCA-S3 §8 — the sibling sweep
// invocation, split out of shadow-observation-service.ts for the max-lines
// ratchet (same module, same contract). Invoked immediately AFTER
// reconcileShadowExecutionState(...) returns; never a phase inside the ORCA-S2
// coordinator (R7); reads/writes only S3 state.

export function convergeWorktreeProvenanceSibling(
  deps: WorktreeProvenanceDeps,
  store: Pick<ExecutionStore, 'listBindings'>,
  settlements: Pick<SettlementObservationStore, 'getByCorrelation'>,
  sliceRef: string,
  now: () => string,
  newId: (prefix: string) => string
): WorktreeProvenanceConvergenceReport {
  return convergeWorktreeProvenance(
    {
      store,
      settlements,
      dispatchWorktrees: deps.dispatchWorktrees,
      provenance: deps.provenance,
      incidents: deps.incidents,
      runBindingCandidateHead: deps.runBindingCandidateHead,
      source: deps.source,
      txn: deps.txn,
      durableShadowWorktreeRoot: deps.durableShadowWorktreeRoot,
      newId,
      now
    },
    { sliceRef }
  )
}
