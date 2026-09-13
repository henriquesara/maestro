import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnProcess } from '../../../shared/child-process/run-process'
import type { ChildProcessHandle } from '../../../shared/child-process/process-spec'
import { signalProcessTree, signalProcessTreeByPid } from '../../../shared/child-process/process-tree-termination'
import { verifyRestartRecoveredIdentity } from '../domain/restart-recovered-identity-verification'
import type { OsStartMarkerSource, ProcessTreeKillScope } from '../domain/dispatch-process-binding'
import { captureOsStartMarkerSync, readCurrentOsStartMarker, readMacosProcessObservation } from './process-instance-discriminator'

// Execution bounded context — infrastructure. ORCA-S4 SPEC §9.1, §9.2 — the
// real ShadowLifecycleProcessPort adapter. Wraps `spawnProcess` /
// `signalProcessTree` / `signalProcessTreeByPid` from
// `src/shared/child-process/` — REUSED, not reimplemented (AGENTS.md). Two
// call shapes exactly as §9.1 describes: the same-process-instance live-handle
// path (`requestTermination`) and the restart-recovered pid-addressed path
// (`requestTerminationByPid`) — the "new, narrow addition" §9.1.2 requires.

const SHAPE_EXPECTED_PREFIX = 'shadow-lifecycle-child.mjs'
const FIXTURE_PATH = join(__dirname, 'shadow-lifecycle-child.mjs')

export type ShadowLifecycleSpawnInput = {
  correlationId: string
  orcaRunId: string
  orcaDispatchId: string
  processNonce: string
  identitySidecarPath: string
  /** Test-only escape hatch — a real spawned dispatch never requests this. */
  __testSelfExitCode?: number
}

export type ShadowLifecycleSpawnResult = {
  pid: number
  killScope: ProcessTreeKillScope
  handle: ChildProcessHandle
  osStartMarker: string | null
  osStartMarkerSource: OsStartMarkerSource
}

export type ShadowLifecycleObserveDurableInput = {
  pid: number
  processNonce: string
  identitySidecarPath: string
  teardownRequestedAt: string | null
  osStartMarker: string | null
  osStartMarkerSource: OsStartMarkerSource
}

export type ProcessLifecycleObservation =
  | { kind: 'still_running' }
  | { kind: 'self_exit'; exitCode: number | null; exitSignal: NodeJS.Signals | null }
  | { kind: 'confirmed_dead_unknown_cause' }
  | { kind: 'identity_unverifiable' }

/** The full port contract (§9.1) — spawn (bind-time seam) + observe/requestTermination/requestTerminationByPid (sweep). */
export type ShadowLifecycleProcessPort = {
  spawn(input: ShadowLifecycleSpawnInput): ShadowLifecycleSpawnResult
  observe(
    handle: ChildProcessHandle | null,
    durable: ShadowLifecycleObserveDurableInput
  ): Promise<ProcessLifecycleObservation>
  requestTermination(handle: ChildProcessHandle): Promise<{ verified: boolean }>
  requestTerminationByPid(pid: number, killScope: ProcessTreeKillScope): Promise<{ verified: boolean }>
}

function currentKillScope(): ProcessTreeKillScope {
  return process.platform === 'win32' ? 'win-taskkill-tree' : 'posix-process-group'
}

/** §4 — true if the target pid currently exists (signal 0 is a documented cross-platform existence test). */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function readIdentitySidecar(
  path: string
): Promise<{ correlationId: string; orcaRunId: string; orcaDispatchId: string; processNonce: string } | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof parsed.correlationId !== 'string' ||
      typeof parsed.orcaRunId !== 'string' ||
      typeof parsed.orcaDispatchId !== 'string' ||
      typeof parsed.processNonce !== 'string'
    ) {
      return null
    }
    return {
      correlationId: parsed.correlationId,
      orcaRunId: parsed.orcaRunId,
      orcaDispatchId: parsed.orcaDispatchId,
      processNonce: parsed.processNonce
    }
  } catch {
    return null
  }
}

