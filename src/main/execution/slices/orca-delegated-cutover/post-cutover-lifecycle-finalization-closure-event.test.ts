// ORCA-S5 Post-Cutover Lifecycle — GENUINE RED: worktree finalization, lifecycle
// closure, terminal event (mission §16-§20; SPEC §5.2 S11, §8.2, §9.2, §13, §15,
// §17, X14; gates 23, 24, 25).
//
// Frozen semantics this file asserts (re-derived, not taken from the mission):
//  - SPEC §13/§17/X14/gate 24: for a REAL delegated dispatch worktree the S4
//    real-deletion arm NEVER fires. Every such binding's
//    `worktree_finalization.status` is `skipped_not_eligible` BY POLICY, and the
//    filesystem is never touched. So "finalization" after a delegated terminal
//    outcome is a durable RECORD of that decision, not a cleanup act.
//  - S4 §11 ordering (unmodified by SPEC §15): termination -> finalization ->
//    closure -> event. A closure needs `finalization.status IN (finalized,
//    skipped_not_eligible)`; it never precedes finalization.
//  - Closure is write-once SOURCE state; `terminal_status_ref` joins the digest.
//
// RED-attribution note: today's `advanceWorktreeFinalization` is not
// delegated-aware. For a delegated binding whose real worktree lies outside the
// shadow root it THROWS ("finalization refused"); inside the shadow root it
// DELETES the real worktree. Both are asserted below. `expect.soft` is used so
// each test reports every unmet requirement, not only the first.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { computeLifecycleClosureDigest } from '../../domain/dispatch-lifecycle-closure'
import {
  closureOf,
  commitDelegatedRun,
  countRows,
  eventsOf,
  FakeOsProcessPort,
  finalizationOf,
  openLifecycleFixture,
  requestTeardown,
  retryableError,
  RETRYABLE_FS_CODE,
  seedUpstreamTerminal,
  settle,
  snapshotTables,
  sqlRow,
  sqlRows,
  SWEEP_MUST_CONVERGE,
  sweep,
  sweepToFixedPoint,
  terminationOf,
  authorityOf,
  injectCrashOnInsert,
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

const sentinelOf = (run: DelegatedRun) => join(run.worktreePath, 'sentinel.txt')

describe('RED — real-worktree finalization is a durable record, never a deletion (SPEC §13, X14, gate 24)', () => {
  it('worktree OUTSIDE the shadow root: the sweep converges, finalization is skipped_not_eligible, the real worktree is byte-untouched', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)

    const settled = await settle(fx, new FakeOsProcessPort().selfExit(run, 0))

    // RED: today `advanceWorktreeFinalization` throws for a path outside the shadow root.
    expect.soft(settled.error, SWEEP_MUST_CONVERGE).toBeUndefined()
    expect.soft(finalizationOf(fx, run)?.status).toBe('skipped_not_eligible')
    expect.soft(existsSync(sentinelOf(run))).toBe(true)
    expect
      .soft(existsSync(sentinelOf(run)) ? readFileSync(sentinelOf(run), 'utf8') : null)
      .toBe(run.worktreeSentinel)
  })

  it('worktree INSIDE the shadow root: the real-deletion arm still NEVER fires (it must not rmSync a real dispatch worktree)', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1, {
      worktreeRoot: join(fx.dir, 'durable-shadow-worktrees', 'worktrees')
    })
    seedUpstreamTerminal(fx, run)

    const settled = await settle(fx, new FakeOsProcessPort().selfExit(run, 0))

    expect.soft(settled.error, SWEEP_MUST_CONVERGE).toBeUndefined()
    // RED: today this path is `isInside` the root, so the S4 arm rmSync's the REAL worktree.
    expect
      .soft(
        existsSync(sentinelOf(run)),
        'a real dispatch worktree must survive delegated finalization'
      )
      .toBe(true)
    expect.soft(finalizationOf(fx, run)?.status).toBe('skipped_not_eligible')
    expect
      .soft(String(finalizationOf(fx, run)?.outcome_detail_json ?? ''))
      .not.toContain('"deleted":true')
  })

  it('finalization targets the SAME bound worktree, and base/candidate/files provenance stays coherent and immutable', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const before = {
      worktree: sqlRows(fx, 'SELECT * FROM dispatch_worktree'),
      provenance: sqlRows(fx, 'SELECT * FROM worktree_provenance')
    }

    const settled = await settle(fx, new FakeOsProcessPort().selfExit(run, 0))

    expect.soft(settled.error, SWEEP_MUST_CONVERGE).toBeUndefined()
    expect.soft(finalizationOf(fx, run)?.orca_dispatch_id).toBe(run.orcaDispatchId)
    expect
      .soft(
        sqlRows(fx, 'SELECT * FROM dispatch_worktree'),
        'the bound worktree row is never rewritten'
      )
      .toEqual(before.worktree)
    expect
      .soft(
        sqlRows(fx, 'SELECT * FROM worktree_provenance'),
        'ORCA-S3 provenance is reused unmodified (gate 23)'
      )
      .toEqual(before.provenance)
    expect.soft(closureOf(fx, run)?.worktree_provenance_ref).toBe('recorded')
    expect
      .soft(
        sqlRow(
          fx,
          'SELECT base_commit, candidate_head FROM worktree_provenance WHERE correlation_id = ?',
          run.correlationId
        )
      )
      .toEqual({
        base_commit: 'b'.repeat(40),
        candidate_head: 'c'.repeat(40)
      })
  })

  it('finalization is idempotent: repeated sweeps change nothing after the fixed point', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const port = new FakeOsProcessPort().selfExit(run, 0)
    expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()
    const settledState = snapshotTables(fx)

    for (let i = 0; i < 3; i += 1) {
      expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()
    }

    expect.soft(snapshotTables(fx)).toEqual(settledState)
    expect.soft(countRows(fx, 'worktree_finalization')).toBe(1) // RED: 0 today (sweep throws before any row survives... or refuses)
  })
})

