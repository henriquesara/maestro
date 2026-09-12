import type { DispatchWorktreeStore } from './dispatch-worktree-store'
import type { DurableWorktreeSource } from './durable-worktree-source'
import type { ExecutionTransactionRunner } from './execution-transaction-runner'
import type { RunBindingCandidateHeadStore } from './run-binding-candidate-head-store'
import type { SettlementObservationStore } from './settlement-observation-store'
import type { WorktreeProvenanceIncidentStore } from './worktree-provenance-incident-store'
import type { WorktreeProvenanceStore } from './worktree-provenance-store'
import type { RunBinding } from '../domain/execution-identity'
import {
  observedIdentityDigest,
  type WorktreeProvenanceIncidentKind
} from '../domain/worktree-provenance'
import { handleUnresolvedRead, raiseMismatch } from './converge-worktree-provenance-incidents'
import {
  commitProvenance,
  pushRetryable,
  identityDigestFor,
  readSource,
  verifyProvenance
} from './converge-worktree-provenance-steps'

// Execution bounded context — application. ORCA-S3 §8 — the sibling two-phase
// convergence sweep, invoked by the composition boundary AFTER
// reconcileShadowExecutionState(...) returns. Pure, idempotent function of
// (Execution store state, durable shadow worktree filesystem state, now).
// Performs NO abandon, NO reap, NO filesystem removal, NO Git write, and is
// NEVER a phase inside the ORCA-S2 coordinator (R7). Mirrors converge-settlements.ts.

const SETTLED_STATUSES: ReadonlySet<string> = new Set(['observed', 'observed_conflicted'])
const REVERIFY_BUDGET = 3

export type ConvergeWorktreeDeps = {
  store: { listBindings(sliceRef: string): RunBinding[] }
  settlements: Pick<SettlementObservationStore, 'getByCorrelation'>
  dispatchWorktrees: Pick<DispatchWorktreeStore, 'getByDispatchId'>
  provenance: WorktreeProvenanceStore
  incidents: WorktreeProvenanceIncidentStore
  runBindingCandidateHead: RunBindingCandidateHeadStore
  source: DurableWorktreeSource
  txn: ExecutionTransactionRunner
  durableShadowWorktreeRoot: string
  newId: (prefix: string) => string
  now: () => string
}

export type ObservedRef = { correlationId: string; orcaDispatchId: string }
export type IncidentRef = {
  correlationId: string
  kind: WorktreeProvenanceIncidentKind
  evidenceDigest: string
}
export type RetryableReason =
  | 'WORKTREE_SOURCE_OPERATIONAL_RETRYABLE'
  | 'WORKTREE_SOURCE_UNSTABLE_RETRYABLE'
  | 'EXECUTION_STORE_BUSY_RETRYABLE'
export type RetryableRef = { correlationId: string; reason: RetryableReason; attempts: number }
export type SweepErrorRef = { correlationId: string; phase: 'A' | 'B'; error: string }

export type WorktreeProvenanceConvergenceReport = {
  sliceRef: string
  observed: ObservedRef[]
  legacyNotConvergeable: string[]
  incidents: IncidentRef[]
  retryable: RetryableRef[]
  sweepErrors: SweepErrorRef[]
}

function sanitize(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg
}

export function convergeWorktreeProvenance(
  deps: ConvergeWorktreeDeps,
  input: { sliceRef: string }
): WorktreeProvenanceConvergenceReport {
  const report: WorktreeProvenanceConvergenceReport = {
    sliceRef: input.sliceRef,
    observed: [],
    legacyNotConvergeable: [],
    incidents: [],
    retryable: [],
    sweepErrors: []
  }

  const bindings = deps.store.listBindings(input.sliceRef)

  // Phase A — bindings with NO existing worktree_provenance row.
  for (const binding of bindings) {
    const cid = String(binding.correlationId)
    if (deps.provenance.getByCorrelation(cid)) {
      continue
    }
    if (deps.incidents.hasOpenIncident(cid)) {
      continue // S3-only block (PROV-10)
    }
    try {
      sweepPhaseA(deps, report, binding)
    } catch (error) {
      report.sweepErrors.push({ correlationId: cid, phase: 'A', error: sanitize(error) })
    }
  }

  // Phase B — bindings WITH a 'recorded' worktree_provenance row, no open incident.
  for (const binding of bindings) {
    const cid = String(binding.correlationId)
    const existing = deps.provenance.getByCorrelation(cid)
    if (!existing || existing.status !== 'recorded') {
      continue
    }
    if (deps.incidents.hasOpenIncident(cid)) {
      continue
    }
    try {
      sweepPhaseB(deps, report, binding)
    } catch (error) {
      report.sweepErrors.push({ correlationId: cid, phase: 'B', error: sanitize(error) })
    }
  }

  return report
}

