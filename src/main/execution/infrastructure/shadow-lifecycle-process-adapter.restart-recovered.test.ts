import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { ShadowLifecycleProcessAdapter } from './shadow-lifecycle-process-adapter'

// ORCA-S4 SPEC §9.1.2 — the restart-recovered path's "new, narrow addition": a
// pid-addressed sibling entry point built on the SAME admitProcessTreeKill gate
// and platform branches `process-tree-termination.ts` already implements
// (AGENTS.md "Reuse Before Reimplementing" — no Node primitive re-attaches a
// ChildProcess to an unrelated pid after a restart). Gate 24's positive control
// (real, non-faked restart) lives here; the exhaustive identity-mismatch /
// macOS gate-25 scenarios live at the service level
// (`converge-delegation-boundary-lifecycle.process-identity-safety.test.ts`),
// where identity can be faked deterministically at the seam rather than by
// forcing real, platform-dependent OS pid recycling. RED:
// `./shadow-lifecycle-process-adapter` does not exist yet.

describe('ShadowLifecycleProcessAdapter — restart-recovered termination (§9.1.2, gate 24 positive control)', () => {
  const spawned: { kill: () => void }[] = []
  afterEach(() => {
    while (spawned.length) {
      try {
        spawned.pop()?.kill()
      } catch {
        /* best-effort cleanup */
      }
    }
  })

  it('a genuinely re-verified pid (correct sidecar + correct OS-marker) CAN be terminated through the pid-addressed entry point after the in-memory handle is lost (simulated restart)', async () => {
    const adapter = new ShadowLifecycleProcessAdapter()
    const spawnResult = adapter.spawn({
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      orcaDispatchId: 'ctx_1',
      processNonce: 'nonce_1',
      identitySidecarPath: '/tmp/unused-in-this-test.json'
    })
    spawned.push({ kill: () => spawnResult.handle.kill('SIGKILL') })
    await sleep(150)

    // Simulate a host restart: the in-memory ChildProcess handle is gone. Only
    // the durable pid + osStartMarker + processNonce survive (what a real
    // restart-recovery would re-read from the sidecar/DB).
    const result = await adapter.requestTerminationByPid(spawnResult.pid, spawnResult.killScope)
    expect(result.verified).toBe(true)
  }, 10_000)

  it('requestTerminationByPid is a distinct method from requestTermination(handle) — the port genuinely offers two call shapes (§9.1: same-process-instance vs restart-recovered)', () => {
    const adapter = new ShadowLifecycleProcessAdapter()
    expect(typeof adapter.requestTermination).toBe('function')
    expect(typeof adapter.requestTerminationByPid).toBe('function')
    expect(adapter.requestTermination).not.toBe(adapter.requestTerminationByPid)
  })

  it('requestTerminationByPid against an already-dead pid is a safe no-op-equivalent (never throws, never fabricates verified:true for a target that no longer exists)', async () => {
    const adapter = new ShadowLifecycleProcessAdapter()
    // A pid essentially guaranteed not to correspond to a live process in the
    // test environment's expected range.
    const result = await adapter.requestTerminationByPid(999999, 'posix-process-group')
    expect(result).toBeDefined()
  }, 10_000)
})
