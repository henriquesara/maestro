import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { finalizeShadowWriterJournal } from '../../infrastructure/shadow-orchestration-journal'
import { ExecutionStoreBusyError } from '../../infrastructure/with-immediate-transaction'
import { convergeSettlements } from '../../application/converge-settlements'
import {
  converge,
  makeS2TmpDir,
  openS2Stores,
  recordBoundReservation,
  S2_SLICE,
  seedShadowSettlements
} from './settlement-test-harness'

// ORCA-S2 acceptance criterion 12 — INCIDENT, NOT INVENTION. Adversarial tests
// induce each incident kind; each is recorded, keyed (correlation_id, kind,
// evidence_digest), blocks its binding, is NEVER auto-resolved, and a later
// differing evidence snapshot produces a NEW row rather than overwriting. The
// negative: transient instability / SQLITE_BUSY / txn-acquisition failure each
// produce a RETRYABLE result and NO settlement_incident row.
//
// These are ADVERSARIAL fixtures — never presented as observed parity evidence.

describe('settlement-incident — adversarial (criterion 12, §13)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  function setup(prefix: string, entry: Parameters<typeof seedShadowSettlements>[1][number]) {
    const root = makeS2TmpDir(prefix)
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const [seeded] = seedShadowSettlements(shadowPath, [entry])
    const ctx = openS2Stores()
    cleanups.push(ctx.close)
    recordBoundReservation(ctx, seeded, 'settled')
    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source.close())
    return { ctx, source, shadowPath, seeded, root }
  }

  it('foreign_dispatch — a newer dispatch for the task makes the bound one non-latest → incident, no observation, blocked', () => {
    const { ctx, source, shadowPath } = setup('orca-s2-adv-foreign-', {
      correlationId: 'corr_1',
      outcome: 'succeeded',
      result: { exitCode: 0 },
      extraStaleDispatch: true
    })
    converge(ctx, source, shadowPath)
    const inc = ctx.incidents.listBySlice(S2_SLICE)
    expect(inc).toHaveLength(1)
    expect(inc[0].kind).toBe('foreign_dispatch')
    expect(inc[0].blocked).toBe(true)
    expect(ctx.observations.listBySlice(S2_SLICE)).toHaveLength(0)
    expect(JSON.parse(inc[0].detailJson).failed_check).toMatch(/dispatch/i)
  })

  it('invalid_or_unresolvable_source — a terminal dispatch whose tasks.result is not valid JSON → incident, NO invented outcome', () => {
    const { ctx, source, shadowPath, seeded } = setup('orca-s2-adv-invalid-', {
      correlationId: 'corr_1',
      outcome: 'succeeded',
      result: { exitCode: 0 }
    })
    source.close()
    cleanups.pop()
    const rw = new SyncDatabase(shadowPath)
    rw.prepare('UPDATE tasks SET result = ? WHERE id = ?').run('{not json', seeded.taskId)
    rw.close()
    finalizeShadowWriterJournal(shadowPath)
    const source2 = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source2.close())

    converge(ctx, source2, shadowPath)
    const inc = ctx.incidents.listBySlice(S2_SLICE)
    expect(inc).toHaveLength(1)
    expect(inc[0].kind).toBe('invalid_or_unresolvable_source')
    expect(ctx.observations.listBySlice(S2_SLICE)).toHaveLength(0)
    expect(JSON.parse(inc[0].detailJson).failed_expectation).toMatch(/json/i)
  })

  it('an incident is keyed (correlation_id, kind, evidence_digest), never auto-resolved, and a re-run adds no row', () => {
    const { ctx, source, shadowPath } = setup('orca-s2-adv-key-', {
      correlationId: 'corr_1',
      outcome: 'succeeded',
      result: { exitCode: 0 },
      extraStaleDispatch: true
    })
    converge(ctx, source, shadowPath, { n: 0 })
    converge(ctx, source, shadowPath, { n: 50 })
    converge(ctx, source, shadowPath, { n: 100 })
    expect(ctx.incidents.listBySlice(S2_SLICE)).toHaveLength(1)
    expect(ctx.incidents.listBySlice(S2_SLICE)[0].resolvedAt).toBeNull()
    expect(ctx.incidents.hasOpenIncident('corr_1')).toBe(true)
  })

  it('after manual resolution, a still-divergent Phase B raises a NEW incident row (§13.1)', () => {
    const { ctx, source, shadowPath, seeded } = setup('orca-s2-adv-resolve-', {
      correlationId: 'corr_1',
      outcome: 'succeeded',
      result: { provenance: 'orca_s1_shadow', exitCode: 0 }
    })
    converge(ctx, source, shadowPath, { n: 0 }) // writes the observation
    source.close()
    cleanups.pop()

    // Mutate → Phase B conflict → source_snapshot_changed incident #1
    const rw = new SyncDatabase(shadowPath)
    rw.prepare('UPDATE tasks SET result = ? WHERE id = ?').run(
      JSON.stringify({ provenance: 'orca_s1_shadow', exitCode: 0, m: 1 }),
      seeded.taskId
    )
    rw.close()
    finalizeShadowWriterJournal(shadowPath)
    const s2 = new ReadOnlyShadowSettlementSource(shadowPath)
    converge(ctx, s2, shadowPath, { n: 30 })
    s2.close()
    const first = ctx.incidents
      .listBySlice(S2_SLICE)
      .filter((i) => i.kind === 'source_snapshot_changed')
    expect(first).toHaveLength(1)

    // Operator resolves incident #1.
    ctx.incidents.resolve(first[0].id, {
      resolvedAt: '2026-09-11T00:00:00.000Z',
      resolutionNote: 'adjudicated'
    })

    // Mutate AGAIN → a still-divergent Phase B raises a NEW row (different evidence_digest).
    const rw2 = new SyncDatabase(shadowPath)
    rw2
      .prepare('UPDATE tasks SET result = ? WHERE id = ?')
      .run(JSON.stringify({ provenance: 'orca_s1_shadow', exitCode: 0, m: 2 }), seeded.taskId)
    rw2.close()
    finalizeShadowWriterJournal(shadowPath)
    const s3 = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => s3.close())
    converge(ctx, s3, shadowPath, { n: 60 })

    const all = ctx.incidents
      .listBySlice(S2_SLICE)
      .filter((i) => i.kind === 'source_snapshot_changed')
    expect(all).toHaveLength(2)
    expect(all[0].evidenceDigest).not.toBe(all[1].evidenceDigest)
    expect(all[0].resolvedAt).not.toBeNull() // the resolved row is never mutated back
  })

  it('NEGATIVE — a forced SQLITE_BUSY produces a retryable result and NO settlement_incident row', () => {
    const { ctx, source, shadowPath } = setup('orca-s2-adv-busy-', {
      correlationId: 'corr_1',
      outcome: 'succeeded',
      result: { exitCode: 0 }
    })
    const report = convergeSettlements(
      {
        store: ctx.store,
        reservations: ctx.reservations,
        observations: ctx.observations,
        incidents: ctx.incidents,
        source,
        txn: {
          withImmediateTransaction<T>(_fn: () => T): T {
            throw new ExecutionStoreBusyError(5)
          }
        },
        sourceDbPath: shadowPath,
        newId: (p) => `${p}_x`,
        now: () => '2026-09-10T00:00:00.000Z'
      },
      { sliceRef: S2_SLICE }
    )
    expect(report.retryable[0].reason).toBe('EXECUTION_STORE_BUSY_RETRYABLE')
    expect(ctx.incidents.listBySlice(S2_SLICE)).toHaveLength(0)
    expect(ctx.observations.listBySlice(S2_SLICE)).toHaveLength(0)
  })
})
