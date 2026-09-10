import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from '../infrastructure/execution-schema'
import { SqliteExecutionStore } from '../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../infrastructure/sqlite-reservation-store'
import { SqliteSettlementIncidentStore } from '../infrastructure/sqlite-settlement-incident-store'
import { SqliteSettlementObservationStore } from '../infrastructure/sqlite-settlement-observation-store'
import {
  makeCorrelationId,
  makeGovernanceAgentRunRef,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef
} from '../domain/execution-identity'
import { sourceDigest, type DurableSettlementSnapshot } from '../domain/durable-settlement-snapshot'
import type { ExecutionPlane } from './execution-plane'
import type {
  DurableSettlementRead,
  DurableSettlementReadInput,
  DurableSettlementSource
} from './durable-settlement-source'
import { reconcileShadowExecutionState } from './reconcile-shadow-execution-state'

const SLICE = 'ORCA-S2'

function snap(
  cid: string,
  over: Partial<DurableSettlementSnapshot> = {}
): DurableSettlementSnapshot {
  return {
    correlationId: cid,
    orgTaskId: `task_${cid}`,
    orcaRunId: `run_${cid}`,
    orcaDispatchId: `ctx_${cid}`,
    dispatchStatus: 'completed',
    dispatchCompletedAt: '2026-09-10T00:00:00.000Z',
    taskStatus: 'completed',
    taskCompletedAt: '2026-09-10T00:00:01.000Z',
    taskResultCanonical: { exitCode: 0 },
    attemptFactsCanonical: [],
    ...over
  }
}
const terminalRead = (s: DurableSettlementSnapshot): DurableSettlementRead => ({
  kind: 'terminal',
  snapshot: s,
  sourceDigest: sourceDigest(s)
})

