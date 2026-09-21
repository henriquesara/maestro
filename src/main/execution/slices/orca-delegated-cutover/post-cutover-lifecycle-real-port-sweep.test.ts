// ORCA-S5 Post-Cutover Lifecycle — GREEN integration proof: the REAL
// `RealDelegatedProcessPort` + the REAL sweep + a REAL OS process, end to end.
// No OS fake and no classification stand-in: identity, observation, signalling and
// classification are all production code against a real disposable child.
//
// Identity EVIDENCE (the S4 sidecar) is supplied by the test because no production
// writer exists for a real PTY-spawned process — an unresolved frozen-architecture
// seam this slice deliberately does not invent (see GREEN evidence).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { signalProcessTreeByPid } from '../../../../shared/child-process/process-tree-termination'
import { spawnProcess } from '../../../../shared/child-process/run-process'
import { RealDelegatedProcessPort } from '../../../runtime/orca-runtime-real-delegated-process-port'
import { captureOsStartMarkerSync } from '../../infrastructure/process-instance-discriminator'
import {
  authorityOf,
  bindingRowOf,
  closureOf,
  commitDelegatedRun,
  incidentsOf,
  openLifecycleFixture,
  projectionOf,
  requestTeardown,
  seedUpstreamTerminal,
  settle,
  terminationOf,
  type DelegatedRun,
  type FakeOsProcessPort,
  type LifecycleFixture
} from './post-cutover-lifecycle-test-harness'

const open: LifecycleFixture[] = []
const children: ChildProcessWithoutNullStreams[] = []
afterEach(async () => {
  while (children.length) {
    const child = children.pop() as ChildProcessWithoutNullStreams
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      await signalProcessTreeByPid(
        child.pid,
        process.platform === 'win32' ? 'win-taskkill-tree' : 'posix-process-group',
        'SIGKILL'
      )
    }
  }
  while (open.length) {
    open.pop()?.cleanup()
  }
})

const alive = (child: ChildProcessWithoutNullStreams) =>
  child.exitCode === null && child.signalCode === null
const exited = (child: ChildProcessWithoutNullStreams): Promise<void> =>
  new Promise((resolve) => {
    if (!alive(child)) {
      resolve()
      return
    }
    child.once('exit', () => resolve())
  })

async function delegatedRunOverRealProcess(over: { staleMarker?: boolean } = {}) {
  const fx = openLifecycleFixture()
  open.push(fx)
  const child = spawnProcess({
    program: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    detached: true,
    stdio: 'ignore'
  })
  children.push(child)
  const marker = captureOsStartMarkerSync(child.pid as number)
  const run: DelegatedRun = await commitDelegatedRun(fx, 1, {
    process: {
      pid: child.pid as number,
      osStartMarker: over.staleMarker ? 'STALE_INCARNATION' : (marker.osStartMarker as string),
      osStartMarkerSource: marker.osStartMarkerSource as DelegatedRun['osStartMarkerSource']
    }
  })
  seedUpstreamTerminal(fx, run)
  // Durable identity evidence for the bound process (test-supplied; see header).
  const dir = join(fx.dir, 'durable-shadow-lifecycle', 'process')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${run.orcaDispatchId}.json`),
    JSON.stringify({
      correlationId: run.correlationId,
      orcaRunId: run.orcaRunId,
      orcaDispatchId: run.orcaDispatchId,
      processNonce: `nonce_pc_${run.n}`
    })
  )
  return { fx, child, run, port: new RealDelegatedProcessPort() as unknown as FakeOsProcessPort }
}

describe('GREEN — real port + real sweep + real process', () => {
  it('a healthy, verified, still-running delegated process is left ALIVE by reconciliation (observation is not termination)', async () => {
    const { fx, child, run, port } = await delegatedRunOverRealProcess()

    for (let i = 0; i < 3; i += 1) {
      expect((await settle(fx, port)).error).toBeUndefined()
    }

    expect(alive(child), 'the workload must survive every sweep').toBe(true)
    expect(terminationOf(fx, run)).toBeUndefined()
    expect(bindingRowOf(fx, run)?.teardown_requested_at).toBeNull()
    expect(closureOf(fx, run)).toBeUndefined()
    expect(incidentsOf(fx, run)).toHaveLength(0)
    expect(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  })

  it('a durable cancel terminates EXACTLY the verified process and the run converges to closure=cancelled, restart-stable', async () => {
    const { fx, child, run, port } = await delegatedRunOverRealProcess()
    requestTeardown(fx, run, 'user_cancel')

    expect((await settle(fx, port)).error).toBeUndefined()
    await exited(child)

    expect(alive(child)).toBe(false)
    expect(terminationOf(fx, run)?.termination_method).toBe('signalled')
    expect(bindingRowOf(fx, run)?.teardown_reason).toBe('user_cancel')
    expect(closureOf(fx, run)?.terminal_status_ref).toBe('cancelled')
    expect(projectionOf(fx, run)?.status).toBe('pending')

    fx.reopen()
    expect((await settle(fx, port)).error).toBeUndefined()
    expect(closureOf(fx, run)?.terminal_status_ref).toBe('cancelled')
  })

  it('a recycled identity (durable marker disagrees with the live process) is NEVER signalled: process stays alive, blocked incident, no closure', async () => {
    const { fx, child, run, port } = await delegatedRunOverRealProcess({ staleMarker: true })
    requestTeardown(fx, run, 'timeout')

    expect((await settle(fx, port)).error).toBeUndefined()

    expect(alive(child), 'an unrelated live process at the bound pid must be untouched').toBe(true)
    expect(terminationOf(fx, run)).toBeUndefined()
    expect(closureOf(fx, run)).toBeUndefined()
    expect(incidentsOf(fx, run).map((i) => i.kind)).toEqual(['process_identity_mismatch'])
    expect(bindingRowOf(fx, run)?.teardown_reason, 'the durable intent is retained').toBe('timeout')
    expect(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  })
})
