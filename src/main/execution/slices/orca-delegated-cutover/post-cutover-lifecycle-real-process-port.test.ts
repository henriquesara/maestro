// ORCA-S5 Post-Cutover Lifecycle — GENUINE RED: `RealDelegatedProcessPort`
// (SPEC §7.1, §4.8.6, §11; mission §5, §6, §27, §28; gates 8, 27, 40).
//
// SPEC §7.1 (frozen): `RealDelegatedProcessPort` implements ORCA-S4's EXACT
// `ShadowLifecycleProcessPort` interface, unmodified as a type:
//   - `spawn(...)` does NOT create a process. It ADOPTS the already-real
//     `{ pid, incarnationId }` the runtime produced at the S4 seam and captures
//     `osStartMarker`/`osStartMarkerSource` via the SAME local-host primitives S4
//     already uses (`captureOsStartMarkerSync`) — never a fabricated value.
//   - `observe(...)` / `requestTermination*(...)` reuse S4's fail-closed identity
//     discipline verbatim, now protecting a REAL process.
// §4.8.6: the port lives on the RUNTIME side (never imported by Execution
// infrastructure); Execution receives it only as the injected
// `processPort: ShadowLifecycleProcessPortLike`.
//
// RED CAUSE: no production `RealDelegatedProcessPort` exists (verified: the only
// `ShadowLifecycleProcessPort` implementation is the synthetic
// `ShadowLifecycleProcessAdapter`, which SPAWNS a fixture child).
//
// RED-IMPOSED PATH/SHAPE (SPEC names the type, not a file): the module is
// imported from `src/main/runtime/orca-runtime-real-delegated-process-port`
// (runtime side, per §4.8.6) and exports class `RealDelegatedProcessPort`;
// adoption is expressed as the S4 spawn input plus `adoptedProcess: { pid,
// incarnationId }`. A GREEN session may only relocate/rename these by editing
// this file's imports/one input field in a documented RED-contract change.
//
// NO FAKED OS: these tests use REAL, disposable OS processes. The identity
// decisions (same incarnation? recycled pid? no baseline?) are made by the
// production port against the real OS. Nothing here models the desired
// behavior in a fake.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawnProcess } from '../../../../shared/child-process/run-process'
import { signalProcessTreeByPid } from '../../../../shared/child-process/process-tree-termination'
import {
  captureOsStartMarkerSync,
  readCurrentOsStartMarker
} from '../../infrastructure/process-instance-discriminator'

type PortCtor = new () => {
  spawn(input: Record<string, unknown>): {
    pid: number
    killScope: string
    osStartMarker: string | null
    osStartMarkerSource: string
  }
  observe(handle: unknown, durable: Record<string, unknown>): Promise<{ kind: string }>
  requestTermination(handle: unknown): Promise<{ verified: boolean }>
  requestTerminationByPid(pid: number, killScope: string): Promise<{ verified: boolean }>
}

async function loadPort(): Promise<PortCtor> {
  const mod = (await import('../../../runtime/orca-runtime-real-delegated-process-port')) as {
    RealDelegatedProcessPort: PortCtor
  }
  return mod.RealDelegatedProcessPort
}

const children: ChildProcessWithoutNullStreams[] = []
const tmpDirs: string[] = []
afterEach(() => {
  while (children.length) {
    const c = children.pop()
    try {
      c?.kill()
    } catch {
      /* already gone */
    }
  }
  while (tmpDirs.length) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true, maxRetries: 3 })
  }
})

function realLongLivedProcess(): ChildProcessWithoutNullStreams {
  const child = spawnProcess({
    program: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    detached: true,
    stdio: 'ignore'
  })
  children.push(child)
  if (!child.pid) {
    throw new Error('fixture: real process failed to start')
  }
  return child
}

const exited = (child: ChildProcessWithoutNullStreams): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    child.once('exit', () => resolve())
  })

