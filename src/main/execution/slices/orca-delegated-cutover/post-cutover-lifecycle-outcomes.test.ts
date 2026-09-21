// ORCA-S5 Post-Cutover Lifecycle — GENUINE RED: durable terminal outcomes
// (mission §7-§12, §15; SPEC §8.2, §9.1, §9.2, §12; gates 13-17).
//
// Frozen classification (SPEC §9.2), re-derived from the SPEC text, not the mission:
//   termination_method='self_exit'   -> exit_code === 0 ? 'completed' : 'failed'
//   termination_method='signalled'   -> dispatch_process_binding.teardown_reason
//                                        ('user_cancel' -> 'cancelled', 'timeout' -> 'timeout')
//   termination_method='confirmed_dead_unknown_cause' -> NULL (never guessed) + incident
// The taxonomy is lowercase (`completed|failed|cancelled|timeout|NULL`); the
// mission's upper-case names are display aliases only.
//
// Every test starts from a durably committed delegation_cutover in a real DB.

import { afterEach, describe, expect, it } from 'vitest'
import {
  bindingRowOf,
  closureOf,
  commitDelegatedRun,
  eventsOf,
  FakeOsProcessPort,
  finalizationOf,
  incidentsOf,
  openLifecycleFixture,
  requestTeardown,
  seedUpstreamTerminal,
  sqlRow,
  settle,
  SWEEP_MUST_CONVERGE,
  terminationOf,
  authorityOf,
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

describe('RED — self-exit outcomes: completed / failed (gates 13, 14)', () => {
  it.each([
    { label: 'exit code 0', exitCode: 0, exitSignal: null, expected: 'completed' },
    { label: 'non-zero exit code', exitCode: 3, exitSignal: null, expected: 'failed' },
    {
      label: 'terminated by a signal (no exit code)',
      exitCode: null,
      exitSignal: 'SIGKILL',
      expected: 'failed'
    }
  ])(
    '$label -> durable terminal_status_ref=$expected; no teardown was ever requested',
    async ({ exitCode, exitSignal, expected }) => {
      const fx = fixture()
      const run = await commitDelegatedRun(fx, 1)
      seedUpstreamTerminal(fx, run)
      const port = new FakeOsProcessPort().selfExit(run, exitCode, exitSignal)

      expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

      expect
        .soft(terminationOf(fx, run))
        .toMatchObject({ termination_method: 'self_exit', exit_code: exitCode })
      expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe(expected) // RED: no writer
      expect.soft(bindingRowOf(fx, run)?.teardown_requested_at).toBeNull()
      expect.soft(port.totalSignals, 'a self-exited process is never signalled').toBe(0)
      expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
    }
  )

  it('the terminal result is restart-reconstructable from durable rows alone (never a lost Promise / exit callback)', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    expect
      .soft((await settle(fx, new FakeOsProcessPort().selfExit(run, 0))).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    fx.reopen() // host restart: no in-memory result survives
    const afterRestart = new FakeOsProcessPort() // nothing scripted: any OS re-observation would throw
    expect.soft((await settle(fx, afterRestart)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect
      .soft(
        afterRestart.observeCalls,
        'a durable terminal fact wins — the process is not re-observed'
      )
      .toEqual([])
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('completed') // RED: never persisted
  })

  it('durable ordering is termination -> finalization -> closure -> event, never inferred from the exit callback alone', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    expect
      .soft((await settle(fx, new FakeOsProcessPort().selfExit(run, 0))).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    const t = terminationOf(fx, run)?.observed_at as string
    const f = finalizationOf(fx, run)?.intent_recorded_at as string
    const c = closureOf(fx, run)?.closed_at as string
    const e = eventsOf(fx, run)[0]?.emitted_at as string
    expect.soft([t, f, c, e].every((v) => typeof v === 'string')).toBe(true)
    expect.soft(t < f && f <= c && c <= e, `order violated: ${[t, f, c, e].join(' | ')}`).toBe(true)
  })

  it('a self-exit that lands while a cancel intent is pending wins by dispatch_termination PK (X12) — classification follows the termination fact', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'user_cancel')
    const port = new FakeOsProcessPort().selfExit(run, 0)

    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect.soft(terminationOf(fx, run)?.termination_method).toBe('self_exit')
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('completed') // RED
    expect
      .soft(
        bindingRowOf(fx, run)?.teardown_reason,
        'the durable intent is history; never rewritten'
      )
      .toBe('user_cancel') // RED
    expect.soft(port.totalSignals).toBe(0)
  })
})

describe('RED — signalled outcomes: cancelled / timeout, decided BEFORE the signal (gates 15, 16)', () => {
  it.each([
    { reason: 'user_cancel', expected: 'cancelled' },
    { reason: 'timeout', expected: 'timeout' }
  ] as const)(
    'teardown_reason=$reason -> terminal_status_ref=$expected, and the reason is durable at signal time',
    async ({ reason, expected }) => {
      const fx = fixture()
      const run = await commitDelegatedRun(fx, 1)
      seedUpstreamTerminal(fx, run)
      requestTeardown(fx, run, reason)
      const port = new FakeOsProcessPort().running(run)
      let reasonAtSignalTime: unknown = 'not-signalled'
      port.onSignal = () => {
        reasonAtSignalTime = bindingRowOf(fx, run)?.teardown_reason
      }

      expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

      expect.soft(port.signalByPidCalls).toEqual([{ pid: run.pid, killScope: run.killScope }])
      expect
        .soft(
          reasonAtSignalTime,
          'SPEC §9.1: the reason is captured before signalProcessTree is ever called'
        )
        .toBe(reason) // RED
      expect.soft(terminationOf(fx, run)?.termination_method).toBe('signalled')
      expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe(expected) // RED
      expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
    }
  )

  it('a process that died after a durable teardown request is attributed to that request (S4 L6), classified by its reason', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'timeout')

    expect
      .soft(
        (await settle(fx, new FakeOsProcessPort().deadUnknownCause(run))).error,
        SWEEP_MUST_CONVERGE
      )
      .toBeUndefined()

    expect
      .soft(terminationOf(fx, run))
      .toMatchObject({ termination_method: 'signalled', tree_verified: 0 })
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('timeout') // RED
  })

  it('death with NO durable cause is honestly unclassifiable: closure ref NULL, never guessed, blocked incident raised (§9.2)', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const port = new FakeOsProcessPort().deadUnknownCause(run)

    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect.soft(terminationOf(fx, run)?.termination_method).toBe('confirmed_dead_unknown_cause')
    const closure = closureOf(fx, run)
    expect.soft(closure, 'a closure exists for the unclassifiable case').toBeDefined() // RED today: closure path is blocked for delegated bindings
    expect.soft(closure?.terminal_status_ref ?? null, 'never defaulted to failed').toBeNull()
    expect.soft(closure).toHaveProperty('terminal_status_ref') // RED: column has no writer; the key must exist and be NULL
    expect.soft(incidentsOf(fx, run).map((i) => i.kind)).toContain('unclassifiable_terminal_status') // RED: new incident kind (SPEC §9.2, §21 item 3)
    expect
      .soft(incidentsOf(fx, run).find((i) => i.kind === 'unclassifiable_terminal_status')?.blocked)
      .toBe(1)
    expect.soft(port.totalSignals).toBe(0)
  })
})

