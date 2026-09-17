// ORCA-S5 Delegated Cutover Core — GENUINE RED baseline (§33).
//
// RED cause: `../../../runtime/orca-runtime-delegated-cutover-coordinator`
// does not exist -- the recovery sweep (SPEC §11, corrected round 5) is
// specified as a method on the SAME coordinator mixin, reusing
// `adoptStablePane`/`reconcileRemoteTerminalCreate` (both confirmed real this
// session). No sweep scheduler is implemented here (mission §33: "Do not
// implement sweep scheduler"). The async-late self-dependency positive
// control (§34) is deliberately kept in its OWN file
// (delegated-cutover-async-residual-positive-control.test.ts) so it can
// independently PASS without being masked by this file's collection-level
// RED (mission §42).
//
// Do not implement the coordinator to make this pass.

import { describe, expect, it } from 'vitest'
// @ts-expect-error -- genuine RED: the coordinator module does not exist yet.
import { OrcaRuntimeWithDelegatedCutoverCoordinator } from '../../../runtime/orca-runtime-delegated-cutover-coordinator'
import {
  fixtureProcessIdentity,
  makeTmpDir,
  openExecStores,
  openProcessBindingStore,
  reserveFixture
} from './cutover-core-test-harness'

describe('ORCA-S5 Delegated Cutover Core -- recovery from durable sources only (RED)', () => {
  // §33 -- future recovery must derive its decision from durable facts
  // (run_reservation, run_binding, dispatch_worktree, dispatch_process_binding,
  // delegation_cutover) -- never from JS Promise state. Proven by restarting
  // "cold" against only the durable rows a prior commit left behind, with no
  // in-memory handle carried over -- the same shape
  // `delegated-side-effect-boundary.composition-root.test.ts`'s restart call
  // already proves for ORCA-S4's sweep (real precedent, not invented here).
  it('recovery reconstructs from durable facts alone, with no carried-over in-memory state', async () => {
    const tmp = makeTmpDir('orca-s5-cutover-core-recovery-')
    const exec = openExecStores(':memory:')
    reserveFixture(exec.reservations, { correlationId: 'corr_recover_1' })
    openProcessBindingStore(exec.db)

    // A prior "process" that committed cutover, but never confirmed release
    // -- modeled directly as durable facts, mirroring crash boundary C4/C5
    // (mission §25/§38), never as a live handle.
    const coordinator1 = new (OrcaRuntimeWithDelegatedCutoverCoordinator as unknown as {
      new (): {
        getDelegatedCutoverCoordinator: () => {
          commitDelegatedCutover: (input: Record<string, unknown>) => Promise<{ outcome: string }>
        }
      }
    })()
    await coordinator1.getDelegatedCutoverCoordinator().commitDelegatedCutover({
      aicontrolRunId: 'aicontrol_run_recover_1',
      fenceToken: 'token_recover_1',
      correlationId: 'corr_recover_1',
      orcaDispatchId: 'dispatch_recover_1',
      processIdentity: fixtureProcessIdentity({ correlationId: 'corr_recover_1' })
    })

    // A SECOND, independent coordinator instance -- no shared in-memory
    // state with coordinator1 -- must be able to classify this run as
    // ORCA_DELEGATED and reconcile it purely from the durable rows above.
    const coordinator2 = new (OrcaRuntimeWithDelegatedCutoverCoordinator as unknown as {
      new (): {
        getDelegatedCutoverCoordinator: () => {
          recoverPendingDelegatedCutovers: () => Promise<
            { correlationId: string; authority: string }[]
          >
        }
      }
    })()
    const recovered = await coordinator2
      .getDelegatedCutoverCoordinator()
      .recoverPendingDelegatedCutovers()

    expect(
      recovered.some(
        (r) => r.correlationId === 'corr_recover_1' && r.authority === 'ORCA_DELEGATED'
      )
    ).toBe(true)

    exec.close()
    tmp.cleanup()
  })
})
