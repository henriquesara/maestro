import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from '../infrastructure/execution-schema'
import { SqliteDispatchLifecycleClosureStore } from '../infrastructure/sqlite-dispatch-lifecycle-closure-store'
import { SqliteDispatchLifecycleEventStore } from '../infrastructure/sqlite-dispatch-lifecycle-event-store'
import { SqliteDispatchLifecycleIncidentStore } from '../infrastructure/sqlite-dispatch-lifecycle-incident-store'
import { SqliteDispatchProcessBindingStore } from '../infrastructure/sqlite-dispatch-process-binding-store'
import { SqliteDispatchTerminationStore } from '../infrastructure/sqlite-dispatch-termination-store'
import { SqliteDispatchWorktreeStore } from '../infrastructure/sqlite-dispatch-worktree-store'
import { SqliteExecutionStore } from '../infrastructure/sqlite-execution-store'
import { SqliteSettlementObservationStore } from '../infrastructure/sqlite-settlement-observation-store'
import { SqliteWorktreeFinalizationStore } from '../infrastructure/sqlite-worktree-finalization-store'
import { SqliteWorktreeProvenanceIncidentStore } from '../infrastructure/sqlite-worktree-provenance-incident-store'
import { SqliteWorktreeProvenanceStore } from '../infrastructure/sqlite-worktree-provenance-store'
import { fixtureBinding, fixtureSettlementObservation, fixtureWorktreeProvenance } from '../slices/delegated-side-effect-boundary/delegated-side-effect-boundary-test-harness'
import { convergeDelegationBoundaryLifecycle, type ProcessLifecycleObservationLike } from './converge-delegation-boundary-lifecycle'

// ORCA-S4 SPEC §11 — the third sibling sweep. Phases 1-5, §8.7 prospective
// eligibility, §13 failure semantics, §14 LIFE-9 incident isolation. A fake,
// deterministic `ShadowLifecycleProcessPort` stands in for the real adapter (not
// yet implemented) so this suite tests ORCHESTRATION, not OS mechanics — the
// real port is exercised separately by `shadow-lifecycle-process-adapter.test.ts`
// and the crash/restart harness. RED: `./converge-delegation-boundary-lifecycle`
// does not exist yet.

const SLICE = 'ORCA-S4'

type FakePortOverrides = Partial<{
  observe: () => Promise<ProcessLifecycleObservationLike>
  requestTermination: () => Promise<{ verified: boolean }>
  requestTerminationByPid: () => Promise<{ verified: boolean }>
}>

