// ORCA-S5 Post-Cutover Lifecycle — GENUINE RED: Maestro-side terminal-projection
// OUTBOX only (mission §29-§31; SPEC §8.3, §10, §10.2, §14 X6/X7/X8, §15, §17;
// gates 18, 19, 20, 21).
//
// SCOPE BOUNDARY (do not blur):
//  - `aicontrol_terminal_projection` is the OUTBOX in MAESTRO's Execution DB.
//    Today it is inert schema (no writer). These tests specify when it is
//    populated and how delivery outcomes update it.
//  - The aiControl-side transport is a NARROW FAKE (`FakeProjectionWriter`)
//    that mirrors the real published `projectDelegatedTerminalResult` name and
//    its four-outcome enum. No HTTP, no `data/app.db`, no fence acquisition.
//  - The aiControl projector's declared-but-never-returned `DIVERGENCE` outcome
//    is EXTERNAL_PRE_LIVE_BLOCKER (SPEC §10.1/§10.2/§18.2 item 2). It is NOT
//    fixed and NOT relied on here: every test that could observe
//    `ALREADY_TERMINAL` treats it as UNVERIFIABLE (never as agreement), which
//    is the frozen fail-closed stance for today's published projector.
//  - Gates 20/21/22 (and 26) are PRE_LIVE_ACTIVATION and are NOT claimed
//    complete by anything in this file.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authorityOf,
  closureOf,
  commitDelegatedRun,
  eventsOf,
  FakeOsProcessPort,
  FakeProjectionWriter,
  incidentsOf,
  openLifecycleFixture,
  projectionOf,
  requestTeardown,
  seedUpstreamTerminal,
  settle,
  sweepOnce,
  sqlRow,
  SWEEP_MUST_CONVERGE,
  terminationOf,
  type DelegatedRun,
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

async function closedRun(
  fx: LifecycleFixture,
  outcome: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'unclassifiable',
  n = 1
): Promise<{ run: DelegatedRun; port: FakeOsProcessPort }> {
  const run = await commitDelegatedRun(fx, n)
  seedUpstreamTerminal(fx, run)
  const port = new FakeOsProcessPort()
  if (outcome === 'completed') {
    port.selfExit(run, 0)
  } else if (outcome === 'failed') {
    port.selfExit(run, 2)
  } else if (outcome === 'unclassifiable') {
    port.deadUnknownCause(run)
  } else {
    requestTeardown(fx, run, outcome === 'cancelled' ? 'user_cancel' : 'timeout')
    port.running(run)
  }
  return { run, port }
}

describe('RED — the outbox row is produced at the accepted lifecycle point, carrying immutable source identity (SPEC §8.3)', () => {
  it.each(['completed', 'failed', 'cancelled', 'timeout'] as const)(
    'a %s closure creates exactly one pending outbox row copied from durable facts; no delivery is attempted without a transport',
    async (outcome) => {
      const fx = fixture()
      const { run, port } = await closedRun(fx, outcome)

      expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

      const closure = closureOf(fx, run)
      const cutover = sqlRow<{ fence_token: string; aicontrol_run_id: string }>(
        fx,
        'SELECT fence_token, aicontrol_run_id FROM delegation_cutover WHERE correlation_id = ?',
        run.correlationId
      )
      expect.soft(closure?.terminal_status_ref).toBe(outcome) // RED (also precondition)
      expect.soft(projectionOf(fx, run)).toMatchObject({
        correlation_id: run.correlationId,
        aicontrol_run_id: cutover?.aicontrol_run_id,
        fence_token_ref: cutover?.fence_token,
        closure_digest_ref: closure?.closure_digest,
        attempt_count: 0,
        last_attempted_at: null,
        projected_at: null,
        status: 'pending'
      }) // RED: the outbox is inert schema today
      expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
    }
  )

  it('an UNCLASSIFIABLE closure (terminal_status_ref NULL) is created directly as blocked_closure_contradicted and no aiControl call is ever attempted', async () => {
    const fx = fixture()
    const { run, port } = await closedRun(fx, 'unclassifiable')
    const writer = new FakeProjectionWriter()

    expect
      .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect.soft(projectionOf(fx, run)?.status).toBe('blocked_closure_contradicted') // RED
    expect.soft(writer.calls, 'a contradicted closure is never copied to aiControl').toHaveLength(0)
  })

  it('CONTROL (trivially true while the outbox is inert; must stay true) — a run blocked before closure has no outbox row', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const port = new FakeOsProcessPort().rawOs(run, {
      pidExists: true,
      currentOsStartMarker: 'RECYCLED_PID'
    })

    await settle(fx, port, { projectionWriter: new FakeProjectionWriter() })

    expect.soft(closureOf(fx, run)).toBeUndefined()
    expect.soft(projectionOf(fx, run)).toBeUndefined()
  })
})

