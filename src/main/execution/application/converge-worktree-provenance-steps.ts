import { join } from 'node:path'
import type { RunBinding } from '../domain/execution-identity'
import {
  observedIdentityDigest,
  type DispatchWorktreeRecord,
  type WorktreeProvenanceRecord
} from '../domain/worktree-provenance'
import { ExecutionStoreBusyError } from '../infrastructure/with-immediate-transaction'
import type {
  ConvergeWorktreeDeps,
  RetryableReason,
  WorktreeProvenanceConvergenceReport
} from './converge-worktree-provenance'

// Execution bounded context — application. ORCA-S3 §8 — the per-binding
// convergence STEP helpers (atomic decision, read wiring). Split from
// converge-worktree-provenance.ts for the max-lines ratchet; same module,
// same contract. Mirrors converge-settlement-steps.ts (S2).

/** The worktree snapshot moved between the first read and the in-transaction re-verify. */
export class ProvenanceSourceMovedError extends Error {
  constructor() {
    super('worktree provenance snapshot changed across the read → re-verify window')
    this.name = 'ProvenanceSourceMovedError'
  }
}

export type StepOutcome = { kind: 'done' } | { kind: 'moved' } | { kind: 'busy'; attempts: number }

export function pushRetryable(
  report: WorktreeProvenanceConvergenceReport,
  correlationId: string,
  reason: RetryableReason,
  attempts: number
): void {
  report.retryable.push({ correlationId, reason, attempts })
}

export function withTxn<T extends { kind: string }>(
  deps: ConvergeWorktreeDeps,
  fn: () => T
): T | { kind: 'moved' } | { kind: 'busy'; attempts: number } {
  try {
    return deps.txn.withImmediateTransaction(fn)
  } catch (error) {
    if (error instanceof ProvenanceSourceMovedError) {
      return { kind: 'moved' }
    }
    if (error instanceof ExecutionStoreBusyError) {
      return { kind: 'busy', attempts: error.attempts }
    }
    throw error
  }
}

export function identitySidecarPathFor(
  durableShadowWorktreeRoot: string,
  orcaDispatchId: string
): string {
  return join(durableShadowWorktreeRoot, 'identity', `${orcaDispatchId}.json`)
}

export function readSource(
  deps: ConvergeWorktreeDeps,
  binding: RunBinding,
  dispatchWorktree: DispatchWorktreeRecord
): ReturnType<ConvergeWorktreeDeps['source']['readProvenance']> {
  const dispatchId = String(binding.orcaDispatchId)
  return deps.source.readProvenance({
    correlationId: String(binding.correlationId),
    boundDispatchId: dispatchId,
    boundRunId: String(binding.orcaRunId),
    boundBaseCommit: binding.baseCommit,
    worktreePath: dispatchWorktree.worktreePath,
    identitySidecarPath: identitySidecarPathFor(deps.durableShadowWorktreeRoot, dispatchId),
    expectedIdentity: {
      correlationId: String(binding.correlationId),
      orcaRunId: String(binding.orcaRunId),
      orcaDispatchId: dispatchId,
      worktreeNonce: dispatchWorktree.worktreeNonce
    },
    durableShadowWorktreeRoot: deps.durableShadowWorktreeRoot
  })
}

export function identityDigestFor(
  binding: RunBinding,
  dispatchWorktree: DispatchWorktreeRecord
): string {
  return observedIdentityDigest({
    correlationId: String(binding.correlationId),
    orcaRunId: String(binding.orcaRunId),
    orcaDispatchId: String(binding.orcaDispatchId),
    worktreeNonce: dispatchWorktree.worktreeNonce
  })
}

type ResolvedRead = Extract<
  ReturnType<ConvergeWorktreeDeps['source']['readProvenance']>,
  { kind: 'resolved' }
>

