// ORCA-S5 Delegated Cutover Core — GENUINE RED baseline.
// Mission §18 (atomic bind+cutover transaction), §36 (delegation_cutover
// schema contract), §37 (transaction rollback).
//
// RED cause (two independent, both genuine, per mission §41 "missing schema"
// / "missing atomic transaction operation"):
//   1. `../../application/delegated-cutover-commit-step` does not exist --
//      the future application-layer step mirroring the real, existing
//      `worktree-provenance-bind-step.ts`'s `bindDispatchWorktree` (confirmed
//      this session: `deps.txn.withImmediateTransaction(() => { ... })`,
//      `ExecutionTransactionRunner` at `execution-transaction-runner.ts`).
//   2. `delegation_cutover` has zero references in `execution-schema.ts`
//      (confirmed this session, `grep -c` returned 0) -- no migration is
//      added by this session.
//
// Do not implement `commitDelegatedCutover` or a `delegation_cutover` table
// to make this pass.

import { describe, expect, it } from 'vitest'
import { commitDelegatedCutover } from '../../application/delegated-cutover-commit-step'
import {
  DELEGATED_CUTOVER_CORE_SLICE_REF,
  fixtureDispatchWorktree,
  fixtureProcessIdentity,
  fixtureRunBinding,
  makeTmpDir,
  openExecStores,
  openProcessBindingStore,
  reserveFixture
} from './cutover-core-test-harness'

