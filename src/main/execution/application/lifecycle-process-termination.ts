import type { ChildProcessHandle } from '../../../shared/child-process/process-spec'
import type { DispatchLifecycleIncidentKind } from '../domain/dispatch-lifecycle-incident'
import type { DispatchProcessBindingRecord } from '../domain/dispatch-process-binding'
import { verifyRestartRecoveredIdentity } from '../domain/restart-recovered-identity-verification'
import { processIdentitySidecarPath } from '../infrastructure/durable-shadow-lifecycle-root'
import type { SqliteDispatchProcessBindingStore } from '../infrastructure/sqlite-dispatch-process-binding-store'

// Execution bounded context — application. ORCA-S4 SPEC §9.3 (Phase 1 — observe &
// tear down), extracted from `convergeDelegationBoundaryLifecycle` so that file
// stays under the repo's max-lines ceiling. ORCA-S5 adds ONE policy on top of the
// unmodified S4 identity discipline:
//
//   A DELEGATED run's process is a REAL, user-facing workload. Observing it — on
//   any sweep, or after any restart — never authorizes terminating it. It is
//   signalled ONLY when a durable teardown request (`teardown_requested_at`, with
//   its `teardown_reason`, written by the cancel handler or a timeout decision)
//   already exists (SPEC §9.1, §12). S4's "tear down any live process
//   immediately" is a policy for a synthetic shadow fixture with no real work.

export type ProcessLifecycleObservationLike =
  | { kind: 'still_running' }
  | { kind: 'self_exit'; exitCode: number | null; exitSignal: string | null }
  | { kind: 'confirmed_dead_unknown_cause' }
  | { kind: 'identity_unverifiable' }
  | {
      kind: '__raw_os_observation__'
      pidExists: boolean
      currentOsStartMarker: string | null
      argv?: string | null
    }

export type ShadowLifecycleProcessPortLike = {
  observe(
    handle: ChildProcessHandle | null | undefined,
    durable: {
      pid: number
      processNonce: string
      identitySidecarPath: string
      teardownRequestedAt: string | null
      osStartMarker: string | null
      osStartMarkerSource: string
    }
  ): Promise<ProcessLifecycleObservationLike>
  requestTermination(handle: ChildProcessHandle): Promise<{ verified: boolean }>
  requestTerminationByPid(pid: number, killScope: string): Promise<{ verified: boolean }>
}

export type TerminationOutcome = {
  outcome: 'termination'
  terminationMethod: 'self_exit' | 'signalled' | 'confirmed_dead_unknown_cause'
  exitCode: number | null
  exitSignal: string | null
  treeVerified: boolean
}
export type IncidentOutcome = {
  outcome: 'incident'
  kind: DispatchLifecycleIncidentKind
  reason: string
}
/** A healthy delegated process with no durable teardown request: nothing is legal this pass. */
export type LeftRunningOutcome = { outcome: 'left_running' }

export type ProcessTerminationDeps = {
  processPort: ShadowLifecycleProcessPortLike
  processBindings: SqliteDispatchProcessBindingStore
  liveHandles: Map<string, ChildProcessHandle>
  durableShadowLifecycleRoot: string
  now: () => string
}

export async function resolveProcessTermination(
  deps: ProcessTerminationDeps,
  orcaDispatchId: string,
  processBinding: DispatchProcessBindingRecord,
  opts: { delegated: boolean }
): Promise<TerminationOutcome | IncidentOutcome | LeftRunningOutcome> {
  const liveHandle = deps.liveHandles.get(orcaDispatchId) ?? null
  const durable = {
    pid: processBinding.pid,
    processNonce: processBinding.processNonce,
    identitySidecarPath: processIdentitySidecarPath(
      deps.durableShadowLifecycleRoot,
      orcaDispatchId
    ),
    teardownRequestedAt: processBinding.teardownRequestedAt,
    osStartMarker: processBinding.osStartMarker,
    osStartMarkerSource: processBinding.osStartMarkerSource
  }

  const observation = await deps.processPort.observe(liveHandle, durable)

  // SPEC §9.1 (S5): a delegated process may be signalled only on a durable request.
  const mayTerminate = !opts.delegated || processBinding.teardownRequestedAt !== null

  // S4 shadow only: durable intent is recorded here, immediately before the signal. A delegated
  // run's intent (with its reason) was written earlier by its own cause; the sweep never
  // invents one, and never infers intent from the cutover, the binding, or the sweep itself.
  const requestTeardown = (): void => {
    if (!opts.delegated && !processBinding.teardownRequestedAt) {
      deps.processBindings.markTeardownRequested(orcaDispatchId, deps.now())
    }
  }

  if (observation.kind === '__raw_os_observation__') {
    const sidecar = {
      correlationId: processBinding.correlationId,
      orcaRunId: processBinding.orcaRunId,
      orcaDispatchId,
      processNonce: processBinding.processNonce
    }
    const macos =
      processBinding.osStartMarkerSource === 'posix_ps_lstart'
        ? { argv: observation.argv ?? null, expectedShapePrefix: 'shadow-lifecycle-child.mjs' }
        : undefined
    const verification = verifyRestartRecoveredIdentity({
      durable: {
        ...sidecar,
        pid: processBinding.pid,
        osStartMarker: processBinding.osStartMarker,
        osStartMarkerSource: processBinding.osStartMarkerSource
      },
      sidecar,
      pidExists: observation.pidExists,
      currentOsStartMarker: observation.currentOsStartMarker,
      macos
    })
    if (verification.kind !== 'verified') {
      return {
        outcome: 'incident',
        kind: 'orphan_process_unverifiable',
        reason: verification.reason
      }
    }
    if (!mayTerminate) {
      return { outcome: 'left_running' }
    }
    requestTeardown()
    const result = await deps.processPort.requestTerminationByPid(
      processBinding.pid,
      processBinding.killScope
    )
    return {
      outcome: 'termination',
      terminationMethod: 'signalled',
      exitCode: null,
      exitSignal: null,
      treeVerified: result.verified
    }
  }

  if (observation.kind === 'still_running') {
    if (!mayTerminate) {
      return { outcome: 'left_running' }
    }
    requestTeardown()
    const result = liveHandle
      ? await deps.processPort.requestTermination(liveHandle)
      : await deps.processPort.requestTerminationByPid(processBinding.pid, processBinding.killScope)
    return {
      outcome: 'termination',
      terminationMethod: 'signalled',
      exitCode: null,
      exitSignal: null,
      treeVerified: result.verified
    }
  }

  if (observation.kind === 'self_exit') {
    return {
      outcome: 'termination',
      terminationMethod: 'self_exit',
      exitCode: observation.exitCode,
      exitSignal: observation.exitSignal,
      treeVerified: true
    }
  }

  if (observation.kind === 'confirmed_dead_unknown_cause') {
    // §9.3 — honest reattribution: a durably-recorded teardown request makes
    // this attributable to a request, never a bare "unknown cause" (§12 window L6).
    if (processBinding.teardownRequestedAt) {
      return {
        outcome: 'termination',
        terminationMethod: 'signalled',
        exitCode: null,
        exitSignal: null,
        treeVerified: false
      }
    }
    return {
      outcome: 'termination',
      terminationMethod: 'confirmed_dead_unknown_cause',
      exitCode: null,
      exitSignal: null,
      treeVerified: false
    }
  }

  // 'identity_unverifiable'
  return {
    outcome: 'incident',
    kind: 'process_identity_mismatch',
    reason: 'process identity could not be confirmed'
  }
}