export class ShadowLifecycleProcessAdapter {
  /** §9.2 step 4 — spawn, obtain pid, capture the OS-observable process-instance discriminator. Synchronous per the port contract. */
  spawn(input: ShadowLifecycleSpawnInput): ShadowLifecycleSpawnResult {
    const args = [FIXTURE_PATH, `--processNonce=${input.processNonce}`]
    if (typeof input.__testSelfExitCode === 'number') {
      args.push(`--self-exit-code=${input.__testSelfExitCode}`)
    }
    const handle = spawnProcess({
      program: process.execPath,
      args,
      detached: true,
      stdio: 'ignore'
    })
    const pid = handle.pid
    if (!pid) {
      throw new Error('shadow lifecycle process failed to obtain a pid')
    }
    const marker = captureOsStartMarkerSync(pid)
    return {
      pid,
      killScope: currentKillScope(),
      handle,
      osStartMarker: marker.osStartMarker,
      osStartMarkerSource: marker.osStartMarkerSource
    }
  }

  /**
   * §9.1.1 same-process-instance path: the live handle already knows whether
   * the child exited, and with what code/signal — no OS re-read needed.
   * §9.1.2 restart-recovered path (handle null): re-verify identity (sidecar,
   * pid-exists, OS-marker, and — on macOS — the compound argv/nonce proof)
   * before ever reporting anything other than dead/alive-but-unverified.
   */
  async observe(
    handle: ChildProcessHandle | null,
    durable: ShadowLifecycleObserveDurableInput
  ): Promise<ProcessLifecycleObservation> {
    if (handle) {
      const exitCode = handle.exitCode ?? null
      const signalCode = handle.signalCode ?? null
      if (exitCode !== null || signalCode !== null) {
        return { kind: 'self_exit', exitCode, exitSignal: signalCode }
      }
      return { kind: 'still_running' }
    }

    if (!pidExists(durable.pid)) {
      return { kind: 'confirmed_dead_unknown_cause' }
    }

    const sidecar = await readIdentitySidecar(durable.identitySidecarPath)
    const currentOsStartMarker = await readCurrentOsStartMarker(durable.pid, durable.osStartMarkerSource)
    let macos: { argv: string | null; expectedShapePrefix: string } | undefined
    if (durable.osStartMarkerSource === 'posix_ps_lstart') {
      const observation = await readMacosProcessObservation(durable.pid)
      macos = { argv: observation.argv, expectedShapePrefix: SHAPE_EXPECTED_PREFIX }
    }

    const verification = verifyRestartRecoveredIdentity({
      durable: {
        correlationId: sidecar?.correlationId ?? '',
        orcaRunId: sidecar?.orcaRunId ?? '',
        orcaDispatchId: sidecar?.orcaDispatchId ?? '',
        processNonce: durable.processNonce,
        pid: durable.pid,
        osStartMarker: durable.osStartMarker,
        osStartMarkerSource: durable.osStartMarkerSource
      },
      sidecar,
      pidExists: true,
      currentOsStartMarker,
      macos
    })

    return verification.kind === 'verified' ? { kind: 'still_running' } : { kind: 'identity_unverifiable' }
  }

  /** §9.1.1 — the existing, unchanged primitive. Already fails closed on a reaped-pid race. */
  async requestTermination(handle: ChildProcessHandle): Promise<{ verified: boolean }> {
    const verified = await signalProcessTree(handle, 'SIGTERM')
    return { verified }
  }

  /**
   * §9.1.2 — the new, narrow, pid-addressed sibling entry point. The caller
   * MUST have already independently re-verified identity before calling this
   * (this method performs no identity check itself, exactly like
   * `requestTermination` performs none for the handle it is given).
   */
  async requestTerminationByPid(pid: number, killScope: ProcessTreeKillScope): Promise<{ verified: boolean }> {
    const verified = await signalProcessTreeByPid(pid, killScope, 'SIGTERM')
    return { verified }
  }
}