describe('ORCA-S5 Delegated Cutover Core -- atomic bind+cutover transaction (RED)', () => {
  function setupWithReservation() {
    const tmp = makeTmpDir('orca-s5-cutover-core-txn-')
    const exec = openExecStores(':memory:')
    // §5.4 (corrected round 5): run_reservation is PRE-EXISTING before this
    // transaction -- established by the S2 reservation step (separate
    // module, see delegated-cutover-fence-and-reservation.test.ts), never
    // inserted by the transaction itself.
    const reservation = reserveFixture(exec.reservations, { correlationId: 'corr_txn_1' })
    const processBindings = openProcessBindingStore(exec.db)
    return { tmp, exec, reservation, processBindings }
  }

  // §18 -- the four required inserts, one commit, using the SAME real
  // ExecutionTransactionRunner.withImmediateTransaction primitive
  // `worktree-provenance-bind-step.ts` already uses (confirmed this session).
  it('a successful commit durably establishes run_binding + dispatch_worktree + dispatch_process_binding + delegation_cutover atomically', async () => {
    const { tmp, exec, processBindings } = setupWithReservation()

    const result = await commitDelegatedCutover(
      {
        store: exec.store,
        dispatchWorktrees: exec.dispatchWorktrees,
        processBindings,
        txn: exec.store
      },
      {
        correlationId: 'corr_txn_1',
        aicontrolRunId: 'aicontrol_run_txn_1',
        fenceToken: 'token_txn_1',
        binding: fixtureRunBinding({ correlationId: 'corr_txn_1' as never }),
        worktree: fixtureDispatchWorktree({ correlationId: 'corr_txn_1' }),
        processIdentity: fixtureProcessIdentity({ correlationId: 'corr_txn_1' })
      }
    )

    expect(result.outcome).toBe('COMMITTED')

    const counts = {
      run_binding: (exec.db.prepare('SELECT COUNT(*) c FROM run_binding').get() as { c: number }).c,
      dispatch_worktree: (
        exec.db.prepare('SELECT COUNT(*) c FROM dispatch_worktree').get() as { c: number }
      ).c,
      dispatch_process_binding: (
        exec.db.prepare('SELECT COUNT(*) c FROM dispatch_process_binding').get() as { c: number }
      ).c,
      delegation_cutover: (
        exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get() as { c: number }
      ).c
    }
    expect(counts).toEqual({
      run_binding: 1,
      dispatch_worktree: 1,
      dispatch_process_binding: 1,
      delegation_cutover: 1
    })

    exec.close()
    tmp.cleanup()
  })

  // §5.4 correction -- the transaction must NOT re-insert run_reservation;
  // it only reads/references the pre-existing row via FK.
  it('the transaction never re-inserts run_reservation -- exactly one row survives, from the S2 step alone', async () => {
    const { tmp, exec, processBindings } = setupWithReservation()

    await commitDelegatedCutover(
      {
        store: exec.store,
        dispatchWorktrees: exec.dispatchWorktrees,
        processBindings,
        txn: exec.store
      },
      {
        correlationId: 'corr_txn_1',
        aicontrolRunId: 'aicontrol_run_txn_1',
        fenceToken: 'token_txn_1',
        binding: fixtureRunBinding({ correlationId: 'corr_txn_1' as never }),
        worktree: fixtureDispatchWorktree({ correlationId: 'corr_txn_1' }),
        processIdentity: fixtureProcessIdentity({ correlationId: 'corr_txn_1' })
      }
    )

    const row = exec.db
      .prepare('SELECT COUNT(*) c FROM run_reservation WHERE slice_ref = ?')
      .get(DELEGATED_CUTOVER_CORE_SLICE_REF) as { c: number }
    expect(row.c).toBe(1)

    exec.close()
    tmp.cleanup()
  })

  // §36 -- delegation_cutover schema contract: identity fields, fence-token
  // linkage, uniqueness/write-once, relationship to run_reservation/binding.
  it('delegation_cutover carries the correlation/aicontrolRun/fenceToken identity and is write-once per correlation_id', async () => {
    const { tmp, exec, processBindings } = setupWithReservation()
    const call = () =>
      commitDelegatedCutover(
        {
          store: exec.store,
          dispatchWorktrees: exec.dispatchWorktrees,
          processBindings,
          txn: exec.store
        },
        {
          correlationId: 'corr_txn_1',
          aicontrolRunId: 'aicontrol_run_txn_1',
          fenceToken: 'token_txn_1',
          binding: fixtureRunBinding({ correlationId: 'corr_txn_1' as never }),
          worktree: fixtureDispatchWorktree({ correlationId: 'corr_txn_1' }),
          processIdentity: fixtureProcessIdentity({ correlationId: 'corr_txn_1' })
        }
      )

    await call()
    const row = exec.db
      .prepare(
        'SELECT correlation_id, aicontrol_run_id, fence_token FROM delegation_cutover WHERE correlation_id = ?'
      )
      .get('corr_txn_1') as {
      correlation_id: string
      aicontrol_run_id: string
      fence_token: string
    }
    expect(row).toEqual({
      correlation_id: 'corr_txn_1',
      aicontrol_run_id: 'aicontrol_run_txn_1',
      fence_token: 'token_txn_1'
    })

    // Write-once: a second, distinct-content commit attempt for the SAME
    // correlation_id must never silently overwrite the durable authority
    // fact -- either idempotent no-op (same identity) or fail closed.
    let secondError: unknown
    try {
      await commitDelegatedCutover(
        {
          store: exec.store,
          dispatchWorktrees: exec.dispatchWorktrees,
          processBindings,
          txn: exec.store
        },
        {
          correlationId: 'corr_txn_1',
          aicontrolRunId: 'aicontrol_run_txn_1',
          fenceToken: 'DIFFERENT_TOKEN',
          binding: fixtureRunBinding({ correlationId: 'corr_txn_1' as never }),
          worktree: fixtureDispatchWorktree({ correlationId: 'corr_txn_1' }),
          processIdentity: fixtureProcessIdentity({ correlationId: 'corr_txn_1' })
        }
      )
    } catch (error) {
      secondError = error
    }
    const after = exec.db
      .prepare('SELECT fence_token FROM delegation_cutover WHERE correlation_id = ?')
      .get('corr_txn_1') as { fence_token: string }
    expect(after.fence_token).toBe('token_txn_1') // never overwritten
    expect(secondError).toBeTruthy()

    exec.close()
    tmp.cleanup()
  })

  // §37 -- rollback: force failure between the binding and cutover writes.
  // Neither survives -- ALL COMMIT or NONE COMMIT (mission §18/§37).
  it('a failure inside the transaction leaves neither dispatch_process_binding nor delegation_cutover durable', async () => {
    const { tmp, exec, processBindings } = setupWithReservation()

    // A process identity with a PID that violates the real
    // dispatch_process_binding schema (pid INTEGER NOT NULL, confirmed this
    // session) forces the transaction to fail partway through the insert
    // sequence -- exercising real SQLite atomicity, not a simulated failure.
    let thrown: unknown
    try {
      await commitDelegatedCutover(
        {
          store: exec.store,
          dispatchWorktrees: exec.dispatchWorktrees,
          processBindings,
          txn: exec.store
        },
        {
          correlationId: 'corr_txn_1',
          aicontrolRunId: 'aicontrol_run_txn_1',
          fenceToken: 'token_txn_1',
          binding: fixtureRunBinding({ correlationId: 'corr_txn_1' as never }),
          worktree: fixtureDispatchWorktree({ correlationId: 'corr_txn_1' }),
          // @ts-expect-error -- deliberately invalid to force a real constraint failure.
          processIdentity: fixtureProcessIdentity({ correlationId: 'corr_txn_1', pid: null })
        }
      )
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeTruthy()

    const counts = {
      run_binding: (exec.db.prepare('SELECT COUNT(*) c FROM run_binding').get() as { c: number }).c,
      dispatch_worktree: (
        exec.db.prepare('SELECT COUNT(*) c FROM dispatch_worktree').get() as { c: number }
      ).c,
      dispatch_process_binding: (
        exec.db.prepare('SELECT COUNT(*) c FROM dispatch_process_binding').get() as { c: number }
      ).c,
      delegation_cutover: (
        exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get() as { c: number }
      ).c
    }
    expect(counts).toEqual({
      run_binding: 0,
      dispatch_worktree: 0,
      dispatch_process_binding: 0,
      delegation_cutover: 0
    })

    exec.close()
    tmp.cleanup()
  })
})
