// ORCA-S5 Post-Cutover Lifecycle — GENUINE RED: no fallback to AICONTROL_NATIVE
// after cutover, on every failure path (mission §14, §26; SPEC §5.7, §5.8, §7.2,
// §11, §12, §16, §20, gate 28; M5 remains NOT STARTED).
//
// Each scenario pairs (a) the SPEC-specific durable result that is NOT yet
// implemented (so the test is RED for a real production gap, not for a
// trivially-true negative) with (b) the no-fallback invariant
// (`assertNoFallback`): authority still ORCA_DELEGATED, no spawn, no fence
// release, no fence re-acquisition, no replacement reservation/binding, no
// cleared or rewritten delegation_cutover.
//
// "M5 not invoked" is asserted operationally: nothing in any failure path
// re-admits the run to aiControl-native execution (the only things M5 could do
// are exactly the calls `assertNoFallback` forbids).

import { afterEach, describe, expect, it } from 'vitest'
import {
  assertNoFallback,
  bindingRowOf,
  captureAuthorityBaseline,
  closureOf,
  commitDelegatedRun,
  eventsOf,
  FakeOsProcessPort,
  FakeProjectionWriter,
  incidentsOf,
  openLifecycleFixture,
  projectionOf,
  requestTeardown,
  retryableError,
  RETRYABLE_FS_CODE,
  RETRYABLE_PROCESS_CODE,
  seedUpstreamTerminal,
  settle,
  SWEEP_MUST_CONVERGE,
  sweep,
  sweepOnce,
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

describe('RED — process crash / unexpected disappearance (SPEC X10, §5.7 "process confirmed gone")', () => {
  it('an un-requested death is honestly unclassifiable, raises an operator incident, and NEVER resumes native execution or respawns', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = captureAuthorityBaseline(fx, run)
    const port = new FakeOsProcessPort().deadUnknownCause(run)

    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect.soft(terminationOf(fx, run)?.termination_method).toBe('confirmed_dead_unknown_cause')
    expect.soft(closureOf(fx, run)?.terminal_status_ref ?? null).toBeNull() // never defaulted to 'failed'
    expect.soft(incidentsOf(fx, run).map((i) => i.kind)).toContain('unclassifiable_terminal_status') // RED
    assertNoFallback(expect.soft, fx, run, port, before)
  })
})

describe('RED — signal failure (mission §26; S4 §13: LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE — no row, no incident)', () => {
  it('a failed signal request fabricates NO terminal fact, keeps the durable intent+reason, substitutes no identity, and retries from durable state', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'user_cancel')
    const before = captureAuthorityBaseline(fx, run)
    const port = new FakeOsProcessPort().running(run)
    port.signalError = retryableError(RETRYABLE_PROCESS_CODE)

    const first = await sweep(fx, port)

    expect.soft(first.retryable.map((r) => r.code)).toEqual([RETRYABLE_PROCESS_CODE])
    expect
      .soft(terminationOf(fx, run), 'requesting a signal is not a terminal fact')
      .toBeUndefined()
    expect.soft(closureOf(fx, run)).toBeUndefined()
    expect.soft(eventsOf(fx, run)).toHaveLength(0)
    expect
      .soft(incidentsOf(fx, run), 'transient signal failure is retryable state, not an incident')
      .toHaveLength(0)
    expect
      .soft(bindingRowOf(fx, run)?.teardown_reason, 'the durable reason survives a failed signal')
      .toBe('user_cancel') // RED
    expect
      .soft(
        port.signalByPidCalls.every((c) => c.pid === run.pid),
        'never a substituted identity'
      )
      .toBe(true)

    port.signalError = null
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('cancelled') // RED
    assertNoFallback(expect.soft, fx, run, port, before)
  })

  it('a signal whose tree is only root-verified (verified=false) still yields the durable-reason classification, not an incident and not a native retry', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'timeout')
    const before = captureAuthorityBaseline(fx, run)
    const port = new FakeOsProcessPort().running(run)
    port.signalVerified = false

    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect
      .soft(terminationOf(fx, run))
      .toMatchObject({ termination_method: 'signalled', tree_verified: 0 })
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('timeout') // RED
    expect.soft(incidentsOf(fx, run)).toHaveLength(0)
    assertNoFallback(expect.soft, fx, run, port, before)
  })
})

