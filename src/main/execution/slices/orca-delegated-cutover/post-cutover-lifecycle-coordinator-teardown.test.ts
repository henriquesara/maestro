// ORCA-S5 Post-Cutover Lifecycle — GREEN hardening tests for behavior the RED suite
// covers only indirectly:
//  - the coordinator's timeout entry (an already-DECIDED cause; the SLA policy is
//    unfrozen and deliberately not modelled) and first-writer-wins ACROSS cancel/timeout;
//  - per-binding isolation of the S4 sweep (S4 SPEC §13): one binding's failure is
//    reported in `sweepErrors` and never blocks a sibling.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setAppEnvironment } from '../../../../shared/app-environment'
import { OrcaRuntimeWithDelegatedCutoverCoordinator } from '../../../runtime/orca-runtime-delegated-cutover-coordinator'
import { FakeAiControlFenceClient, fixtureProcessIdentity } from './cutover-core-test-harness'
import {
  closureOf,
  commitDelegatedRun,
  FakeOsProcessPort,
  openLifecycleFixture,
  seedUpstreamTerminal,
  sweep,
  terminationOf,
  type LifecycleFixture
} from './post-cutover-lifecycle-test-harness'

const cleanups: (() => void)[] = []
const open: LifecycleFixture[] = []
afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.()
  }
  while (open.length) {
    open.pop()?.cleanup()
  }
})

async function coordinatorWithRun(correlationId: string, pid: number) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s5-coord-teardown-'))
  setAppEnvironment({
    getPath: (name: string) => (name === 'userData' ? dir : tmpdir()),
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  } as never)
  const fence = new FakeAiControlFenceClient()
  const port = new FakeOsProcessPort()
  const runtime = new OrcaRuntimeWithDelegatedCutoverCoordinator()
  runtime.getDelegatedCutoverCoordinatorDeps = () => ({ fence, processPort: port })
  const coordinator = runtime.getDelegatedCutoverCoordinator()
  const aicontrolRunId = `aicontrol_${correlationId}`
  fence.seedEligible(aicontrolRunId)
  await coordinator.establishReservation({
    correlationId,
    aicontrolRunId,
    fenceToken: `token_${correlationId}`,
    workloadId: `workload_${correlationId}`,
    providerEligible: true,
    now: '2026-09-21T00:00:00Z'
  })
  await coordinator.commitDelegatedCutover({
    aicontrolRunId,
    fenceToken: `token_${correlationId}`,
    correlationId,
    orcaDispatchId: `dispatch_${correlationId}`,
    processIdentity: fixtureProcessIdentity({
      correlationId,
      orcaDispatchId: `dispatch_${correlationId}`,
      orcaRunId: `run_${correlationId}`,
      pid
    })
  })
  const db = runtime.getDelegatedCutoverDatabaseForDiagnostics()!
  cleanups.push(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  })
  const reason = () =>
    (
      db
        .prepare('SELECT teardown_reason FROM dispatch_process_binding WHERE correlation_id = ?')
        .get(correlationId) as { teardown_reason: string | null }
    ).teardown_reason
  return { coordinator, port, db, reason }
}

describe('coordinator teardown intent — cancel and an already-decided timeout share ONE first-writer-wins write', () => {
  it('a timeout decision durably records intent + reason (and never signals itself)', async () => {
    const { coordinator, port, reason } = await coordinatorWithRun('corr_t1', 992_001)
    expect(await coordinator.requestDelegatedTimeout({ correlationId: 'corr_t1' })).toEqual({
      outcome: 'REQUESTED'
    })
    expect(reason()).toBe('timeout')
    expect(port.totalSignals).toBe(0)
  })

  it.each([
    { first: 'cancel', second: 'timeout', winner: 'user_cancel' },
    { first: 'timeout', second: 'cancel', winner: 'timeout' }
  ] as const)(
    '$first then $second: the first cause wins, the second reports it and never overwrites',
    async ({ first, second, winner }) => {
      const { coordinator, reason } = await coordinatorWithRun(
        `corr_${first}_${second}`,
        first === 'cancel' ? 992_002 : 992_003
      )
      const request = (which: 'cancel' | 'timeout') =>
        which === 'cancel'
          ? coordinator.requestDelegatedCancellation({ correlationId: `corr_${first}_${second}` })
          : coordinator.requestDelegatedTimeout({ correlationId: `corr_${first}_${second}` })

      expect(await request(first)).toEqual({ outcome: 'REQUESTED' })
      expect(await request(second)).toEqual({ outcome: 'ALREADY_REQUESTED', reason: winner })
      expect(await request(first)).toEqual({ outcome: 'ALREADY_REQUESTED', reason: winner })
      expect(reason()).toBe(winner)
    }
  )

  it('a run that already has a terminal fact accepts no further teardown intent', async () => {
    const { coordinator, port, db, reason } = await coordinatorWithRun('corr_t4', 992_004)
    db.prepare(
      "INSERT INTO dispatch_termination (correlation_id, orca_dispatch_id, termination_method, exit_code, exit_signal, tree_verified, observed_at) VALUES ('corr_t4', 'dispatch_corr_t4', 'self_exit', 0, NULL, 1, 't')"
    ).run()

    expect(await coordinator.requestDelegatedCancellation({ correlationId: 'corr_t4' })).toEqual({
      outcome: 'ALREADY_TERMINAL'
    })
    expect(reason()).toBeNull()
    expect(port.totalSignals).toBe(0)
  })

  it('a run with no durable cutover is rejected for timeout as well as cancellation', async () => {
    const { coordinator } = await coordinatorWithRun('corr_t5', 992_005)
    await expect(
      coordinator.requestDelegatedTimeout({ correlationId: 'corr_never' })
    ).rejects.toThrow(/no_durable_cutover/)
  })
})

describe('S4 sweep per-binding isolation (S4 SPEC §13)', () => {
  it('one binding failing is reported in sweepErrors and never blocks a sibling from converging', async () => {
    const fx = openLifecycleFixture()
    open.push(fx)
    const a = await commitDelegatedRun(fx, 1)
    const b = await commitDelegatedRun(fx, 2)
    seedUpstreamTerminal(fx, a)
    seedUpstreamTerminal(fx, b)
    const port = new FakeOsProcessPort().selfExit(a, 0).selfExit(b, 0)
    const real = fx.stores.terminations
    const poisoned = new Proxy(real, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (prop === 'insert' && typeof value === 'function') {
          return (record: { correlationId: string }) => {
            if (record.correlationId === a.correlationId) {
              throw new Error('disk on fire for binding A only')
            }
            return (value as (r: unknown) => unknown).call(target, record)
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      }
    }) as never

    for (let pass = 0; pass < 4; pass += 1) {
      const report = await sweep(fx, port, { overrideStores: { terminations: poisoned } })
      expect(report.sweepErrors.map((e) => e.correlationId)).toContain(a.correlationId)
      expect(report.sweepErrors.find((e) => e.correlationId === a.correlationId)?.error).toContain(
        'disk on fire'
      )
    }

    expect(terminationOf(fx, a)).toBeUndefined()
    expect(closureOf(fx, a)).toBeUndefined()
    expect(
      closureOf(fx, b)?.terminal_status_ref,
      'the sibling converged despite A failing every pass'
    ).toBe('completed')
  })
})
