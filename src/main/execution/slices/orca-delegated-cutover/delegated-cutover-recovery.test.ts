// ORCA-S5 Delegated Cutover Core — GREEN (§33).
//
// Exercises the real `OrcaRuntimeWithDelegatedCutoverCoordinator`'s recovery
// surface (SPEC §11, corrected round 5) — a method on the SAME coordinator
// mixin that owns the persistent Execution store, reusing the coordinator's
// own lazily-owned connection rather than a second composition root. No
// sweep scheduler is implemented (mission §33/§30: "Do not implement sweep
// scheduler" — cadence is a deliberately deferred implementation detail).
//
// Test-authoring correction (documented per mission §3, same root cause as
// delegated-cutover-coordinator-callback-and-identity.test.ts): seeds the
// prior "committed" state through the coordinator's own real steps
// (`establishReservation` + `commitDelegatedCutover`) rather than a
// disconnected in-memory store, so the durable facts a second, independent
// coordinator instance recovers from are genuinely the coordinator's own.

import { afterEach, describe, expect, it } from 'vitest'
import { OrcaRuntimeWithDelegatedCutoverCoordinator } from '../../../runtime/orca-runtime-delegated-cutover-coordinator'
import { fixtureProcessIdentity, FakeAiControlFenceClient } from './cutover-core-test-harness'

const openCoordinators: OrcaRuntimeWithDelegatedCutoverCoordinator[] = []
afterEach(() => {
  while (openCoordinators.length) {
    openCoordinators.pop()?.getDelegatedCutoverDatabaseForDiagnostics()?.close()
  }
})

describe('ORCA-S5 Delegated Cutover Core -- recovery from durable sources only', () => {
  it('recovery reconstructs from durable facts alone, with no carried-over in-memory state', async () => {
    // A prior "process" that committed cutover -- modeled directly as
    // durable facts written by a first, independent coordinator instance,
    // mirroring crash boundary C4/C5 (mission §25/§38), never as a live
    // handle carried between instances.
    const fence1 = new FakeAiControlFenceClient()
    const coordinator1 = new OrcaRuntimeWithDelegatedCutoverCoordinator()
    coordinator1.getDelegatedCutoverCoordinatorDeps = () => ({ fence: fence1 })
    openCoordinators.push(coordinator1)

    fence1.seedEligible('aicontrol_run_recover_1')
    await coordinator1.getDelegatedCutoverCoordinator().establishReservation({
      correlationId: 'corr_recover_1',
      aicontrolRunId: 'aicontrol_run_recover_1',
      fenceToken: 'token_recover_1',
      workloadId: 'workload_recover_1',
      providerEligible: true,
      now: '2026-09-17T00:00:00Z'
    })
    await coordinator1.getDelegatedCutoverCoordinator().commitDelegatedCutover({
      aicontrolRunId: 'aicontrol_run_recover_1',
      fenceToken: 'token_recover_1',
      correlationId: 'corr_recover_1',
      orcaDispatchId: 'dispatch_recover_1',
      processIdentity: fixtureProcessIdentity({
        correlationId: 'corr_recover_1',
        orcaDispatchId: 'dispatch_recover_1'
      })
    })

    // A SECOND, independent coordinator instance -- no shared in-memory
    // state with coordinator1 -- must classify this run as ORCA_DELEGATED
    // and reconcile it purely from the durable rows above (the same real
    // `userData/execution.db` file both instances open).
    const coordinator2 = new OrcaRuntimeWithDelegatedCutoverCoordinator()
    openCoordinators.push(coordinator2)
    const recovered = await coordinator2
      .getDelegatedCutoverCoordinator()
      .recoverPendingDelegatedCutovers()

    expect(
      recovered.some(
        (r) => r.correlationId === 'corr_recover_1' && r.authority === 'ORCA_DELEGATED'
      )
    ).toBe(true)
  })
})
