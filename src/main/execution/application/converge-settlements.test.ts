import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from '../infrastructure/execution-schema'
import { SqliteExecutionStore } from '../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../infrastructure/sqlite-reservation-store'
import { SqliteSettlementObservationStore } from '../infrastructure/sqlite-settlement-observation-store'
import { SqliteSettlementIncidentStore } from '../infrastructure/sqlite-settlement-incident-store'
import { ExecutionStoreBusyError } from '../infrastructure/with-immediate-transaction'
import { makeCorrelationId, makeGovernanceAgentRunRef } from '../domain/execution-identity'
import {
  canonicalSerialize,
  sourceDigest,
  type DurableSettlementSnapshot
} from '../domain/durable-settlement-snapshot'
import type {
  DurableSettlementRead,
  DurableSettlementReadInput,
  DurableSettlementSource
} from './durable-settlement-source'
import { convergeSettlements } from './converge-settlements'

const SLICE = 'ORCA-S2'

function terminalSnapshot(
  over: Partial<DurableSettlementSnapshot> = {}
): DurableSettlementSnapshot {
  return {
    correlationId: 'corr_1',
    orgTaskId: 'task_1',
    orcaRunId: 'run_1',
    orcaDispatchId: 'ctx_1',
    dispatchStatus: 'completed',
    dispatchCompletedAt: '2026-09-10T00:00:00.000Z',
    taskStatus: 'completed',
    taskCompletedAt: '2026-09-10T00:00:01.000Z',
    taskResultCanonical: { exitCode: 0, provenance: 'orca_s1_shadow' },
    attemptFactsCanonical: [],
    ...over
  }
}

/** A scriptable DurableSettlementSource. `script[correlationId]` is consumed one read at a time;
 *  the last entry repeats. */
class FakeSource implements DurableSettlementSource {
  reads = 0
  constructor(private readonly script: Record<string, DurableSettlementRead[]>) {}
  readSettlement(input: DurableSettlementReadInput): DurableSettlementRead {
    this.reads += 1
    const seq = this.script[input.correlationId] ?? [{ kind: 'no_task' }]
    return seq.length > 1 ? seq.shift()! : seq[0]
  }
  sourceGuard() {
    return {
      openedReadonly: true,
      ddlIssued: 0,
      pragmaJournalMutations: 0,
      triggersCreated: 0,
      metadataWrites: 0,
      sidecarsCreatedByS2: 0
    }
  }
}

const terminalRead = (snap: DurableSettlementSnapshot): DurableSettlementRead => ({
  kind: 'terminal',
  snapshot: snap,
  sourceDigest: sourceDigest(snap)
})

