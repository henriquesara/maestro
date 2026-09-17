// ORCA-S5 Delegated Cutover Core — GENUINE RED baseline.
// Mission §5 (aiControl fence contract, test-fake only), §6 (provider before
// fence), §7 (fence token identity), §9 (response-loss / same-token retry),
// §10 (S5 run_reservation), §11 (crash after fence, before reservation), §12
// (crash after reservation, before prepare), §27 (matching fence required).
//
// RED cause: `../../application/delegated-cutover-reservation-step` does not
// exist. This is the future S1(fence)->S2(run_reservation) application step
// (SPEC.md §5.2 S1/S2, §4.8.1, corrected round 5) -- the ONE place eligibility,
// fence acquisition, and reservation creation must be ordered and made
// idempotent. Gate 52 (provider eligibility, `buildRuntimePtySpawnOptions`)
// is ALREADY GREEN and unmodified by this session -- see the baseline run in
// CUTOVER-CORE-RED-EVIDENCE.md §2; this file exercises only the new
// orchestration this correction requires, not the provider layer again.
//
// Do not implement `establishDelegatedCutoverReservation` to make this pass.

import { describe, expect, it } from 'vitest'
// @ts-expect-error -- genuine RED: this application-layer step does not exist yet.
import { establishDelegatedCutoverReservation } from '../../application/delegated-cutover-reservation-step'
import {
  DELEGATED_CUTOVER_CORE_SLICE_REF,
  FakeAiControlFenceClient,
  makeTmpDir,
  openExecStores
} from './cutover-core-test-harness'

