// ORCA-S5 Post-Cutover Lifecycle — RED-ONLY sweep driver, raw durable-fact
// readers, snapshots, deterministic crash injection and the no-fallback
// invariant. The lifecycle state machine lives in production
// (`convergeDelegationBoundaryLifecycle`); this file only builds its inputs and
// observes durable rows. "Crash" = a SQLite trigger that RAISEs on one table's
// INSERT followed by close/reopen with fresh store objects (never hand-seeded rows).

import type { expect } from 'vitest'
import { join } from 'node:path'
import type { DelegationBoundaryLifecycleDeps } from '../../application/converge-delegation-boundary-lifecycle'
import { convergeDelegationBoundaryLifecycle } from '../../application/converge-delegation-boundary-lifecycle'
import { DELEGATED_CUTOVER_CORE_SLICE_REF } from './cutover-core-test-harness'
import {
  authorityOf,
  type DelegatedRun,
  type LifecycleFixture,
  type TeardownReason
} from './post-cutover-lifecycle-fixture'
import type {
  FakeOsProcessPort,
  FakeProjectionWriter
} from './post-cutover-lifecycle-os-and-transport-fakes'

export const RETRYABLE_PROCESS_CODE = 'LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE'
export const RETRYABLE_FS_CODE = 'LIFECYCLE_FS_OPERATIONAL_RETRYABLE'
export const RETRYABLE_STORE_CODE = 'LIFECYCLE_STORE_BUSY_RETRYABLE'

export function retryableError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code })
}

// ── Sweep driver ────────────────────────────────────────────────────────────

export type SweepOptions = {
  projectionWriter?: FakeProjectionWriter
  durableShadowWorktreeRoot?: string
  liveHandles?: Map<string, never>
  /** Wrap/replace individual stores (crash / failure injection at the store edge). */
  overrideStores?: Partial<DelegationBoundaryLifecycleDeps>
}

/**
 * Builds the sweep's dependency record over the fixture's CURRENT stores.
 * `delegationCutovers` / `projections` / `projectionWriter` are the optional
 * deps (SPEC §8.1 delegated discrimination; SPEC §10 outbox delivery) — today's
 * sweep simply ignores them, which is itself part of the RED.
 */
export function lifecycleDeps(
  fx: LifecycleFixture,
  port: FakeOsProcessPort,
  opts: SweepOptions = {}
): DelegationBoundaryLifecycleDeps {
  const s = fx.stores
  let idn = 0
  return {
    bindings: s.store,
    settlements: s.settlements,
    dispatchWorktrees: s.dispatchWorktrees,
    provenance: s.provenance,
    worktreeProvenanceIncidents: s.worktreeProvenanceIncidents,
    processBindings: s.processBindings,
    terminations: s.terminations,
    finalizations: s.finalizations,
    closures: s.closures,
    events: s.events,
    incidents: s.incidents,
    processPort: port,
    liveHandles: (opts.liveHandles ?? new Map()) as never,
    durableShadowWorktreeRoot:
      opts.durableShadowWorktreeRoot ?? join(fx.dir, 'durable-shadow-worktrees'),
    durableShadowLifecycleRoot: join(fx.dir, 'durable-shadow-lifecycle'),
    now: fx.clock,
    newId: (prefix: string) => `${prefix}_pc_${++idn}`,
    delegationCutovers: s.delegationCutovers,
    projections: s.projections,
    projectionWriter: opts.projectionWriter,
    ...opts.overrideStores
  } as unknown as DelegationBoundaryLifecycleDeps
}

export function sweep(fx: LifecycleFixture, port: FakeOsProcessPort, opts: SweepOptions = {}) {
  return convergeDelegationBoundaryLifecycle(lifecycleDeps(fx, port, opts), {
    sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF
  })
}

/**
 * Runs the sweep until a pass changes no durable row (or `maxPasses`). Lifecycle
 * phases advance one durable step per pass (S4 §10.2 / §12), and the SPEC
 * freezes NO cadence (§11, §21 item 7) — so correctness is asserted at the
 * fixed point, never against a specific pass count or timer.
 */
export async function sweepToFixedPoint(
  fx: LifecycleFixture,
  port: FakeOsProcessPort,
  opts: SweepOptions = {},
  maxPasses = 8
) {
  let previous = JSON.stringify(snapshotTables(fx))
  let report = await sweep(fx, port, opts)
  let passes = 1
  while (passes < maxPasses) {
    const current = JSON.stringify(snapshotTables(fx))
    if (current === previous) {
      break
    }
    previous = current
    report = await sweep(fx, port, opts)
    passes += 1
  }
  return { report, passes }
}

