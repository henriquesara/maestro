// ORCA-S5 Post-Cutover Lifecycle — GENUINE RED: crash matrix, restart recovery,
// recovery composition, concurrency, cadence independence
// (mission §22-§25, §32-§37; SPEC §5.5-§5.9, §11, §12, §14, §21 item 7).
//
// Classification (mission §32, SPEC §19 gate 26): the cross-DB crash windows
// X1-X16 are a PRE_LIVE_ACTIVATION gate ("each proven via a separate-CHILD-
// PROCESS restart harness"). Tests here use in-process DB fault injection +
// close/reopen with FRESH store objects, which is IMPLEMENTATION_SUPPORTING_
// EVIDENCE only. They are NOT gate-26 completion and must never be cited as
// such. No distributed atomic transaction is pretended: every window below is a
// SINGLE-DB (Maestro Execution DB) boundary; the aiControl leg is the outbox
// (see post-cutover-lifecycle-projection-outbox.test.ts for X6/X7/X8).
//
// Crash injection is a real SQLite trigger that RAISEs on one table's INSERT
// (no store proxy, no hand-seeded rows): the write genuinely aborts, the
// process "restarts" by closing/reopening the DB with brand-new store objects.

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setAppEnvironment } from '../../../../shared/app-environment'
import { OrcaRuntimeWithDelegatedCutoverCoordinator } from '../../../runtime/orca-runtime-delegated-cutover-coordinator'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import { SqliteWorktreeProvenanceStore } from '../../infrastructure/sqlite-worktree-provenance-store'
import {
  fixtureSettlementObservation,
  fixtureWorktreeProvenance
} from '../delegated-side-effect-boundary/delegated-side-effect-boundary-test-harness'
import { fixtureProcessIdentity, FakeAiControlFenceClient } from './cutover-core-test-harness'
import {
  assertNoFallback,
  authorityOf,
  bindingRowOf,
  captureAuthorityBaseline,
  closureOf,
  commitDelegatedRun,
  countRows,
  DELEGATED_CUTOVER_CORE_SLICE_REF,
  eventsOf,
  FakeOsProcessPort,
  finalizationOf,
  incidentsOf,
  injectCrashOnInsert,
  openLifecycleFixture,
  projectionOf,
  requestTeardown,
  seedUpstreamTerminal,
  settle,
  snapshotTables,
  stripVolatile,
  SWEEP_MUST_CONVERGE,
  sweepOnce,
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

/** A restart: fresh connection, fresh store objects, fresh OS port — zero surviving JS state. */
const restart = (fx: LifecycleFixture) => fx.reopen()

describe('RED — crash matrix row: cutover committed, process running (SPEC X9, C3-C5; mission §37 rows 1)', () => {
  it('after a restart a healthy verified-alive delegated process is left running: authority ORCA_DELEGATED, NO signal, NO termination, NO respawn', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = captureAuthorityBaseline(fx, run)
    restart(fx)
    const port = new FakeOsProcessPort().rawOs(run, {
      pidExists: true,
      currentOsStartMarker: run.osStartMarker
    })

    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    // RED: today the sweep tears down ANY verified-live process on first contact.
    expect.soft(port.totalSignals).toBe(0)
    expect.soft(terminationOf(fx, run)).toBeUndefined()
    expect.soft(bindingRowOf(fx, run)?.teardown_requested_at).toBeNull()
    assertNoFallback(expect.soft, fx, run, port, before)
  })
})

describe('RED — crash matrix row: termination requested, terminal not proven (SPEC L6, X13; mission §37 row 2)', () => {
  it.each([
    { label: 'process still alive & identity-verified', script: 'alive' },
    { label: 'process died in the meantime', script: 'dead' }
  ] as const)(
    '$label -> converges to the durable cause (cancelled); alive => one legal signal, dead => none',
    async ({ script }) => {
      const fx = fixture()
      const run = await commitDelegatedRun(fx, 1)
      seedUpstreamTerminal(fx, run)
      requestTeardown(fx, run, 'user_cancel')
      const before = captureAuthorityBaseline(fx, run)
      restart(fx)
      const port = new FakeOsProcessPort()
      if (script === 'alive') {
        port.rawOs(run, { pidExists: true, currentOsStartMarker: run.osStartMarker })
      } else {
        port.deadUnknownCause(run)
      }

      expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

      expect.soft(port.signalByPidCalls.length).toBe(script === 'alive' ? 1 : 0)
      expect.soft(terminationOf(fx, run)?.termination_method).toBe('signalled')
      expect.soft(bindingRowOf(fx, run)?.teardown_reason).toBe('user_cancel') // RED
      expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('cancelled') // RED
      assertNoFallback(expect.soft, fx, run, port, before)
    }
  )
})