describe('RED — delivery: COPY-NEVER-DECIDE, idempotent, restart-safe (SPEC §10, §14 X6, gates 18-19)', () => {
  it('PROJECTED: outbox becomes projected exactly once; terminal truth and authority are untouched; later sweeps never re-send', async () => {
    const fx = fixture()
    const { run, port } = await closedRun(fx, 'completed')
    const writer = new FakeProjectionWriter()
    expect
      .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()
    const closureAtProjection = closureOf(fx, run)

    expect
      .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()
    expect
      .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect.soft(projectionOf(fx, run)).toMatchObject({ status: 'projected', attempt_count: 1 }) // RED
    expect.soft(projectionOf(fx, run)?.projected_at).not.toBeNull()
    expect.soft(writer.calls, 'PROJECTED exactly once').toHaveLength(1)
    expect.soft(closureOf(fx, run)).toEqual(closureAtProjection)
    expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  })

  it('the transport call is byte-traceable to durable facts: runId/token/status are copies, never computed by the writer path', async () => {
    const fx = fixture()
    const { run, port } = await closedRun(fx, 'failed')
    const writer = new FakeProjectionWriter()

    expect
      .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    const call = writer.calls[0]
    expect.soft(call, 'a delivery attempt was made').toBeDefined() // RED
    expect.soft(call?.runId).toBe(run.aicontrolRunId)
    expect.soft(call?.token).toBe(run.fenceToken)
    expect.soft(call?.status).toBe(closureOf(fx, run)?.terminal_status_ref)
    expect.soft(['completed', 'failed', 'cancelled', 'timeout']).toContain(call?.status)
    // only the published projectDelegatedTerminalResult input fields — no invented decision fields
    expect
      .soft(
        Object.keys(call ?? {}).filter(
          (k) => !['runId', 'token', 'status', 'finishedAt', 'stdout', 'stderr'].includes(k)
        )
      )
      .toEqual([])
  })

  it('transport failure changes NEITHER Orca authority NOR terminal truth: row stays pending with attempt bookkeeping, then a healthy retry projects', async () => {
    const fx = fixture()
    const { run, port } = await closedRun(fx, 'cancelled')
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined() // closure + pending outbox, no transport wired

    const failing = new FakeProjectionWriter().next(new Error('ECONNRESET: aiControl unreachable'))
    expect
      .soft((await sweepOnce(fx, port, { projectionWriter: failing })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    const afterFailure = {
      projection: projectionOf(fx, run),
      closure: closureOf(fx, run),
      termination: terminationOf(fx, run),
      events: eventsOf(fx, run)
    }
    expect.soft(afterFailure.projection).toMatchObject({ status: 'pending', attempt_count: 1 }) // RED
    expect.soft(afterFailure.projection?.last_attempted_at).not.toBeNull()
    expect
      .soft(afterFailure.closure?.terminal_status_ref, 'terminal truth existed before any delivery')
      .toBe('cancelled')
    expect
      .soft(incidentsOf(fx, run), 'a transient transport error is not an incident')
      .toHaveLength(0)
    expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')

    const healthy = new FakeProjectionWriter()
    expect
      .soft((await sweepOnce(fx, port, { projectionWriter: healthy })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()
    expect.soft(projectionOf(fx, run)).toMatchObject({ status: 'projected', attempt_count: 2 })
    expect.soft(closureOf(fx, run)).toEqual(afterFailure.closure)
    expect.soft(terminationOf(fx, run)).toEqual(afterFailure.termination)
  })

  it('a pending projection survives a host restart and is delivered afterwards (no in-memory queue)', async () => {
    const fx = fixture()
    const { run, port } = await closedRun(fx, 'timeout')
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined() // no transport wired yet: row stays pending
    expect.soft(projectionOf(fx, run)?.status).toBe('pending') // RED

    fx.reopen()
    const writer = new FakeProjectionWriter()
    expect
      .soft(
        (await settle(fx, new FakeOsProcessPort(), { projectionWriter: writer })).error,
        SWEEP_MUST_CONVERGE
      )
      .toBeUndefined()

    expect.soft(writer.calls).toHaveLength(1)
    expect.soft(projectionOf(fx, run)?.status).toBe('projected')
  })
})

describe('RED — aiControl outcomes: unverifiable / blocked, never assumed benign (SPEC §10.2, §14 X7)', () => {
  it('ALREADY_TERMINAL is UNVERIFIABLE while the divergence fix is unshipped: blocked_closure_contradicted + incident, NEVER "projected"', async () => {
    const fx = fixture()
    const { run, port } = await closedRun(fx, 'completed')
    const writer = new FakeProjectionWriter().next('ALREADY_TERMINAL')

    expect
      .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect.soft(projectionOf(fx, run)?.status).toBe('blocked_closure_contradicted') // RED
    expect.soft(projectionOf(fx, run)?.status).not.toBe('projected')
    expect
      .soft(
        incidentsOf(fx, run).filter((i) => i.blocked === 1).length,
        'a blocking incident is raised, not a silent no-op'
      )
      .toBeGreaterThan(0)
    expect
      .soft(closureOf(fx, run)?.terminal_status_ref, 'terminal truth unchanged')
      .toBe('completed')
  })

  it('X7 — CAS applied remotely but the local ack was lost: the retry sees ALREADY_TERMINAL and must be treated as unverifiable; nothing rolls back, no duplicate closure, no fallback', async () => {
    const fx = fixture()
    const { run, port } = await closedRun(fx, 'completed')
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined() // closure + pending outbox
    const closureBefore = closureOf(fx, run)

    // Attempt 1: remote CAS applied, response lost => transport error locally.
    const writer = new FakeProjectionWriter().next(
      new Error('response lost after remote commit'),
      'ALREADY_TERMINAL'
    )
    expect
      .soft((await sweepOnce(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()
    expect.soft(projectionOf(fx, run)?.status).toBe('pending') // RED: local ack lost => still pending
    // Attempt 2: remote row is already terminal => today's projector answers ALREADY_TERMINAL.
    expect
      .soft((await sweepOnce(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect.soft(projectionOf(fx, run)?.status).toBe('blocked_closure_contradicted') // RED: unverifiable, NOT projected
    expect
      .soft(
        sqlRow<{ c: number }>(
          fx,
          'SELECT COUNT(*) AS c FROM dispatch_lifecycle_closure WHERE correlation_id = ?',
          run.correlationId
        )?.c
      )
      .toBe(1)
    expect.soft(closureOf(fx, run)).toEqual(closureBefore)
    expect.soft(port.spawnCalls).toBe(0)
    expect.soft(fx.fence.releaseCalls).toHaveLength(0)
    expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  })

  it.each([
    { outcome: 'FENCE_MISMATCH', status: 'blocked_fence_mismatch' },
    { outcome: 'DIVERGENCE', status: 'blocked_already_terminal_divergent' }
  ] as const)(
    '$outcome -> $status; terminal truth and authority unchanged; a blocked row is not retried',
    async ({ outcome, status }) => {
      const fx = fixture()
      const { run, port } = await closedRun(fx, 'failed')
      const writer = new FakeProjectionWriter().next(outcome)
      expect
        .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
        .toBeUndefined()
      expect
        .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
        .toBeUndefined()

      expect.soft(projectionOf(fx, run)?.status).toBe(status) // RED
      expect.soft(writer.calls, 'a blocked outbox row is not re-sent').toHaveLength(1)
      expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('failed')
      expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
    }
  )

  it('a closure later contradicted by settlement (post-closure conflict marker) is blocked-from-copy: the writer is never called', async () => {
    const fx = fixture()
    const { run, port } = await closedRun(fx, 'completed')
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined() // closure + pending outbox, no transport yet

    // ORCA-S2's one legitimate later transition: observed -> observed_conflicted.
    fx.stores.db
      .prepare(
        "UPDATE settlement_observation SET status = 'observed_conflicted', conflicted_at = ? WHERE correlation_id = ?"
      )
      .run('2026-09-21T05:00:00.000Z', run.correlationId)
    const writer = new FakeProjectionWriter()
    expect
      .soft((await settle(fx, port, { projectionWriter: writer })).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect.soft(closureOf(fx, run)?.post_closure_settlement_conflict_detected_at).not.toBeNull() // RED today (closure never exists)
    expect.soft(projectionOf(fx, run)?.status).toBe('blocked_closure_contradicted')
    expect.soft(writer.calls).toHaveLength(0)
  })
})

describe('RED — the outbox has exactly one legitimate writer: the lifecycle sweep (SPEC §14 X8, mission §29)', () => {
  it('a production writer of aicontrol_terminal_projection exists under execution/, and none exists in providers/ipc/runtime', () => {
    const srcMain = join(__dirname, '..', '..', '..', '..', '..', 'src', 'main')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (
          name.endsWith('.ts') &&
          !name.endsWith('.test.ts') &&
          !name.endsWith('-test-harness.ts')
        ) {
          files.push(full)
        }
      }
    }
    walk(srcMain)
    const writers = files
      .filter((f) =>
        /INSERT\s+(OR\s+\w+\s+)?INTO\s+aicontrol_terminal_projection/i.test(readFileSync(f, 'utf8'))
      )
      .map((f) => relative(srcMain, f).split(sep).join('/'))

    expect
      .soft(writers.length, 'RED: the outbox is inert schema — no writer exists yet')
      .toBeGreaterThan(0)
    expect
      .soft(
        writers.filter((w) => !w.startsWith('execution/')),
        'no writer outside the Execution bounded context'
      )
      .toEqual([])
  })
})
