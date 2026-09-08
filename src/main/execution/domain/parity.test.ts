import { describe, expect, it } from 'vitest'
import {
  assertObservationComplete,
  compareOutcomes,
  filesChangedSet,
  ParityObservationError,
  type ExecutionOutcome,
  type ParityObservation
} from './parity'

const base: ExecutionOutcome = {
  terminalOutcome: 'completed',
  exitDisposition: 'zero_exit',
  cancellationBehavior: 'not_cancelled',
  filesChanged: null
}

describe('compareOutcomes (amendment §S gate 8)', () => {
  it('matches when the three recorded dimensions agree and files were not recorded', () => {
    const r = compareOutcomes(base, { ...base, filesChanged: filesChangedSet(['a', 'b']) })
    expect(r.match).toBe(true)
    expect(r.divergences).toEqual([])
    expect(r.notComparable).toEqual(['files_changed'])
  })

  it('diverges on terminal outcome + exit disposition', () => {
    const r = compareOutcomes(base, {
      ...base,
      terminalOutcome: 'failed',
      exitDisposition: 'non_zero_exit'
    })
    expect(r.match).toBe(false)
    expect(r.divergences.map((d) => d.dimension).sort()).toEqual([
      'exit_disposition',
      'terminal_outcome'
    ])
  })

  it('diverges on cancellation granularity', () => {
    const auth = {
      ...base,
      terminalOutcome: 'cancelled' as const,
      cancellationBehavior: 'cancelled_clean' as const,
      exitDisposition: 'no_exit' as const
    }
    const shadow = { ...auth, cancellationBehavior: 'cancelled_mid_flight' as const }
    const r = compareOutcomes(auth, shadow)
    expect(r.divergences.map((d) => d.dimension)).toEqual(['cancellation'])
  })

  it('compares files-changed only when the authoritative side recorded it', () => {
    const auth = { ...base, filesChanged: filesChangedSet(['x', 'y']) }
    const same = compareOutcomes(auth, { ...base, filesChanged: filesChangedSet(['y', 'x']) })
    expect(same.match).toBe(true)
    const diff = compareOutcomes(auth, { ...base, filesChanged: filesChangedSet(['x', 'z']) })
    expect(diff.match).toBe(false)
    expect(diff.divergences.map((d) => d.dimension)).toEqual(['files_changed'])
    expect(diff.notComparable).toEqual([])
  })
})

describe('assertObservationComplete (I7)', () => {
  const obs = (over: Partial<ParityObservation>): ParityObservation => ({
    id: 'p1',
    runBindingDispatchId: 'ctx_1',
    sliceRef: 'ORCA-S1',
    authoritative: base,
    shadow: base,
    parity: { match: true, divergences: [], notComparable: [] },
    rootCause: null,
    observedAt: '2026-09-08T00:00:00Z',
    ...over
  })

  it('passes a matched observation with no root cause', () => {
    expect(() => assertObservationComplete(obs({}))).not.toThrow()
  })

  it('rejects a mismatched observation with an empty root cause', () => {
    expect(() =>
      assertObservationComplete(
        obs({
          parity: {
            match: false,
            divergences: [{ dimension: 'cancellation', authoritative: 'a', shadow: 'b' }],
            notComparable: []
          },
          rootCause: '   '
        })
      )
    ).toThrow(ParityObservationError)
  })

  it('passes a mismatched observation once it is root-caused', () => {
    expect(() =>
      assertObservationComplete(
        obs({
          parity: {
            match: false,
            divergences: [{ dimension: 'cancellation', authoritative: 'a', shadow: 'b' }],
            notComparable: []
          },
          rootCause: 'authoritative_cancellation_granularity_not_recorded'
        })
      )
    ).not.toThrow()
  })
})