describe('RED — crash matrix row: terminal condition OBSERVED but the durable fact was never written (mission §22)', () => {
  it('the exit was seen, the write crashed, the exit code is lost: recovery re-observes the SAME identity and converges HONESTLY — never a guessed completion, never a respawn', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = captureAuthorityBaseline(fx, run)
    const crash = injectCrashOnInsert(fx, 'dispatch_termination')

    await settle(fx, new FakeOsProcessPort().selfExit(run, 0)) // exit observed; durable write aborts
    expect.soft(terminationOf(fx, run), 'nothing terminal was durably committed').toBeUndefined()
    expect
      .soft(authorityOf(fx, run.correlationId), 'authority is unaffected by the crash')
      .toBe('ORCA_DELEGATED')
    crash.disarm()

    restart(fx)
    // The reaped process's exit code no longer exists anywhere: the only honest
    // observation is "gone, cause unknown" (SPEC §5.7 / §9.2 / X10 — never inferred from a lost Promise).
    const port = new FakeOsProcessPort().deadUnknownCause(run)
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect.soft(terminationOf(fx, run)?.termination_method).toBe('confirmed_dead_unknown_cause')
    expect
      .soft(closureOf(fx, run)?.terminal_status_ref ?? null, 'never inferred as completed/failed')
      .toBeNull()
    expect.soft(closureOf(fx, run), 'a closure exists (with a NULL classification)').toBeDefined() // RED
    expect.soft(incidentsOf(fx, run).map((i) => i.kind)).toContain('unclassifiable_terminal_status') // RED
    assertNoFallback(expect.soft, fx, run, port, before)
  })
})

/**
 * Rows 4-7: a crash at each successive durable boundary after the terminal
 * fact. Recovery must converge to EXACTLY the durable state an uninterrupted
 * run reaches (source of truth = the DB only), re-using every already-durable
 * fact and never re-observing or re-signalling the process.
 */
const BOUNDARY_ROWS = [
  {
    row: 'terminal fact durable, worktree not finalized (L2)',
    crashOn: 'worktree_finalization',
    durable: { termination: 1, finalization: 0, closure: 0, event: 0, outbox: 0 }
  },
  {
    row: 'worktree finalized, closure absent (L2/L5)',
    crashOn: 'dispatch_lifecycle_closure',
    durable: { termination: 1, finalization: 1, closure: 0, event: 0, outbox: 0 }
  },
  {
    row: 'closure durable, event absent',
    crashOn: 'dispatch_lifecycle_event',
    durable: { termination: 1, finalization: 1, closure: 1, event: 0, outbox: 0 }
  },
  {
    row: 'event durable, outbox row absent (X6 precursor)',
    crashOn: 'aicontrol_terminal_projection',
    durable: { termination: 1, finalization: 1, closure: 1, event: 1, outbox: 0 }
  }
] as const

