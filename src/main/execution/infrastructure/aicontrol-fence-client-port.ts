// Execution bounded context — infrastructure. SPEC.md §4.8.5 —
// `AiControlFenceClientPort`. An outbound port, owned by Execution
// infrastructure, used only by the delegated-cutover coordinator. No
// concrete HTTP adapter exists yet (confirmed this session: no existing
// Maestro code calls aiControlCenter's real `acquireOrcaFence`/
// `acknowledgeOrcaCutover`/`safeReleaseOrcaFence` API routes — the only
// existing aiControl-facing code reads `data/app.db` directly, read-only, or
// replays canned results). This file defines the port's shape and ONE safe,
// fail-closed default implementation — never a network client.

export type AcquireOrcaFenceOutcome =
  | 'ACQUIRED'
  | 'ALREADY_FENCED_SAME_TOKEN'
  | 'CONFLICT_DIFFERENT_TOKEN'
  | 'ALREADY_CUTOVER'
  | 'NOT_ELIGIBLE'
  | 'ACQUISITION_DISABLED'

export type AiControlFenceClientPort = {
  acquireOrcaFence(input: { runId: string; token: string }): Promise<{
    outcome: AcquireOrcaFenceOutcome
    runId: string
    token?: string
  }>
}

/**
 * The production default until a real HTTP adapter exists. Always reports
 * `ACQUISITION_DISABLED` — the same safe-default disposition the real
 * `isOrcaFenceAcquisitionEnabled()` gate uses aiControl-side. Never opens a
 * network connection, never mutates `data/app.db`. Wiring this port into the
 * coordinator does not enable delegation for any real/native session: every
 * acquisition attempt against it fails closed, unconditionally.
 */
export function createFailClosedAiControlFenceClientPort(): AiControlFenceClientPort {
  return {
    async acquireOrcaFence(input) {
      return { outcome: 'ACQUISITION_DISABLED', runId: input.runId }
    }
  }
}