function adoptInput(pid: number, dir: string, over: Record<string, unknown> = {}) {
  return {
    correlationId: 'corr_port_1',
    orcaRunId: 'run_port_1',
    orcaDispatchId: 'dispatch_port_1',
    processNonce: 'nonce_port_1',
    identitySidecarPath: join(dir, 'dispatch_port_1.json'),
    adoptedProcess: { pid, incarnationId: 'incarnation_port_1' },
    ...over
  }
}
function durableOf(pid: number, dir: string, over: Record<string, unknown> = {}) {
  const marker = captureOsStartMarkerSync(pid)
  return {
    pid,
    processNonce: 'nonce_port_1',
    identitySidecarPath: join(dir, 'dispatch_port_1.json'),
    teardownRequestedAt: null,
    osStartMarker: marker.osStartMarker,
    osStartMarkerSource: marker.osStartMarkerSource,
    ...over
  }
}
/**
 * Durable identity EVIDENCE (the S4 sidecar shape) for the adopted process. No production
 * writer exists for a real PTY-spawned process (an unresolved frozen-architecture seam, see
 * POST-CUTOVER-LIFECYCLE-GREEN-EVIDENCE.md), and this slice deliberately does not invent one:
 * the port USES such evidence when it exists and fails closed when it does not. The tests that
 * assert the "evidence exists" branch supply it here; the "evidence absent" branch is asserted
 * separately below.
 */
function writeIdentityEvidence(dir: string): void {
  writeFileSync(
    join(dir, 'dispatch_port_1.json'),
    JSON.stringify({
      correlationId: 'corr_port_1',
      orcaRunId: 'run_port_1',
      orcaDispatchId: 'dispatch_port_1',
      processNonce: 'nonce_port_1'
    })
  )
}

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'orca-s5-realport-'))
  tmpDirs.push(d)
  return d
}

describe('CONTROL — the real-process fixtures are sound, using ONLY existing S4 primitives (a correct GREEN port is achievable from them)', () => {
  it('a real child yields a stable, re-readable OS incarnation marker, and the existing pid-addressed primitive terminates exactly it', async () => {
    const target = realLongLivedProcess()
    const bystander = realLongLivedProcess()
    const captured = captureOsStartMarkerSync(target.pid as number)
    expect(
      captured.osStartMarker,
      'host supplies an OS-observable incarnation marker'
    ).not.toBeNull()
    expect(captured.osStartMarkerSource).not.toBe('unavailable')
    expect(await readCurrentOsStartMarker(target.pid as number, captured.osStartMarkerSource)).toBe(
      captured.osStartMarker
    )

    const verified = await signalProcessTreeByPid(
      target.pid as number,
      process.platform === 'win32' ? 'win-taskkill-tree' : 'posix-process-group',
      'SIGTERM'
    )
    await exited(target)

    expect(typeof verified).toBe('boolean')
    expect(target.exitCode !== null || target.signalCode !== null).toBe(true)
    expect(bystander.exitCode === null && bystander.signalCode === null).toBe(true)
  })
})

describe('RED — RealDelegatedProcessPort is the exact S4 port shape over a REAL process (SPEC §7.1)', () => {
  it('exists and exposes exactly the ShadowLifecycleProcessPort surface: spawn / observe / requestTermination / requestTerminationByPid', async () => {
    const Port = await loadPort()
    const port = new Port()
    for (const method of [
      'spawn',
      'observe',
      'requestTermination',
      'requestTerminationByPid'
    ] as const) {
      expect.soft(typeof port[method], `RealDelegatedProcessPort.${method}`).toBe('function')
    }
  })

  it('spawn ADOPTS the already-running process: same pid, OS marker captured by the S4 primitive, never a fabricated value', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const real = realLongLivedProcess()
    const truth = captureOsStartMarkerSync(real.pid as number)

    const adopted = new Port().spawn(adoptInput(real.pid as number, dir))

    expect.soft(adopted.pid, 'adoption never creates a second process').toBe(real.pid)
    expect.soft(adopted.osStartMarker).toBe(truth.osStartMarker)
    expect.soft(adopted.osStartMarkerSource).toBe(truth.osStartMarkerSource)
    expect
      .soft(adopted.killScope)
      .toBe(process.platform === 'win32' ? 'win-taskkill-tree' : 'posix-process-group')
  })
})

