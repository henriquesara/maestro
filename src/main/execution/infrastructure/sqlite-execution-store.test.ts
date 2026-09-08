import { afterEach, describe, expect, it } from 'vitest'
import {
  makeAiControlRunRef,
  makeCorrelationId,
  makeOrcaDispatchRef,
  RunBindingError
} from '../domain/execution-identity'
import {
  fixtureBinding,
  openExecStores
} from '../slices/shadow-identity-observation/shadow-observation.test-support'

// I3 — run_binding uniqueness. correlation_id is also unique (amendment 001 §5).
describe('SqliteExecutionStore binding uniqueness', () => {
  let ctx: ReturnType<typeof openExecStores> | undefined
  afterEach(() => {
    ctx?.close()
    ctx = undefined
  })

  it('rejects a second binding for the same orca_dispatch_id', () => {
    ctx = openExecStores()
    // a reservation row is required (FK from run_binding.correlation_id)
    ctx.reservations.reserve({
      correlationId: makeCorrelationId('corr_1'),
      sliceRef: 'ORCA-S1',
      authoritativeRunRef: null,
      workloadId: 'w1',
      now: 'now'
    })
    ctx.store.recordBinding(fixtureBinding())
    let thrown: unknown
    try {
      ctx.store.recordBinding(fixtureBinding())
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(RunBindingError)
    expect((thrown as RunBindingError).code).toBe('duplicate_dispatch')
  })

  it('rejects a second binding for the same non-null aicontrol_run_id', () => {
    ctx = openExecStores()
    for (const [cid, wid] of [
      ['corr_1', 'w1'],
      ['corr_2', 'w2']
    ] as const) {
      ctx.reservations.reserve({
        correlationId: makeCorrelationId(cid),
        sliceRef: 'ORCA-S1',
        authoritativeRunRef: null,
        workloadId: wid,
        now: 'now'
      })
    }
    ctx.store.recordBinding(fixtureBinding({ aicontrolRunId: makeAiControlRunRef('run_x') }))
    let thrown: unknown
    try {
      ctx.store.recordBinding(
        fixtureBinding({
          correlationId: makeCorrelationId('corr_2'),
          orcaDispatchId: makeOrcaDispatchRef('ctx_2'),
          aicontrolRunId: makeAiControlRunRef('run_x')
        })
      )
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(RunBindingError)
    expect((thrown as RunBindingError).code).toBe('duplicate_aicontrol_run')
  })

  it('round-trips a binding by dispatch id and by correlation id', () => {
    ctx = openExecStores()
    ctx.reservations.reserve({
      correlationId: makeCorrelationId('corr_1'),
      sliceRef: 'ORCA-S1',
      authoritativeRunRef: null,
      workloadId: 'w1',
      now: 'now'
    })
    const b = fixtureBinding()
    ctx.store.recordBinding(b)
    expect(ctx.store.getBindingByDispatch(String(b.orcaDispatchId))?.orgTaskId).toBe(b.orgTaskId)
    expect(ctx.store.getBindingByCorrelation(String(b.correlationId))?.orgTaskId).toBe(b.orgTaskId)
  })
})