/** §8 Phase A step 6 — re-read inside the write txn, then insert-or-no-op + CAS atomically. */
export function commitProvenance(
  deps: ConvergeWorktreeDeps,
  report: WorktreeProvenanceConvergenceReport,
  ctx: {
    binding: RunBinding
    cid: string
    dispatchId: string
    runId: string
    dispatchWorktree: DispatchWorktreeRecord
    firstRead: ResolvedRead
  }
): StepOutcome {
  return withTxn<StepOutcome>(deps, (): StepOutcome => {
    const reread = readSource(deps, ctx.binding, ctx.dispatchWorktree)
    if (reread.kind !== 'resolved' || reread.provenanceDigest !== ctx.firstRead.provenanceDigest) {
      throw new ProvenanceSourceMovedError()
    }
    if (deps.provenance.getByCorrelation(ctx.cid)) {
      return { kind: 'done' }
    }
    if (deps.incidents.hasOpenIncident(ctx.cid)) {
      return { kind: 'done' }
    }
    const now = deps.now()
    const record: WorktreeProvenanceRecord = {
      correlationId: ctx.cid,
      orcaDispatchId: ctx.dispatchId,
      orcaRunId: ctx.runId,
      sliceRef: report.sliceRef,
      status: 'recorded',
      baseCommit: reread.baseCommit,
      candidateHead: reread.candidateHead,
      filesChangedJson: JSON.stringify(reread.filesChanged),
      provenanceSource: 'converged_from_worktree',
      worktreePathRef: ctx.dispatchWorktree.worktreePath,
      provenanceDigest: reread.provenanceDigest,
      provenanceJson: JSON.stringify({ transcript: reread.transcript }),
      firstSeenAt: now,
      observedAt: now,
      conflictedAt: null
    }
    const ins = deps.provenance.insert(record)
    if (!ins.inserted) {
      return { kind: 'done' }
    }
    deps.runBindingCandidateHead.casSetCandidateHead(ctx.dispatchId, reread.candidateHead)
    report.observed.push({ correlationId: ctx.cid, orcaDispatchId: ctx.dispatchId })
    return { kind: 'done' }
  })
}

/** §8 Phase B step 2 — stable-and-equal no-op; stable-and-different -> conflict, byte-preserved artifacts. */
export function verifyProvenance(
  deps: ConvergeWorktreeDeps,
  report: WorktreeProvenanceConvergenceReport,
  ctx: {
    cid: string
    dispatchId: string
    binding: RunBinding
    dispatchWorktree: DispatchWorktreeRecord
    firstRead: ResolvedRead
  }
): StepOutcome {
  return withTxn<StepOutcome>(deps, (): StepOutcome => {
    const reread = readSource(deps, ctx.binding, ctx.dispatchWorktree)
    if (reread.kind !== 'resolved' || reread.provenanceDigest !== ctx.firstRead.provenanceDigest) {
      throw new ProvenanceSourceMovedError()
    }
    const current = deps.provenance.getByCorrelation(ctx.cid)
    if (!current) {
      return { kind: 'done' }
    }
    if (reread.provenanceDigest === current.provenanceDigest) {
      return { kind: 'done' }
    }
    const now = deps.now()
    const record = {
      id: deps.newId('wpi'),
      correlationId: ctx.cid,
      orcaDispatchId: ctx.dispatchId,
      sliceRef: report.sliceRef,
      kind: 'provenance_snapshot_changed' as const,
      evidenceDigest: reread.provenanceDigest,
      detailJson: JSON.stringify({
        old_digest: current.provenanceDigest,
        new_digest: reread.provenanceDigest
      }),
      blocked: true,
      resolvedAt: null,
      resolutionNote: null,
      raisedAt: now
    }
    const ins = deps.incidents.insert(record)
    if (ins.inserted) {
      deps.provenance.markConflicted(ctx.cid, { conflictedAt: now })
      report.incidents.push({
        correlationId: ctx.cid,
        kind: 'provenance_snapshot_changed',
        evidenceDigest: reread.provenanceDigest
      })
    }
    return { kind: 'done' }
  })
}
