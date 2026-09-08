import { afterEach, describe, expect, it } from 'vitest'
import { SqliteExecutionStore } from './sqlite-execution-store'
import { migrateExecutionStore } from './execution-schema'
import { makeOrcaDispatchRef, RunBindingError } from '../domain/execution-identity'
import { fixtureBinding } from '../slices/shadow-identity-observation/shadow-observation.test-support'

// I3 — run_binding uniqueness: one Dispatch → at most one AgentRun; aicontrol_run_id unique when present.
describe('SqliteExecutionStore binding uniqueness (amendment §L)', () => {
  let store: SqliteExecutionStore | undefined

  afterEach(() => {
    store?.close()
    store = undefined
  })

  function open(): SqliteExecutionStore {
    const s = new SqliteExecutionStore(':memory:')
    migrateExecutionStore(s.database)
    return s
  }

  it('rejects a second binding for the same orca_dispatch_id', () => {
    store = open()
    store.recordBinding(fixtureBinding())
    let thrown: unknown
    try {
      store.recordBinding(fixtureBinding({ aicontrolRunId: null }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(RunBindingError)
    expect((thrown as RunBindingError).code).toBe('duplicate_dispatch')
  })

  it('rejects a second binding for the same non-null aicontrol_run_id', () => {
    store = open()
    store.recordBinding(fixtureBinding())
    let thrown: unknown
    try {
      store.recordBinding(fixtureBinding({ orcaDispatchId: makeOrcaDispatchRef('ctx_2') }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(RunBindingError)
    expect((thrown as RunBindingError).code).toBe('duplicate_aicontrol_run')
  })

  it('allows two bindings that both have a null aicontrol_run_id', () => {
    store = open()
    store.recordBinding(fixtureBinding({ aicontrolRunId: null }))
    expect(() =>
      store!.recordBinding(
        fixtureBinding({ aicontrolRunId: null, orcaDispatchId: makeOrcaDispatchRef('ctx_2') })
      )
    ).not.toThrow()
  })

  it('round-trips a binding by dispatch id', () => {
    store = open()
    const b = fixtureBinding()
    store.recordBinding(b)
    expect(store.getBindingByDispatch(String(b.orcaDispatchId))?.orgTaskId).toBe(b.orgTaskId)
  })
})
