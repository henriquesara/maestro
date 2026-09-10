import { describe, expect, it } from 'vitest'
import {
  assertObservationConverged,
  buildProvenance,
  type SettlementObservationRecord
} from './settlement-observation'
import type { DurableSettlementSnapshot } from './durable-settlement-snapshot'

const snapshot: DurableSettlementSnapshot = {
  correlationId: 'corr_1',
  orgTaskId: 'task_1',
  orcaRunId: 'run_1',
  orcaDispatchId: 'ctx_1',
  dispatchStatus: 'completed',
  dispatchCompletedAt: '2026-09-10T00:00:00.000Z',
  taskStatus: 'completed',
  taskCompletedAt: '2026-09-10T00:00:01.000Z',
  taskResultCanonical: { exitCode: 0 },
  attemptFactsCanonical: []
}

const record = (over: Partial<SettlementObservationRecord> = {}): SettlementObservationRecord => ({
  correlationId: 'corr_1',
  orcaDispatchId: 'ctx_1',
  orcaRunId: 'run_1',
  orgTaskId: 'task_1',
  sliceRef: 'ORCA-S2',
  status: 'observed',
  sourceDispatchStatus: 'completed',
  sourceDispatchCompletedAt: '2026-09-10T00:00:00.000Z',
  sourceTaskStatus: 'completed',
  sourceTaskCompletedAt: '2026-09-10T00:00:01.000Z',
  sourceDigest: 'a'.repeat(64),
  observedOutcomeJson: JSON.stringify({
    terminalOutcome: 'completed',
    exitDisposition: 'zero_exit',
    cancellation: 'not_cancelled'
  }),
  provenanceJson: buildProvenance(snapshot, {
    resolvedDispatchId: 'ctx_1',
    resolvedRunId: 'run_1',
    sourceDbPath: '/tmp/shadow-orchestration.db'
  }),
  firstSeenAt: '2026-09-10T00:00:02.000Z',
  observedAt: '2026-09-10T00:00:02.000Z',
  conflictedAt: null,
  ...over
})

describe('buildProvenance (§4 / §12)', () => {
  it('is the full canonical snapshot plus resolved ids and source_db_path', () => {
    const parsed = JSON.parse(
      buildProvenance(snapshot, {
        resolvedDispatchId: 'ctx_1',
        resolvedRunId: 'run_1',
        sourceDbPath: '/x/y.db'
      })
    )
    expect(parsed.snapshot).toEqual(snapshot)
    expect(parsed.resolved_dispatch_id).toBe('ctx_1')
    expect(parsed.resolved_run_id).toBe('run_1')
    expect(parsed.source_db_path).toBe('/x/y.db')
  })
})

describe('assertObservationConverged (§21, P-S2-1, P-S2-2)', () => {
  it('passes a complete, identity-matching observation', () => {
    expect(() => assertObservationConverged(record(), { boundDispatchId: 'ctx_1' })).not.toThrow()
  })

  it('throws when orca_dispatch_id does not equal the bound dispatch (P-S2-1)', () => {
    expect(() =>
      assertObservationConverged(record({ orcaDispatchId: 'ctx_other' }), {
        boundDispatchId: 'ctx_1'
      })
    ).toThrow(/dispatch/i)
  })

  it('throws when provenance_json is empty', () => {
    expect(() =>
      assertObservationConverged(record({ provenanceJson: '' }), { boundDispatchId: 'ctx_1' })
    ).toThrow(/provenance/i)
  })

  it('throws when provenance is missing resolved ids or source_db_path', () => {
    expect(() =>
      assertObservationConverged(record({ provenanceJson: JSON.stringify({ snapshot }) }), {
        boundDispatchId: 'ctx_1'
      })
    ).toThrow(/provenance/i)
  })

  it('throws when provenance resolved_dispatch_id disagrees with the observation dispatch id', () => {
    const bad = buildProvenance(snapshot, {
      resolvedDispatchId: 'ctx_mismatch',
      resolvedRunId: 'run_1',
      sourceDbPath: '/x/y.db'
    })
    expect(() =>
      assertObservationConverged(record({ provenanceJson: bad }), { boundDispatchId: 'ctx_1' })
    ).toThrow(/provenance/i)
  })

  it('throws when observed_outcome_json is not a valid SettlementObservedOutcome', () => {
    expect(() =>
      assertObservationConverged(
        record({ observedOutcomeJson: JSON.stringify({ terminalOutcome: 'weird' }) }),
        { boundDispatchId: 'ctx_1' }
      )
    ).toThrow(/outcome/i)
  })
})
