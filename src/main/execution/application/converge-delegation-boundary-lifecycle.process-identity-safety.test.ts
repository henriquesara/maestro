import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
import { convergeDelegationBoundaryLifecycle } from './converge-delegation-boundary-lifecycle'

// ORCA-S4 SPEC §9.1, §9.3, §14 LIFE-2, §12 window L12, gates 7/24/25, §20 attack
// surface #2 "Bare-pid kill". The decisive assertion throughout this file is
// NOT the returned classification alone — it is a SPY on the actual signal call
// surface (`requestTerminationByPid`), per gate 25's explicit requirement: "so a
// bug that classifies correctly but signals anyway would still fail the gate."
// RED: `./converge-delegation-boundary-lifecycle` does not exist yet.

const SLICE = 'ORCA-S4'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-s4-identity-safety-'))
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

function seedRestartRecoveredBinding(
  s: ReturnType<typeof setup>,
  processBinding: {
    pid: number
    osStartMarker: string
    osStartMarkerSource: 'windows_creation_time' | 'posix_proc_stat_starttime' | 'posix_ps_lstart'
    processNonce: string
  }
) {
  const cid = 'corr_1'
  s.bindings.recordBinding(fixtureBinding({ correlationId: cid as never, sliceRef: SLICE }))
  s.settlements.insert(fixtureSettlementObservation({ correlationId: cid, sliceRef: SLICE }))
  s.provenance.insert(fixtureWorktreeProvenance({ correlationId: cid, sliceRef: SLICE }))
  s.processBindings.insert({
    orcaDispatchId: 'ctx_1',
    correlationId: cid,
    orcaRunId: 'run_1',
    ...processBinding,
    killScope: 'posix-process-group',
    spawnedAt: '2026-09-13T00:00:00Z',
    teardownRequestedAt: null
  })
  return cid
}

function spyPort(behavior: {
  pidExists: boolean
  currentOsStartMarker: string | null
  argv?: string | null
}) {
  const calls: { pid: number }[] = []
  return {
    port: {
      spawn: () => {
        throw new Error('not exercised')
      },
      // No live handle in these scenarios — every case here is restart-recovered
      // (liveHandles is empty), so `observe` is invoked with handle=null and must
      // itself perform the full §9.1 re-verification before ever calling
      // requestTerminationByPid.
      observe: async (
        _handle: unknown,
        _durable: unknown
      ) => {
        // The fixture reports what the OS *actually* shows right now — the
        // production adapter re-reads this live; a fake here stands in for
        // that OS read only, never for the identity DECISION itself.
        return {
          kind: '__raw_os_observation__',
          pidExists: behavior.pidExists,
          currentOsStartMarker: behavior.currentOsStartMarker,
          argv: behavior.argv
        } as never
      },
      requestTermination: async () => ({ verified: true }),
      requestTerminationByPid: async (pid: number) => {
        calls.push({ pid })
        return { verified: true }
      }
    },
    calls
  }
}

