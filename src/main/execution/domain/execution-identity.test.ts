import { describe, expect, it } from 'vitest'
import { assertBoundDispatch, makeOrcaDispatchRef, RunBindingError } from './execution-identity'
import { fixtureBinding } from '../slices/shadow-identity-observation/shadow-observation.test-support'

// I4 — an AgentRun cannot be settled / associated through a wrong or stale Dispatch ref.
describe('run binding dispatch identity (amendment §L)', () => {
  it('rejects a Dispatch ref that is not the bound one', () => {
    const binding = fixtureBinding({ orcaDispatchId: makeOrcaDispatchRef('ctx_A') })
    expect(() => assertBoundDispatch(binding, makeOrcaDispatchRef('ctx_B'))).toThrow(
      RunBindingError
    )
    try {
      assertBoundDispatch(binding, makeOrcaDispatchRef('ctx_B'))
    } catch (error) {
      expect((error as RunBindingError).code).toBe('dispatch_mismatch')
    }
  })

  it('accepts the bound Dispatch ref', () => {
    const ref = makeOrcaDispatchRef('ctx_A')
    const binding = fixtureBinding({ orcaDispatchId: ref })
    expect(() => assertBoundDispatch(binding, ref)).not.toThrow()
  })

  it('rejects an empty ref at construction', () => {
    expect(() => makeOrcaDispatchRef('')).toThrow(RunBindingError)
  })
})
