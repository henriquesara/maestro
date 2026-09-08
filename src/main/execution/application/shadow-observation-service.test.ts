import { afterEach, describe, expect, it, vi } from 'vitest'
import { runShadowObservation, type ShadowObservationInput } from './shadow-observation-service'
import { SqliteExecutionStore } from '../infrastructure/sqlite-execution-store'
import { migrateExecutionStore } from '../infrastructure/execution-schema'
import {
  fakePlane,
  fakeSource,
  FROZEN_SAMPLE_REQUEST,
  outcome,
  syntheticWorkload
} from '../slices/shadow-identity-observation/shadow-observation.test-support'
import type { SampleEntry } from './authoritative-run-source'

describe('runShadowObservation — I2 (no plane call for ineligible) + I5 (crash isolation)', () => {
  let store: SqliteExecutionStore | undefined
  afterEach(() => {
    store?.close()
    store = undefined
  })

  function openStore(): SqliteExecutionStore {
    const s = new SqliteExecutionStore(':memory:')
    migrateExecutionStore(s.database)
    return s
  }

  function input(): ShadowObservationInput {
    let n = 0
    return {
      sliceRef: 'ORCA-S1',
      request: FROZEN_SAMPLE_REQUEST,
      worktreeRoot: '/tmp/does-not-need-to-exist',
      makeWorktreeDir: (runId) => `/tmp/wt/${runId}`,
      now: () => '2026-09-08T00:00:00Z',
      newId: (prefix) => `${prefix}_${++n}`
    }
  }

  const recordEntries: SampleEntry[] = FROZEN_SAMPLE_REQUEST.slots.map((slot, i) => ({
    kind: 'record',
    profile: slot.profile,
    record: {
      aicontrolRunId: `run_${i}`,
      agentId: `agent-${slot.profile}`,
      recordedOutcome: outcome({
        terminalOutcome:
          slot.status === 'completed' ? 'completed' : slot.status === 'failed' ? 'failed' : 'cancelled'
      }),
      descriptor: slot.descriptor,
      workload: slot.workload
    }
  }))

  it('an ineligible workload never reaches the ExecutionPlane (I2)', async () => {
    store = openStore()
    const plane = fakePlane()
    const ineligible: SampleEntry = {
      kind: 'record',
      profile: 'X',
      record: {
        aicontrolRunId: 'run_x',
        agentId: 'agent-X',
        recordedOutcome: outcome({}),
        descriptor: {
          id: 'danger',
          kind: 'external_effect',
          declaredCapabilities: ['mutating_external_api']
        },
        workload: syntheticWorkload('danger', [{ op: 'write', path: 'x', content: '1' }])
      }
    }
    await runShadowObservation({ source: fakeSource([ineligible]), plane, store }, input())
    expect(plane.openShadowRun).not.toHaveBeenCalled()
    expect(store.listExclusions('ORCA-S1').length).toBe(1)
  })

  it('contains a plane failure: resolves with the run abandoned, does not reject (I5)', async () => {
    store = openStore()
    const plane = fakePlane({
      runShadowWorkload: vi.fn(async () => {
        throw new Error('boom in shadow adapter')
      })
    })
    const report = await runShadowObservation(
      { source: fakeSource([recordEntries[0]]), plane, store },
      input()
    )
    expect(report.abandoned.length).toBeGreaterThan(0)
    expect(plane.abandonShadow).toHaveBeenCalled()
  })

  it('a mismatched ParityObservation carries a non-empty root cause (I7)', async () => {
    store = openStore()
    const plane = fakePlane({
      settleShadow: vi.fn(async () => ({
        candidateHead: 'cand',
        // diverges from the recorded `completed` outcome
        outcome: outcome({ terminalOutcome: 'failed', exitDisposition: 'non_zero_exit' })
      }))
    })
    const report = await runShadowObservation(
      { source: fakeSource([recordEntries[0]]), plane, store },
      input()
    )
    const obs = report.observations[0]
    expect(obs.parity.match).toBe(false)
    expect(obs.rootCause && obs.rootCause.length > 0).toBe(true)
  })
})
