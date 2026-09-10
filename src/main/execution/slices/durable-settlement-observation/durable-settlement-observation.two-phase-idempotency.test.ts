import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { rebuildSettlementProjection } from '../../infrastructure/durable-shadow-orchestration-path'
import { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { finalizeShadowWriterJournal } from '../../infrastructure/shadow-orchestration-journal'
import {
  converge,
  makeS2TmpDir,
  openS2Stores,
  recordBoundReservation,
  S2_SLICE,
  seedShadowSettlements
} from './settlement-test-harness'

// ORCA-S2 acceptance criteria 8 & 9 — two-phase idempotency; digest change → conflict, not replacement.

const SEMANTIC_OBS_KEYS = [
  'sourceDigest',
  'orcaDispatchId',
  'orcaRunId',
  'orgTaskId',
  'observedOutcomeJson',
  'provenanceJson',
  'status'
] as const

describe('durable-settlement-observation — two-phase idempotency (criteria 8, 9)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  function setup(prefix: string) {
    const root = makeS2TmpDir(prefix)
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const seeded = seedShadowSettlements(shadowPath, [
      {
        correlationId: 'corr_1',
        outcome: 'succeeded',
        result: { provenance: 'orca_s1_shadow', exitCode: 0 }
      },
      {
        correlationId: 'corr_2',
        outcome: 'failed',
        result: { provenance: 'orca_s1_shadow', exitCode: 3 }
      }
    ])
    const ctx = openS2Stores()
    cleanups.push(ctx.close)
    for (const s of seeded) {
      recordBoundReservation(ctx, s, 'settled')
    }
    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source.close())
    return { ctx, source, shadowPath, root }
  }

  it('converge ×3 back-to-back → one observation per binding, zero duplicate rows, zero extra incidents', () => {
    const { ctx, source, shadowPath } = setup('orca-s2-idem-')
    const seq = { n: 0 }
    const r1 = converge(ctx, source, shadowPath, seq)
    const r2 = converge(ctx, source, shadowPath, seq)
    const r3 = converge(ctx, source, shadowPath, seq)

    expect(r1.observed).toHaveLength(2)
    expect(r2.observed).toHaveLength(0)
    expect(r2.scannedPhaseB).toBe(2)
    expect(r2.noop).toBe(2)
    expect(r3.noop).toBe(2)
    expect(ctx.observations.listBySlice(S2_SLICE)).toHaveLength(2)
    expect(ctx.incidents.listBySlice(S2_SLICE)).toHaveLength(0)
  })

  it('a settlement-projection rebuild + re-run reproduces SEMANTICALLY equivalent observations (I-S2-3)', () => {
    const { ctx, source, shadowPath } = setup('orca-s2-rebuild-')
    converge(ctx, source, shadowPath, { n: 0 })
    const before = ctx.observations.listBySlice(S2_SLICE)

    rebuildSettlementProjection(ctx.db)
    expect(ctx.observations.listBySlice(S2_SLICE)).toHaveLength(0)

    converge(ctx, source, shadowPath, { n: 100 })
    const after = ctx.observations.listBySlice(S2_SLICE)

    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i += 1) {
      for (const k of SEMANTIC_OBS_KEYS) {
        expect(after[i][k]).toBe(before[i][k])
      }
      // local metadata is EXCLUDED from replay equivalence — and here it legitimately differs
      expect(after[i].observedAt).not.toBe(before[i].observedAt)
    }
  })

  it('a digest change on an already-observed binding → exactly one source_snapshot_changed incident, source columns BYTE-unchanged (criterion 9)', () => {
    const { ctx, source, shadowPath } = setup('orca-s2-conflict-')
    converge(ctx, source, shadowPath, { n: 0 })
    const before = ctx.observations.getByCorrelation('corr_1')!
    source.close()
    cleanups.pop() // drop the stale close

    // Mutate the durable terminal facts, then re-open a fresh read-only source.
    const rw = new SyncDatabase(shadowPath)
    rw.prepare('UPDATE tasks SET result = ? WHERE run_id = ?').run(
      JSON.stringify({ provenance: 'orca_s1_shadow', exitCode: 0, mutated: true }),
      before.orcaRunId
    )
    rw.close()
    finalizeShadowWriterJournal(shadowPath)
    const source2 = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source2.close())

    const report = converge(ctx, source2, shadowPath, { n: 50 })
    expect(report.conflicted.map((c) => c.correlationId)).toEqual(['corr_1'])

    const incidents = ctx.incidents
      .listBySlice(S2_SLICE)
      .filter((i) => i.correlationId === 'corr_1')
    expect(incidents).toHaveLength(1)
    expect(incidents[0].kind).toBe('source_snapshot_changed')

    const after = ctx.observations.getByCorrelation('corr_1')!
    expect(after.status).toBe('observed_conflicted')
    expect(after.conflictedAt).not.toBeNull()
    for (const k of [
      'sourceDigest',
      'sourceDispatchStatus',
      'sourceDispatchCompletedAt',
      'sourceTaskStatus',
      'sourceTaskCompletedAt',
      'observedOutcomeJson',
      'provenanceJson'
    ] as const) {
      expect(after[k]).toBe(before[k])
    }
    // a further pass re-detects the same evidence → no new incident row
    const again = converge(ctx, source2, shadowPath, { n: 80 })
    expect(again.conflicted).toHaveLength(0)
    expect(
      ctx.incidents.listBySlice(S2_SLICE).filter((i) => i.correlationId === 'corr_1')
    ).toHaveLength(1)
  })
})