describe('RED — finalization failure after a known terminal result (mission §17)', () => {
  it('terminal fact is not lost, closure/event are NOT fabricated, authority stays delegated, retry converges from durable facts', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const port = new FakeOsProcessPort().selfExit(run, 0)

    // Fault at the finalization store edge, exactly once, with the S4 retryable code.
    const real = fx.stores.finalizations
    let armed = true
    const flaky = new Proxy(real, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (prop === 'insertIntent' && typeof value === 'function') {
          return (...args: unknown[]) => {
            if (armed) {
              armed = false
              throw retryableError(RETRYABLE_FS_CODE)
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args)
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      }
    }) as never

    const first = await sweep(fx, port, { overrideStores: { finalizations: flaky } })

    expect.soft(first.retryable.map((r) => r.code)).toEqual([RETRYABLE_FS_CODE]) // S4 §13: retryable, not an incident
    expect
      .soft(terminationOf(fx, run)?.termination_method, 'the terminal process fact is not lost')
      .toBe('self_exit')
    expect
      .soft(closureOf(fx, run), 'SPEC §11: no closure while finalization has not completed')
      .toBeUndefined()
    expect.soft(eventsOf(fx, run)).toHaveLength(0)
    expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
    expect.soft(port.spawnCalls + port.totalSignals).toBe(0)

    // Retry, healthy store: converges from durable facts only.
    const retry = await settle(fx, port)
    expect.soft(retry.error, SWEEP_MUST_CONVERGE).toBeUndefined()
    expect.soft(finalizationOf(fx, run)?.status).toBe('skipped_not_eligible')
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('completed') // RED
    expect.soft(eventsOf(fx, run)).toHaveLength(1)
  })

  it('a restart after finalization but before closure reuses the SAME finalization and never touches a different worktree', async () => {
    const fx = fixture()
    const a = await commitDelegatedRun(fx, 1)
    const b = await commitDelegatedRun(fx, 2)
    seedUpstreamTerminal(fx, a)
    seedUpstreamTerminal(fx, b)
    const port = new FakeOsProcessPort().selfExit(a, 0).selfExit(b, 1)

    // Crash at the closure write: termination + finalization are durable, closure is not.
    const crash = injectCrashOnInsert(fx, 'dispatch_lifecycle_closure')
    await settle(fx, port)
    const finalizationBefore = sqlRows(
      fx,
      'SELECT * FROM worktree_finalization ORDER BY correlation_id'
    )
    crash.disarm()

    fx.reopen() // host restart, fresh objects
    expect
      .soft((await settle(fx, new FakeOsProcessPort())).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect
      .soft(finalizationBefore.length, 'both bindings reached finalization before the crash')
      .toBe(2) // RED today (sweep refuses first)
    expect
      .soft(sqlRows(fx, 'SELECT * FROM worktree_finalization ORDER BY correlation_id'))
      .toEqual(finalizationBefore)
    expect.soft(finalizationOf(fx, a)?.orca_dispatch_id).toBe(a.orcaDispatchId)
    expect.soft(finalizationOf(fx, b)?.orca_dispatch_id).toBe(b.orcaDispatchId)
    expect.soft(existsSync(sentinelOf(a)) && existsSync(sentinelOf(b))).toBe(true)
    expect.soft(closureOf(fx, a)?.terminal_status_ref).toBe('completed') // RED
    expect.soft(closureOf(fx, b)?.terminal_status_ref).toBe('failed') // RED
  })
})

