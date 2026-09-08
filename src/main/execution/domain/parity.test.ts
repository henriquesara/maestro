import { describe, expect, it } from 'vitest'
import {
  assertObservationComplete,
  compareOutcomes,
  filesChangedSet,
  ParityObservationError,
  type ExecutionOutcome,
  type ParityObservation,
  type RootCauseAdjudication
} from './parity'

const base: ExecutionOutcome = {
  terminalOutcome: 'completed',
  exitDisposition: 'zero_exit',
  cancellationBehavior: 'not_cancelled',
  filesChanged: []
}

describe('compareOutcomes', () => {
  it('matches on identical outcomes', () => {
    expect(compareOutcomes(base, { ...base }).match).toBe(true)
  })
  it('diverges on files_changed when both sides recorded a set', () => {
    const r = compareOutcomes(
      { ...base, filesChanged: filesChangedSet(['a']) },
      { ...base, filesChanged: filesChangedSet(['a', 'b']) }
    )
    expect(r.match).toBe(false)
    expect(r.divergences.map((d) => d.dimension)).toEqual(['files_changed'])
  })
  it('diverges on cancellation granularity', () => {
    const a = {
      ...base,
      terminalOutcome: 'cancelled' as const,
      cancellationBehavior: 'cancelled_clean' as const,
      exitDisposition: 'no_exit' as const
    }
    const s = { ...a, cancellationBehavior: 'cancelled_mid_flight' as const }
    expect(compareOutcomes(a, s).divergences.map((d) => d.dimension)).toEqual(['cancellation'])
  })
})

// Blocker B9 — a bare label is not adjudication. Every divergence needs an
// `explained` adjudication with evidence; an `unresolved` one fails the gate.
describe('assertObservationComplete (blocker B9)', () => {
  const obs = (
    parity: ParityObservation['parity'],
    adjudications: RootCauseAdjudication[]
  ): ParityObservation => ({
    id: 'p1',
    runBindingDispatchId: 'ctx_1',
    sliceRef: 'ORCA-S1',
    workloadId: 'w',
    authoritative: base,
    shadow: base,
    parity,
    adjudications,
    observedAt: '2026-09-08T00:00:00Z'
  })

  it('passes a matched observation', () => {
    expect(() =>
      assertObservationComplete(obs({ match: true, divergences: [], notComparable: [] }, []))
    ).not.toThrow()
  })

  it('throws when a divergence has an unresolved adjudication', () => {
    expect(() =>
      assertObservationComplete(
        obs(
          {
            match: false,
            divergences: [{ dimension: 'cancellation', authoritative: 'a', shadow: 'b' }],
            notComparable: []
          },
          [
            {
              status: 'unresolved',
              dimension: 'cancellation',
              observedMismatch: 'cancellation: a vs b',
              classifiedCause: null,
              evidence: ['cancellation: a vs b']
            }
          ]
        )
      )
    ).toThrow(ParityObservationError)
  })

  it('throws when a divergence has an explained adjudication but no evidence', () => {
    expect(() =>
      assertObservationComplete(
        obs(
          {
            match: false,
            divergences: [{ dimension: 'files_changed', authoritative: 'a', shadow: 'b' }],
            notComparable: []
          },
          [
            {
              status: 'explained',
              dimension: 'files_changed',
              observedMismatch: 'x',
              classifiedCause: 'some_cause',
              evidence: []
            }
          ]
        )
      )
    ).toThrow(ParityObservationError)
  })

  it('passes when every divergence is explained with evidence', () => {
    expect(() =>
      assertObservationComplete(
        obs(
          {
            match: false,
            divergences: [{ dimension: 'files_changed', authoritative: 'a', shadow: 'b' }],
            notComparable: []
          },
          [
            {
              status: 'explained',
              dimension: 'files_changed',
              observedMismatch: 'x',
              classifiedCause: 'shadow_input_worktree_divergence',
              evidence: ['shadow input carried src/extra.txt']
            }
          ]
        )
      )
    ).not.toThrow()
  })
})