describe('RED — worktree-finalization failure (mission §17; S4 §13 retryable)', () => {
  it('authority stays ORCA_DELEGATED, the terminal fact survives, and nothing falls back while finalization is retried', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = captureAuthorityBaseline(fx, run)
    const port = new FakeOsProcessPort().selfExit(run, 1)
    let armed = true
    const flaky = new Proxy(fx.stores.finalizations, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (prop === 'insertIntent' && typeof value === 'function') {
          return (...a: unknown[]) => {
            if (armed) {
              armed = false
              throw retryableError(RETRYABLE_FS_CODE)
            }
            return (value as (...x: unknown[]) => unknown).apply(target, a)
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      }
    }) as never

    const first = await sweep(fx, port, { overrideStores: { finalizations: flaky } })
    expect.soft(first.retryable).toHaveLength(1)
    expect.soft(terminationOf(fx, run)?.termination_method).toBe('self_exit')

    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('failed') // RED
    assertNoFallback(expect.soft, fx, run, port, before)
  })
})

describe('RED — reconciliation uncertainty: identity cannot be confirmed (S4 §9.3; mission §28)', () => {
  it('blocked by a durable incident, never PID-only control, never native resume; a closure/outbox is never fabricated', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'timeout')
    const before = captureAuthorityBaseline(fx, run)
    const port = new FakeOsProcessPort().rawOs(run, {
      pidExists: true,
      currentOsStartMarker: 'UNRELATED_PROCESS_AT_SAME_PID'
    })

    expect
      .soft(
        (await settle(fx, port, { projectionWriter: new FakeProjectionWriter() })).error,
        SWEEP_MUST_CONVERGE
      )
      .toBeUndefined()

    expect.soft(port.totalSignals).toBe(0)
    expect.soft(incidentsOf(fx, run).map((i) => i.kind)).toEqual(['orphan_process_unverifiable'])
    expect.soft(bindingRowOf(fx, run)?.teardown_reason).toBe('timeout') // RED: reason not durable
    expect.soft(closureOf(fx, run)).toBeUndefined()
    expect.soft(projectionOf(fx, run)).toBeUndefined()
    assertNoFallback(expect.soft, fx, run, port, before)
  })
})

describe('RED — projection failure (SPEC §14 X6/X7): retriable local state, never lost correctness, never a fallback trigger', () => {
  it('a permanently failing aiControl transport leaves Orca terminal truth complete and authority unchanged', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = captureAuthorityBaseline(fx, run)
    const port = new FakeOsProcessPort().selfExit(run, 0)
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined() // terminal truth + pending outbox
    const writer = new FakeProjectionWriter()
    writer.defaultError = new Error('ECONNREFUSED: aiControl permanently unreachable')

    for (let i = 0; i < 4; i += 1) {
      expect
        .soft((await sweepOnce(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
        .toBeUndefined()
    }

    expect
      .soft(
        closureOf(fx, run)?.terminal_status_ref,
        'terminal truth exists regardless of projection'
      )
      .toBe('completed') // RED
    expect.soft(eventsOf(fx, run)).toHaveLength(1)
    expect.soft(projectionOf(fx, run)?.status).toBe('pending') // RED
    expect.soft(Number(projectionOf(fx, run)?.attempt_count)).toBe(4) // one attempt per pass, never a hot loop
    expect.soft(incidentsOf(fx, run)).toHaveLength(0)
    assertNoFallback(expect.soft, fx, run, port, before)
  })
})