describe('RED — lifecycle closure: one per lifecycle, immutable, digest covers terminal_status_ref (SPEC §9.2, §17)', () => {
  it('the closure digest is a five-field digest: terminal_status_ref participates (isolated domain RED)', () => {
    const refs = {
      settlementStatusRef: 'observed',
      worktreeProvenanceRef: 'recorded',
      terminationMethodRef: 'self_exit',
      finalizationStatusRef: 'skipped_not_eligible'
    }
    const completed = computeLifecycleClosureDigest({
      ...refs,
      terminalStatusRef: 'completed'
    } as never)
    const failed = computeLifecycleClosureDigest({ ...refs, terminalStatusRef: 'failed' } as never)
    const bare = computeLifecycleClosureDigest(refs)
    expect
      .soft(completed, 'digest must differ when only terminal_status_ref differs')
      .not.toBe(failed)
    expect.soft(completed, 'digest must differ from the four-field S4 digest').not.toBe(bare)
  })

  it('the closure store can persist terminal_status_ref at insert time (isolated store RED — the column exists, no writer does)', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    fx.stores.closures.insert({
      correlationId: run.correlationId,
      orcaDispatchId: run.orcaDispatchId,
      orcaRunId: run.orcaRunId,
      sliceRef: 'ORCA-S5-DELEGATED-CUTOVER-CORE',
      settlementStatusRef: 'observed',
      worktreeProvenanceRef: 'recorded',
      terminationMethodRef: 'self_exit',
      finalizationStatusRef: 'skipped_not_eligible',
      terminalStatusRef: 'completed',
      closureDigest: 'd'.repeat(64),
      closedAt: '2026-09-21T00:00:00.000Z',
      postClosureSettlementConflictDetectedAt: null
    } as never)

    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('completed')
  })

  it('exactly one closure per delegated lifecycle; once legally closed it is immutable even if the OS later reports something else', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    expect
      .soft((await settle(fx, new FakeOsProcessPort().selfExit(run, 0))).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()
    const closed = snapshotTables(fx)

    // A conflicting terminal report arrives after closure (a different exit code).
    expect
      .soft((await settle(fx, new FakeOsProcessPort().selfExit(run, 9))).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect.soft(countRows(fx, 'dispatch_lifecycle_closure')).toBe(1)
    expect.soft(closureOf(fx, run)?.terminal_status_ref).toBe('completed') // RED: never computed
    expect
      .soft(
        snapshotTables(fx),
        'closure/termination/event rows are byte-identical after a conflicting late report'
      )
      .toEqual(closed)
  })

  it('same-terminal retry converges (no new rows), reconstructable after a restart', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    expect
      .soft((await settle(fx, new FakeOsProcessPort().selfExit(run, 0))).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()
    const closedRow = closureOf(fx, run)

    fx.reopen()
    expect
      .soft((await settle(fx, new FakeOsProcessPort())).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect.soft(closureOf(fx, run)).toEqual(closedRow)
    expect.soft(closedRow?.terminal_status_ref).toBe('completed') // RED
  })
})

describe('CONTROL — closure is PK-guarded write-once at the store (must not regress)', () => {
  it('a second closure insert for the same lifecycle is rejected by the PK, never silently replaced', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    const record = {
      correlationId: run.correlationId,
      orcaDispatchId: run.orcaDispatchId,
      orcaRunId: run.orcaRunId,
      sliceRef: 'ORCA-S5-DELEGATED-CUTOVER-CORE',
      settlementStatusRef: 'observed',
      worktreeProvenanceRef: 'recorded',
      terminationMethodRef: 'self_exit',
      finalizationStatusRef: 'skipped_not_eligible',
      closureDigest: 'e'.repeat(64),
      closedAt: '2026-09-21T00:00:00.000Z',
      postClosureSettlementConflictDetectedAt: null
    }
    fx.stores.closures.insert(record)
    expect(() =>
      fx.stores.closures.insert({
        ...record,
        terminationMethodRef: 'signalled',
        closureDigest: 'f'.repeat(64)
      })
    ).toThrow()
    expect(closureOf(fx, run)?.termination_method_ref).toBe('self_exit')
  })
})