describe('convergeSettlements — two-phase sweep (§8, I-S2-1..5)', () => {
  let db: SyncDatabase | undefined
  afterEach(() => {
    db?.close()
    db = undefined
  })

  function harness() {
    db = new SyncDatabase(':memory:')
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    const execStore = new SqliteExecutionStore(db)
    const reservations = new SqliteReservationStore(db)
    const observations = new SqliteSettlementObservationStore(db)
    const incidents = new SqliteSettlementIncidentStore(db)
    let seq = 0
    const now = () => `2026-09-10T10:00:${String(seq++).padStart(2, '0')}.000Z`
    const newId = (p: string) => `${p}_${seq++}`
    return { execStore, reservations, observations, incidents, now, newId }
  }

  function seedBinding(
    h: ReturnType<typeof harness>,
    correlationId: string,
    dispatchId: string,
    runId: string,
    state: 'bound' | 'settled' | 'executed' | 'orca_created' | 'observed' = 'settled'
  ) {
    const cid = makeCorrelationId(correlationId)
    h.reservations.reserve({
      correlationId: cid,
      sliceRef: SLICE,
      authoritativeRunRef: null,
      workloadId: `w_${correlationId}`,
      now: 't0'
    })
    h.reservations.advance(cid, state, {
      orcaRunId: runId,
      orcaDispatchId: dispatchId,
      orgTaskId: `task_${correlationId}`,
      now: 't1'
    })
    h.execStore.recordBinding({
      correlationId: cid,
      governanceAgentRunId: makeGovernanceAgentRunRef(`gar_${correlationId}`),
      aicontrolRunId: null,
      orcaRunId: runId as never,
      orcaDispatchId: dispatchId as never,
      orgTaskId: `task_${correlationId}` as never,
      sliceRef: SLICE,
      baseCommit: 'base',
      candidateHead: null,
      boundAt: 't1'
    })
  }

  const run = (h: ReturnType<typeof harness>, source: DurableSettlementSource) =>
    convergeSettlements(
      {
        store: h.execStore,
        reservations: h.reservations,
        observations: h.observations,
        incidents: h.incidents,
        source,
        txn: h.execStore,
        sourceDbPath: '/tmp/shadow-orchestration.db',
        newId: h.newId,
        now: h.now
      },
      { sliceRef: SLICE }
    )

  it('Phase A converges a terminal bound Dispatch → exactly one observation + reservation "observed"', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1', 'settled')
    const snap = terminalSnapshot()
    const report = run(h, new FakeSource({ corr_1: [terminalRead(snap)] }))

    expect(report.observed).toEqual([
      { correlationId: 'corr_1', orcaDispatchId: 'ctx_1', sourceDigest: sourceDigest(snap) }
    ])
    const obs = h.observations.getByCorrelation('corr_1')!
    expect(obs.status).toBe('observed')
    expect(obs.sourceDigest).toBe(sourceDigest(snap))
    expect(JSON.parse(obs.observedOutcomeJson)).toEqual({
      terminalOutcome: 'completed',
      exitDisposition: 'zero_exit',
      cancellation: 'not_cancelled'
    })
    expect(JSON.parse(obs.provenanceJson).snapshot).toEqual(snap)
    expect(JSON.parse(obs.provenanceJson).source_db_path).toBe('/tmp/shadow-orchestration.db')
    expect(h.reservations.get(makeCorrelationId('corr_1'))!.state).toBe('observed')
  })

  it('is idempotent — run ×3 (Phase A then Phase B) yields one row, zero duplicates, zero extra incidents (I-S2-1)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const snap = terminalSnapshot()
    const src = new FakeSource({ corr_1: [terminalRead(snap)] })
    const r1 = run(h, src)
    const r2 = run(h, src)
    const r3 = run(h, src)
    expect(r1.observed).toHaveLength(1)
    expect(r2.observed).toHaveLength(0)
    expect(r2.scannedPhaseB).toBe(1)
    expect(r2.noop).toBe(1)
    expect(r3.noop).toBe(1)
    expect(h.observations.listBySlice(SLICE)).toHaveLength(1)
    expect(h.incidents.listBySlice(SLICE)).toHaveLength(0)
  })

  it('Phase B with a STABLE differing digest → source_snapshot_changed incident + observed_conflicted, source columns untouched (§13, G5)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const original = terminalSnapshot()
    const src = new FakeSource({ corr_1: [terminalRead(original)] })
    run(h, src)
    const before = h.observations.getByCorrelation('corr_1')!

    const mutated = terminalSnapshot({ taskCompletedAt: '2026-09-10T09:09:09.000Z' })
    const src2 = new FakeSource({ corr_1: [terminalRead(mutated)] })
    const report = run(h, src2)

    expect(report.conflicted).toEqual([
      {
        correlationId: 'corr_1',
        oldDigest: sourceDigest(original),
        newDigest: sourceDigest(mutated)
      }
    ])
    const after = h.observations.getByCorrelation('corr_1')!
    expect(after.status).toBe('observed_conflicted')
    expect(after.conflictedAt).not.toBeNull()
    expect(after.sourceDigest).toBe(before.sourceDigest) // immutable
    expect(after.observedOutcomeJson).toBe(before.observedOutcomeJson)
    expect(after.provenanceJson).toBe(before.provenanceJson)
    expect(after.sourceDispatchCompletedAt).toBe(before.sourceDispatchCompletedAt)

    const incidents = h.incidents.listBySlice(SLICE)
    expect(incidents).toHaveLength(1)
    expect(incidents[0].kind).toBe('source_snapshot_changed')
    expect(incidents[0].evidenceDigest).toBe(sourceDigest(mutated))
    expect(incidents[0].blocked).toBe(true)
  })

  it('Phase A NEVER produces source_snapshot_changed — an unstable Phase A source is SOURCE_UNSTABLE_RETRYABLE (§16.3, attack 3a)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    // Every read is a different digest → the read → re-verify double-read never agrees.
    const script: DurableSettlementRead[] = []
    for (let i = 0; i < 40; i += 1) {
      script.push(terminalRead(terminalSnapshot({ taskCompletedAt: `2026-09-10T00:00:${i}.000Z` })))
    }
    const report = run(h, new FakeSource({ corr_1: script }))

    expect(report.retryable).toEqual([
      {
        correlationId: 'corr_1',
        phase: 'A',
        reason: 'SOURCE_UNSTABLE_RETRYABLE',
        attempts: expect.any(Number)
      }
    ])
    expect(h.observations.listBySlice(SLICE)).toHaveLength(0)
    expect(h.incidents.listBySlice(SLICE)).toHaveLength(0)
    // binding not blocked, reservation untouched
    expect(h.reservations.get(makeCorrelationId('corr_1'))!.state).toBe('settled')
  })

  it('a foreign latest Dispatch → foreign_dispatch incident, binding blocked, no observation (P-S2-4, attack 4)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const report = run(
      h,
      new FakeSource({
        corr_1: [
          {
            kind: 'foreign',
            resolvedDispatchId: 'ctx_other',
            resolvedRunId: 'run_1',
            failedCheck: 'latest dispatch ctx_other != bound dispatch ctx_1'
          }
        ]
      })
    )
    expect(report.incidents).toEqual([
      { correlationId: 'corr_1', kind: 'foreign_dispatch', evidenceDigest: expect.any(String) }
    ])
    expect(h.observations.listBySlice(SLICE)).toHaveLength(0)
    const inc = h.incidents.listBySlice(SLICE)[0]
    expect(inc.blocked).toBe(true)
    // idempotent — a re-run hits the UNIQUE key and adds no second row
    run(
      h,
      new FakeSource({
        corr_1: [
          {
            kind: 'foreign',
            resolvedDispatchId: 'ctx_other',
            resolvedRunId: 'run_1',
            failedCheck: 'x'
          }
        ]
      })
    )
    expect(h.incidents.listBySlice(SLICE)).toHaveLength(1)
  })

  it('a terminal-but-uncanonicalisable source → invalid_or_unresolvable_source incident, no invented outcome (attack 2)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const report = run(
      h,
      new FakeSource({
        corr_1: [
          {
            kind: 'unresolvable',
            partial: { taskResultRaw: '{bad' },
            failedExpectation: 'tasks.result is not valid JSON'
          }
        ]
      })
    )
    expect(report.incidents[0].kind).toBe('invalid_or_unresolvable_source')
    expect(h.observations.listBySlice(SLICE)).toHaveLength(0)
  })

  it('a non-terminal bound Dispatch is left for a later pass — no observation, no incident, no retryable', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const report = run(
      h,
      new FakeSource({ corr_1: [{ kind: 'non_terminal', dispatchId: 'ctx_1' }] })
    )
    expect(report.observed).toHaveLength(0)
    expect(report.incidents).toHaveLength(0)
    expect(report.retryable).toHaveLength(0)
    expect(report.scannedPhaseA).toBe(1)
  })

  it('EXECUTION_STORE_BUSY_RETRYABLE — a txn that cannot be acquired writes no row, no incident, no partial state (§16.1, attack 3b)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const snap = terminalSnapshot()
    const busyTxn = {
      withImmediateTransaction<T>(_fn: () => T): T {
        throw new ExecutionStoreBusyError(5)
      }
    }
    const report = convergeSettlements(
      {
        store: h.execStore,
        reservations: h.reservations,
        observations: h.observations,
        incidents: h.incidents,
        source: new FakeSource({ corr_1: [terminalRead(snap)] }),
        txn: busyTxn,
        sourceDbPath: '/tmp/x.db',
        newId: h.newId,
        now: h.now
      },
      { sliceRef: SLICE }
    )
    expect(report.retryable).toEqual([
      { correlationId: 'corr_1', phase: 'A', reason: 'EXECUTION_STORE_BUSY_RETRYABLE', attempts: 5 }
    ])
    expect(h.observations.listBySlice(SLICE)).toHaveLength(0)
    expect(h.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(h.reservations.get(makeCorrelationId('corr_1'))!.state).toBe('settled')
  })

  it('an incident-blocked binding is skipped in both phases (§7, §15.2)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    // First raise a foreign incident.
    run(
      h,
      new FakeSource({
        corr_1: [
          { kind: 'foreign', resolvedDispatchId: 'ctx_x', resolvedRunId: 'run_1', failedCheck: 'x' }
        ]
      })
    )
    // Now the source is a clean terminal — but the binding is blocked, so no observation.
    const report = run(h, new FakeSource({ corr_1: [terminalRead(terminalSnapshot())] }))
    expect(report.observed).toHaveLength(0)
    expect(h.observations.listBySlice(SLICE)).toHaveLength(0)
  })

  it('a settlement-projection rebuild + re-run reproduces a semantically-equivalent observation (I-S2-3)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const snap = terminalSnapshot()
    const src = () => new FakeSource({ corr_1: [terminalRead(snap)] })
    run(h, src())
    const first = h.observations.getByCorrelation('corr_1')!

    // Rebuild: drop only the two S2 projection tables, recreate, re-run.
    db!.exec('DROP TABLE settlement_observation; DROP TABLE settlement_incident;')
    migrateExecutionStore(db!)
    run(h, src())
    const rebuilt = h.observations.getByCorrelation('corr_1')!

    for (const k of [
      'sourceDigest',
      'orcaDispatchId',
      'orcaRunId',
      'orgTaskId',
      'observedOutcomeJson',
      'provenanceJson',
      'status'
    ] as const) {
      expect(rebuilt[k]).toBe(first[k])
    }
  })

  it('Phase B no-op heals a reservation left behind at "settled" by advancing it to "observed" (G3)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1', 'settled')
    const snap = terminalSnapshot()
    const src = new FakeSource({ corr_1: [terminalRead(snap)] })
    run(h, src) // Phase A writes the observation + advances to observed
    // Simulate "crash before reservation advanced":
    db!
      .prepare("UPDATE run_reservation SET state = 'settled' WHERE correlation_id = 'corr_1'")
      .run()
    const r = run(h, new FakeSource({ corr_1: [terminalRead(snap)] }))
    expect(r.noop).toBe(1)
    expect(r.observed).toHaveLength(0)
    expect(h.reservations.get(makeCorrelationId('corr_1'))!.state).toBe('observed')
  })

  it('report carries the sourceGuard block verbatim (§10)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const report = run(h, new FakeSource({ corr_1: [terminalRead(terminalSnapshot())] }))
    expect(report.sourceGuard.openedReadonly).toBe(true)
    expect(report.sourceGuard.ddlIssued).toBe(0)
  })

  it('never writes a parity_observation row (§18, attack 11)', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    run(h, new FakeSource({ corr_1: [terminalRead(terminalSnapshot())] }))
    expect(h.execStore.listParityObservations(SLICE)).toHaveLength(0)
  })

  it('does not perturb the canonical form assumption — provenance snapshot round-trips through canonicalSerialize', () => {
    const h = harness()
    seedBinding(h, 'corr_1', 'ctx_1', 'run_1')
    const snap = terminalSnapshot()
    run(h, new FakeSource({ corr_1: [terminalRead(snap)] }))
    const obs = h.observations.getByCorrelation('corr_1')!
    expect(canonicalSerialize(JSON.parse(obs.provenanceJson).snapshot)).toBe(
      canonicalSerialize(snap)
    )
  })
})