describe('RED — crash matrix rows 4-7: every post-terminal boundary recovers from durable facts alone (mission §23-§25, §33)', () => {
  it.each(BOUNDARY_ROWS)('$row', async ({ crashOn, durable }) => {
    // Reference: the same lifecycle, uninterrupted.
    const ref = fixture()
    const refRun = await commitDelegatedRun(ref, 1)
    seedUpstreamTerminal(ref, refRun)
    expect
      .soft(
        (await settle(ref, new FakeOsProcessPort().selfExit(refRun, 0))).error,
        SWEEP_MUST_CONVERGE
      )
      .toBeUndefined()

    // Subject: crash at the boundary, restart, recover with NOTHING scripted.
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = captureAuthorityBaseline(fx, run)
    const crash = injectCrashOnInsert(fx, crashOn)
    await settle(fx, new FakeOsProcessPort().selfExit(run, 0)) // aborts at the injected boundary
    expect
      .soft(
        {
          termination: countRows(fx, 'dispatch_termination'),
          finalization: countRows(fx, 'worktree_finalization'),
          closure: countRows(fx, 'dispatch_lifecycle_closure'),
          event: countRows(fx, 'dispatch_lifecycle_event'),
          outbox: countRows(fx, 'aicontrol_terminal_projection')
        },
        'durable state at the crash boundary'
      )
      .toEqual(durable)
    expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
    crash.disarm()

    restart(fx)
    const afterRestart = new FakeOsProcessPort() // nothing scripted: any OS re-observation throws
    expect.soft((await settle(fx, afterRestart)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect
      .soft(afterRestart.observeCalls, 'a durable terminal fact wins: no re-observation')
      .toEqual([])
    expect.soft(afterRestart.totalSignals, 'no re-signalling once terminal is durable').toBe(0)
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('completed') // RED
    expect.soft(projectionOf(fx, run)?.status).toBe('pending') // RED
    expect
      .soft(
        stripVolatile(Object.values(snapshotTables(fx)).flat()),
        'converges to the uninterrupted lifecycle result'
      )
      .toEqual(stripVolatile(Object.values(snapshotTables(ref)).flat()))
    assertNoFallback(expect.soft, fx, run, afterRestart, before)
  })

  it('a closure that is already durable is immutable across the restart: no second terminal classification, authority does not revert (mission §25)', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const crash = injectCrashOnInsert(fx, 'dispatch_lifecycle_event')
    await settle(fx, new FakeOsProcessPort().selfExit(run, 0))
    const closureBefore = closureOf(fx, run)
    expect.soft(closureBefore, 'closure was durable before the event write crashed').toBeDefined() // RED today
    crash.disarm()

    restart(fx)
    // A contradictory late OS report must not be able to reclassify a legally closed lifecycle.
    const contradicting = new FakeOsProcessPort().selfExit(run, 42)
    expect.soft((await settle(fx, contradicting)).error, SWEEP_MUST_CONVERGE).toBeUndefined()

    expect.soft(closureOf(fx, run)).toEqual(closureBefore)
    expect
      .soft(terminationOf(fx, run))
      .toMatchObject({ termination_method: 'self_exit', exit_code: 0 })
    expect.soft(finalizationOf(fx, run)?.status).toBe('skipped_not_eligible')
    expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  })
})

describe('RED — recovery correctness is independent of cadence (SPEC §11, §21 item 7; mission §35)', () => {
  it('one pass per restart (worst-case cadence, zero surviving state) reaches the same durable result as an uninterrupted fixed-point run', async () => {
    const uninterrupted = fixture()
    const uRun = await commitDelegatedRun(uninterrupted, 1)
    seedUpstreamTerminal(uninterrupted, uRun)
    expect
      .soft(
        (await settle(uninterrupted, new FakeOsProcessPort().selfExit(uRun, 0))).error,
        SWEEP_MUST_CONVERGE
      )
      .toBeUndefined()

    const slow = fixture()
    const sRun = await commitDelegatedRun(slow, 1)
    seedUpstreamTerminal(slow, sRun)
    let previous = ''
    for (let pass = 0; pass < 12; pass += 1) {
      const port = pass === 0 ? new FakeOsProcessPort().selfExit(sRun, 0) : new FakeOsProcessPort()
      const res = await sweepOnce(slow, port)
      expect.soft(res.error, SWEEP_MUST_CONVERGE).toBeUndefined()
      const snap = JSON.stringify(snapshotTables(slow))
      if (snap === previous) {
        break
      }
      previous = snap
      restart(slow)
    }

    expect.soft(closureOf(slow, sRun)?.terminal_status_ref).toBe('completed') // RED
    expect
      .soft(stripVolatile(Object.values(snapshotTables(slow)).flat()))
      .toEqual(stripVolatile(Object.values(snapshotTables(uninterrupted)).flat()))
  })
})

describe('RED — deterministic concurrency: one authoritative terminal classification per delegated run (mission §36; SPEC X12)', () => {
  function gated(run: DelegatedRun, exitCode: number) {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const port = new FakeOsProcessPort()
    let arrived = 0
    port.set(run.pid, async () => {
      arrived += 1
      await gate
      return { kind: 'self_exit', exitCode, exitSignal: null }
    })
    return { port, release, arrived: () => arrived }
  }

  it('two sweeps racing on the SAME terminal observation converge: the PK-collision loser is a no-op, not a failure; one termination/closure/event/outbox row', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const a = gated(run, 0)
    const b = gated(run, 0)

    const pa = sweepOnce(fx, a.port)
    const pb = sweepOnce(fx, b.port)
    expect
      .soft(
        a.arrived() + b.arrived(),
        'both sweeps observed before either wrote (barrier, no sleeps)'
      )
      .toBe(2)
    a.release()
    b.release()
    const [ra, rb] = await Promise.all([pa, pb])
    const finished = await settle(fx, new FakeOsProcessPort())

    // RED: today the loser's plain INSERT hits the PK and the sweep REJECTS (SPEC X12: PK-collision no-op).
    expect.soft(ra.error, 'first racer').toBeUndefined()
    expect.soft(rb.error, 'second racer must not fail on a PK collision').toBeUndefined()
    expect.soft(finished.error, SWEEP_MUST_CONVERGE).toBeUndefined()
    expect.soft(countRows(fx, 'dispatch_termination')).toBe(1)
    expect.soft(countRows(fx, 'dispatch_lifecycle_closure')).toBe(1)
    expect.soft(eventsOf(fx, run)).toHaveLength(1)
    expect.soft(countRows(fx, 'aicontrol_terminal_projection')).toBe(1) // RED
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('completed') // RED
  })

  it('two INCOMPATIBLE terminal observations racing: exactly one wins, the closure follows the winner, the other never becomes authoritative', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const ok = gated(run, 0)
    const bad = gated(run, 7)

    const p1 = sweepOnce(fx, ok.port)
    const p2 = sweepOnce(fx, bad.port)
    ok.release()
    bad.release()
    const [r1, r2] = await Promise.all([p1, p2])
    const finished = await settle(fx, new FakeOsProcessPort())

    expect.soft(r1.error, 'racer 1').toBeUndefined() // RED
    expect.soft(r2.error, 'racer 2').toBeUndefined() // RED
    expect.soft(finished.error, SWEEP_MUST_CONVERGE).toBeUndefined()
    expect.soft(countRows(fx, 'dispatch_termination')).toBe(1)
    const winner = terminationOf(fx, run)
    expect
      .soft(closureOf(fx, run)?.terminal_status_ref)
      .toBe(winner?.exit_code === 0 ? 'completed' : 'failed') // RED
    expect.soft(countRows(fx, 'dispatch_lifecycle_closure')).toBe(1)
    expect.soft(incidentsOf(fx, run), 'the loser is a PK no-op, not an incident').toHaveLength(0)
  })
})

