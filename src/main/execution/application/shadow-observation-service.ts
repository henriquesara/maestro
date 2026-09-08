// Execution bounded context — application. Orchestrates ORCA-S1: resolve the
// frozen sample, classify each workload, dispatch only the eligible subset via
// the ExecutionPlane, record run_binding + parity_observation, root-cause every
// divergence. Advisory only — never touches an authoritative run.

import type { AuthoritativeRunSource, SampleRequest } from './authoritative-run-source'
import type { ExecutionPlane } from './execution-plane'
import type { ExecutionStore } from './execution-store'
import {
  makeAiControlRunRef,
  makeGovernanceAgentRunRef,
  type RunBinding
} from '../domain/execution-identity'
import {
  assertObservationComplete,
  compareOutcomes,
  type ExecutionOutcome,
  type ParityObservation,
  type ParityResult
} from '../domain/parity'
import { classifyShadowWorkload } from '../domain/shadow-safety-policy'

export type ShadowObservationInput = {
  sliceRef: string
  request: SampleRequest
  worktreeRoot: string
  makeWorktreeDir: (runId: string) => string
  now: () => string
  newId: (prefix: string) => string
}

export type ShadowObservationReport = {
  sliceRef: string
  bindings: readonly RunBinding[]
  observations: readonly ParityObservation[]
  exclusionCount: number
  divergences: readonly { dispatchId: string; dimension: string; rootCause: string }[]
  abandoned: readonly { workloadId: string; reason: string }[]
}

export type ShadowObservationDeps = {
  source: AuthoritativeRunSource
  plane: ExecutionPlane
  store: ExecutionStore
}

function sanitize(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg
}

/**
 * Deterministic root-cause for the frozen ORCA-S1 sample. Every divergence gets
 * a non-empty cause (I7 / §S gate 8); the report keeps the dimension list so an
 * *unexpected* divergence is still visible to independent acceptance.
 */
export function rootCauseFor(
  parity: ParityResult,
  authoritative: ExecutionOutcome,
  shadow: ExecutionOutcome
): string {
  const dims = parity.divergences.map((d) => d.dimension)
  const causes: string[] = []
  if (dims.includes('files_changed') && authoritative.filesChanged !== null) {
    // A recorded files-changed set differs from the synthetic shadow set — the
    // shadow runs an approximation, not the real agent turn.
    causes.push('shadow_synthetic_workload_not_replayable')
  }
  if (
    dims.includes('cancellation') &&
    shadow.cancellationBehavior === 'cancelled_mid_flight' &&
    authoritative.cancellationBehavior === 'cancelled_clean'
  ) {
    causes.push('authoritative_cancellation_granularity_not_recorded')
  }
  if (dims.includes('terminal_outcome')) {
    causes.push('shadow_synthetic_workload_terminal_outcome_mismatch')
  }
  if (dims.includes('exit_disposition') && !dims.includes('terminal_outcome')) {
    causes.push('shadow_synthetic_exit_disposition_mismatch')
  }
  const covered = new Set<string>()
  if (causes.includes('shadow_synthetic_workload_not_replayable')) {
    covered.add('files_changed')
  }
  if (causes.includes('authoritative_cancellation_granularity_not_recorded')) {
    covered.add('cancellation')
  }
  if (causes.includes('shadow_synthetic_workload_terminal_outcome_mismatch')) {
    covered.add('terminal_outcome')
    covered.add('exit_disposition')
  }
  if (causes.includes('shadow_synthetic_exit_disposition_mismatch')) {
    covered.add('exit_disposition')
  }
  const uncovered = dims.filter((d) => !covered.has(d))
  if (uncovered.length > 0) {
    causes.push(`unexpected_divergence:${uncovered.join('+')}`)
  }
  return causes.join('; ')
}

