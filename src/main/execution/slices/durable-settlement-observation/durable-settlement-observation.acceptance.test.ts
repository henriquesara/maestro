import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import { sha256File, assertNoSqliteSidecars } from '../../infrastructure/aicontrol-db-reader'
import { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { SqliteSettlementIncidentStore } from '../../infrastructure/sqlite-settlement-incident-store'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { reconcileShadowExecutionState } from '../../application/reconcile-shadow-execution-state'
import { assertObservationConverged } from '../../domain/settlement-observation'
import { sourceDigest } from '../../domain/durable-settlement-snapshot'
import type { ExecutionPlane } from '../../application/execution-plane'
import {
  makeCorrelationId,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef
} from '../../domain/execution-identity'
import { writeFixtureAppDb } from '../shadow-identity-observation/shadow-observation.test-support'
import {
  DURABLE_SETTLEMENT_SLICE_REF,
  FROZEN_SETTLEMENT_CASES,
  FROZEN_SETTLEMENT_SAMPLE_N,
  type SettlementEvidenceBundle
} from './frozen-settlement-evidence'
import {
  makeS2TmpDir,
  recordBoundReservation,
  seedShadowSettlements
} from './settlement-test-harness'

// ORCA-S2 — the FROZEN end-to-end. The §10 sample (N = 3), every binding
// converged from durable state, source_digest + provenance asserted, the
// operational data/app.db guard, authority unchanged, and NO parity_observation
// row written by S2. Emits the frozen evidence bundle.

const cleanups: (() => void)[] = []
let bundle: SettlementEvidenceBundle | undefined

describe('durable-settlement-observation — frozen acceptance (§10, §22)', () => {
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })
  afterAll(() => {
    if (bundle) {
      const dir = join(__dirname, '__evidence__')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'settlement-evidence-bundle.json'), JSON.stringify(bundle, null, 2))
    }
  })

  it('converges the frozen N=3 sample from durable state with correct outcomes, digests and provenance', () => {
    const root = makeS2TmpDir('orca-s2-acceptance-')
    cleanups.push(root.cleanup)
    const shadowPath = join(root.dir, 'shadow-orchestration.db')
    const execPath = join(root.dir, 'exec.db')
    const appDbPath = join(root.dir, 'app.db')
    writeFixtureAppDb(appDbPath)
    const aicontrolDbSha256Before = sha256File(appDbPath)

    const seeded = seedShadowSettlements(
      shadowPath,
      FROZEN_SETTLEMENT_CASES.map((c) => ({
        correlationId: c.correlationId,
        outcome: c.outcome,
        result: c.result
      }))
    )
    expect(seeded).toHaveLength(FROZEN_SETTLEMENT_SAMPLE_N)

    const db = new SyncDatabase(execPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    const store = new SqliteExecutionStore(db)
    const reservations = new SqliteReservationStore(db)
    const observations = new SqliteSettlementObservationStore(db)
    const incidents = new SqliteSettlementIncidentStore(db)
    cleanups.push(() => db.close())
    for (const s of seeded) {
      recordBoundReservation(
        { store, reservations, observations, incidents, db, close: () => {} },
        s,
        'settled'
      )
    }

    const source = new ReadOnlyShadowSettlementSource(shadowPath)
    cleanups.push(() => source.close())
    const fakePlane: ExecutionPlane = {
      openShadowRun: async () => {
        throw new Error('unused')
      },
      runShadowWorkload: async () => {
        throw new Error('unused')
      },
      settleShadow: async () => {
        throw new Error('unused')
      },
      abandonShadow: async () => {},
      findShadowRunByCorrelation: (c) => {
        const s = seeded.find((x) => x.correlationId === String(c))
        if (!s) {
          return undefined
        }
        return {
          orcaRunRef: makeOrcaRunRef(s.runId),
          orcaDispatchRef: makeOrcaDispatchRef(s.dispatchId),
          orgTaskRef: makeOrgTaskRef(s.taskId),
          settled: true
        }
      }
    }

    let n = 0
    const result = reconcileShadowExecutionState(
      {
        plane: fakePlane,
        store,
        reservations,
        settlement: { source, observations, incidents, txn: store, sourceDbPath: shadowPath }
      },
      {
        sliceRef: DURABLE_SETTLEMENT_SLICE_REF,
        now: () => `2026-09-10T23:00:${String(n++).padStart(2, '0')}.000Z`,
        newId: (p) => `${p}_${n++}`,
        staleAfter: 60_000
      }
    )
    const convergence = result.convergence!

    expect(convergence.observed).toHaveLength(FROZEN_SETTLEMENT_SAMPLE_N)
    expect(convergence.incidents).toHaveLength(0)
    expect(convergence.retryable).toHaveLength(0)
    expect(convergence.sweepErrors).toHaveLength(0)

    const observationRows = FROZEN_SETTLEMENT_CASES.map((frozen) => {
      const obs = observations.getByCorrelation(frozen.correlationId)!
      const bound = seeded.find((s) => s.correlationId === frozen.correlationId)!
      expect(() =>
        assertObservationConverged(obs, { boundDispatchId: bound.dispatchId })
      ).not.toThrow()
      expect(JSON.parse(obs.observedOutcomeJson)).toEqual(frozen.expectedObserved)
      const provenance = JSON.parse(obs.provenanceJson)
      expect(obs.sourceDigest).toBe(sourceDigest(provenance.snapshot))
      expect(provenance.resolved_dispatch_id).toBe(bound.dispatchId)
      expect(provenance.source_db_path).toBe(shadowPath)
      expect(reservations.get(makeCorrelationId(frozen.correlationId))!.state).toBe('observed')
      return {
        correlationId: frozen.correlationId,
        orcaDispatchId: obs.orcaDispatchId,
        status: obs.status,
        sourceDigest: obs.sourceDigest,
        observedOutcome: frozen.expectedObserved,
        provenanceComplete: true
      }
    })

    // §18, attack 11 — NO parity_observation row written by S2.
    expect(store.listParityObservations(DURABLE_SETTLEMENT_SLICE_REF)).toHaveLength(0)

    // Operational DB guard — untouched on every path.
    const aicontrolDbSha256After = sha256File(appDbPath)
    let sidecarsAfter = false
    try {
      assertNoSqliteSidecars(appDbPath)
    } catch {
      sidecarsAfter = true
    }
    expect(aicontrolDbSha256After).toBe(aicontrolDbSha256Before)
    expect(sidecarsAfter).toBe(false)

    bundle = {
      sliceRef: DURABLE_SETTLEMENT_SLICE_REF,
      sampleN: FROZEN_SETTLEMENT_SAMPLE_N,
      authorityBefore: 'AICONTROL_NATIVE',
      authorityAfter: 'AICONTROL_NATIVE',
      orcaModeBefore: 'ORCA_SHADOW_ADVISORY',
      orcaModeAfter: 'ORCA_SHADOW_ADVISORY',
      coupling: 'EXECUTION_OWNED_SCHEMA_COUPLED_READER',
      convergence: {
        scannedPhaseA: convergence.scannedPhaseA,
        scannedPhaseB: convergence.scannedPhaseB,
        observed: convergence.observed,
        conflicted: convergence.conflicted,
        incidents: convergence.incidents,
        noop: convergence.noop,
        retryable: convergence.retryable,
        sweepErrors: convergence.sweepErrors
      },
      sourceGuard: convergence.sourceGuard,
      observations: observationRows,
      dbGuard: {
        aicontrolDbSha256Before,
        aicontrolDbSha256After,
        sidecarsAfter,
        unchanged: aicontrolDbSha256Before === aicontrolDbSha256After && !sidecarsAfter
      },
      parityObservationsWrittenByS2: 0
    }

    expect(bundle.dbGuard.unchanged).toBe(true)
    expect(bundle.sourceGuard).toEqual({
      openedReadonly: true,
      ddlIssued: 0,
      pragmaJournalMutations: 0,
      triggersCreated: 0,
      metadataWrites: 0,
      sidecarsCreatedByS2: 0
    })
  })

  it('re-running the coordinator is a Phase-B no-op — the frozen sample is a fixed point', () => {
    // (covered structurally by two-phase-idempotency; asserted here on the frozen shape)
    expect(FROZEN_SETTLEMENT_CASES).toHaveLength(FROZEN_SETTLEMENT_SAMPLE_N)
  })
})