describe('convergeDelegationBoundaryLifecycle — bare-pid-kill prevention (§20 attack surface #2, gate 7)', () => {
  it('§12 window L12 — the durably stored pid has been reused by a genuinely unrelated live process (OS-marker disagrees): requestTerminationByPid is NEVER called; a blocking orphan_process_unverifiable incident is raised instead', async () => {
    const s = setup()
    const { port, calls } = spyPort({ pidExists: true, currentOsStartMarker: 'DIFFERENT_MARKER_BELONGS_TO_B' })
    const cid = seedRestartRecoveredBinding(s, {
      pid: 4242,
      osStartMarker: 'MARKER_A',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      processNonce: 'nonce_1'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(calls).toHaveLength(0) // the unrelated process B is NEVER signalled
    expect(s.terminations.getByCorrelationId(cid)).toBeUndefined() // no fabricated termination fact
    const incidents = s.incidents.listBySlice(SLICE)
    expect(incidents).toHaveLength(1)
    expect(incidents[0].kind).toBe('orphan_process_unverifiable')
    expect(incidents[0].blocked).toBe(true)
  })

  it('§12 window L13 — osStartMarkerSource="unavailable": restart-recovered corroboration is unconditionally identity_unverifiable; requestTerminationByPid is NEVER called', async () => {
    const s = setup()
    const { port, calls } = spyPort({ pidExists: true, currentOsStartMarker: null })
    const cid = 'corr_1'
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
      osStartMarker: null,
      osStartMarkerSource: 'unavailable',
      spawnedAt: '2026-09-13T00:00:00Z',
      teardownRequestedAt: null
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(calls).toHaveLength(0)
    expect(s.terminations.getByCorrelationId(cid)).toBeUndefined()
  })

  it('sidecar/db identity mismatch (impossible in practice but must still fail closed): requestTerminationByPid is NEVER called', async () => {
    const s = setup()
    const { port, calls } = spyPort({ pidExists: false, currentOsStartMarker: null })
    seedRestartRecoveredBinding(s, {
      pid: 4242,
      osStartMarker: 'MARKER_A',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      processNonce: 'nonce_1'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(calls).toHaveLength(0)
  })

  it('a genuinely correct restart-recovered identity match DOES authorize exactly one requestTerminationByPid call (positive control — the suite cannot pass by simply never signalling anything)', async () => {
    const s = setup()
    const { port, calls } = spyPort({ pidExists: true, currentOsStartMarker: 'MARKER_A' })
    seedRestartRecoveredBinding(s, {
      pid: 4242,
      osStartMarker: 'MARKER_A',
      osStartMarkerSource: 'posix_proc_stat_starttime',
      processNonce: 'nonce_1'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].pid).toBe(4242)
  })
})

describe('convergeDelegationBoundaryLifecycle — macOS compound identity, gate 25 exhaustive scenarios (§9.1.3, §12 L12 macOS sub-case)', () => {
  const SHAPE = 'shadow-lifecycle-child.mjs'

  it('same-second lstart collision ALONE (checks 1-3 agree) is insufficient — argv is unreadable -> requestTerminationByPid NEVER called', async () => {
    const s = setup()
    const { port, calls } = spyPort({ pidExists: true, currentOsStartMarker: 'Fri Sep 13 00:00:00 2026', argv: null })
    seedRestartRecoveredBinding(s, {
      pid: 4242,
      osStartMarker: 'Fri Sep 13 00:00:00 2026',
      osStartMarkerSource: 'posix_ps_lstart',
      processNonce: 'nonce_A'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(calls).toHaveLength(0)
  })

  it('same-second lstart collision + argv matches shape but carries a DIFFERENT processNonce (another genuine S4 process) -> NEVER signalled', async () => {
    const s = setup()
    const { port, calls } = spyPort({
      pidExists: true,
      currentOsStartMarker: 'Fri Sep 13 00:00:00 2026',
      argv: `node ${SHAPE} --processNonce=nonce_B /tmp/READY hang`
    })
    seedRestartRecoveredBinding(s, {
      pid: 4242,
      osStartMarker: 'Fri Sep 13 00:00:00 2026',
      osStartMarkerSource: 'posix_ps_lstart',
      processNonce: 'nonce_A'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(calls).toHaveLength(0)
  })

  it('positive control: matching lstart + matching shape + EXACT matching processNonce -> exactly one requestTerminationByPid call', async () => {
    const s = setup()
    const { port, calls } = spyPort({
      pidExists: true,
      currentOsStartMarker: 'Fri Sep 13 00:00:00 2026',
      argv: `node ${SHAPE} --processNonce=nonce_A /tmp/READY hang`
    })
    seedRestartRecoveredBinding(s, {
      pid: 4242,
      osStartMarker: 'Fri Sep 13 00:00:00 2026',
      osStartMarkerSource: 'posix_ps_lstart',
      processNonce: 'nonce_A'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(calls).toHaveLength(1)
  })

  it('argv matches synthetic shape but is missing the processNonce token entirely -> NEVER signalled, never a retryable', async () => {
    const s = setup()
    const { port, calls } = spyPort({
      pidExists: true,
      currentOsStartMarker: 'Fri Sep 13 00:00:00 2026',
      argv: `node ${SHAPE} /tmp/READY hang`
    })
    seedRestartRecoveredBinding(s, {
      pid: 4242,
      osStartMarker: 'Fri Sep 13 00:00:00 2026',
      osStartMarkerSource: 'posix_ps_lstart',
      processNonce: 'nonce_A'
    })
    const report = await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    expect(calls).toHaveLength(0)
    expect(report.retryable).toHaveLength(0)
  })

  it('macOS gate-21/gate-25 evidence boundary: the incident detail for a macOS mismatch never claims production executor identity parity', async () => {
    const s = setup()
    const { port } = spyPort({ pidExists: true, currentOsStartMarker: 'Fri Sep 13 00:00:00 2026', argv: null })
    seedRestartRecoveredBinding(s, {
      pid: 4242,
      osStartMarker: 'Fri Sep 13 00:00:00 2026',
      osStartMarkerSource: 'posix_ps_lstart',
      processNonce: 'nonce_A'
    })
    await convergeDelegationBoundaryLifecycle(
      { ...s, processPort: port, liveHandles: new Map(), durableShadowWorktreeRoot: s.durableRoot, durableShadowLifecycleRoot: s.durableRoot, now: () => '2026-09-13T00:00:00Z', newId: (p: string) => `${p}_1` },
      { sliceRef: SLICE }
    )
    const incidents = s.incidents.listBySlice(SLICE)
    expect(incidents).toHaveLength(1)
    expect(incidents[0].detailJson).not.toMatch(/production executor|remote parity|SSH/i)
  })
})
