// ORCA-S5 Delegated Cutover Core — GENUINE RED baseline.
// Mission §29 (cancel before cutover), §30 (cutover before cancel), §31
// (aiControl ack is not authority transfer), §32 (no automatic fallback).
//
// RED cause: `../../application/delegated-cutover-commit-step` does not
// exist (same missing module as the transaction/authority files). §31's
// aiControl-acknowledgement scope classification is recorded per mission
// §31's own instruction ("If ack is explicitly later in frozen gate mapping:
// classify LATER_SLICE_B. Do not invent implementation.") -- see
// CUTOVER-CORE-RED-EVIDENCE.md §gate-mapping. The two tests below prove only
// the ALREADY-ACCEPTED invariant (Maestro's own commit is sole authority,
// regardless of ack) using the fake aiControl fence client, never a real ack
// route.
//
// Do not implement `commitDelegatedCutover` to make this pass.

import { describe, expect, it } from 'vitest'
import { commitDelegatedCutover } from '../../application/delegated-cutover-commit-step'
import {
  FakeAiControlCancellationAuthority,
  FakeAiControlFenceClient,
  fixtureDispatchWorktree,
  fixtureProcessIdentity,
  fixtureRunBinding,
  makeTmpDir,
  openExecStores,
  openProcessBindingStore,
  reserveFixture
} from './cutover-core-test-harness'

describe('ORCA-S5 Delegated Cutover Core -- cancellation vs. cutover, ack, no-fallback (RED)', () => {
  function setup(correlationId: string) {
    const tmp = makeTmpDir('orca-s5-cutover-core-cancel-')
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

  // §29 -- narrow core boundary: before durable delegation_cutover, an
  // authoritative pre-cutover cancellation must win. The coordinator's
  // commit step must consult cancellation state as a precondition, not
  // commit blindly.
  it('an authoritative pre-cutover cancellation prevents the commit from landing', async () => {
    const { tmp, exec, deps, input } = setup('corr_cancel_1')
    const cancellation = new FakeAiControlCancellationAuthority()
    cancellation.cancel(input.aicontrolRunId)

    let thrown: unknown
    try {
      await commitDelegatedCutover({ ...deps, cancellation }, input)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeTruthy()
    expect(exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get()).toEqual({ c: 0 })

    exec.close()
    tmp.cleanup()
  })

  // §30 -- after a durable commit, aiControl-native cancellation must not
  // become authoritative for continued execution/signaling.
  it('a durable commit is not undone by a cancellation observed afterward', async () => {
    const { tmp, exec, deps, input } = setup('corr_cancel_2')
    const cancellation = new FakeAiControlCancellationAuthority()

    const result = await commitDelegatedCutover({ ...deps, cancellation }, input)
    expect(result.outcome).toBe('COMMITTED')

    cancellation.cancel(input.aicontrolRunId) // arrives only after commit
    const row = exec.db
      .prepare('SELECT COUNT(*) c FROM delegation_cutover WHERE correlation_id = ?')
      .get('corr_cancel_2') as { c: number }
    expect(row.c).toBe(1) // the durable winner is preserved

    exec.close()
    tmp.cleanup()
  })

  // §31 -- aiControl acknowledgement is not the authority-transfer decision.
  // Maestro's own commit already transferred authority; a pending/lost ack
  // must not revert it, and a retried ack must not release the workload a
  // second time.
  it('authority transfers on the Maestro commit alone -- a pending or lost aiControl ack never reverts it', async () => {
    const { tmp, exec, deps, input } = setup('corr_ack_1')
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible(input.aicontrolRunId)
    await fence.acquireOrcaFence({ runId: input.aicontrolRunId, token: input.fenceToken })

    const result = await commitDelegatedCutover(deps, input)
    expect(result.outcome).toBe('COMMITTED')

    // No acknowledgeOrcaCutover call was ever made -- the ack is explicitly
    // lost/pending. Authority is still ORCA_DELEGATED, per the durable fact
    // alone (never per aiControl's own state).
    expect(fence.acknowledgeCalls.length).toBe(0)
    const row = exec.db
      .prepare('SELECT COUNT(*) c FROM delegation_cutover WHERE correlation_id = ?')
      .get('corr_ack_1') as { c: number }
    expect(row.c).toBe(1)

    exec.close()
    tmp.cleanup()
  })

  it('a retried acknowledgement never releases the workload a second time (idempotent, fake fence semantics)', async () => {
    const { tmp, exec, deps, input } = setup('corr_ack_2')
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible(input.aicontrolRunId)
    await fence.acquireOrcaFence({ runId: input.aicontrolRunId, token: input.fenceToken })
    await commitDelegatedCutover(deps, input)

    const first = await fence.acknowledgeOrcaCutover({
      runId: input.aicontrolRunId,
      token: input.fenceToken
    })
    const second = await fence.acknowledgeOrcaCutover({
      runId: input.aicontrolRunId,
      token: input.fenceToken
    })
    expect(first.outcome).toBe('ACKNOWLEDGED')
    expect(second.outcome).toBe('ACKNOWLEDGED') // idempotent no-op, never a second release

    exec.close()
    tmp.cleanup()
  })

  // §32 -- explicit no-fallback contract: after commit, release/process
  // failure must never resume native execution, clear the fence for native
  // use, or invoke M5.
  it('after a committed cutover, a simulated release/process failure never clears the fence for native execution', async () => {
    const { tmp, exec, deps, input } = setup('corr_fallback_1')
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible(input.aicontrolRunId)
    await fence.acquireOrcaFence({ runId: input.aicontrolRunId, token: input.fenceToken })
    await commitDelegatedCutover(deps, input)

    // A release failure must never call safeReleaseOrcaFence with fabricated
    // positive evidence -- the fake enforces the same evidence gate the real
    // orca-fence.ts does (mission §32 + §6.1's real disposition, confirmed
    // this session against orca-fence.ts's own doc comment).
    const releaseAttempt = await fence.safeReleaseOrcaFence({
      runId: input.aicontrolRunId,
      token: input.fenceToken,
      positiveNoCutoverEvidence: false // no genuine evidence exists -- cutover DID happen
    })
    expect(releaseAttempt.outcome).toBe('REJECTED_NO_EVIDENCE')
    expect(fence.stateOf(input.aicontrolRunId)).toBe('fenced') // never cleared for native reclaim

    exec.close()
    tmp.cleanup()
  })
})
