import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { canonicalSerialize, sourceDigest } from '../../domain/durable-settlement-snapshot'
import { makeCorrelationId } from '../../domain/execution-identity'
import {
  converge,
  makeS2TmpDir,
  openS2Stores,
  recordBoundReservation,
  S2_SLICE,
  seedShadowSettlements
} from './settlement-test-harness'

// ORCA-S2 acceptance criterion 7 — convergence from durable state, NO hook, NO
// notification, NO in-flight process, NO Git. The shadow Dispatch is durably
// settled in a dedicated shadow orchestration.db; ALL in-memory state is
// discarded; a fresh sweep proves the settlement_observation.

describe('durable-settlement-observation — convergence from durable state (criterion 7)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  it('a fresh sweep converges a durably-settled shadow Dispatch with correct outcome, digest and provenance', () => {
    const root = makeS2TmpDir('orca-s2-converge-')
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const [seeded] = seedShadowSettlements(shadowPath, [
      {
        correlationId: 'corr_1',
        outcome: 'succeeded',
        result: { provenance: 'orca_s1_shadow', exitCode: 0 }
      }
    ])

    // A brand-new store + a brand-new source handle — no shared memory with the writer.
    const ctx = openS2Stores()
    cleanups.push(ctx.close)
    recordBoundReservation(ctx, seeded, 'settled')
    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source.close())

    const report = converge(ctx, source, shadowPath)

    expect(report.observed).toHaveLength(1)
    const obs = ctx.observations.getByCorrelation('corr_1')!
    expect(obs.status).toBe('observed')
    expect(obs.orcaDispatchId).toBe(seeded.dispatchId)
    expect(JSON.parse(obs.observedOutcomeJson)).toEqual({
      terminalOutcome: 'completed',
      exitDisposition: 'zero_exit',
      cancellation: 'not_cancelled'
    })
    const provenance = JSON.parse(obs.provenanceJson)
    expect(provenance.resolved_dispatch_id).toBe(seeded.dispatchId)
    expect(provenance.resolved_run_id).toBe(seeded.runId)
    expect(provenance.source_db_path).toBe(shadowPath)
    expect(obs.sourceDigest).toBe(sourceDigest(provenance.snapshot))
    // The snapshot carries only durable source facts — no clock, no Git, no in-process result.
    const serial = canonicalSerialize(provenance.snapshot)
    expect(serial).toContain('"correlationId":"corr_1"')
    expect(serial).not.toMatch(/candidate_head|filesChanged|files_changed|base_commit/)
    expect(ctx.reservations.get(makeCorrelationId('corr_1'))!.state).toBe('observed')
  })

  it('a failed settlement converges to failed / non_zero_exit', () => {
    const root = makeS2TmpDir('orca-s2-converge-fail-')
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const [seeded] = seedShadowSettlements(shadowPath, [
      {
        correlationId: 'corr_f',
        outcome: 'failed',
        result: { provenance: 'orca_s1_shadow', exitCode: 2 }
      }
    ])
    const ctx = openS2Stores()
    cleanups.push(ctx.close)
    recordBoundReservation(ctx, seeded, 'settled')
    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source.close())

    converge(ctx, source, shadowPath)
    expect(JSON.parse(ctx.observations.getByCorrelation('corr_f')!.observedOutcomeJson)).toEqual({
      terminalOutcome: 'failed',
      exitDisposition: 'non_zero_exit',
      cancellation: 'not_cancelled'
    })
  })

  it('a cancelled marker converges to cancelled / no_exit without inventing granularity', () => {
    const root = makeS2TmpDir('orca-s2-converge-cancel-')
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const [seeded] = seedShadowSettlements(shadowPath, [
      {
        correlationId: 'corr_c',
        outcome: 'failed',
        result: { provenance: 'orca_s1_shadow', cancelled: true }
      }
    ])
    const ctx = openS2Stores()
    cleanups.push(ctx.close)
    recordBoundReservation(ctx, seeded, 'settled')
    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source.close())

    converge(ctx, source, shadowPath)
    const outcome = JSON.parse(ctx.observations.getByCorrelation('corr_c')!.observedOutcomeJson)
    expect(outcome).toEqual({
      terminalOutcome: 'cancelled',
      exitDisposition: 'no_exit',
      cancellation: 'cancelled'
    })
  })

  it('creates no -wal/-shm attributable to S2 and writes no parity_observation row', () => {
    const root = makeS2TmpDir('orca-s2-converge-clean-')
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const [seeded] = seedShadowSettlements(shadowPath, [
      { correlationId: 'corr_1', outcome: 'succeeded', result: { exitCode: 0 } }
    ])
    const walBefore = existsSync(`${shadowPath}-wal`)
    const shmBefore = existsSync(`${shadowPath}-shm`)

    const ctx = openS2Stores()
    cleanups.push(ctx.close)
    recordBoundReservation(ctx, seeded, 'settled')
    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    const report = converge(ctx, source, shadowPath)
    source.close()

    expect(existsSync(`${shadowPath}-wal`)).toBe(walBefore)
    expect(existsSync(`${shadowPath}-shm`)).toBe(shmBefore)
    expect(report.sourceGuard).toEqual({
      openedReadonly: true,
      ddlIssued: 0,
      pragmaJournalMutations: 0,
      triggersCreated: 0,
      metadataWrites: 0,
      sidecarsCreatedByS2: 0
    })
    expect(ctx.store.listParityObservations(S2_SLICE)).toHaveLength(0)
    // and nothing that looks like a git worktree was created under the temp dir
    expect(readdirSync(root.dir).some((n) => n === '.git')).toBe(false)
  })
})
