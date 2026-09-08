import { describe, expect, it } from 'vitest'
import { classifyShadowWorkload, type WorkloadDescriptor } from './shadow-safety-policy'

// I2 — an unsafe workload must be rejected by SHADOW_EXECUTION_SAFETY_POLICY.
describe('SHADOW_EXECUTION_SAFETY_POLICY (amendment §I)', () => {
  it('rejects a workload that can call a mutating external API', () => {
    const d: WorkloadDescriptor = {
      id: 'w1',
      kind: 'external_effect',
      declaredCapabilities: ['mutating_external_api']
    }
    const decision = classifyShadowWorkload(d)
    expect(decision.eligible).toBe(false)
    if (!decision.eligible) expect(decision.code).toBe('prohibited_capability')
  })

  it('rejects a repo_local_code_only workload that still declares a network mutation', () => {
    const decision = classifyShadowWorkload({
      id: 'w2',
      kind: 'repo_local_code_only',
      declaredCapabilities: ['network_mutation']
    })
    expect(decision.eligible).toBe(false)
  })

  it('rejects external_effect without an accepted isolation strategy', () => {
    const decision = classifyShadowWorkload({
      id: 'w3',
      kind: 'external_effect',
      declaredCapabilities: []
    })
    expect(decision.eligible).toBe(false)
    if (!decision.eligible) expect(decision.code).toBe('external_effect_without_isolation')
  })

  it('rejects external_effect whose isolation strategy has no independent acceptance', () => {
    const decision = classifyShadowWorkload({
      id: 'w4',
      kind: 'external_effect',
      declaredCapabilities: ['deploy'],
      isolationStrategy: { kind: 'dry_run', acceptedBy: '', note: 'planned' }
    })
    expect(decision.eligible).toBe(false)
    if (!decision.eligible) expect(decision.code).toBe('isolation_not_accepted')
  })

  it('accepts a synthetic workload with no declared capabilities', () => {
    const decision = classifyShadowWorkload({ id: 'w5', kind: 'synthetic', declaredCapabilities: [] })
    expect(decision.eligible).toBe(true)
  })

  it('accepts a repo_local_code_only workload with no declared capabilities', () => {
    const decision = classifyShadowWorkload({
      id: 'w6',
      kind: 'repo_local_code_only',
      declaredCapabilities: []
    })
    expect(decision.eligible).toBe(true)
  })

  it('accepts an external_effect workload with an accepted isolation strategy', () => {
    const decision = classifyShadowWorkload({
      id: 'w7',
      kind: 'external_effect',
      declaredCapabilities: ['send_message'],
      isolationStrategy: { kind: 'mocked_endpoint', acceptedBy: 'reviewer-x', note: 'mock only' }
    })
    expect(decision.eligible).toBe(true)
  })
})
