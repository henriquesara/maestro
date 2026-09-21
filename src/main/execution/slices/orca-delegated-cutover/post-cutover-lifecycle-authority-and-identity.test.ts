// ORCA-S5 Post-Cutover Lifecycle — GENUINE RED (mission §3, §6, §13, §26-§28).
//
// Every test starts from a REAL disposable Execution DB holding a durably
// committed `delegation_cutover` (built through the accepted Cutover-Core
// application APIs — see post-cutover-lifecycle-test-harness.ts). Authority is
// DERIVED from that durable fact, never a flag.
//
// Two describe blocks, deliberately separated:
//  - `RED`     : must FAIL today, for the named production gap.
//  - `CONTROL` : must PASS today. They prove the harness is sound and record
//                which S4 fail-closed identity mechanisms already protect a
//                delegated binding unmodified (so GREEN must not regress them).

import { afterEach, describe, expect, it } from 'vitest'
import {
  assertNoFallback,
  authorityOf,
  bindingRowOf,
  captureAuthorityBaseline,
  closureOf,
  commitDelegatedRun,
  countRows,
  FakeAiControlCancellationAuthority,
  FakeOsProcessPort,
  incidentsOf,
  openLifecycleFixture,
  requestTeardown,
  seedUpstreamTerminal,
  sqlRow,
  settle,
  SWEEP_MUST_CONVERGE,
  sweep,
  terminationOf,
  type LifecycleFixture
} from './post-cutover-lifecycle-test-harness'

const open: LifecycleFixture[] = []
function fixture(): LifecycleFixture {
  const fx = openLifecycleFixture()
  open.push(fx)
  return fx
}
afterEach(() => {
  while (open.length) {
    open.pop()?.cleanup()
  }
})

describe('CONTROL — the harness starts every lifecycle test from a durably committed cutover', () => {
  it('authority is ORCA_DELEGATED because delegation_cutover is durable, and AICONTROL_NATIVE without it', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    expect(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
    expect(authorityOf(fx, 'corr_never_cutover')).toBe('AICONTROL_NATIVE')
    expect(
      sqlRow(
        fx,
        'SELECT aicontrol_run_id, fence_token FROM delegation_cutover WHERE correlation_id = ?',
        run.correlationId
      )
    ).toEqual({
      aicontrol_run_id: run.aicontrolRunId,
      fence_token: run.fenceToken
    })
    // Real, migrated schema v6 — the lifecycle tables the SPEC extends already exist.
    expect(countRows(fx, 'dispatch_process_binding')).toBe(1)
    expect(bindingRowOf(fx, run)?.teardown_requested_at).toBeNull()
  })

  it('authority survives a host restart: a fresh DB connection re-derives ORCA_DELEGATED from the durable row alone', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    fx.reopen()
    expect(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  })
})

describe('CONTROL — S4 fail-closed identity mechanism already protects a delegated binding (must not regress)', () => {
  it('PID reused by an unrelated process (OS marker disagrees): NO signal, no termination, blocked incident, authority unchanged', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = captureAuthorityBaseline(fx, run)
    const port = new FakeOsProcessPort().rawOs(run, {
      pidExists: true,
      currentOsStartMarker: 'A_DIFFERENT_PROCESS_INCARNATION'
    })

    await sweep(fx, port)

    expect(port.totalSignals).toBe(0)
    expect(terminationOf(fx, run)).toBeUndefined()
    expect(closureOf(fx, run)).toBeUndefined()
    expect(incidentsOf(fx, run).map((i) => i.kind)).toEqual(['orphan_process_unverifiable'])
    assertNoFallback(expect, fx, run, port, before)
  })

  it('binding with no durable OS-marker baseline (`unavailable`) is never downgraded to PID-only control', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1, { osStartMarkerSource: 'unavailable' })
    seedUpstreamTerminal(fx, run)
    const port = new FakeOsProcessPort().rawOs(run, {
      pidExists: true,
      currentOsStartMarker: run.osStartMarker
    })

    await sweep(fx, port)

    expect(port.totalSignals).toBe(0)
    expect(terminationOf(fx, run)).toBeUndefined()
    expect(incidentsOf(fx, run).map((i) => i.kind)).toEqual(['orphan_process_unverifiable'])
  })
})