/**
 * Same as `sweepToFixedPoint` but a thrown sweep error is RETURNED, not
 * propagated. RED tests use it with `expect.soft` so a single test reports EVERY
 * unmet requirement (e.g. finalizer refusal AND missing terminal_status_ref AND
 * missing teardown_reason) instead of stopping at whichever blocker fires first.
 */
export async function settle(
  fx: LifecycleFixture,
  port: FakeOsProcessPort,
  opts: SweepOptions = {},
  maxPasses = 8
) {
  try {
    return {
      ...(await sweepToFixedPoint(fx, port, opts, maxPasses)),
      error: undefined as Error | undefined
    }
  } catch (error) {
    return { report: undefined, passes: 0, error: error as Error }
  }
}

/**
 * ONE sweep pass, error returned not thrown. A pending outbox row's attempt
 * bookkeeping changes on every pass, so tests that count delivery attempts
 * must use explicit single passes (after `settle` reaches the pending row with
 * NO transport wired) — never the fixed-point driver.
 */
export async function sweepOnce(
  fx: LifecycleFixture,
  port: FakeOsProcessPort,
  opts: SweepOptions = {}
) {
  try {
    return { report: await sweep(fx, port, opts), error: undefined as Error | undefined }
  } catch (error) {
    return { report: undefined, error: error as Error }
  }
}

export const SWEEP_MUST_CONVERGE =
  'the delegated sweep converges without throwing (finalizer/coordinator must be delegated-aware)'

// ── Raw durable-fact readers (real persistence, no store-API invention) ────

type SqlParam = string | number | null