describe('ORCA-S5 Delegated Cutover Core -- fence + S5 run_reservation (RED)', () => {
  function setup() {
    const tmp = makeTmpDir('orca-s5-cutover-core-fence-')
    const exec = openExecStores(':memory:')
    const fence = new FakeAiControlFenceClient()
    return { tmp, exec, fence }
  }

  // §6 -- future ordering: provider eligibility precedes fence acquisition.
  // The provider-side half of this is already real and GREEN
  // (`buildRuntimePtySpawnOptions`, gate 52). What is missing is the
  // COORDINATOR's own refusal to touch the fence at all when the request was
  // never eligible in the first place -- proven here via the fake's call
  // count, not by recreating provider eligibility as a competing test-only
  // implementation.
  it('an ineligible/unsupported request never calls the fence client (zero fence calls, zero reservation)', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedIneligible('aicontrol_run_ineligible_1')

    await expect(
      establishDelegatedCutoverReservation(
        { reservations: exec.reservations, fence, sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF },
        {
          correlationId: 'corr_ineligible_1',
          aicontrolRunId: 'aicontrol_run_ineligible_1',
          fenceToken: 'token_ineligible_1',
          workloadId: 'workload_ineligible_1',
          providerEligible: false,
          now: '2026-09-17T00:00:00Z'
        }
      )
    ).rejects.toBeTruthy()

    expect(fence.acquireCalls.length).toBe(0)
    const row = exec.db.prepare('SELECT COUNT(*) c FROM run_reservation').get() as { c: number }
    expect(row.c).toBe(0)

    exec.close()
    tmp.cleanup()
  })

  // §7 -- one delegated protocol instance, one caller-generated token.
  it('the same caller-generated token is reused on a same-protocol retry, never regenerated', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedEligible('aicontrol_run_token_1')

    const deps = {
      reservations: exec.reservations,
      fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }
    const input = {
      correlationId: 'corr_token_1',
      aicontrolRunId: 'aicontrol_run_token_1',
      fenceToken: 'token_token_1',
      workloadId: 'workload_token_1',
      providerEligible: true,
      now: '2026-09-17T00:00:00Z'
    }

    await establishDelegatedCutoverReservation(deps, input)
    await establishDelegatedCutoverReservation(deps, input) // retry, same input/token

    expect(fence.acquireCalls.every((c) => c.token === 'token_token_1')).toBe(true)
    // Exactly one ACQUIRED, the retry is ALREADY_FENCED_SAME_TOKEN (idempotent).
    expect(fence.acquireCalls.length).toBe(2)

    exec.close()
    tmp.cleanup()
  })

  it('a different token for the same run conflicts and never proceeds to reservation', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedEligible('aicontrol_run_token_2')
    const deps = {
      reservations: exec.reservations,
      fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }

    await establishDelegatedCutoverReservation(deps, {
      correlationId: 'corr_token_2a',
      aicontrolRunId: 'aicontrol_run_token_2',
      fenceToken: 'token_2_first',
      workloadId: 'workload_token_2',
      providerEligible: true,
      now: '2026-09-17T00:00:00Z'
    })

    await expect(
      establishDelegatedCutoverReservation(deps, {
        correlationId: 'corr_token_2b',
        aicontrolRunId: 'aicontrol_run_token_2',
        fenceToken: 'token_2_conflict',
        workloadId: 'workload_token_2',
        providerEligible: true,
        now: '2026-09-17T00:00:00Z'
      })
    ).rejects.toBeTruthy()

    const row = exec.db
      .prepare('SELECT COUNT(*) c FROM run_reservation WHERE authoritative_run_ref = ?')
      .get('aicontrol_run_token_2') as { c: number }
    expect(row.c).toBe(1) // only the first, successful attempt

    exec.close()
    tmp.cleanup()
  })

  // §8/§9 -- no preparation before a SUCCESSFUL fence; response-loss retry
  // converges on the same token without a second protocol identity.
  it('fence rejection/conflict produces zero reservation, zero preparation signal', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedIneligible('aicontrol_run_reject_1')
    const deps = {
      reservations: exec.reservations,
      fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }

    await expect(
      establishDelegatedCutoverReservation(deps, {
        correlationId: 'corr_reject_1',
        aicontrolRunId: 'aicontrol_run_reject_1',
        fenceToken: 'token_reject_1',
        workloadId: 'workload_reject_1',
        providerEligible: true,
        now: '2026-09-17T00:00:00Z'
      })
    ).rejects.toBeTruthy()

    const row = exec.db.prepare('SELECT COUNT(*) c FROM run_reservation').get() as { c: number }
    expect(row.c).toBe(0)

    exec.close()
    tmp.cleanup()
  })

  it('response-loss then same-token retry converges idempotently to exactly one reservation', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedEligible('aicontrol_run_loss_1')
    const deps = {
      reservations: exec.reservations,
      fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }
    const input = {
      correlationId: 'corr_loss_1',
      aicontrolRunId: 'aicontrol_run_loss_1',
      fenceToken: 'token_loss_1',
      workloadId: 'workload_loss_1',
      providerEligible: true,
      now: '2026-09-17T00:00:00Z'
    }

    // aiControl durably accepted the fence; the caller's own view of the
    // response was lost (modeled as calling the step again with the SAME
    // token/correlationId -- the caller does not know acquisition already
    // durably succeeded).
    await establishDelegatedCutoverReservation(deps, input)
    await establishDelegatedCutoverReservation(deps, input)
    await establishDelegatedCutoverReservation(deps, input)

    const row = exec.db
      .prepare('SELECT COUNT(*) c FROM run_reservation WHERE correlation_id = ?')
      .get('corr_loss_1') as { c: number }
    expect(row.c).toBe(1) // no duplicate delegated protocol identity

    exec.close()
    tmp.cleanup()
  })

  // §10 -- S5 run_reservation: created only after fence success, distinct
  // slice_ref, FK/identity anchor only.
  it('a successful fence acquisition establishes exactly one run_reservation, under the distinct S5 slice_ref', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedEligible('aicontrol_run_res_1')
    const deps = {
      reservations: exec.reservations,
      fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }

    const result = await establishDelegatedCutoverReservation(deps, {
      correlationId: 'corr_res_1',
      aicontrolRunId: 'aicontrol_run_res_1',
      fenceToken: 'token_res_1',
      workloadId: 'workload_res_1',
      providerEligible: true,
      now: '2026-09-17T00:00:00Z'
    })

    expect(result.reservation.sliceRef).toBe(DELEGATED_CUTOVER_CORE_SLICE_REF)
    expect(result.reservation.sliceRef).not.toBe('ORCA-S1') // shadow-observation's own, never reused

    const row = exec.db
      .prepare('SELECT COUNT(*) c FROM run_reservation WHERE slice_ref = ?')
      .get('ORCA-S1') as { c: number }
    expect(row.c).toBe(0) // this flow never writes into the shadow flow's slice

    exec.close()
    tmp.cleanup()
  })

  // §11 -- crash after fence, before reservation: authority stays
  // AICONTROL_NATIVE; resume is legal; nothing durable Maestro-side exists
  // yet to misinterpret.
  it('fence durable, no Maestro reservation yet: resuming the same protocol/token is the only legal action', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedEligible('aicontrol_run_crash11')
    // Model the crash boundary directly: fence already durably ACQUIRED at
    // aiControl, nothing written to Maestro's Execution store yet.
    await fence.acquireOrcaFence({ runId: 'aicontrol_run_crash11', token: 'token_crash11' })

    const before = exec.db.prepare('SELECT COUNT(*) c FROM run_reservation').get() as { c: number }
    expect(before.c).toBe(0)

    // Legal recovery: resume S2 with the SAME token -- the reservation step
    // must accept the fence's ALREADY_FENCED_SAME_TOKEN outcome and proceed,
    // not treat it as a failure requiring a new token.
    const deps = {
      reservations: exec.reservations,
      fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }
    const result = await establishDelegatedCutoverReservation(deps, {
      correlationId: 'corr_crash11',
      aicontrolRunId: 'aicontrol_run_crash11',
      fenceToken: 'token_crash11',
      workloadId: 'workload_crash11',
      providerEligible: true,
      now: '2026-09-17T00:05:00Z'
    })
    expect(result.reservation).toBeDefined()

    exec.close()
    tmp.cleanup()
  })

  // §12 -- crash after reservation, before prepare: reservation alone never
  // authorizes workload; resume the same protocol identity.
  it('reservation durable, process absent: reservation alone never implies ORCA_DELEGATED', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedEligible('aicontrol_run_crash12')
    const deps = {
      reservations: exec.reservations,
      fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }

    const result = await establishDelegatedCutoverReservation(deps, {
      correlationId: 'corr_crash12',
      aicontrolRunId: 'aicontrol_run_crash12',
      fenceToken: 'token_crash12',
      workloadId: 'workload_crash12',
      providerEligible: true,
      now: '2026-09-17T00:00:00Z'
    })

    // Frozen invariant (SPEC.md §16 authority table, round 5 S2 row): the
    // reservation step itself must never claim authority moved.
    expect(result.authority).toBe('AICONTROL_NATIVE')
    expect(exec.db.prepare('SELECT COUNT(*) c FROM dispatch_process_binding').get()).toEqual({
      c: 0
    })
    expect(exec.db.prepare('SELECT COUNT(*) c FROM run_binding').get()).toEqual({ c: 0 })

    exec.close()
    tmp.cleanup()
  })

  // §27 -- cutover must require positive evidence of a MATCHING authoritative
  // fence, never a local in-memory boolean alone. Expressed here at the
  // reservation-step boundary: a request whose token does not match any
  // acquired fence must never establish a reservation.
  it('no acquired fence for this token: zero reservation, request rejected', async () => {
    const { tmp, exec, fence } = setup()
    fence.seedEligible('aicontrol_run_nofence_1')
    // No acquireOrcaFence call at all -- the row stays 'none'.
    const deps = {
      reservations: exec.reservations,
      fence,
      sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
    }

    // A malicious/buggy caller supplying a token that was never actually
    // acquired must still route through the real fence CAS, not trust its
    // own claim.
    fence.acquisitionEnabled = false
    await expect(
      establishDelegatedCutoverReservation(deps, {
        correlationId: 'corr_nofence_1',
        aicontrolRunId: 'aicontrol_run_nofence_1',
        fenceToken: 'unacquired_token',
        workloadId: 'workload_nofence_1',
        providerEligible: true,
        now: '2026-09-17T00:00:00Z'
      })
    ).rejects.toBeTruthy()

    const row = exec.db.prepare('SELECT COUNT(*) c FROM run_reservation').get() as { c: number }
    expect(row.c).toBe(0)

    exec.close()
    tmp.cleanup()
  })
})
