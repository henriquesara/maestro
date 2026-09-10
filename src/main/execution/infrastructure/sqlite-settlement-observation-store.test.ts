import { describe, expect, it, afterEach } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from './execution-schema'
import { SqliteSettlementObservationStore } from './sqlite-settlement-observation-store'
import { buildProvenance, type SettlementObservationRecord } from '../domain/settlement-observation'
import type { DurableSettlementSnapshot } from '../domain/durable-settlement-snapshot'

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
    sourceDbPath: '/tmp/x.db'
  }),
  firstSeenAt: '2026-09-10T00:00:02.000Z',
  observedAt: '2026-09-10T00:00:02.000Z',
  conflictedAt: null,
  ...over
})

describe('SqliteSettlementObservationStore (§12, §21, I-S2-2)', () => {
  let db: SyncDatabase | undefined
  afterEach(() => {
    db?.close()
    db = undefined
  })
  function store() {
    db = new SyncDatabase(':memory:')
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return new SqliteSettlementObservationStore(db)
  }

  it('inserts and round-trips a record verbatim, including provenance_json', () => {
    const s = store()
    expect(s.insert(record())).toEqual({ inserted: true })
    expect(s.getByCorrelation('corr_1')).toEqual(record())
  })

  it('is write-once per correlation_id — a second insert is a no-op, not an error', () => {
    const s = store()
    s.insert(record())
    const collide = s.insert(
      record({ sourceDigest: 'b'.repeat(64), observedOutcomeJson: '{"tampered":true}' })
    )
    expect(collide).toEqual({ inserted: false })
    expect(s.getByCorrelation('corr_1')).toEqual(record()) // original unchanged
  })

  it('markConflicted is the ONLY permitted mutation: observed → observed_conflicted + conflicted_at', () => {
    const s = store()
    s.insert(record())
    s.markConflicted('corr_1', '2026-09-10T01:00:00.000Z')
    const row = s.getByCorrelation('corr_1')!
    expect(row.status).toBe('observed_conflicted')
    expect(row.conflictedAt).toBe('2026-09-10T01:00:00.000Z')
    // every source_* column + json bodies untouched
    expect(row.sourceDigest).toBe('a'.repeat(64))
    expect(row.sourceDispatchStatus).toBe('completed')
    expect(row.observedOutcomeJson).toBe(record().observedOutcomeJson)
    expect(row.provenanceJson).toBe(record().provenanceJson)
  })

  it('markConflicted on an already-conflicted row does not move conflicted_at', () => {
    const s = store()
    s.insert(record())
    s.markConflicted('corr_1', '2026-09-10T01:00:00.000Z')
    s.markConflicted('corr_1', '2026-09-10T09:00:00.000Z')
    expect(s.getByCorrelation('corr_1')!.conflictedAt).toBe('2026-09-10T01:00:00.000Z')
  })

  it('lists by slice', () => {
    const s = store()
    s.insert(record())
    s.insert(record({ correlationId: 'corr_2', orcaDispatchId: 'ctx_2', sliceRef: 'OTHER' }))
    expect(s.listBySlice('ORCA-S2').map((r) => r.correlationId)).toEqual(['corr_1'])
  })

  it('exposes no method that rewrites a source_* column', () => {
    const s = store()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(s))
    expect(methods).not.toContain('update')
    expect(methods).not.toContain('setSourceDigest')
  })
})
