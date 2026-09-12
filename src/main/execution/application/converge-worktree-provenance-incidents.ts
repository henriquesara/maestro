import {
  observedIdentityDigest,
  worktreeDispatchMismatchEvidenceDigest,
  worktreeMissingEvidenceDigest,
  type WorktreeDispatchMismatchFailedCheck,
  type WorktreeProvenanceIncidentKind
} from '../domain/worktree-provenance'
import { pushRetryable, withTxn } from './converge-worktree-provenance-steps'
import type {
  ConvergeWorktreeDeps,
  WorktreeProvenanceConvergenceReport
} from './converge-worktree-provenance'

// Execution bounded context — application. ORCA-S3 §7.3, §8 — the S3-only
// incident-raising helpers (worktree_missing, worktree_dispatch_mismatch) +
// the classification of every non-'resolved' DurableWorktreeRead kind. Split
// from converge-worktree-provenance-steps.ts for the max-lines ratchet; same
// module, same contract.

function incidentRecord(
  deps: ConvergeWorktreeDeps,
  sliceRef: string,
  cid: string,
  dispatchId: string,
  kind: WorktreeProvenanceIncidentKind,
  evidenceDigest: string,
  detail: Record<string, unknown>
) {
  return {
    id: deps.newId('wpi'),
    correlationId: cid,
    orcaDispatchId: dispatchId,
    sliceRef,
    kind,
    evidenceDigest,
    detailJson: JSON.stringify(detail),
    blocked: true,
    resolvedAt: null,
    resolutionNote: null,
    raisedAt: deps.now()
  }
}

function finishIncidentOutcome(
  report: WorktreeProvenanceConvergenceReport,
  cid: string,
  outcome:
    | { kind: 'done'; wrote: boolean }
    | { kind: 'moved' }
    | { kind: 'busy'; attempts: number },
  kind: WorktreeProvenanceIncidentKind,
  evidenceDigest: string
): void {
  if (outcome.kind === 'busy') {
    pushRetryable(report, cid, 'EXECUTION_STORE_BUSY_RETRYABLE', outcome.attempts)
    return
  }
  if (outcome.kind === 'done' && outcome.wrote) {
    report.incidents.push({ correlationId: cid, kind, evidenceDigest })
  }
}

/** §7.3 — worktree_dispatch_mismatch, one of the five FailedCheck reasons. */
export function raiseMismatch(
  deps: ConvergeWorktreeDeps,
  report: WorktreeProvenanceConvergenceReport,
  cid: string,
  dispatchId: string,
  failedCheck: WorktreeDispatchMismatchFailedCheck,
  observedDigest: string
): void {
  const evidenceDigest = worktreeDispatchMismatchEvidenceDigest(
    cid,
    dispatchId,
    observedDigest,
    failedCheck
  )
  const outcome = withTxn(deps, () => {
    const record = incidentRecord(
      deps,
      report.sliceRef,
      cid,
      dispatchId,
      'worktree_dispatch_mismatch',
      evidenceDigest,
      {
        failed_check: failedCheck
      }
    )
    const ins = deps.incidents.insert(record)
    return { kind: 'done' as const, wrote: ins.inserted }
  })
  finishIncidentOutcome(report, cid, outcome, 'worktree_dispatch_mismatch', evidenceDigest)
}

/** §7.3 — worktree_missing (PROV-1: confirmed non-repository, never a fabricated SHA). */
export function raiseWorktreeMissing(
  deps: ConvergeWorktreeDeps,
  report: WorktreeProvenanceConvergenceReport,
  cid: string,
  dispatchId: string
): void {
  const evidenceDigest = worktreeMissingEvidenceDigest(cid, dispatchId)
  const outcome = withTxn(deps, () => {
    const record = incidentRecord(
      deps,
      report.sliceRef,
      cid,
      dispatchId,
      'worktree_missing',
      evidenceDigest,
      {
        observed: 'non_repository'
      }
    )
    const ins = deps.incidents.insert(record)
    return { kind: 'done' as const, wrote: ins.inserted }
  })
  finishIncidentOutcome(report, cid, outcome, 'worktree_missing', evidenceDigest)
}

/** Terminal for this sweep call — identity/missing/operational/unstable never loop at this layer. */
export function handleUnresolvedRead(
  deps: ConvergeWorktreeDeps,
  report: WorktreeProvenanceConvergenceReport,
  ctx: { cid: string; dispatchId: string; read: { kind: string; observedIdentityDigest?: string } }
): void {
  const { read } = ctx
  if (read.kind === 'identity_absent') {
    raiseMismatch(
      deps,
      report,
      ctx.cid,
      ctx.dispatchId,
      'identity_discriminator_absent',
      observedIdentityDigest(null)
    )
    return
  }
  if (read.kind === 'identity_mismatch') {
    raiseMismatch(
      deps,
      report,
      ctx.cid,
      ctx.dispatchId,
      'identity_discriminator_mismatch',
      read.observedIdentityDigest ?? observedIdentityDigest(null)
    )
    return
  }
  if (read.kind === 'missing') {
    raiseWorktreeMissing(deps, report, ctx.cid, ctx.dispatchId)
    return
  }
  if (read.kind === 'operational_error') {
    pushRetryable(report, ctx.cid, 'WORKTREE_SOURCE_OPERATIONAL_RETRYABLE', 1)
    return
  }
  // 'unstable' — the adapter already double-read internally; final for this sweep.
  pushRetryable(report, ctx.cid, 'WORKTREE_SOURCE_UNSTABLE_RETRYABLE', 1)
}