export async function runShadowObservation(
  deps: ShadowObservationDeps,
  input: ShadowObservationInput
): Promise<ShadowObservationReport> {
  const { source, plane, store } = deps
  const bindings: RunBinding[] = []
  const observations: ParityObservation[] = []
  const divergences: { dispatchId: string; dimension: string; rootCause: string }[] = []
  const abandoned: { workloadId: string; reason: string }[] = []
  let exclusionCount = 0

  const entries = source.resolveSample(input.request)

  for (const entry of entries) {
    if (entry.kind === 'unavailable') {
      store.recordExclusion({
        id: input.newId('excl'),
        sliceRef: input.sliceRef,
        workloadId: `slot:${entry.profile}`,
        code: 'sample_source_unavailable',
        reason: `no authoritative row for profile ${entry.profile}`,
        excludedAt: input.now()
      })
      exclusionCount += 1
      continue
    }

    const { record } = entry
    const decision = classifyShadowWorkload(record.descriptor)
    if (!decision.eligible) {
      // I2 — an ineligible workload is refused before any ExecutionPlane call.
      store.recordExclusion({
        id: input.newId('excl'),
        sliceRef: input.sliceRef,
        workloadId: record.descriptor.id,
        code: decision.code,
        reason: decision.reason,
        excludedAt: input.now()
      })
      exclusionCount += 1
      continue
    }

    // I5 — the whole per-entry run is contained: no throw escapes this block.
    let opened: Awaited<ReturnType<ExecutionPlane['openShadowRun']>> | undefined
    try {
      const governanceAgentRunId = makeGovernanceAgentRunRef(input.newId('gar'))
      opened = await plane.openShadowRun({
        sliceRef: input.sliceRef,
        workloadId: record.workload.id,
        baseCommit: 'shadow-base',
        governanceAgentRunId
      })

      const runResult = await plane.runShadowWorkload({
        orcaDispatchRef: opened.orcaDispatchRef,
        workload: record.workload,
        worktreeDir: input.makeWorktreeDir(String(opened.orcaDispatchRef))
      })
      const settled = await plane.settleShadow({
        orcaRunRef: opened.orcaRunRef,
        orcaDispatchRef: opened.orcaDispatchRef,
        result: runResult
      })

      const binding: RunBinding = {
        governanceAgentRunId,
        aicontrolRunId: makeAiControlRunRef(record.aicontrolRunId),
        orcaRunId: opened.orcaRunRef,
        orcaDispatchId: opened.orcaDispatchRef,
        orgTaskId: opened.orgTaskRef,
        sliceRef: input.sliceRef,
        baseCommit: 'shadow-base',
        candidateHead: settled.candidateHead,
        boundAt: input.now()
      }
      store.recordBinding(binding) // I3 — uniqueness enforced here
      bindings.push(binding)

      const parity = compareOutcomes(record.recordedOutcome, settled.outcome)
      const rootCause = parity.match
        ? null
        : rootCauseFor(parity, record.recordedOutcome, settled.outcome)
      const observation: ParityObservation = {
        id: input.newId('parity'),
        runBindingDispatchId: String(opened.orcaDispatchRef),
        sliceRef: input.sliceRef,
        authoritative: record.recordedOutcome,
        shadow: settled.outcome,
        parity,
        rootCause,
        observedAt: input.now()
      }
      assertObservationComplete(observation) // I7
      store.recordParityObservation(observation)
      observations.push(observation)
      for (const d of parity.divergences) {
        divergences.push({
          dispatchId: String(opened.orcaDispatchRef),
          dimension: d.dimension,
          rootCause: rootCause ?? ''
        })
      }
    } catch (error) {
      abandoned.push({ workloadId: record.workload.id, reason: sanitize(error) })
      if (opened) {
        try {
          await plane.abandonShadow({
            orcaRunRef: opened.orcaRunRef,
            orcaDispatchRef: opened.orcaDispatchRef,
            reason: sanitize(error)
          })
        } catch {
          // contained — advisory-only teardown
        }
      }
    }
  }

  return {
    sliceRef: input.sliceRef,
    bindings,
    observations,
    exclusionCount,
    divergences,
    abandoned
  }
}
