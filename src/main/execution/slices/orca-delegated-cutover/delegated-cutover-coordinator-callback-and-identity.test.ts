// ORCA-S5 Delegated Cutover Core — GREEN.
// Mission §13 (exactly one delegated execution identity), §15 (process
// identity required before commit), §16 (site #5 callback coordination).
// §17 (identity must not leak into provider contract) is covered separately
// in delegated-cutover-identity-boundary-positive-control.test.ts.
//
// Exercises the real `OrcaRuntimeWithDelegatedCutoverCoordinator`
// (`src/main/runtime/orca-runtime-delegated-cutover-coordinator.ts`) — the
// SPEC §4.8.1 mixin/composition root the real site #5 closure
// (`orca-runtime-create-agent-session.ts:225-227`) calls
// `this.getDelegatedCutoverCoordinator().commitDelegatedCutover(...)` on.
//
// Test-authoring correction (documented per mission §3): the RED version of
// this file seeded a reservation into a SEPARATE in-memory `exec` store
// (`cutover-core-test-harness.ts`'s `openExecStores`) while the coordinator
// under test owns its OWN lazily-opened Execution SQLite connection (SPEC
// §4.8.1, mirroring `getOrchestrationDb()`) — the two were different
// databases. GREEN exposed this immediately as a real `FOREIGN KEY
// constraint failed` (the coordinator's own DB enforces the FK the
// disposable-store harness disables), which is the correct, honest failure:
// a genuine test-authoring gap, not a production defect. The fix seeds the
// reservation through the coordinator's own `establishReservation` (the S2
// step, injected with a fake, always-eligible fence via the coordinator's
// documented test seam, `getDelegatedCutoverCoordinatorDeps`), so both steps
// operate against the one real database the frozen architecture requires.

import { afterEach, describe, expect, it } from 'vitest'
import { OrcaRuntimeWithDelegatedCutoverCoordinator } from '../../../runtime/orca-runtime-delegated-cutover-coordinator'
import { fixtureProcessIdentity, FakeAiControlFenceClient } from './cutover-core-test-harness'

const openCoordinators: OrcaRuntimeWithDelegatedCutoverCoordinator[] = []
afterEach(() => {
  while (openCoordinators.length) {
    openCoordinators.pop()?.getDelegatedCutoverDatabaseForDiagnostics()?.close()
  }
})

function newCoordinator() {
  const fence = new FakeAiControlFenceClient()
  const coordinator = new OrcaRuntimeWithDelegatedCutoverCoordinator()
  coordinator.getDelegatedCutoverCoordinatorDeps = () => ({ fence })
  openCoordinators.push(coordinator)
  return { coordinator, fence }
}

async function seedReservation(
  coordinator: OrcaRuntimeWithDelegatedCutoverCoordinator,
  fence: FakeAiControlFenceClient,
  args: { correlationId: string; aicontrolRunId: string; fenceToken: string }
) {
  fence.seedEligible(args.aicontrolRunId)
  await coordinator.getDelegatedCutoverCoordinator().establishReservation({
    correlationId: args.correlationId,
    aicontrolRunId: args.aicontrolRunId,
    fenceToken: args.fenceToken,
    workloadId: `workload_${args.correlationId}`,
    providerEligible: true,
    now: '2026-09-17T00:00:00Z'
  })
}

describe('ORCA-S5 Delegated Cutover Core -- site #5 callback / coordinator', () => {
  it('the coordinator accessor exists on the runtime mixin chain and exposes commitDelegatedCutover', () => {
    expect(
      typeof OrcaRuntimeWithDelegatedCutoverCoordinator.prototype.getDelegatedCutoverCoordinator
    ).toBe('function')
  })

  // §16 -- required inputs: aiControl run id, fence token, Orca dispatch
  // identity, exact prepared process identity (SPEC §4.8.4).
  it('commitDelegatedCutover requires aiControl run id, fence token, Orca dispatch identity, and process identity', async () => {
    const { coordinator, fence } = newCoordinator()
    await seedReservation(coordinator, fence, {
      correlationId: 'corr_cb_1',
      aicontrolRunId: 'aicontrol_run_cb_1',
      fenceToken: 'token_cb_1'
    })

    const result = await coordinator.getDelegatedCutoverCoordinator().commitDelegatedCutover({
      aicontrolRunId: 'aicontrol_run_cb_1',
      fenceToken: 'token_cb_1',
      correlationId: 'corr_cb_1',
      orcaDispatchId: 'dispatch_cb_1',
      processIdentity: fixtureProcessIdentity({
        correlationId: 'corr_cb_1',
        orcaDispatchId: 'dispatch_cb_1'
      })
    })
    expect(result.outcome).toBe('COMMITTED')
  })

  // §15 -- missing/unverifiable process identity: no binding, no cutover, no
  // release, no signal/speculative bind to an unverifiable process.
  it('an absent process identity produces zero dispatch_process_binding, zero delegation_cutover', async () => {
    const { coordinator, fence } = newCoordinator()
    await seedReservation(coordinator, fence, {
      correlationId: 'corr_noident_1',
      aicontrolRunId: 'aicontrol_run_noident_1',
      fenceToken: 'token_noident_1'
    })

    let thrown: unknown
    try {
      await coordinator.getDelegatedCutoverCoordinator().commitDelegatedCutover({
        aicontrolRunId: 'aicontrol_run_noident_1',
        fenceToken: 'token_noident_1',
        correlationId: 'corr_noident_1',
        orcaDispatchId: 'dispatch_noident_1',
        processIdentity: null as never
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeTruthy()

    const db = coordinator.getDelegatedCutoverDatabaseForDiagnostics()!
    expect(
      db
        .prepare('SELECT COUNT(*) c FROM dispatch_process_binding WHERE correlation_id = ?')
        .get('corr_noident_1')
    ).toEqual({ c: 0 })
    expect(
      db
        .prepare('SELECT COUNT(*) c FROM delegation_cutover WHERE correlation_id = ?')
        .get('corr_noident_1')
    ).toEqual({ c: 0 })
  })

  // §13 -- exactly one delegated execution identity: a retry for the same
  // protocol identity must never produce a second dispatch_process_binding.
  it('a retry for the same correlation_id never produces a second process binding', async () => {
    const { coordinator, fence } = newCoordinator()
    await seedReservation(coordinator, fence, {
      correlationId: 'corr_card_1',
      aicontrolRunId: 'aicontrol_run_card_1',
      fenceToken: 'token_card_1'
    })

    const input = {
      aicontrolRunId: 'aicontrol_run_card_1',
      fenceToken: 'token_card_1',
      correlationId: 'corr_card_1',
      orcaDispatchId: 'dispatch_card_1',
      processIdentity: fixtureProcessIdentity({
        correlationId: 'corr_card_1',
        orcaDispatchId: 'dispatch_card_1'
      })
    }

    await coordinator.getDelegatedCutoverCoordinator().commitDelegatedCutover(input)
    await coordinator.getDelegatedCutoverCoordinator().commitDelegatedCutover(input)

    const db = coordinator.getDelegatedCutoverDatabaseForDiagnostics()!
    const row = db
      .prepare('SELECT COUNT(*) c FROM dispatch_process_binding WHERE correlation_id = ?')
      .get('corr_card_1') as { c: number }
    expect(row.c).toBe(1)
  })
})
