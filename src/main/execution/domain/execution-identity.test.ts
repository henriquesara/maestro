import { describe, expect, it } from 'vitest'
import {
  assertBoundDispatch,
  makeCorrelationId,
  makeOrcaDispatchRef,
  RunBindingError
} from './execution-identity'
import { fixtureBinding } from '../slices/shadow-identity-observation/shadow-observation.test-support'

// I4 — a settlement / association may only use the bound Dispatch ref.
describe('run binding dispatch identity (amendment §L)', () => {
  it('rejects a Dispatch ref that is not the bound one', () => {
    const binding = fixtureBinding({ orcaDispatchId: makeOrcaDispatchRef('ctx_A') })
    let thrown: unknown
    try {
      assertBoundDispatch(binding, makeOrcaDispatchRef('ctx_B'))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(RunBindingError)
    expect((thrown as RunBindingError).code).toBe('dispatch_mismatch')
  })

  it('accepts the bound Dispatch ref', () => {
    const ref = makeOrcaDispatchRef('ctx_A')
    expect(() => assertBoundDispatch(fixtureBinding({ orcaDispatchId: ref }), ref)).not.toThrow()
  })

  it('rejects an empty ref at construction', () => {
    expect(() => makeOrcaDispatchRef('')).toThrow(RunBindingError)
    expect(() => makeCorrelationId('')).toThrow(RunBindingError)
  })
})