// ── Recovery composition: the coordinator is the ONE owner (SPEC §4.8.1, §11) ─

type LifecycleCoordinator = {
  reconcileDelegatedLifecycles(): Promise<unknown>
  requestDelegatedCancellation(input: { correlationId: string }): Promise<unknown>
}

function installTmpUserData(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s5-coordinator-'))
  setAppEnvironment({
    getPath: (name: string) => (name === 'userData' ? dir : tmpdir()),
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  } as never)
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* transient Windows handle */
      }
    }
  }
}

async function coordinatorWithCommittedRun(pid: number, correlationId: string) {
  const env = installTmpUserData()
  const port = new FakeOsProcessPort()
  const fence = new FakeAiControlFenceClient()
  const runtime = new OrcaRuntimeWithDelegatedCutoverCoordinator()
  runtime.getDelegatedCutoverCoordinatorDeps = () => ({ fence, processPort: port }) as never
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
  new SqliteSettlementObservationStore(db).insert(
    fixtureSettlementObservation({
      correlationId,
      orcaDispatchId: `dispatch_${correlationId}`,
      orcaRunId: `run_${correlationId}`,
      orgTaskId: correlationId,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }) as never
  )
  new SqliteWorktreeProvenanceStore(db).insert(
    fixtureWorktreeProvenance({
      correlationId,
      orcaDispatchId: `dispatch_${correlationId}`,
      orcaRunId: `run_${correlationId}`,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }) as never
  )
  return {
    env,
    port,
    fence,
    db,
    lifecycle: coordinator as unknown as LifecycleCoordinator,
    close: () => {
      db.close()
      env.cleanup()
    }
  }
}