describe('reconcileShadowExecutionState — unified coordinator (§15, criterion 16)', () => {
  let db: SyncDatabase | undefined
  afterEach(() => {
    db?.close()
    db = undefined
  })

  function harness() {
    db = new SyncDatabase(':memory:')
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    const store = new SqliteExecutionStore(db)
    const reservations = new SqliteReservationStore(db)
    const observations = new SqliteSettlementObservationStore(db)
    const incidents = new SqliteSettlementIncidentStore(db)
    const log: string[] = []
    let seq = 0
    return {
      store,
      reservations,
      observations,
      incidents,
      log,
      now: () => `2026-09-10T12:00:${String(seq++).padStart(2, '0')}.000Z`,
      newId: (p: string) => `${p}_${seq++}`
    }
  }

  function seedBinding(
    h: ReturnType<typeof harness>,
    name: string,
    state: 'reserved' | 'bound' | 'settled' | 'executed' = 'settled'
  ) {
    const cid = `corr_${name}`
    const c = makeCorrelationId(cid)
    h.reservations.reserve({
      correlationId: c,
      sliceRef: SLICE,
      authoritativeRunRef: null,
      workloadId: `w_${name}`,
      now: '2026-09-10T00:00:00.000Z'
    })
    if (state !== 'reserved') {
      h.reservations.advance(c, state, {
        orcaRunId: `run_${cid}`,
        orcaDispatchId: `ctx_${cid}`,
        orgTaskId: `task_${cid}`,
        now: '2026-09-10T00:00:00.000Z'
      })
      h.store.recordBinding({
        correlationId: c,
        governanceAgentRunId: makeGovernanceAgentRunRef(`gar_${cid}`),
        aicontrolRunId: null,
        orcaRunId: makeOrcaRunRef(`run_${cid}`),
        orcaDispatchId: makeOrcaDispatchRef(`ctx_${cid}`),
        orgTaskId: makeOrgTaskRef(`task_${cid}`),
        sliceRef: SLICE,
        baseCommit: 'base',
        candidateHead: null,
        boundAt: '2026-09-10T00:00:00.000Z'
      })
    }
  }

  function fakePlane(
    h: ReturnType<typeof harness>,
    shadowByCid: Record<string, { settled: boolean } | null>
  ): ExecutionPlane {
    return {
      openShadowRun: async () => {
        throw new Error('not used')
      },
      runShadowWorkload: async () => {
        throw new Error('not used')
      },
      settleShadow: async () => {
        throw new Error('not used')
      },
      abandonShadow: async (i) => {
        h.log.push(`abandon:${String(i.orcaDispatchRef)}`)
      },
      findShadowRunByCorrelation: (c) => {
        const cid = String(c)
        h.log.push(`reconcile-scan:${cid}`)
        const s = shadowByCid[cid]
        if (s === null || s === undefined) {
          return undefined
        }
        return {
          orcaRunRef: makeOrcaRunRef(`run_${cid}`),
          orcaDispatchRef: makeOrcaDispatchRef(`ctx_${cid}`),
          orgTaskRef: makeOrgTaskRef(`task_${cid}`),
          settled: s.settled
        }
      }
    }
  }

  function fakeSource(
    h: ReturnType<typeof harness>,
    script: Record<string, DurableSettlementRead[]>
  ): DurableSettlementSource {
    return {
      readSettlement: (input: DurableSettlementReadInput) => {
        h.log.push(`converge-read:${input.correlationId}`)
        const seq = script[input.correlationId] ?? [{ kind: 'no_task' }]
        return seq.length > 1 ? seq.shift()! : seq[0]
      },
      sourceGuard: () => ({
        openedReadonly: true,
        ddlIssued: 0,
        pragmaJournalMutations: 0,
        triggersCreated: 0,
        metadataWrites: 0,
        sidecarsCreatedByS2: 0
      })
    }
  }

  const runCoordinator = (
    h: ReturnType<typeof harness>,
    plane: ExecutionPlane,
    source: DurableSettlementSource,
    staleAfter?: number
  ) =>
    reconcileShadowExecutionState(
      {
        plane,
        store: h.store,
        reservations: h.reservations,
        settlement: {
          source,
          observations: h.observations,
          incidents: h.incidents,
          txn: h.store,
          sourceDbPath: '/tmp/shadow-orchestration.db'
        }
      },
      { sliceRef: SLICE, now: h.now, newId: h.newId, staleAfter }
    )

  it('a terminal bound Dispatch with a stable snapshot CONVERGES and is never abandoned', () => {
    const h = harness()
    seedBinding(h, 'a', 'settled')
    const report = runCoordinator(
      h,
      fakePlane(h, { corr_a: { settled: true } }),
      fakeSource(h, { corr_a: [terminalRead(snap('corr_a'))] })
    )
    void report
    expect(h.observations.getByCorrelation('corr_a')).toBeDefined()
    expect(h.reservations.get(makeCorrelationId('corr_a'))!.state).toBe('observed')
    expect(h.log.filter((e) => e.startsWith('abandon:'))).toHaveLength(0)
  })

  it('convergence phases 1–2 run to completion BEFORE any phase-3 reconcile scan or abandon', () => {
    const h = harness()
    seedBinding(h, 'a', 'settled')
    seedBinding(h, 'b', 'reserved') // never-created → phase 3 abandons
    runCoordinator(
      h,
      fakePlane(h, { corr_a: { settled: true }, corr_b: null }),
      fakeSource(h, { corr_a: [terminalRead(snap('corr_a'))] })
    )
    const firstReconcile = h.log.findIndex((e) => e.startsWith('reconcile-scan:'))
    const lastConvergeRead = h.log.map((e) => e.startsWith('converge-read:')).lastIndexOf(true)
    expect(lastConvergeRead).toBeGreaterThanOrEqual(0)
    expect(firstReconcile).toBeGreaterThan(lastConvergeRead)
    // and the never-created reservation was abandoned in phase 3
    expect(h.reservations.get(makeCorrelationId('corr_b'))!.state).toBe('abandoned')
  })

  it('a SOURCE_UNSTABLE_RETRYABLE result does NOT cause the still-incomplete reservation to be abandoned', () => {
    const h = harness()
    seedBinding(h, 'a', 'settled')
    const unstable: DurableSettlementRead[] = []
    for (let i = 0; i < 40; i += 1) {
      unstable.push(terminalRead(snap('corr_a', { taskCompletedAt: `2026-09-10T00:00:${i}.000Z` })))
    }
    const report = runCoordinator(
      h,
      fakePlane(h, { corr_a: { settled: true } }),
      fakeSource(h, { corr_a: unstable })
    )
    expect(report.convergence!.retryable[0].reason).toBe('SOURCE_UNSTABLE_RETRYABLE')
    expect(h.reservations.get(makeCorrelationId('corr_a'))!.state).toBe('settled') // NOT abandoned
    expect(h.log.filter((e) => e.startsWith('abandon:'))).toHaveLength(0)
    expect(h.observations.getByCorrelation('corr_a')).toBeUndefined()
  })

  it('a foreign_dispatch incident blocks the binding — phase 3 neither converges nor abandons it', () => {
    const h = harness()
    seedBinding(h, 'a', 'settled')
    const report = runCoordinator(
      h,
      fakePlane(h, { corr_a: { settled: true } }),
      fakeSource(h, {
        corr_a: [
          {
            kind: 'foreign',
            resolvedDispatchId: 'ctx_x',
            resolvedRunId: 'run_corr_a',
            failedCheck: 'x'
          }
        ]
      })
    )
    expect(report.convergence!.incidents[0].kind).toBe('foreign_dispatch')
    expect(h.reservations.get(makeCorrelationId('corr_a'))!.state).toBe('settled')
    expect(h.log.filter((e) => e.startsWith('abandon:'))).toHaveLength(0)
  })

  it('a stale non-terminal Dispatch is abandoned in phase 3; a fresh one is left', () => {
    const h = harness()
    seedBinding(h, 'stale', 'bound')
    seedBinding(h, 'fresh', 'bound')
    // Age the stale reservation far in the past.
    db!
      .prepare(
        "UPDATE run_reservation SET updated_at = '2000-01-01T00:00:00.000Z' WHERE correlation_id = 'corr_stale'"
      )
      .run()
    db!
      .prepare("UPDATE run_reservation SET updated_at = ? WHERE correlation_id = 'corr_fresh'")
      .run(new Date().toISOString())
    const report = reconcileShadowExecutionState(
      {
        plane: fakePlane(h, { corr_stale: { settled: false }, corr_fresh: { settled: false } }),
        store: h.store,
        reservations: h.reservations,
        settlement: {
          source: fakeSource(h, {}),
          observations: h.observations,
          incidents: h.incidents,
          txn: h.store,
          sourceDbPath: '/tmp/x.db'
        }
      },
      { sliceRef: SLICE, now: () => new Date().toISOString(), newId: h.newId, staleAfter: 60_000 }
    )
    expect(report.reconcile.abandoned).toContain('corr_stale')
    expect(report.reconcile.left).toContain('corr_fresh')
    expect(h.reservations.get(makeCorrelationId('corr_fresh'))!.state).toBe('bound')
  })

  it('runs the modified reconcile even with no settlement deps (S1 fallback path)', () => {
    const h = harness()
    seedBinding(h, 'x', 'reserved')
    const report = reconcileShadowExecutionState(
      {
        plane: fakePlane(h, { corr_x: null }),
        store: h.store,
        reservations: h.reservations
      },
      { sliceRef: SLICE, now: h.now }
    )
    expect(report.convergence).toBeNull()
    expect(report.reconcile.abandoned).toContain('corr_x')
  })
})