export function sqlRow<T = Record<string, unknown>>(
  fx: LifecycleFixture,
  sql: string,
  ...params: SqlParam[]
): T | undefined {
  return fx.stores.db.prepare(sql).get(...params) as T | undefined
}
export function sqlRows<T = Record<string, unknown>>(
  fx: LifecycleFixture,
  sql: string,
  ...params: SqlParam[]
): T[] {
  return fx.stores.db.prepare(sql).all(...params) as T[]
}
export function countRows(
  fx: LifecycleFixture,
  table: string,
  where = '1=1',
  ...params: SqlParam[]
): number {
  return (
    sqlRow<{ c: number }>(fx, `SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, ...params) as {
      c: number
    }
  ).c
}

export const closureOf = (fx: LifecycleFixture, run: DelegatedRun) =>
  sqlRow<Record<string, unknown>>(
    fx,
    'SELECT * FROM dispatch_lifecycle_closure WHERE correlation_id = ?',
    run.correlationId
  )
export const terminationOf = (fx: LifecycleFixture, run: DelegatedRun) =>
  sqlRow<Record<string, unknown>>(
    fx,
    'SELECT * FROM dispatch_termination WHERE correlation_id = ?',
    run.correlationId
  )
export const bindingRowOf = (fx: LifecycleFixture, run: DelegatedRun) =>
  sqlRow<Record<string, unknown>>(
    fx,
    'SELECT * FROM dispatch_process_binding WHERE orca_dispatch_id = ?',
    run.orcaDispatchId
  )
export const finalizationOf = (fx: LifecycleFixture, run: DelegatedRun) =>
  sqlRow<Record<string, unknown>>(
    fx,
    'SELECT * FROM worktree_finalization WHERE correlation_id = ?',
    run.correlationId
  )
export const projectionOf = (fx: LifecycleFixture, run: DelegatedRun) =>
  sqlRow<Record<string, unknown>>(
    fx,
    'SELECT * FROM aicontrol_terminal_projection WHERE correlation_id = ?',
    run.correlationId
  )
export const eventsOf = (fx: LifecycleFixture, run: DelegatedRun) =>
  sqlRows<Record<string, unknown>>(
    fx,
    'SELECT * FROM dispatch_lifecycle_event WHERE correlation_id = ?',
    run.correlationId
  )
export const incidentsOf = (fx: LifecycleFixture, run: DelegatedRun) =>
  sqlRows<Record<string, unknown>>(
    fx,
    'SELECT * FROM dispatch_lifecycle_incident WHERE correlation_id = ?',
    run.correlationId
  )

/** SPEC §9.1: teardown intent — `teardown_requested_at` + `teardown_reason` in ONE statement, CAS on `teardown_requested_at IS NULL`. */
export function requestTeardown(
  fx: LifecycleFixture,
  run: DelegatedRun,
  reason: TeardownReason,
  at = fx.clock()
): void {
  ;(
    fx.stores.processBindings as unknown as {
      markTeardownRequested(id: string, at: string, reason: TeardownReason): void
    }
  ).markTeardownRequested(run.orcaDispatchId, at, reason)
}

// ── Whole-DB snapshots (immutability / fixed-point / restart equivalence) ───

const SNAPSHOT_TABLES = [
  'delegation_cutover',
  'dispatch_process_binding',
  'dispatch_termination',
  'worktree_finalization',
  'dispatch_lifecycle_closure',
  'dispatch_lifecycle_event',
  'dispatch_lifecycle_incident',
  'aicontrol_terminal_projection',
  'run_binding',
  'dispatch_worktree',
  'worktree_provenance',
  'settlement_observation',
  'run_reservation'
] as const

export function snapshotTables(
  fx: LifecycleFixture,
  tables: readonly string[] = SNAPSHOT_TABLES
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const t of tables) {
    out[t] = sqlRows(fx, `SELECT * FROM ${t} ORDER BY rowid`)
  }
  return out
}

/** The row minus per-attempt timestamps/ids — for "same lifecycle result" comparisons across restarts. */
export function stripVolatile(rows: unknown[]): unknown[] {
  return rows.map((r) => {
    const copy = { ...(r as Record<string, unknown>) }
    for (const k of Object.keys(copy)) {
      if (/(_at|^id$|raised_at|last_attempted_at|attempt_count|path|path_ref)$/.test(k)) {
        delete copy[k]
      }
    }
    return copy
  })
}

// ── Deterministic crash injection: a SQLite trigger that aborts ONE write ───

export function injectCrashOnInsert(fx: LifecycleFixture, table: string): { disarm: () => void } {
  const name = `crash_${table}`
  fx.stores.db.exec(
    `CREATE TRIGGER IF NOT EXISTS ${name} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'INJECTED_CRASH_${table}'); END;`
  )
  return { disarm: () => fx.stores.db.exec(`DROP TRIGGER IF EXISTS ${name}`) }
}

// ── No-fallback / no-second-instance invariant (SPEC §5.7, §11, §16, gate 28) ─

export type AuthorityBaseline = {
  reservations: number
  runBindings: number
  processBindings: number
  cutovers: number
  cutoverRow: unknown
  acquireCalls: number
}

export function captureAuthorityBaseline(
  fx: LifecycleFixture,
  run: DelegatedRun
): AuthorityBaseline {
  return {
    reservations: countRows(fx, 'run_reservation'),
    runBindings: countRows(fx, 'run_binding'),
    processBindings: countRows(fx, 'dispatch_process_binding'),
    cutovers: countRows(fx, 'delegation_cutover'),
    cutoverRow: sqlRow(
      fx,
      'SELECT * FROM delegation_cutover WHERE correlation_id = ?',
      run.correlationId
    ),
    acquireCalls: fx.fence.acquireCalls.length
  }
}

/** Every post-cutover path must leave authority exactly where the cutover put it. */
export function assertNoFallback(
  expectFn: typeof expect.soft,
  fx: LifecycleFixture,
  run: DelegatedRun,
  port: FakeOsProcessPort,
  before: AuthorityBaseline
): void {
  expectFn(authorityOf(fx, run.correlationId)).toBe('ORCA_DELEGATED')
  expectFn(port.spawnCalls, 'no second/replacement process is ever spawned').toBe(0)
  expectFn(fx.fence.releaseCalls, 'the fence is never released after cutover').toHaveLength(0)
  expectFn(fx.fence.acquireCalls.length, 'no new fence acquisition / native re-admission').toBe(
    before.acquireCalls
  )
  expectFn(fx.fence.stateOf(run.aicontrolRunId)).toBe('fenced') // fake has no ack step; never returned to 'none'
  expectFn(countRows(fx, 'run_reservation'), 'no replacement reservation').toBe(before.reservations)
  expectFn(countRows(fx, 'run_binding'), 'no replacement run_binding').toBe(before.runBindings)
  expectFn(countRows(fx, 'dispatch_process_binding'), 'no replacement process binding').toBe(
    before.processBindings
  )
  expectFn(countRows(fx, 'delegation_cutover'), 'delegation is never cleared').toBe(before.cutovers)
  expectFn(
    sqlRow(fx, 'SELECT * FROM delegation_cutover WHERE correlation_id = ?', run.correlationId),
    'delegation_cutover is write-once/immutable'
  ).toEqual(before.cutoverRow)
}
