import { randomUUID } from 'node:crypto'
import { captureOsStartMarkerSync } from '../execution/infrastructure/process-instance-discriminator'
import type { DelegationCutoverCommitResult } from '../../shared/delegation-cutover-commit-result'

// ORCA-S5 SPEC §4.8.4 (focused composition fix) — the real site #5
// callback body for a delegated request. Split out of
// `orca-runtime-create-agent-session.ts` only to stay under this repo's
// max-lines ratchet; same real call site, same real closure semantics.
// Resolves the rest of the real, stable process identity
// (osStartMarker/osStartMarkerSource, via the same `captureOsStartMarkerSync`
// primitive ORCA-S4 already uses) from the raw pid the real local
// spawn-commit site (`local-pty-spawn.ts`) captured into the identity box
// before this closure fired.

export type DelegatedCutoverCoordinatorLike = {
  commitDelegatedCutover(input: {
    aicontrolRunId: string
    fenceToken: string
    correlationId: string
    orcaDispatchId: string
    processIdentity: {
      orcaDispatchId: string
      correlationId: string
      orcaRunId: string
      processNonce: string
      pid: number
      killScope: 'posix-process-group' | 'win-taskkill-tree'
      osStartMarker: string | null
      osStartMarkerSource: string
      spawnedAt: string
      teardownRequestedAt: string | null
    }
  }): Promise<DelegationCutoverCommitResult>
}

export function buildDelegatedCutoverSpawnCommitCallback(args: {
  getCoordinator: () => DelegatedCutoverCoordinatorLike
  aicontrolRunId: string
  fenceToken: string
  correlationId: string
  orcaDispatchId: string
  preparedProcessIdentityCapture: { current?: { pid: number } }
  /** Same reasoning as the native path's own retainReplayFence: a real,
   *  durably-bound process now exists, so a later failure in this same
   *  operation must never be reinterpreted as "no process was ever
   *  created." */
  onCommitSucceeded: () => void
}): () => Promise<DelegationCutoverCommitResult> {
  return async () => {
    const capturedPid = args.preparedProcessIdentityCapture.current?.pid
    if (typeof capturedPid !== 'number') {
      throw new Error('delegated_cutover_process_identity_unavailable')
    }
    const marker = captureOsStartMarkerSync(capturedPid)
    const commitResult = await args.getCoordinator().commitDelegatedCutover({
      aicontrolRunId: args.aicontrolRunId,
      fenceToken: args.fenceToken,
      correlationId: args.correlationId,
      orcaDispatchId: args.orcaDispatchId,
      processIdentity: {
        orcaDispatchId: args.orcaDispatchId,
        correlationId: args.correlationId,
        orcaRunId: args.correlationId,
        processNonce: randomUUID(),
        pid: capturedPid,
        killScope: process.platform === 'win32' ? 'win-taskkill-tree' : 'posix-process-group',
        osStartMarker: marker.osStartMarker,
        osStartMarkerSource: marker.osStartMarkerSource,
        spawnedAt: new Date().toISOString(),
        teardownRequestedAt: null
      }
    })
    args.onCommitSucceeded()
    return commitResult
  }
}