describe('RED — cancelled != timeout, durably, across a restart (gate 17, mission §11)', () => {
  it('two otherwise identical terminations keep DISTINCT classifications because of durable teardown_reason alone', async () => {
    const fx = fixture()
    const a = await commitDelegatedRun(fx, 1)
    const b = await commitDelegatedRun(fx, 2)
    seedUpstreamTerminal(fx, a)
    seedUpstreamTerminal(fx, b)
    // Reasons deliberately assigned against run order, so a positional/heuristic
    // implementation (or a caller that "remembers why") cannot pass by accident.
    requestTeardown(fx, a, 'timeout')
    requestTeardown(fx, b, 'user_cancel')
    // Identical OS behaviour for both: still running, signalled the same way.
    const port = new FakeOsProcessPort().running(a).running(b)

    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()
    fx.reopen()
    expect
      .soft((await settle(fx, new FakeOsProcessPort())).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined() // restart: nothing scripted, no memory of why

    expect.soft(closureOf(fx, a)?.terminal_status_ref).toBe('timeout') // RED
    expect.soft(closureOf(fx, b)?.terminal_status_ref).toBe('cancelled') // RED
    expect.soft(bindingRowOf(fx, a)?.teardown_reason).toBe('timeout') // RED
    expect.soft(bindingRowOf(fx, b)?.teardown_reason).toBe('user_cancel') // RED
    expect
      .soft(terminationOf(fx, a)?.termination_method)
      .toBe(terminationOf(fx, b)?.termination_method)
    expect
      .soft(
        closureOf(fx, a)?.closure_digest,
        'terminal_status_ref participates in closure_digest (§9.2)'
      )
      .not.toBe(closureOf(fx, b)?.closure_digest) // RED: digest is still the four-field S4 digest
  })
})

describe('RED — teardown request idempotency and conflict (mission §12; SPEC §9.1, X13)', () => {
  it('the reason and intent are ONE statement: a request writes both columns together, exactly once', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)

    requestTeardown(fx, run, 'user_cancel', '2026-09-21T01:00:00.000Z')

    expect.soft(bindingRowOf(fx, run)).toMatchObject({
      teardown_requested_at: '2026-09-21T01:00:00.000Z',
      teardown_reason: 'user_cancel' // RED: markTeardownRequested has no reason
    })
  })

  it('repeating the SAME request converges: first timestamp + reason preserved, and the process is signalled at most once', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'user_cancel', '2026-09-21T01:00:00.000Z')
    requestTeardown(fx, run, 'user_cancel', '2026-09-21T02:00:00.000Z')
    const port = new FakeOsProcessPort().running(run)

    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect.soft(bindingRowOf(fx, run)).toMatchObject({
      teardown_requested_at: '2026-09-21T01:00:00.000Z',
      teardown_reason: 'user_cancel' // RED
    })
    expect
      .soft(
        port.signalByPidCalls,
        'no repeated destructive signalling once a terminal fact is durable'
      )
      .toHaveLength(1)
  })

  it.each([
    { first: 'user_cancel', second: 'timeout', winner: 'cancelled' },
    { first: 'timeout', second: 'user_cancel', winner: 'timeout' }
  ] as const)(
    'conflicting reasons ($first then $second): the FIRST durable write wins (CAS on teardown_requested_at IS NULL); the loser never overwrites',
    async ({ first, second, winner }) => {
      const fx = fixture()
      const run = await commitDelegatedRun(fx, 1)
      seedUpstreamTerminal(fx, run)
      requestTeardown(fx, run, first, '2026-09-21T01:00:00.000Z')
      expect
        .soft(
          () => requestTeardown(fx, run, second, '2026-09-21T02:00:00.000Z'),
          'the loser is a no-op, not an error'
        )
        .not.toThrow()

      expect.soft(bindingRowOf(fx, run)).toMatchObject({
        teardown_requested_at: '2026-09-21T01:00:00.000Z',
        teardown_reason: first
      }) // RED
      expect
        .soft((await settle(fx, new FakeOsProcessPort().running(run))).error, SWEEP_MUST_CONVERGE)
        .toBeUndefined()
      expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe(winner) // RED
      expect
        .soft(
          sqlRow<{ c: number }>(
            fx,
            'SELECT COUNT(*) AS c FROM dispatch_termination WHERE correlation_id = ?',
            run.correlationId
          )?.c
        )
        .toBe(1)
    }
  )
})
