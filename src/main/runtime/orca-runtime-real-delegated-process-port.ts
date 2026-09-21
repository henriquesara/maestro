import type { ChildProcessHandle } from '../../shared/child-process/process-spec'
import type {
  OsStartMarkerSource,
  ProcessTreeKillScope
} from '../execution/domain/dispatch-process-binding'
import { captureOsStartMarkerSync } from '../execution/infrastructure/process-instance-discriminator'
import {
  ShadowLifecycleProcessAdapter,
  type ProcessLifecycleObservation,
  type ShadowLifecycleObserveDurableInput,
  type ShadowLifecycleSpawnInput
} from '../execution/infrastructure/shadow-lifecycle-process-adapter'

// ORCA-S5 SPEC §7.1 / §4.8.6 — `RealDelegatedProcessPort`: an ADAPTER, not a new
// port shape. It implements ORCA-S4's `ShadowLifecycleProcessPort` surface over a
// REAL process the runtime already created, and lives on the RUNTIME side — the
// Execution bounded context never imports it; it receives it only as the injected
// `processPort` (Runtime → Execution, never the reverse).
//
// It is a MECHANISM port. It owns no authority decision, no terminal
// classification, no DB transaction and no aiControl semantics:
//  - `spawn(...)` ADOPTS `{ pid, incarnationId }` (§7.1) — it never creates a process; the
//    OS-observable start marker is captured by the SAME primitive S4 uses, or honestly
//    `unavailable` (S4 §12 window L13).
//  - `observe` / `requestTermination*` delegate VERBATIM to the S4 adapter, so the exact S4
//    fail-closed identity discipline (durable sidecar/nonce + pid-exists + OS-marker match)
//    protects a real process. Identity that cannot be verified is `identity_unverifiable` —
//    the caller sends NO signal (S4 §9.3, §14 LIFE-2). Never PID-only control.
//
// INTENTIONALLY NOT INVENTED here (frozen-architecture seams, see GREEN evidence):
//  - who writes an identity sidecar for a real PTY-spawned process — when durable sidecar
//    evidence exists it is used; when it does not, the port fails closed exactly as frozen;
//  - a macOS nonce/argv transport into a PTY shell — the compound argv proof (S4 §9.1.3) cannot
//    be satisfied by a real shell, so a `posix_ps_lstart` identity is ALWAYS unverifiable
//    (fail-closed, never a signal) rather than weakening the proof.

/** ORCA-S4's spawn input plus the real process the runtime already created (§7.1). */
export type RealDelegatedAdoptInput = Omit<ShadowLifecycleSpawnInput, '__testSelfExitCode'> & {
  adoptedProcess: { pid: number; incarnationId: string }
}

export type AdoptedDelegatedProcess = {
  pid: number
  killScope: ProcessTreeKillScope
  osStartMarker: string | null
  osStartMarkerSource: OsStartMarkerSource
}

function currentKillScope(): ProcessTreeKillScope {
  return process.platform === 'win32' ? 'win-taskkill-tree' : 'posix-process-group'
}

/** Signal 0 is the documented cross-platform existence test. */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export class RealDelegatedProcessPort {
  private readonly s4 = new ShadowLifecycleProcessAdapter()

  /** §7.1 — adopts the already-real process synchronously; never spawns, never scans. */
  spawn(input: RealDelegatedAdoptInput): AdoptedDelegatedProcess {
    const { pid } = input.adoptedProcess
    if (!Number.isInteger(pid) || pid <= 0 || !pidExists(pid)) {
      throw new Error(`delegated_process_adoption_failed: pid ${pid} is not a live process`)
    }
    const marker = captureOsStartMarkerSync(pid)
    return {
      pid,
      killScope: currentKillScope(),
      osStartMarker: marker.osStartMarker,
      osStartMarkerSource: marker.osStartMarkerSource
    }
  }

  async observe(
    handle: ChildProcessHandle | null | undefined,
    durable: ShadowLifecycleObserveDurableInput
  ): Promise<ProcessLifecycleObservation> {
    if (!handle && durable.osStartMarkerSource === 'posix_ps_lstart') {
      // A dead pid is safe to report; a LIVE one cannot be corroborated by the shadow-child argv
      // shape a real shell never has, so it is never treated as verified (no signal follows).
      return pidExists(durable.pid)
        ? { kind: 'identity_unverifiable' }
        : { kind: 'confirmed_dead_unknown_cause' }
    }
    return this.s4.observe(handle ?? null, durable)
  }

  requestTermination(handle: ChildProcessHandle): Promise<{ verified: boolean }> {
    return this.s4.requestTermination(handle)
  }

  /**
   * The caller MUST have verified identity first (S4 §9.1.2): this performs no identity check of
   * its own, exactly like the S4 primitive it delegates to. `convergeDelegationBoundaryLifecycle`
   * reaches this only after `observe` returned `still_running` for the bound identity.
   */
  requestTerminationByPid(
    pid: number,
    killScope: ProcessTreeKillScope
  ): Promise<{ verified: boolean }> {
    return this.s4.requestTerminationByPid(pid, killScope)
  }
}
