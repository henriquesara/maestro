import { describe, expect, it } from 'vitest'
import { classifyShadowWorkload, type WorkloadDescriptor } from './shadow-safety-policy'

// Blocker B5 — a caller-supplied string is not independent acceptance; actor
// separation is required for any side-effecting workload.
describe('SHADOW_EXECUTION_SAFETY_POLICY hardened (amendment 001 §6)', () => {
  it('auto-admits a synthetic workload with no declared capability', () => {
    expect(
      classifyShadowWorkload({ id: 'w', kind: 'synthetic', declaredCapabilities: [] }).eligible
    ).toBe(true)
  })

  it('auto-admits a repo_local_code_only workload with no declared capability', () => {
    expect(
      classifyShadowWorkload({ id: 'w', kind: 'repo_local_code_only', declaredCapabilities: [] })
        .eligible
    ).toBe(true)
  })

  it('rejects external_effect with no isolation decision', () => {
    const d = classifyShadowWorkload({ id: 'w', kind: 'external_effect', declaredCapabilities: [] })
    expect(d.eligible).toBe(false)
  })

  it('rejects a declared prohibited capability with no isolation decision', () => {
    const d = classifyShadowWorkload({
      id: 'w',
      kind: 'synthetic',
      declaredCapabilities: ['mutating_external_api']
    })
    expect(d.eligible).toBe(false)
    if (!d.eligible) {
      expect(d.code).toBe('prohibited_capability')
    }
  })

  it('rejects acceptedBy "self" — not independent acceptance', () => {
    const d: WorkloadDescriptor = {
      id: 'w',
      kind: 'external_effect',
      declaredCapabilities: ['deploy'],
      isolationDecision: {
        kind: 'dry_run',
        decisionRef: 'DEC-1',
        authoredBy: 'self',
        acceptedBy: 'self',
        note: 'n'
      }
    }
    const decision = classifyShadowWorkload(d)
    expect(decision.eligible).toBe(false)
    if (!decision.eligible) {
      expect(decision.code).toBe('isolation_actor_not_separated')
    }
  })

  it('rejects when authoredBy === acceptedBy (no actor separation)', () => {
    const d = classifyShadowWorkload({
      id: 'w',
      kind: 'external_effect',
      declaredCapabilities: [],
      isolationDecision: {
        kind: 'mocked_endpoint',
        decisionRef: 'DEC-2',
        authoredBy: 'alice',
        acceptedBy: 'alice',
        note: 'n'
      }
    })
    expect(d.eligible).toBe(false)
  })

  it('rejects when decisionRef is empty', () => {
    const d = classifyShadowWorkload({
      id: 'w',
      kind: 'external_effect',
      declaredCapabilities: [],
      isolationDecision: {
        kind: 'mocked_endpoint',
        decisionRef: '',
        authoredBy: 'alice',
        acceptedBy: 'bob',
        note: 'n'
      }
    })
    expect(d.eligible).toBe(false)
  })

  it('admits an external_effect workload only with an actor-separated durable decision', () => {
    const d = classifyShadowWorkload({
      id: 'w',
      kind: 'external_effect',
      declaredCapabilities: ['send_message'],
      isolationDecision: {
        kind: 'mocked_endpoint',
        decisionRef: 'DEC-3',
        authoredBy: 'alice',
        acceptedBy: 'bob',
        note: 'mock only'
      }
    })
    expect(d.eligible).toBe(true)
  })
})
