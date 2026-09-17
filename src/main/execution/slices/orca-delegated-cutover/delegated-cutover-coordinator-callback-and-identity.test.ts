// ORCA-S5 Delegated Cutover Core — GENUINE RED baseline.
// Mission §13 (exactly one delegated execution identity), §15 (process
// identity required before commit), §16 (site #5 callback coordination).
// §17 (identity must not leak into provider contract) is covered separately
// in delegated-cutover-identity-boundary-positive-control.test.ts, kept out
// of THIS file so it can independently PASS without being masked by this
// file's collection-level RED (mission §42: classify failures precisely).
//
// RED cause: `../../../runtime/orca-runtime-delegated-cutover-coordinator`
// does not exist (confirmed this session: `ls` returns "No such file or
// directory"). This is the SPEC §4.8.1 mixin/composition root — the ONE
// place the real site #5 closure (`orca-runtime-create-agent-session.ts:225-227`,
// byte-confirmed unchanged this session) would call
// `this.getDelegatedCutoverCoordinator().commitDelegatedCutover(...)`.
//
// Do not implement the coordinator to make this pass.

import { describe, expect, it } from 'vitest'
// @ts-expect-error -- genuine RED: the coordinator module does not exist yet.
import { OrcaRuntimeWithDelegatedCutoverCoordinator } from '../../../runtime/orca-runtime-delegated-cutover-coordinator'
import {
  fixtureProcessIdentity,
  makeTmpDir,
  openExecStores,
  reserveFixture
} from './cutover-core-test-harness'

describe('ORCA-S5 Delegated Cutover Core -- site #5 callback / coordinator (RED)', () => {
  it('the future coordinator accessor exists on the runtime mixin chain and exposes commitDelegatedCutover', () => {
    // Genuinely missing today -- this line alone fails to import. The shape
    // asserted below documents the accepted contract (SPEC §4.8.1/§4.8.4),
    // not an invented one.
    const coordinatorCtor = OrcaRuntimeWithDelegatedCutoverCoordinator as unknown as {
      prototype: {
        getDelegatedCutoverCoordinator: () => {
          commitDelegatedCutover: (...args: unknown[]) => unknown
        }
      }
    }
    expect(typeof coordinatorCtor.prototype.getDelegatedCutoverCoordinator).toBe('function')
  })

  // §16 -- required inputs: aiControl run id, fence token, Orca run/dispatch
  // identity, exact prepared process identity (SPEC §4.8.4).
  it('commitDelegatedCutover requires aiControl run id, fence token, Orca dispatch identity, and process identity', async () => {
    const tmp = makeTmpDir('orca-s5-cutover-core-callback-')
    const exec = openExecStores(':memory:')
    reserveFixture(exec.reservations, { correlationId: 'corr_cb_1' })

    const coordinator = new (OrcaRuntimeWithDelegatedCutoverCoordinator as unknown as {
      new (): {
        getDelegatedCutoverCoordinator: () => {
          commitDelegatedCutover: (input: {
            aicontrolRunId: string
            fenceToken: string
            correlationId: string
            orcaDispatchId: string
            processIdentity: ReturnType<typeof fixtureProcessIdentity>
          }) => Promise<{ outcome: string }>
        }
      }
    })()

    const result = await coordinator.getDelegatedCutoverCoordinator().commitDelegatedCutover({
      aicontrolRunId: 'aicontrol_run_cb_1',
      fenceToken: 'token_cb_1',
      correlationId: 'corr_cb_1',
      orcaDispatchId: 'dispatch_cb_1',
      processIdentity: fixtureProcessIdentity({ correlationId: 'corr_cb_1' })
    })
    expect(result.outcome).toBe('COMMITTED')

    exec.close()
    tmp.cleanup()
  })

  // §15 -- missing/unverifiable process identity: no binding, no cutover, no
  // release, no signal/speculative bind to an unverifiable process.
  it('an absent process identity produces zero dispatch_process_binding, zero delegation_cutover', async () => {
    const tmp = makeTmpDir('orca-s5-cutover-core-noidentity-')
    const exec = openExecStores(':memory:')
    reserveFixture(exec.reservations, { correlationId: 'corr_noident_1' })

    const coordinator = new (OrcaRuntimeWithDelegatedCutoverCoordinator as unknown as {
      new (): {
        getDelegatedCutoverCoordinator: () => {
          commitDelegatedCutover: (input: Record<string, unknown>) => Promise<{ outcome: string }>
        }
      }
    })()

    let thrown: unknown
    try {
      await coordinator.getDelegatedCutoverCoordinator().commitDelegatedCutover({
        aicontrolRunId: 'aicontrol_run_noident_1',
        fenceToken: 'token_noident_1',
        correlationId: 'corr_noident_1',
        orcaDispatchId: 'dispatch_noident_1',
        processIdentity: null
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeTruthy()
    expect(exec.db.prepare('SELECT COUNT(*) c FROM dispatch_process_binding').get()).toEqual({
      c: 0
    })
    expect(exec.db.prepare('SELECT COUNT(*) c FROM delegation_cutover').get()).toEqual({ c: 0 })

    exec.close()
    tmp.cleanup()
  })

  // §13 -- exactly one delegated execution identity: a retry for the same
  // protocol identity must never produce a second dispatch_process_binding.
  it('a retry for the same correlation_id never produces a second process binding', async () => {
    const tmp = makeTmpDir('orca-s5-cutover-core-cardinality-')
    const exec = openExecStores(':memory:')
    reserveFixture(exec.reservations, { correlationId: 'corr_card_1' })

    const coordinator = new (OrcaRuntimeWithDelegatedCutoverCoordinator as unknown as {
      new (): {
        getDelegatedCutoverCoordinator: () => {
          commitDelegatedCutover: (input: Record<string, unknown>) => Promise<{ outcome: string }>
        }
      }
    })()
    const input = {
      aicontrolRunId: 'aicontrol_run_card_1',
      fenceToken: 'token_card_1',
      correlationId: 'corr_card_1',
      orcaDispatchId: 'dispatch_card_1',
      processIdentity: fixtureProcessIdentity({ correlationId: 'corr_card_1' })
    }

    await coordinator.getDelegatedCutoverCoordinator().commitDelegatedCutover(input)
    await coordinator.getDelegatedCutoverCoordinator().commitDelegatedCutover(input)

    const row = exec.db
      .prepare('SELECT COUNT(*) c FROM dispatch_process_binding WHERE correlation_id = ?')
      .get('corr_card_1') as { c: number }
    expect(row.c).toBe(1)

    exec.close()
    tmp.cleanup()
  })
})
