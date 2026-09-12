import type { compareOutcomes, RootCauseAdjudication } from '../domain/parity'
import type { WorkloadSpec } from '../domain/workload-spec'

// Execution bounded context — application. Structured adjudication (blocker B9),
// split out of shadow-observation-service.ts for the max-lines ratchet (same
// module, same contract). Each divergence dimension is either genuinely
// `explained` with concrete evidence, or `unresolved` — which makes
// `assertObservationComplete` throw and fails the acceptance gate.

export function adjudicate(
  parity: ReturnType<typeof compareOutcomes>,
  spec: WorkloadSpec,
  authoritative: { cancellationBehavior: string },
  shadow: { cancellationBehavior: string; filesChanged: readonly string[] | null }
): RootCauseAdjudication[] {
  return parity.divergences.map((divergence): RootCauseAdjudication => {
    const observedMismatch = `${divergence.dimension}: authoritative=${divergence.authoritative} shadow=${divergence.shadow}`

    if (divergence.dimension === 'files_changed' && (spec.shadowInputExtras?.length ?? 0) > 0) {
      return {
        status: 'explained',
        dimension: 'files_changed',
        observedMismatch,
        classifiedCause: 'shadow_input_worktree_divergence',
        evidence: [
          `shadow input worktree carried extra untracked content: ${spec
            .shadowInputExtras!.map((f) => f.path)
            .join(', ')}`,
          `shadow files_changed = [${(shadow.filesChanged ?? []).join(', ')}]`
        ]
      }
    }

    if (
      divergence.dimension === 'cancellation' &&
      spec.steps.some((s) => s.op === 'cancel' && s.midFlight) &&
      authoritative.cancellationBehavior === 'cancelled_clean' &&
      shadow.cancellationBehavior === 'cancelled_mid_flight'
    ) {
      return {
        status: 'explained',
        dimension: 'cancellation',
        observedMismatch,
        classifiedCause: 'reference_executor_cancellation_granularity_coarse',
        evidence: [
          'aiControl-native recording coarsens mid-flight cancellation to clean (amendment 001 §4 row 6)',
          `authoritative=${authoritative.cancellationBehavior} shadow=${shadow.cancellationBehavior}`
        ]
      }
    }

    return {
      status: 'unresolved',
      dimension: divergence.dimension,
      observedMismatch,
      classifiedCause: null,
      evidence: [observedMismatch]
    }
  })
}