describe('RED — recovery composition: the accepted coordinator owns post-cutover reconciliation (mission §34; SPEC §4.8.1, §11)', () => {
  it('the existing DelegatedCutoverCoordinator exposes reconcileDelegatedLifecycles() and cancellation, over its OWN persistent connection', async () => {
    const ctx = await coordinatorWithCommittedRun(991_001, 'corr_k1')
    try {
      expect
        .soft(
          typeof ctx.lifecycle.reconcileDelegatedLifecycles,
          'coordinator.reconcileDelegatedLifecycles'
        )
        .toBe('function')
      expect
        .soft(
          typeof ctx.lifecycle.requestDelegatedCancellation,
          'coordinator.requestDelegatedCancellation'
        )
        .toBe('function')
    } finally {
      ctx.close()
    }
  })

  it('end-to-end through the coordinator: a durably delegated run whose process exited 0 reaches closure=completed with no second composition root', async () => {
    const ctx = await coordinatorWithCommittedRun(991_002, 'corr_k2')
    try {
      ctx.port.selfExit({ pid: 991_002 } as DelegatedRun, 0)
      for (let i = 0; i < 6; i += 1) {
        await ctx.lifecycle.reconcileDelegatedLifecycles()
      }
      const closure = ctx.db
        .prepare(
          "SELECT terminal_status_ref FROM dispatch_lifecycle_closure WHERE correlation_id = 'corr_k2'"
        )
        .get() as { terminal_status_ref: string | null } | undefined
      expect.soft(closure?.terminal_status_ref).toBe('completed')
      expect.soft(ctx.port.spawnCalls).toBe(0)
      expect.soft(ctx.fence.releaseCalls).toHaveLength(0)
    } finally {
      ctx.close()
    }
  })

  it('Orca-owned cancellation writes the durable intent+reason ONLY (no signal from the handler); the sweep then signals once and classifies cancelled', async () => {
    const ctx = await coordinatorWithCommittedRun(991_003, 'corr_k3')
    try {
      ctx.port.running({ pid: 991_003 } as DelegatedRun)
      await ctx.lifecycle.requestDelegatedCancellation({ correlationId: 'corr_k3' })
      const intent = ctx.db
        .prepare(
          "SELECT teardown_requested_at, teardown_reason FROM dispatch_process_binding WHERE correlation_id = 'corr_k3'"
        )
        .get() as {
        teardown_requested_at: string | null
        teardown_reason: string | null
      }
      expect.soft(intent.teardown_reason).toBe('user_cancel')
      expect.soft(intent.teardown_requested_at).not.toBeNull()
      expect
        .soft(
          ctx.port.totalSignals,
          'the handler records intent; the sweep signals (SPEC §9.1/§12)'
        )
        .toBe(0)

      for (let i = 0; i < 6; i += 1) {
        await ctx.lifecycle.reconcileDelegatedLifecycles()
      }
      const closure = ctx.db
        .prepare(
          "SELECT terminal_status_ref FROM dispatch_lifecycle_closure WHERE correlation_id = 'corr_k3'"
        )
        .get() as { terminal_status_ref: string | null } | undefined
      expect
        .soft(ctx.port.signalByPidCalls)
        .toEqual([{ pid: 991_003, killScope: expect.any(String) }])
      expect.soft(closure?.terminal_status_ref).toBe('cancelled')
    } finally {
      ctx.close()
    }
  })

  it('cancellation of a run with NO durable cutover is rejected and writes nothing (only the current authority may act)', async () => {
    const ctx = await coordinatorWithCommittedRun(991_004, 'corr_k4')
    try {
      const before = ctx.db
        .prepare(
          'SELECT COUNT(*) AS c FROM dispatch_process_binding WHERE teardown_requested_at IS NOT NULL'
        )
        .get() as { c: number }
      await expect
        .soft(ctx.lifecycle.requestDelegatedCancellation({ correlationId: 'corr_never_delegated' }))
        .rejects.toBeDefined()
      const after = ctx.db
        .prepare(
          'SELECT COUNT(*) AS c FROM dispatch_process_binding WHERE teardown_requested_at IS NOT NULL'
        )
        .get() as { c: number }
      expect.soft(after.c).toBe(before.c)
    } finally {
      ctx.close()
    }
  })

  it('there is exactly ONE production composition root for the lifecycle sweep outside execution/, and it lives in runtime/ (never providers/ipc)', () => {
    const srcMain = join(__dirname, '..', '..', '..', '..', '..', 'src', 'main')
    const importers: string[] = []
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
          if (
            /from\s+['"][^'"]*converge-delegation-boundary-lifecycle['"]/.test(
              readFileSync(full, 'utf8')
            )
          ) {
            importers.push(relative(srcMain, full).split(sep).join('/'))
          }
        }
      }
    }
    walk(srcMain)
    const outside = importers.filter((f) => !f.startsWith('execution/'))

    expect
      .soft(outside, 'exactly one composition root outside execution/ drives the sweep')
      .toHaveLength(1) // RED: 0 today
    expect.soft(outside.every((f) => f.startsWith('runtime/'))).toBe(true)
  })
})