describe('RED — process identity is the SAME instance bound at Cutover Core (mission §6, §28)', () => {
  it('a verified teardown signals EXACTLY the bound pid/kill-scope once, and the terminal classification comes from the durable reason', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'user_cancel')
    const port = new FakeOsProcessPort().rawOs(run, {
      pidExists: true,
      currentOsStartMarker: run.osStartMarker
    })

    const settled = await settle(fx, port)
    expect.soft(settled.error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect.soft(port.signalByPidCalls).toEqual([{ pid: run.pid, killScope: run.killScope }])
    expect.soft(terminationOf(fx, run)?.termination_method).toBe('signalled')
    // RED: neither teardown_reason nor terminal_status_ref has an application writer.
    expect.soft(bindingRowOf(fx, run)?.teardown_reason).toBe('user_cancel')
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('cancelled')
  })

  it('identity unverifiable while a cancel is pending: NO signal, the durable intent + reason are retained, no closure is fabricated, authority stays delegated', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'user_cancel')
    const before = captureAuthorityBaseline(fx, run)
    const port = new FakeOsProcessPort().rawOs(run, {
      pidExists: true,
      currentOsStartMarker: 'RECYCLED_PID_OTHER_PROCESS'
    })

    const settled = await settle(fx, port)
    expect.soft(settled.error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect.soft(port.totalSignals).toBe(0)
    expect.soft(bindingRowOf(fx, run)?.teardown_requested_at).not.toBeNull()
    // RED: the reason must be durable alongside the intent (SPEC §9.1 one-statement write).
    expect.soft(bindingRowOf(fx, run)?.teardown_reason).toBe('user_cancel')
    expect.soft(terminationOf(fx, run)).toBeUndefined()
    expect.soft(closureOf(fx, run)).toBeUndefined()
    expect.soft(incidentsOf(fx, run).map((i) => i.kind)).toEqual(['orphan_process_unverifiable'])
    assertNoFallback(expect.soft, fx, run, port, before)
  })

  it('an already-dead process during a cancel reconcile is observed safely — never signalled, classified from durable cause', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'user_cancel')
    const port = new FakeOsProcessPort().deadUnknownCause(run)

    const settled = await settle(fx, port)
    expect.soft(settled.error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect
      .soft(port.totalSignals, 'never signal a pid that is already gone (it may be recycled)')
      .toBe(0)
    expect.soft(terminationOf(fx, run)?.termination_method).toBe('signalled') // honest reattribution (S4 §9.3 / L6)
    // RED: derived legal classification = durable cause 'user_cancel' -> 'cancelled'.
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('cancelled')
  })
})

describe('RED — only the CURRENT authority acts after cutover (mission §13, gate 27)', () => {
  it('a native aiControl cancellation flag cannot terminate, resume or reclassify a delegated run', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = captureAuthorityBaseline(fx, run)

    // aiControl-native side "cancels" the run AFTER the durable cutover.
    const native = new FakeAiControlCancellationAuthority()
    native.cancel(run.aicontrolRunId)
    expect.soft(native.isCancelled(run.aicontrolRunId)).toBe(true)

    // The delegated process is healthy and running; Orca has NOT requested teardown.
    const port = new FakeOsProcessPort().running(run)
    const settled = await settle(fx, port)
    expect.soft(settled.error, SWEEP_MUST_CONVERGE).toBeUndefined()

    // RED: today the sweep signals ANY still-running process immediately (an S4
    // synthetic-fixture policy, S4 §9.3) — for a real delegated workload that
    // kills a healthy execution nobody with authority asked to stop.
    expect.soft(port.totalSignals).toBe(0)
    expect.soft(bindingRowOf(fx, run)?.teardown_requested_at).toBeNull()
    expect.soft(bindingRowOf(fx, run)?.teardown_reason ?? null).toBeNull()
    expect.soft(terminationOf(fx, run)).toBeUndefined()
    expect.soft(closureOf(fx, run)).toBeUndefined()
    assertNoFallback(expect.soft, fx, run, port, before)
  })

  it('a healthy still-running delegated process with no durable teardown request is left completely alone', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const port = new FakeOsProcessPort().running(run)

    const settled = await settle(fx, port)
    expect.soft(settled.error, SWEEP_MUST_CONVERGE).toBeUndefined()
    const report = settled.report

    expect.soft(port.totalSignals).toBe(0)
    expect.soft(terminationOf(fx, run)).toBeUndefined()
    expect.soft(report?.closed ?? []).not.toContain(run.correlationId)
    expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  })
})
