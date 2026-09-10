import { describe, expect, it } from 'vitest'
import type { DurableSettlementSnapshot } from './durable-settlement-snapshot'
import {
  settlementObservedOutcome,
  SettlementOutcomeUnresolvableError
} from './settlement-observed-outcome'

const snap = (over: Partial<DurableSettlementSnapshot>): DurableSettlementSnapshot => ({
  correlationId: 'corr_1',
  orgTaskId: 'task_1',
  orcaRunId: 'run_1',
  orcaDispatchId: 'ctx_1',
  dispatchStatus: 'completed',
  dispatchCompletedAt: '2026-09-10T00:00:00.000Z',
  taskStatus: 'completed',
  taskCompletedAt: '2026-09-10T00:00:01.000Z',
  taskResultCanonical: { exitCode: 0 },
  attemptFactsCanonical: [],
  ...over
})

describe('settlementObservedOutcome (§6.2 — source-only derivation)', () => {
  it('completed dispatch + completed task + exitCode 0 → completed / zero_exit / not_cancelled', () => {
    expect(settlementObservedOutcome(snap({}))).toEqual({
      terminalOutcome: 'completed',
      exitDisposition: 'zero_exit',
      cancellation: 'not_cancelled'
    })
  })

  it('exitCode positive integer → non_zero_exit and terminalOutcome failed on status disagreement', () => {
    expect(
      settlementObservedOutcome(
        snap({
          taskStatus: 'failed',
          dispatchStatus: 'failed',
          taskResultCanonical: { exitCode: 2 }
        })
      )
    ).toEqual({
      terminalOutcome: 'failed',
      exitDisposition: 'non_zero_exit',
      cancellation: 'not_cancelled'
    })
  })

  it('circuit_broken dispatch → failed', () => {
    expect(
      settlementObservedOutcome(
        snap({ dispatchStatus: 'circuit_broken', taskStatus: 'failed', taskResultCanonical: null })
      ).terminalOutcome
    ).toBe('failed')
  })

  it('a cancelled marker (cancelled === true) → cancelled / no_exit / cancelled, overriding status', () => {
    expect(
      settlementObservedOutcome(snap({ taskResultCanonical: { cancelled: true, exitCode: 0 } }))
    ).toEqual({
      terminalOutcome: 'cancelled',
      exitDisposition: 'no_exit',
      cancellation: 'cancelled'
    })
  })

  it('null tasks.result on a completed/completed dispatch → completed / no_exit', () => {
    expect(settlementObservedOutcome(snap({ taskResultCanonical: null }))).toEqual({
      terminalOutcome: 'completed',
      exitDisposition: 'no_exit',
      cancellation: 'not_cancelled'
    })
  })

  it('exitCode absent from an object body → no_exit', () => {
    expect(
      settlementObservedOutcome(snap({ taskResultCanonical: { provenance: 'x' } })).exitDisposition
    ).toBe('no_exit')
  })

  it('throws SettlementOutcomeUnresolvableError when the result body is a non-object (structurally wrong)', () => {
    expect(() => settlementObservedOutcome(snap({ taskResultCanonical: 'done' }))).toThrow(
      SettlementOutcomeUnresolvableError
    )
  })

  it('throws when exitCode is present but not a non-negative integer', () => {
    expect(() =>
      settlementObservedOutcome(snap({ taskResultCanonical: { exitCode: -1 } }))
    ).toThrow(SettlementOutcomeUnresolvableError)
    expect(() =>
      settlementObservedOutcome(snap({ taskResultCanonical: { exitCode: 'x' } }))
    ).toThrow(SettlementOutcomeUnresolvableError)
  })

  it('never invents finer cancellation granularity (no cancelled_clean / cancelled_mid_flight)', () => {
    const out = settlementObservedOutcome(snap({ taskResultCanonical: { cancelled: true } }))
    expect(Object.values(out)).not.toContain('cancelled_mid_flight')
    expect(Object.values(out)).not.toContain('cancelled_clean')
  })
})