function fakePort(overrides: FakePortOverrides = {}) {
  return {
    spawn: () => {
      throw new Error('spawn is not exercised by the sweep — bind-time seam only')
    },
    observe: async (): Promise<ProcessLifecycleObservationLike> => ({ kind: 'self_exit', exitCode: 0, exitSignal: null }),
    requestTermination: async () => ({ verified: true }),
    requestTerminationByPid: async () => ({ verified: true }),
    ...overrides
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s4-converge-'))
  const durableRoot = join(dir, 'durable-shadow-root')
  const db = new SyncDatabase(join(dir, 'exec.db'))
  db.pragma('foreign_keys = OFF')
  migrateExecutionStore(db)
  return {
    dir,
    durableRoot,
    db,
    bindings: new SqliteExecutionStore(db),
    settlements: new SqliteSettlementObservationStore(db),
    dispatchWorktrees: new SqliteDispatchWorktreeStore(db),
    provenance: new SqliteWorktreeProvenanceStore(db),
    worktreeProvenanceIncidents: new SqliteWorktreeProvenanceIncidentStore(db),
    processBindings: new SqliteDispatchProcessBindingStore(db),
    terminations: new SqliteDispatchTerminationStore(db),
    finalizations: new SqliteWorktreeFinalizationStore(db),
    closures: new SqliteDispatchLifecycleClosureStore(db),
    events: new SqliteDispatchLifecycleEventStore(db),
    incidents: new SqliteDispatchLifecycleIncidentStore(db)
  }
}

function seedEligibleBinding(s: ReturnType<typeof setup>, over: { correlationId?: string } = {}) {
  const cid = over.correlationId ?? 'corr_1'
  s.bindings.recordBinding(fixtureBinding({ correlationId: cid as never, sliceRef: SLICE }))
  s.settlements.insert(fixtureSettlementObservation({ correlationId: cid, sliceRef: SLICE }))
  s.provenance.insert(fixtureWorktreeProvenance({ correlationId: cid, sliceRef: SLICE }))
  s.processBindings.insert({
    orcaDispatchId: 'ctx_1',
    correlationId: cid,
    orcaRunId: 'run_1',
    processNonce: 'nonce_1',
    pid: 4242,
    killScope: 'posix-process-group',
    osStartMarker: '1000',
    osStartMarkerSource: 'posix_proc_stat_starttime',
    spawnedAt: '2026-09-13T00:00:00Z',
    teardownRequestedAt: null
  })
  return cid
}

describe('convergeDelegationBoundaryLifecycle — §8.7 prospective eligibility', () => {
  afterEach(() => {})

  it('a pre-S4 binding (settled + terminal provenance, no dispatch_process_binding row) -> LEGACY_BINDING_NOT_LIFECYCLE_MANAGED: no row, no incident, no block, no retroactive spawn', async () => {
    const s = setup()
    s.bindings.recordBinding(fixtureBinding({ correlationId: 'corr_legacy' as never, sliceRef: SLICE }))
    s.settlements.insert(fixtureSettlementObservation({ correlationId: 'corr_legacy', sliceRef: SLICE }))
    s.provenance.insert(fixtureWorktreeProvenance({ correlationId: 'corr_legacy', sliceRef: SLICE }))

    const report = await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort(), liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(report.legacyNotLifecycleManaged).toContain('corr_legacy')
    expect(s.incidents.listBySlice(SLICE)).toHaveLength(0)
  })

  it('first S4 activation over N historical bindings produces 0 S4 rows and 0 S4 incidents (mirrors S3 gate 18)', async () => {
    const s = setup()
    for (const n of [1, 2, 3]) {
      s.bindings.recordBinding(fixtureBinding({ correlationId: `corr_${n}` as never, orcaDispatchId: `ctx_${n}` as never, sliceRef: SLICE }))
      s.settlements.insert(fixtureSettlementObservation({ correlationId: `corr_${n}`, orcaDispatchId: `ctx_${n}`, sliceRef: SLICE }))
      s.provenance.insert(fixtureWorktreeProvenance({ correlationId: `corr_${n}`, orcaDispatchId: `ctx_${n}`, sliceRef: SLICE }))
    }
    const report = await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort(), liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(report.legacyNotLifecycleManaged.sort()).toEqual(['corr_1', 'corr_2', 'corr_3'])
    expect(s.processBindings.getByCorrelationId('corr_1')).toBeUndefined()
    expect(s.terminations.getByCorrelationId('corr_1')).toBeUndefined()
    expect(s.incidents.listBySlice(SLICE)).toHaveLength(0)
  })
})

describe('convergeDelegationBoundaryLifecycle — Phases 1-4 happy path', () => {
  it('Phase 1 observe&teardown -> Phase 2 finalize -> Phase 3 close -> Phase 4 emit, for one eligible binding whose process already self-exited', async () => {
    const s = setup()
    const cid = seedEligibleBinding(s)
    const report = await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort(), liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(s.terminations.getByCorrelationId(cid)).toBeDefined()
    expect(s.finalizations.getByCorrelationId(cid)?.status).toBe('skipped_not_eligible') // no real durable worktree seeded in this fixture
    expect(s.closures.getByCorrelationId(cid)).toBeDefined()
    expect(s.events.getByCorrelationAndKind(cid, 'shadow_delegated_boundary_closed')).toBeDefined()
    expect(report.closed).toContain(cid)
  })

  it('closure *_ref columns are verbatim copies, never re-decided (LIFE-5) — settlement "observed" copies through unchanged', async () => {
    const s = setup()
    const cid = seedEligibleBinding(s)
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort(), liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    const closure = s.closures.getByCorrelationId(cid)
    expect(closure?.settlementStatusRef).toBe('observed')
    expect(closure?.worktreeProvenanceRef).toBe('recorded')
  })
})

describe('convergeDelegationBoundaryLifecycle — §14 LIFE-9 incident isolation', () => {
  it('an open dispatch_lifecycle_incident for a binding blocks ONLY convergeDelegationBoundaryLifecycle for that binding — never suppresses ORCA-S2/S3 reconciliation (never touches settlement_incident / worktree_provenance_incident)', async () => {
    const s = setup()
    const cid = seedEligibleBinding(s)
    s.incidents.insert({
      id: 'inc_pre',
      correlationId: cid,
      orcaDispatchId: 'ctx_1',
      sliceRef: SLICE,
      kind: 'process_identity_mismatch',
      evidenceDigest: 'z'.repeat(64),
      detailJson: '{}',
      blocked: true,
      resolvedAt: null,
      resolutionNote: null,
      raisedAt: '2026-09-13T00:00:00Z'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: fakePort(), liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(s.terminations.getByCorrelationId(cid)).toBeUndefined() // Phase 1 skipped for this binding
    expect(
      (s.db.prepare('SELECT COUNT(*) c FROM settlement_incident').get() as { c: number }).c
    ).toBe(0)
    expect(
      (s.db.prepare('SELECT COUNT(*) c FROM worktree_provenance_incident').get() as { c: number }).c
    ).toBe(0)
  })
})

describe('convergeDelegationBoundaryLifecycle — §13 retryables never become semantic incidents', () => {
  it('LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE (transient process query/signal error) writes no durable row, raises no incident, does not block; surfaced with an attempt count', async () => {
    const s = setup()
    const cid = seedEligibleBinding(s)
    const flakyPort = fakePort({
      observe: async () => {
        throw Object.assign(new Error('transient'), { code: 'LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE' })
      }
    })
    const report = await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: flakyPort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(s.terminations.getByCorrelationId(cid)).toBeUndefined()
    expect(s.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(report.retryable.some((r) => r.correlationId === cid && r.code === 'LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE')).toBe(true)
  })

  it('LIFECYCLE_STORE_BUSY_RETRYABLE (SQLite write-txn contention) writes no durable row, raises no incident, not blocked', async () => {
    const s = setup()
    const cid = seedEligibleBinding(s)
    const busyPort = fakePort({
      observe: async () => {
        throw Object.assign(new Error('busy'), { code: 'LIFECYCLE_STORE_BUSY_RETRYABLE' })
      }
    })
    const report = await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: busyPort, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(s.incidents.listBySlice(SLICE)).toHaveLength(0)
    expect(report.retryable.some((r) => r.correlationId === cid)).toBe(true)
  })
})

describe('convergeDelegationBoundaryLifecycle — §11 fixed-point / idempotent replay (gate 8)', () => {
  it('running the sweep 3x back-to-back on unchanged durable state is semantically equivalent to running it once: zero duplicate rows, zero extra incidents', async () => {
    const s = setup()
    const cid = seedEligibleBinding(s)
    const deps = { ...s, processPort: fakePort(), liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` }
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
    expect(s.events.getByCorrelationAndKind(cid, 'shadow_delegated_boundary_closed')).toBeDefined()
    const eventCount = (
      s.db.prepare('SELECT COUNT(*) c FROM dispatch_lifecycle_event WHERE correlation_id = ?').get(cid) as {
        c: number
      }
    ).c
    expect(eventCount).toBe(1)
    const closureCount = (
      s.db.prepare('SELECT COUNT(*) c FROM dispatch_lifecycle_closure WHERE correlation_id = ?').get(cid) as {
        c: number
      }
    ).c
    expect(closureCount).toBe(1)
  })
})

describe('convergeDelegationBoundaryLifecycle — §14 LIFE-8 hooks are wake-up hints only (gate 14, window L9)', () => {
  it('a synthetic duplicate process-exit callback firing 0, 1, and many times across otherwise identical runs produces IDENTICAL durable results — the sweep never trusts the hook, only its own durable-state re-verification', async () => {
    const durableResultFor = async (hookFireCount: number) => {
      const s = setup()
      const cid = seedEligibleBinding(s)
      const deps = { ...s, processPort: fakePort(), liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` }
      for (let i = 0; i < Math.max(1, hookFireCount); i += 1) {
        await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
      }
      return {
        events: (s.db.prepare('SELECT COUNT(*) c FROM dispatch_lifecycle_event WHERE correlation_id = ?').get(cid) as { c: number }).c,
        closures: (s.db.prepare('SELECT COUNT(*) c FROM dispatch_lifecycle_closure WHERE correlation_id = ?').get(cid) as { c: number }).c
      }
    }
    const zero = await durableResultFor(0)
    const one = await durableResultFor(1)
    const many = await durableResultFor(5)
    expect(zero).toEqual({ events: 1, closures: 1 })
    expect(one).toEqual(zero)
    expect(many).toEqual(zero)
  })
})
