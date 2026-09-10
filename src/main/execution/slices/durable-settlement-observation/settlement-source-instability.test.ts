import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { finalizeShadowWriterJournal } from '../../infrastructure/shadow-orchestration-journal'
import type {
  DurableSettlementRead,
  DurableSettlementReadInput,
  DurableSettlementSource
} from '../../application/durable-settlement-source'
import {
  converge,
  makeS2TmpDir,
  openS2Stores,
  recordBoundReservation,
  S2_SLICE,
  seedShadowSettlements
} from './settlement-test-harness'

// ORCA-S2 §16.3 / attack 3a — a source snapshot that keeps changing across the
// bounded re-verify window yields SOURCE_UNSTABLE_RETRYABLE with NO
// settlement_incident, NO observation mutation, the binding NOT blocked, and the
// result surfaced in the report. A Phase A binding NEVER produces
// source_snapshot_changed.

/** Wraps a real read-only source and mutates the durable facts before every read. */
class MutatingSource implements DurableSettlementSource {
  private tick = 0
  constructor(
    private readonly inner: ReadOnlyShadowSettlementSource,
    private readonly shadowPath: string,
    private readonly runId: string
  ) {}
  readSettlement(input: DurableSettlementReadInput): DurableSettlementRead {
    this.tick += 1
    const rw = new SyncDatabase(this.shadowPath)
    rw.prepare('UPDATE tasks SET completed_at = ? WHERE run_id = ?').run(
      `2026-09-10T00:00:${String(this.tick % 60).padStart(2, '0')}.${String(this.tick).padStart(3, '0')}Z`,
      this.runId
    )
    rw.close()
    // The inner read-only handle picks up the just-committed change on its next query.
    return this.inner.readSettlement(input)
  }
  sourceGuard() {
    return this.inner.sourceGuard()
  }
}

describe('settlement-source-instability — SOURCE_UNSTABLE_RETRYABLE (§16.3, attack 3a)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  it('a source that never stabilises across the bounded budget → retryable, no incident, no observation, not blocked', () => {
    const root = makeS2TmpDir('orca-s2-unstable-')
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const [seeded] = seedShadowSettlements(shadowPath, [
      {
        correlationId: 'corr_1',
        outcome: 'succeeded',
        result: { provenance: 'orca_s1_shadow', exitCode: 0 }
      }
    ])
    const ctx = openS2Stores()
    cleanups.push(ctx.close)
    recordBoundReservation(ctx, seeded, 'settled')

    const inner = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => inner.close())
    const unstable = new MutatingSource(inner, shadowPath, seeded.runId)

    const report = converge(
      { ...ctx, store: ctx.store },
      unstable as unknown as ReadOnlyShadowSettlementSource,
      shadowPath
    )

    expect(report.retryable).toEqual([
      {
        correlationId: 'corr_1',
        phase: 'A',
        reason: 'SOURCE_UNSTABLE_RETRYABLE',
        attempts: expect.any(Number)
      }
    ])
    expect(report.incidents).toHaveLength(0)
    expect(ctx.observations.listBySlice(S2_SLICE)).toHaveLength(0)
    expect(ctx.incidents.listBySlice(S2_SLICE)).toHaveLength(0)
    // binding not blocked → a later STABLE sweep converges it
    finalizeShadowWriterJournal(shadowPath)
    const stable = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => stable.close())
    const r2 = converge(ctx, stable, shadowPath, { n: 99 })
    expect(r2.observed).toHaveLength(1)
    expect(ctx.observations.getByCorrelation('corr_1')!.status).toBe('observed')
  })

  it('a Phase A binding NEVER produces a source_snapshot_changed incident from instability', () => {
    const root = makeS2TmpDir('orca-s2-unstable-A-')
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const [seeded] = seedShadowSettlements(shadowPath, [
      { correlationId: 'corr_1', outcome: 'succeeded', result: { exitCode: 0 } }
    ])
    const ctx = openS2Stores()
    cleanups.push(ctx.close)
    recordBoundReservation(ctx, seeded, 'settled')
    const inner = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => inner.close())
    const unstable = new MutatingSource(inner, shadowPath, seeded.runId)

    const report = converge(ctx, unstable as unknown as ReadOnlyShadowSettlementSource, shadowPath)
    expect(report.incidents.some((i) => i.kind === 'source_snapshot_changed')).toBe(false)
    expect(ctx.incidents.listBySlice(S2_SLICE)).toHaveLength(0)
  })
})