describe('RED — identity is the SAME incarnation or nothing: no PID-only control (SPEC §7.1, S4 §9.3/§12 L12/L13; mission §6, §28)', () => {
  it('a live process whose durable identity matches is reported still_running', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const real = realLongLivedProcess()
    const port = new Port()
    port.spawn(adoptInput(real.pid as number, dir))
    writeIdentityEvidence(dir)

    const observation = await port.observe(null, durableOf(real.pid as number, dir))

    expect.soft(observation.kind).toBe('still_running')
  })

  it('NO durable identity evidence for a live process: fail closed (identity_unverifiable) — never verified from pid + marker alone, never signalled', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const real = realLongLivedProcess()
    const port = new Port()
    port.spawn(adoptInput(real.pid as number, dir)) // adoption alone writes no evidence (unfrozen seam)

    const observation = await port.observe(null, durableOf(real.pid as number, dir))

    expect.soft(observation.kind).toBe('identity_unverifiable')
    expect
      .soft(real.exitCode === null && real.signalCode === null, 'observing never signals')
      .toBe(true)
  })

  it('a macOS-style durable identity (`posix_ps_lstart`) cannot be corroborated by a real shell: a live process is unverifiable (no signal), a dead one is reported dead', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const live = realLongLivedProcess()
    const gone = realLongLivedProcess()
    const port = new Port()
    writeIdentityEvidence(dir)
    const macosSource = {
      osStartMarkerSource: 'posix_ps_lstart',
      osStartMarker: 'Mon Sep 21 00:00:00 2026'
    }

    const liveObservation = await port.observe(
      null,
      durableOf(live.pid as number, dir, macosSource)
    )
    const goneDurable = durableOf(gone.pid as number, dir, macosSource)
    gone.kill()
    await exited(gone)
    const goneObservation = await port.observe(null, goneDurable)

    expect.soft(liveObservation.kind).toBe('identity_unverifiable')
    expect.soft(goneObservation.kind).toBe('confirmed_dead_unknown_cause')
    expect.soft(live.exitCode === null && live.signalCode === null).toBe(true)
  })

  it('adoption never fabricates a process: adopting a pid that is not alive is rejected', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const real = realLongLivedProcess()
    const deadPid = real.pid as number
    real.kill()
    await exited(real)

    expect(() => new Port().spawn(adoptInput(deadPid, dir))).toThrow(
      /delegated_process_adoption_failed/
    )
  })

  it('PID reuse: the live process at the bound pid has a DIFFERENT incarnation marker -> identity_unverifiable, and it is left ALIVE (never signalled)', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const real = realLongLivedProcess()
    const port = new Port()
    port.spawn(adoptInput(real.pid as number, dir))

    // The durable record was written for a DIFFERENT (now-dead) incarnation of this pid.
    const observation = await port.observe(
      null,
      durableOf(real.pid as number, dir, { osStartMarker: 'STALE_INCARNATION_MARKER' })
    )

    expect.soft(observation.kind).toBe('identity_unverifiable')
    expect
      .soft(
        real.exitCode === null && real.signalCode === null,
        'observing an unverifiable identity must never kill it'
      )
      .toBe(true)
  })

  it('no durable OS-marker baseline (`unavailable`): never downgraded to PID-only — identity_unverifiable even though the pid is alive', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const real = realLongLivedProcess()
    const port = new Port()
    port.spawn(adoptInput(real.pid as number, dir))

    const observation = await port.observe(
      null,
      durableOf(real.pid as number, dir, {
        osStartMarker: null,
        osStartMarkerSource: 'unavailable'
      })
    )

    expect.soft(observation.kind).toBe('identity_unverifiable')
  })

  it('a process that has already exited is observed as confirmed_dead_unknown_cause without any signal', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const real = realLongLivedProcess()
    const durable = durableOf(real.pid as number, dir)
    const port = new Port()
    port.spawn(adoptInput(real.pid as number, dir))
    real.kill()
    await exited(real)

    const observation = await port.observe(null, durable)

    expect.soft(observation.kind).toBe('confirmed_dead_unknown_cause')
  })
})

describe('RED — termination by pid terminates exactly the adopted real process (SPEC §7.1, gate 27)', () => {
  it('requestTerminationByPid on the adopted identity ends that process; the result is verified', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const real = realLongLivedProcess()
    const port = new Port()
    const adopted = port.spawn(adoptInput(real.pid as number, dir))

    const result = await port.requestTerminationByPid(adopted.pid, adopted.killScope)
    await Promise.race([
      exited(real),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('process did not exit')), 15_000)
      )
    ])

    expect.soft(result.verified).toBe(true)
    expect.soft(real.exitCode !== null || real.signalCode !== null).toBe(true)
  })

  it('an unrelated sibling process is never touched when the adopted one is terminated', async () => {
    const Port = await loadPort()
    const dir = tmp()
    const target = realLongLivedProcess()
    const bystander = realLongLivedProcess()
    const port = new Port()
    const adopted = port.spawn(adoptInput(target.pid as number, dir))

    await port.requestTerminationByPid(adopted.pid, adopted.killScope)
    await exited(target)

    expect
      .soft(bystander.exitCode === null && bystander.signalCode === null, 'bystander must survive')
      .toBe(true)
  })
})
