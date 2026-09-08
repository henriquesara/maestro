import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adjudicate, runShadowObservation } from '../../application/shadow-observation-service'
import {
  assertObservationComplete,
  compareOutcomes,
  type ParityObservation
} from '../../domain/parity'
import type { WorkloadSpec } from '../../domain/workload-spec'
import {
  fakeAuthoritativeExecutor,
  fakePlane,
  makeTmpDir,
  openExecStores,
  outcome
} from './shadow-observation.test-support'

// ─────────────────────────────────────────────────────────────────────────────
// ROOT-CAUSE MECHANISM TEST — SPEC-AMENDMENT-002 §7.
//
// These cases DELIBERATELY INDUCE a mismatch to prove the rejection path:
//   unexpected divergence -> RootCauseAdjudication 'unresolved' -> the run is
//   contained as `abandoned` and NEVER recorded as a parity observation.
//
// The induced mismatches here are NOT observed aiControl<->Orca parity evidence.
// The real parity acceptance sample is a separate file
// (shadow-identity-observation.acceptance.test.ts) and injects nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe('ROOT-CAUSE MECHANISM (induced) — an unexplained divergence is rejected', () => {
  const exitWorkload = (id: string, code: number): WorkloadSpec => ({
    id,
    steps: [{ op: 'exit', code }]
  })

  it('adjudicate leaves an induced terminal_outcome divergence UNRESOLVED', () => {
    const authoritative = outcome({ terminalOutcome: 'failed', exitDisposition: 'non_zero_exit' })
    const shadow = outcome({ terminalOutcome: 'completed', exitDisposition: 'zero_exit' })
    const parity = compareOutcomes(authoritative, shadow)
    expect(parity.match).toBe(false)

    const adjs = adjudicate(parity, exitWorkload('induced', 0), authoritative, {
      cancellationBehavior: shadow.cancellationBehavior,
      filesChanged: shadow.filesChanged
    })
    expect(adjs.length).toBeGreaterThan(0)
    expect(adjs.every((a) => a.status === 'unresolved')).toBe(true)
    expect(adjs.every((a) => a.classifiedCause === null)).toBe(true)
  })

  it('assertObservationComplete THROWS on an unresolved adjudication', () => {
    const authoritative = outcome({ terminalOutcome: 'failed', exitDisposition: 'non_zero_exit' })
    const shadow = outcome()
    const parity = compareOutcomes(authoritative, shadow)
    const observation: ParityObservation = {
      id: 'induced_obs',
      runBindingDispatchId: 'ctx_induced',
      sliceRef: 'ORCA-S1',
      workloadId: 'induced',
      authoritative,
      shadow,
      parity,
      adjudications: adjudicate(parity, exitWorkload('induced', 0), authoritative, {
        cancellationBehavior: shadow.cancellationBehavior,
        filesChanged: shadow.filesChanged
      }),
      observedAt: 'now'
    }
    expect(() => assertObservationComplete(observation)).toThrow()
  })

  it('runShadowObservation CONTAINS an induced mismatch as abandoned — never recorded as parity', async () => {
    const ctx = openExecStores()
    const root = makeTmpDir('orca-s1-adversarial-')
    try {
      const report = await runShadowObservation(
        {
          // authoritative says failed; the fake plane settles as completed -> mismatch
          authoritativeExecutor: fakeAuthoritativeExecutor(() =>
            outcome({ terminalOutcome: 'failed', exitDisposition: 'non_zero_exit' })
          ),
          plane: fakePlane(),
          store: ctx.store,
          reservations: ctx.reservations
        },
        {
          sliceRef: 'ORCA-S1',
          slots: [
            {
              profile: 'induced-profile',
              authoritativeRunRef: 'induced_run_1',
              descriptor: { id: 'induced', kind: 'synthetic', declaredCapabilities: [] },
              workload: exitWorkload('induced', 0)
            }
          ],
          shadowRoot: root.dir,
          worktreeDirFor: (k, c) => join(root.dir, `${k}-${c}`),
          now: () => 'now',
          newId: (p) => `${p}_adv`
        }
      )

      expect(report.observations.length).toBe(0) // NOT recorded as parity evidence
      expect(report.abandoned.length).toBe(1)
      expect(ctx.store.listParityObservations('ORCA-S1').length).toBe(0)
      const reservation = ctx.reservations.listAll('ORCA-S1')[0]
      expect(reservation.state).toBe('abandoned')
    } finally {
      ctx.close()
      root.cleanup()
    }
  })
})
