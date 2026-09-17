// ORCA-S5 Delegated Cutover Core — GENUINE RED baseline.
// Mission §19 (sole authority transfer), §20 (commit before callback
// success), §21 (callback success before release), §22 (same prepared
// process release), §23 (transaction failure), §24 (commit success /
// release failure), §25 (crash after commit, before release), §26 (cutover
// idempotency), §28 (concurrent cutover attempts).
//
// RED cause: `../../application/delegated-cutover-commit-step` does not
// exist (same missing module as delegated-cutover-transaction-and-schema.test.ts
// -- deliberately reused here rather than re-derived, per mission §42
// "one missing coordinator causing a coherent cluster to fail").
//
// Do not implement `commitDelegatedCutover` to make this pass.

import { describe, expect, it } from 'vitest'
import { commitDelegatedCutover } from '../../application/delegated-cutover-commit-step'
import {
  fixtureDispatchWorktree,
  fixtureProcessIdentity,
  fixtureRunBinding,
  makeTmpDir,
  openExecStores,
  openProcessBindingStore,
  reserveFixture
} from './cutover-core-test-harness'

describe('ORCA-S5 Delegated Cutover Core -- authority transfer, ordering, failure paths (RED)', () => {
  function setup(correlationId: string) {
    const tmp = makeTmpDir('orca-s5-cutover-core-authority-')
    const exec = openExecStores(':memory:')
    reserveFixture(exec.reservations, { correlationId })
    const processBindings = openProcessBindingStore(exec.db)
    const input = {
      correlationId,
      aicontrolRunId: `aicontrol_${correlationId}`,
      fenceToken: `token_${correlationId}`,
      binding: fixtureRunBinding({ correlationId: correlationId as never }),
      worktree: fixtureDispatchWorktree({ correlationId }),
      processIdentity: fixtureProcessIdentity({ correlationId })
    }
    const deps = {
      store: exec.store,
      dispatchWorktrees: exec.dispatchWorktrees,
      processBindings,
      txn: exec.store
    }
    return { tmp, exec, processBindings, input, deps }
  }

  // §19 -- across every pre-commit state, authority is AICONTROL_NATIVE; only
  // a durable COMMIT of delegation_cutover moves it to ORCA_DELEGATED.
  it('authority is AICONTROL_NATIVE at every state before commit, ORCA_DELEGATED only after', async () => {
    const { tmp, exec, deps, input } = setup('corr_auth_1')

    // Before any call: no delegation_cutover row -> AICONTROL_NATIVE.
    expect(exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get()).toEqual({ c: 0 })

    const result = await commitDelegatedCutover(deps, input)
    expect(result.outcome).toBe('COMMITTED')
    // Authority classification is a durable-fact read, not the function's own claim.
    const committed = exec.db
      .prepare('SELECT COUNT(*) c FROM delegation_cutover WHERE correlation_id = ?')
      .get('corr_auth_1') as { c: number }
    expect(committed.c).toBe(1)

    exec.close()
    tmp.cleanup()
  })

  // §20 -- while the transaction is pending, callback/release must not have
  // happened; only the durable COMMIT unlocks resolution. Modeled via the
  // fact that `commitDelegatedCutover` only ever returns after the underlying
  // `withImmediateTransaction` call returns -- proven by forcing a mid-
  // transaction failure and confirming zero release signal was ever produced.
  it('while the transaction has not committed, no outcome ever claims release is legal', async () => {
    const { tmp, exec, deps, input } = setup('corr_ord_1')
    const failingInput = {
      ...input,
      // Deliberately invalid pid to force mid-transaction failure.
      processIdentity: { ...input.processIdentity, pid: null }
    }

    let outcome: { outcome: string } | undefined
    try {
      // @ts-expect-error -- failingInput.processIdentity.pid is deliberately invalid (null, not number).
      outcome = await commitDelegatedCutover(deps, failingInput)
    } catch {
      outcome = undefined
    }
    // Either the call rejects, or it returns a non-COMMITTED outcome -- never
    // an outcome a caller could mistake for "safe to release".
    if (outcome) {
      expect(outcome.outcome).not.toBe('COMMITTED')
    }
    expect(exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get()).toEqual({ c: 0 })

    exec.close()
    tmp.cleanup()
  })

  // §22 -- the process identity captured at prepare is the SAME identity
  // durably bound at commit -- no substitute PID/process/dispatch.
  it('the durable dispatch_process_binding identity exactly equals the identity handed to the transaction', async () => {
    const { tmp, exec, deps, input } = setup('corr_ident_1')
    await commitDelegatedCutover(deps, input)

    const row = exec.db
      .prepare(
        'SELECT pid, process_nonce, os_start_marker FROM dispatch_process_binding WHERE correlation_id = ?'
      )
      .get('corr_ident_1') as { pid: number; process_nonce: string; os_start_marker: string }
    expect(row.pid).toBe(input.processIdentity.pid)
    expect(row.process_nonce).toBe(input.processIdentity.processNonce)
    expect(row.os_start_marker).toBe(input.processIdentity.osStartMarker)

    exec.close()
    tmp.cleanup()
  })

  // §23 -- transaction failure: no delegation_cutover, no partial binding, no
  // fabricated new process, no fallback.
  it('a transaction failure leaves authority AICONTROL_NATIVE, no partial durable state, no fallback signal', async () => {
    const { tmp, exec, deps, input } = setup('corr_fail_1')
    const failingInput = {
      ...input,
      // Deliberately invalid to force failure.
      processIdentity: { ...input.processIdentity, pid: null }
    }

    let thrown: unknown
    try {
      // @ts-expect-error -- failingInput.processIdentity.pid is deliberately invalid (null, not number).
      await commitDelegatedCutover(deps, failingInput)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeTruthy()

    const counts = {
      delegation_cutover: (
        exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get() as { c: number }
      ).c,
      dispatch_process_binding: (
        exec.db.prepare('SELECT COUNT(*) c FROM dispatch_process_binding').get() as { c: number }
      ).c
    }
    expect(counts).toEqual({ delegation_cutover: 0, dispatch_process_binding: 0 })

    exec.close()
    tmp.cleanup()
  })

  // §26 -- idempotency: the exact same tuple, repeated, converges to one
  // authority-transfer fact; a different tuple element conflicts/fails closed.
  it('repeating a commit with the exact same identity tuple converges to one durable fact, never a duplicate', async () => {
    const { tmp, exec, deps, input } = setup('corr_idem_1')

    const first = await commitDelegatedCutover(deps, input)
    const second = await commitDelegatedCutover(deps, input) // exact same tuple, repeated

    expect(first.outcome).toBe('COMMITTED')
    expect(second.outcome).toBe('ALREADY_COMMITTED_SAME_IDENTITY')

    const row = exec.db
      .prepare('SELECT COUNT(*) c FROM delegation_cutover WHERE correlation_id = ?')
      .get('corr_idem_1') as { c: number }
    expect(row.c).toBe(1)

    exec.close()
    tmp.cleanup()
  })

  it('a repeat commit for the same correlation_id but a DIFFERENT fence token conflicts, never overwrites', async () => {
    const { tmp, exec, deps, input } = setup('corr_idem_2')

    await commitDelegatedCutover(deps, input)
    let secondError: unknown
    try {
      await commitDelegatedCutover(deps, { ...input, fenceToken: 'DIFFERENT_TOKEN' })
    } catch (error) {
      secondError = error
    }
    expect(secondError).toBeTruthy()

    const row = exec.db
      .prepare('SELECT fence_token FROM delegation_cutover WHERE correlation_id = ?')
      .get('corr_idem_2') as { fence_token: string }
    expect(row.fence_token).toBe(input.fenceToken)

    exec.close()
    tmp.cleanup()
  })

  // §28 -- concurrent attempts: SQLite's own `BEGIN IMMEDIATE` serialization
  // (confirmed real, `with-immediate-transaction.ts`) is the mechanism that
  // must make this hold -- same identity converges, conflicting identity
  // cannot both commit. Modeled deterministically (synchronous SQLite; no
  // sleep-based correctness) via two sequential calls sharing one connection,
  // which is what real concurrent callers converge through in production.
  it('two same-identity attempts against the same connection converge to exactly one commit, no double release signal', async () => {
    const { tmp, exec, deps, input } = setup('corr_conc_1')

    const [a, b] = await Promise.all([
      commitDelegatedCutover(deps, input),
      commitDelegatedCutover(deps, input)
    ])
    const outcomes = [a.outcome, b.outcome].sort()
    expect(outcomes).toEqual(['ALREADY_COMMITTED_SAME_IDENTITY', 'COMMITTED'].sort())

    const row = exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get() as { c: number }
    expect(row.c).toBe(1)

    exec.close()
    tmp.cleanup()
  })

  it('two conflicting-identity attempts for the same correlation_id cannot both commit', async () => {
    const { tmp, exec, deps, input } = setup('corr_conc_2')
    const conflicting = { ...input, fenceToken: 'CONFLICTING_TOKEN' }

    const results = await Promise.allSettled([
      commitDelegatedCutover(deps, input),
      commitDelegatedCutover(deps, conflicting)
    ])
    const committedCount = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as { outcome: string }).outcome === 'COMMITTED'
    ).length
    expect(committedCount).toBe(1)

    const row = exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get() as { c: number }
    expect(row.c).toBe(1)

    exec.close()
    tmp.cleanup()
  })
})