function sweepPhaseA(
  deps: ConvergeWorktreeDeps,
  report: WorktreeProvenanceConvergenceReport,
  binding: RunBinding
): void {
  const cid = String(binding.correlationId)
  const dispatchId = String(binding.orcaDispatchId)
  const runId = String(binding.orcaRunId)

  const settlement = deps.settlements.getByCorrelation(cid)
  if (!settlement || !SETTLED_STATUSES.has(settlement.status)) {
    return // not yet settled — S3 only acts after ORCA-S2 converged settlement
  }

  const dispatchWorktree = deps.dispatchWorktrees.getByDispatchId(dispatchId)
  if (!dispatchWorktree) {
    // §7.6 window F — legacy / pre-S3 binding. PROV-12: no row, no incident, no block.
    report.legacyNotConvergeable.push(cid)
    return
  }

  let read = readSource(deps, binding, dispatchWorktree)
  for (let attempt = 1; attempt <= REVERIFY_BUDGET; attempt += 1) {
    if (read.kind !== 'resolved') {
      handleUnresolvedRead(deps, report, { cid, dispatchId, read })
      return
    }
    if (read.baseCommit !== binding.baseCommit) {
      raiseMismatch(
        deps,
        report,
        cid,
        dispatchId,
        'base_commit_disagreement',
        identityDigestFor(binding, dispatchWorktree)
      )
      return
    }
    if (binding.candidateHead !== null && binding.candidateHead !== read.candidateHead) {
      raiseMismatch(
        deps,
        report,
        cid,
        dispatchId,
        'candidate_head_disagreement',
        identityDigestFor(binding, dispatchWorktree)
      )
      return
    }

    const outcome = commitProvenance(deps, report, {
      binding,
      cid,
      dispatchId,
      runId,
      dispatchWorktree,
      firstRead: read
    })
    if (outcome.kind === 'done') {
      return
    }
    if (outcome.kind === 'busy') {
      pushRetryable(report, cid, 'EXECUTION_STORE_BUSY_RETRYABLE', outcome.attempts)
      return
    }
    // 'moved' — the worktree changed under us between the read and the in-txn
    // re-verify; retry the whole attempt from a fresh read, up to the budget.
    if (attempt === REVERIFY_BUDGET) {
      pushRetryable(report, cid, 'WORKTREE_SOURCE_UNSTABLE_RETRYABLE', attempt)
      return
    }
    read = readSource(deps, binding, dispatchWorktree)
  }
}

function sweepPhaseB(
  deps: ConvergeWorktreeDeps,
  report: WorktreeProvenanceConvergenceReport,
  binding: RunBinding
): void {
  const cid = String(binding.correlationId)
  const dispatchId = String(binding.orcaDispatchId)

  const dispatchWorktree = deps.dispatchWorktrees.getByDispatchId(dispatchId)
  if (!dispatchWorktree) {
    // §7.6 window G — post-S3 source loss: a provenance row already exists,
    // proving the source row must have existed. Never the legacy skip.
    raiseMismatch(
      deps,
      report,
      cid,
      dispatchId,
      'dispatch_worktree_row_absent',
      observedIdentityDigest(null)
    )
    return
  }

  const read = readSource(deps, binding, dispatchWorktree)
  if (read.kind !== 'resolved') {
    handleUnresolvedRead(deps, report, { cid, dispatchId, read })
    return
  }

  const outcome = verifyProvenance(deps, report, {
    cid,
    dispatchId,
    binding,
    dispatchWorktree,
    firstRead: read
  })
  if (outcome.kind === 'busy') {
    pushRetryable(report, cid, 'EXECUTION_STORE_BUSY_RETRYABLE', outcome.attempts)
    return
  }
  if (outcome.kind === 'moved') {
    pushRetryable(report, cid, 'WORKTREE_SOURCE_UNSTABLE_RETRYABLE', 1)
  }
}