describe('RED — terminal event: exactly-once, idempotent, never without a closure (SPEC §15, gate 25)', () => {
  it('one event per closure, carrying the closure digest, stable across repeated recovery', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const port = new FakeOsProcessPort().selfExit(run, 0)

    for (let i = 0; i < 4; i += 1) {
      expect.soft((await settle(fx, port)).error, SWEEP_MUST_CONVERGE).toBeUndefined()
    }

    const events = eventsOf(fx, run)
    expect.soft(events).toHaveLength(1)
    expect.soft(events[0]?.closure_digest_ref).toBe(closureOf(fx, run)?.closure_digest)
  })

  it('a crash after closure but before the event leaves closure immutable and emits the event exactly once on recovery', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    const port = new FakeOsProcessPort().selfExit(run, 0)

    const crash = injectCrashOnInsert(fx, 'dispatch_lifecycle_event')
    await settle(fx, port) // closure durable, event write aborted
    const closureBefore = closureOf(fx, run)
    expect.soft(eventsOf(fx, run), 'no event without the ability to write one').toHaveLength(0)
    crash.disarm()

    fx.reopen()
    expect
      .soft((await settle(fx, new FakeOsProcessPort())).error, SWEEP_MUST_CONVERGE)
      .toBeUndefined()

    expect
      .soft(closureBefore, 'a closure existed before the event write was attempted')
      .toBeDefined() // RED today (finalizer refuses first)
    expect.soft(closureOf(fx, run)).toEqual(closureBefore)
    expect.soft(eventsOf(fx, run)).toHaveLength(1)
    expect.soft(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  })

  it('CONTROL (already true via S4, must not regress) — event ordering: never an event or outbox row for a run whose closure does not exist', async () => {
    const fx = fixture()
    const run = await commitDelegatedRun(fx, 1)
    seedUpstreamTerminal(fx, run)
    requestTeardown(fx, run, 'user_cancel')
    const port = new FakeOsProcessPort().rawOs(run, {
      pidExists: true,
      currentOsStartMarker: 'RECYCLED'
    })

    await sweepToFixedPoint(fx, port) // identity unverifiable: blocked before any terminal fact

    expect.soft(closureOf(fx, run)).toBeUndefined()
    expect.soft(eventsOf(fx, run)).toHaveLength(0)
    expect.soft(countRows(fx, 'aicontrol_terminal_projection')).toBe(0)
    expect.soft(terminationOf(fx, run)).toBeUndefined()
  })
})
