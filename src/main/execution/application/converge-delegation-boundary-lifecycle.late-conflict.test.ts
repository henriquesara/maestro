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
import {
  fixtureBinding,
  fixtureSettlementObservation,
  fixtureWorktreeProvenance
} from '../slices/delegated-side-effect-boundary/delegated-side-effect-boundary-test-harness'
import { convergeDelegationBoundaryLifecycle, type ProcessLifecycleObservationLike } from './converge-delegation-boundary-lifecycle'

// ORCA-S4 SPEC §8.0.1, §11 Phase 5, §12 window L14, §14 LIFE-15, gate 23 — the
// exact scenario review finding B1 requires. RED:
// `./converge-delegation-boundary-lifecycle` does not exist yet.

const SLICE = 'ORCA-S4'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s4-late-conflict-'))
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

const fakePort = {
  spawn: () => {
    throw new Error('not exercised')
  },
  observe: async (): Promise<ProcessLifecycleObservationLike> => ({ kind: 'self_exit', exitCode: 0, exitSignal: null }),
  requestTermination: async () => ({ verified: true }),
  requestTerminationByPid: async () => ({ verified: true })
}

describe('convergeDelegationBoundaryLifecycle — Phase 5 late post-closure contradiction (gate 23, LIFE-15)', () => {
  afterEach(() => {})

  it('(1) S4 closes a binding while settlement_observation.status="observed"; (2) closure+event durably written; (3) a later ORCA-S2 Phase B sweep legitimately transitions status to "observed_conflicted"; (4) closure/event rows are byte-for-byte UNCHANGED; (5) the NEXT sweep Phase 5 sets post_closure_settlement_conflict_detected_at and raises a blocking incident; (6) a future delegation/projection consumer refuses to copy the closure while the marker is set', async () => {
    const s = setup()
    const cid = 'corr_1'
    s.bindings.recordBinding(fixtureBinding({ correlationId: cid as never, sliceRef: SLICE }))
    s.settlements.insert(fixtureSettlementObservation({ correlationId: cid, sliceRef: SLICE, status: 'observed' }))
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

    const deps = {
      ...s,
      processPort: fakePort,
      liveHandles: new Map(),
      durableShadowWorktreeRoot: s.durableRoot,
      now: () => '2026-09-13T00:00:00Z',
      newId: (p: string) => `${p}_1`
    }

    // (1)+(2) — first sweep closes the binding while status='observed'.
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
    const closureBefore = s.closures.getByCorrelationId(cid)
    expect(closureBefore?.settlementStatusRef).toBe('observed')
    expect(closureBefore?.postClosureSettlementConflictDetectedAt).toBeNull()
    const eventBefore = s.events.getByCorrelationAndKind(cid, 'shadow_delegated_boundary_closed')
    expect(eventBefore).toBeDefined()

    // (3) — an independent, LATER, legitimate ORCA-S2 Phase B transition. Never
    // performed by S4 — this directly models S2's own frozen contract allowing
    // 'observed' -> 'observed_conflicted' at any later time, with no quiescence
    // point. Applied directly against the store S4 never writes to.
    s.db
      .prepare("UPDATE settlement_observation SET status = 'observed_conflicted', conflicted_at = ? WHERE correlation_id = ?")
      .run('2026-09-14T00:00:00Z', cid)

    // (4) — closure/event rows must be byte-for-byte unchanged by that upstream
    // write alone (they are SOURCE, never touched by anything but S4's own
    // Phase 5 marker mutation).
    expect(s.closures.getByCorrelationId(cid)).toEqual(closureBefore)
    expect(s.events.getByCorrelationAndKind(cid, 'shadow_delegated_boundary_closed')).toEqual(eventBefore)

    // (5) — the NEXT sweep's Phase 5 deterministically detects the divergence.
    const deps2 = { ...deps, now: () => '2026-09-15T00:00:00Z' }
    await convergeDelegationBoundaryLifecycle(deps2, { sliceRef: SLICE })

    const closureAfter = s.closures.getByCorrelationId(cid)
    expect(closureAfter?.postClosureSettlementConflictDetectedAt).toBe('2026-09-15T00:00:00Z')
    // Every other column remains exactly what it was at closure time — NEVER
    // rewritten to 'observed_conflicted'.
    expect(closureAfter?.settlementStatusRef).toBe('observed')
    expect(closureAfter?.closureDigest).toBe(closureBefore?.closureDigest)

    const incidents = s.incidents.listBySlice(SLICE)
    const lateConflict = incidents.find((i) => i.kind === 'post_closure_settlement_conflict')
    expect(lateConflict).toBeDefined()
    expect(lateConflict?.blocked).toBe(true)
    expect(lateConflict?.detailJson).toContain('observed')
    expect(lateConflict?.detailJson).toContain('observed_conflicted')

    // (6) — a (test-only) future delegation/projection consumer refuses to copy
    // a closure carrying the marker.
    function wouldCopyToDataAppDb(closure: { postClosureSettlementConflictDetectedAt: string | null }): boolean {
      return closure.postClosureSettlementConflictDetectedAt === null
    }
    expect(wouldCopyToDataAppDb(closureAfter!)).toBe(false)
  })

  it('Phase 5 runs on EVERY sweep pass, for EVERY existing closure — not only newly eligible bindings, and its mutation is idempotent (fixed-point)', async () => {
    const s = setup()
    const cid = 'corr_1'
    s.bindings.recordBinding(fixtureBinding({ correlationId: cid as never, sliceRef: SLICE }))
    s.settlements.insert(fixtureSettlementObservation({ correlationId: cid, sliceRef: SLICE, status: 'observed' }))
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
    const deps = {
      ...s,
      processPort: fakePort,
      liveHandles: new Map(),
      durableShadowWorktreeRoot: s.durableRoot,
      now: () => '2026-09-13T00:00:00Z',
      newId: (p: string) => `${p}_1`
    }
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
    s.db
      .prepare("UPDATE settlement_observation SET status = 'observed_conflicted', conflicted_at = ? WHERE correlation_id = ?")
      .run('2026-09-14T00:00:00Z', cid)

    const deps2 = { ...deps, now: () => '2026-09-15T00:00:00Z' }
    await convergeDelegationBoundaryLifecycle(deps2, { sliceRef: SLICE })
    await convergeDelegationBoundaryLifecycle(deps2, { sliceRef: SLICE })
    await convergeDelegationBoundaryLifecycle(deps2, { sliceRef: SLICE })

    const incidents = s.incidents.listBySlice(SLICE).filter((i) => i.kind === 'post_closure_settlement_conflict')
    expect(incidents).toHaveLength(1) // UNIQUE-index no-op on retry, same evidence_digest
    expect(s.closures.getByCorrelationId(cid)?.postClosureSettlementConflictDetectedAt).toBe('2026-09-15T00:00:00Z')
  })

  it('no divergence -> Phase 5 is a no-op: marker stays NULL, no incident raised', async () => {
    const s = setup()
    const cid = 'corr_1'
    s.bindings.recordBinding(fixtureBinding({ correlationId: cid as never, sliceRef: SLICE }))
    s.settlements.insert(fixtureSettlementObservation({ correlationId: cid, sliceRef: SLICE, status: 'observed' }))
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
    const deps = {
      ...s,
      processPort: fakePort,
      liveHandles: new Map(),
      durableShadowWorktreeRoot: s.durableRoot,
      now: () => '2026-09-13T00:00:00Z',
      newId: (p: string) => `${p}_1`
    }
    await convergeDelegationBoundaryLifecycle(deps, { sliceRef: SLICE })
    await convergeDelegationBoundaryLifecycle({ ...deps, now: () => '2026-09-20T00:00:00Z' }, { sliceRef: SLICE })
    expect(s.closures.getByCorrelationId(cid)?.postClosureSettlementConflictDetectedAt).toBeNull()
    expect(s.incidents.listBySlice(SLICE).filter((i) => i.kind === 'post_closure_settlement_conflict')).toHaveLength(0)
  })
})
