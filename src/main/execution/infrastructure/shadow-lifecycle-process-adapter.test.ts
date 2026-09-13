import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { ShadowLifecycleProcessAdapter } from './shadow-lifecycle-process-adapter'

// ORCA-S4 SPEC §9.1, §9.2, §9.3 — the real ShadowLifecycleProcessPort adapter,
// wrapping spawnProcess / signalProcessTree / admitProcessTreeKill (reused, not
// reimplemented, AGENTS.md). Exercises a REAL synthetic child process (§4), the
// same-process-instance live-handle path (§9.1.1), and self-exit observation.
// Restart-recovered pid-addressed termination is covered separately
// (`shadow-lifecycle-process-adapter.restart-recovered.test.ts`) since it needs
// the full sidecar/identity-verification pipeline. RED:
// `./shadow-lifecycle-process-adapter` does not exist yet.

describe('ShadowLifecycleProcessAdapter (§9.1, §9.2)', () => {
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

  it('spawn() returns a real pid, a platform-appropriate killScope, and an osStartMarker captured immediately after spawn (§4, §9.2 step 4)', () => {
    const adapter = new ShadowLifecycleProcessAdapter()
    const result = adapter.spawn({
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      orcaDispatchId: 'ctx_1',
      processNonce: 'nonce_1',
      identitySidecarPath: '/tmp/unused-in-this-test.json'
    })
    spawned.push({ kill: () => result.handle.kill('SIGKILL') })
    expect(typeof result.pid).toBe('number')
    expect(result.pid).toBeGreaterThan(0)
    expect(['posix-process-group', 'win-taskkill-tree']).toContain(result.killScope)
    // osStartMarkerSource must be one of the four defined values, never something invented.
    expect([
      'windows_creation_time',
      'posix_proc_stat_starttime',
      'posix_ps_lstart',
      'unavailable'
    ]).toContain(result.osStartMarkerSource)
    if (result.osStartMarkerSource === 'unavailable') {
      expect(result.osStartMarker).toBeNull()
    } else {
      expect(typeof result.osStartMarker).toBe('string')
    }
  })

  it('the spawned process embeds processNonce verbatim in its argv, on every platform (§9.2 step 4 — read back by the macOS branch, §9.1.3)', () => {
    const adapter = new ShadowLifecycleProcessAdapter()
    const result = adapter.spawn({
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      orcaDispatchId: 'ctx_1',
      processNonce: 'unique-nonce-xyz',
      identitySidecarPath: '/tmp/unused-in-this-test.json'
    })
    spawned.push({ kill: () => result.handle.kill('SIGKILL') })
    const spawnArgs = (result.handle as unknown as { spawnargs: string[] }).spawnargs ?? []
    expect(spawnArgs.some((a) => a.includes('unique-nonce-xyz'))).toBe(true)
  })

  it('observe(handle, durable) reports "still_running" while the live process has not exited', async () => {
    const adapter = new ShadowLifecycleProcessAdapter()
    const { handle, pid, osStartMarker, osStartMarkerSource } = adapter.spawn({
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      orcaDispatchId: 'ctx_1',
      processNonce: 'nonce_1',
      identitySidecarPath: '/tmp/unused-in-this-test.json'
    })
    spawned.push({ kill: () => handle.kill('SIGKILL') })
    await sleep(200)
    const observation = await adapter.observe(handle, {
      pid,
      processNonce: 'nonce_1',
      identitySidecarPath: '/tmp/unused-in-this-test.json',
      teardownRequestedAt: null,
      osStartMarker,
      osStartMarkerSource
    })
    expect(observation).toEqual({ kind: 'still_running' })
  })

  it('same-process-instance path: requestTermination(handle) verifiably kills the process (§9.1.1 — signalProcessTree unchanged, no OS-marker check needed)', async () => {
    const adapter = new ShadowLifecycleProcessAdapter()
    const { handle } = adapter.spawn({
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      orcaDispatchId: 'ctx_1',
      processNonce: 'nonce_1',
      identitySidecarPath: '/tmp/unused-in-this-test.json'
    })
    spawned.push({ kill: () => handle.kill('SIGKILL') })
    await sleep(150)
    const result = await adapter.requestTermination(handle)
    expect(result.verified).toBe(true)
  }, 10_000)

  it('observe() reports "self_exit" with a real exit code once the process exits on its own', async () => {
    const adapter = new ShadowLifecycleProcessAdapter()
    // This test drives a self-exiting fixture through the adapter's own spawn
    // contract — the adapter is expected to support a test/self-exit mode via
    // its spawn input, mirroring how S1-S3's own disposable fixtures work.
    const { handle, pid, osStartMarker, osStartMarkerSource } = adapter.spawn({
      correlationId: 'corr_1',
      orcaRunId: 'run_1',
      orcaDispatchId: 'ctx_1',
      processNonce: 'nonce_1',
      identitySidecarPath: '/tmp/unused-in-this-test.json',
      __testSelfExitCode: 0
    } as never)
    spawned.push({ kill: () => handle.kill('SIGKILL') })
    await new Promise<void>((resolve) => handle.on('exit', () => resolve()))
    const observation = await adapter.observe(handle, {
      pid,
      processNonce: 'nonce_1',
      identitySidecarPath: '/tmp/unused-in-this-test.json',
      teardownRequestedAt: null,
      osStartMarker,
      osStartMarkerSource
    })
    expect(observation).toEqual({ kind: 'self_exit', exitCode: 0, exitSignal: null })
  }, 10_000)
})
