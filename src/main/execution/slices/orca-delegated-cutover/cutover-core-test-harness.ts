// ORCA-S5 Delegated Cutover Core — RED-ONLY shared fixture helpers.
// Test-only: never production behavior (AGENTS.md "Reuse Before
// Reimplementing" + this session's own "test-only fixtures/harnesses are
// allowed only to express the contract"). Reuses the real, existing
// `openExecStores`/`makeTmpDir` fixtures ORCA-S4's own RED session already
// built (`delegated-side-effect-boundary-test-harness.ts`) rather than
// duplicating them — those stores (SqliteReservationStore, SqliteExecutionStore,
// SqliteDispatchWorktreeStore, ...) are all real, published, unchanged by this
// session. Adds only what ORCA-S5 needs and nothing prior sessions already
// provide: a distinct S5 slice_ref, dispatch-process-binding fixtures, and a
// narrow in-memory fake for the aiControl fence handshake (SPEC §4.8.5 /
// CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md §14 `AiControlFenceClientPort`) —
// never the real network/DB-backed `orca-fence.ts`.

import type {
  DispatchProcessBindingRecord,
  OsStartMarkerSource
} from '../../domain/dispatch-process-binding'
import type { CorrelationId, RunBinding } from '../../domain/execution-identity'
import {
  makeCorrelationId,
  makeGovernanceAgentRunRef,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef
} from '../../domain/execution-identity'
import type { ReservationStore, RunReservation } from '../../application/reservation-store'
import { SqliteDispatchProcessBindingStore } from '../../infrastructure/sqlite-dispatch-process-binding-store'
import type SyncDatabase from '../../../sqlite/sync-database'

export {
  makeTmpDir,
  openExecStores
} from '../delegated-side-effect-boundary/delegated-side-effect-boundary-test-harness'

/**
 * Distinct from the shadow-observation slice's own `SHADOW_IDENTITY_OBSERVATION_SLICE_REF
 * = 'ORCA-S1'` (`frozen-sample.ts:15`) — required by the frozen correction
 * (SPEC.md §5.2/§4.8.1, round 5) so the two flows can never collide under the
 * real schema's `run_reservation_authoritative_workload` unique index, which
 * is scoped `(slice_ref, authoritative_run_ref, workload_id) WHERE state !=
 * 'abandoned'` — confirmed against `execution-schema.ts` this session.
 */
export const DELEGATED_CUTOVER_CORE_SLICE_REF = 'ORCA-S5-DELEGATED-CUTOVER-CORE'

export function fixtureCorrelationId(id = 'corr_dc_1'): CorrelationId {
  return makeCorrelationId(id)
}

/** A future S5 `run_reservation` row, written via the real, existing, generic
 *  `SqliteReservationStore.reserve()` — no production writer is added by this
 *  session; only the *decision of when to call it* (the coordinator) is
 *  missing. */
export function reserveFixture(
  reservations: { reserve: (input: Parameters<ReservationStore['reserve']>[0]) => RunReservation },
  over: {
    correlationId?: string
    authoritativeRunRef?: string | null
    workloadId?: string
    now?: string
  } = {}
): RunReservation {
  return reservations.reserve({
    correlationId: fixtureCorrelationId(over.correlationId ?? 'corr_dc_1'),
    sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF,
    authoritativeRunRef: over.authoritativeRunRef ?? 'aicontrol_run_dc_1',
    workloadId: over.workloadId ?? 'workload_dc_1',
    now: over.now ?? '2026-09-17T00:00:00Z'
  })
}

export function fixtureRunBinding(over: Partial<RunBinding> = {}): RunBinding {
  return {
    correlationId: fixtureCorrelationId(),
    governanceAgentRunId: makeGovernanceAgentRunRef('gar_dc_1'),
    aicontrolRunId: null,
    orcaRunId: makeOrcaRunRef('run_dc_1'),
    orcaDispatchId: makeOrcaDispatchRef('dispatch_dc_1'),
    orgTaskId: makeOrgTaskRef('task_dc_1'),
    sliceRef: DELEGATED_CUTOVER_CORE_SLICE_REF,
    baseCommit: 'c'.repeat(40),
    candidateHead: null,
    boundAt: '2026-09-17T00:00:00Z',
    ...over
  }
}

export function fixtureDispatchWorktree(over: Record<string, unknown> = {}) {
  return {
    orcaDispatchId: 'dispatch_dc_1',
    correlationId: 'corr_dc_1',
    orcaRunId: 'run_dc_1',
    worktreeNonce: 'wnonce_dc_1',
    worktreePath: 'unused',
    rootRef: 'root_gen_dc_1',
    openedAt: '2026-09-17T00:00:00Z',
    ...over
  }
}

export function fixtureProcessIdentity(
  over: Partial<DispatchProcessBindingRecord> = {}
): DispatchProcessBindingRecord {
  return {
    orcaDispatchId: 'dispatch_dc_1',
    correlationId: 'corr_dc_1',
    orcaRunId: 'run_dc_1',
    processNonce: 'process_nonce_dc_1',
    pid: 999123,
    killScope: 'posix-process-group',
    osStartMarker: '1000',
    osStartMarkerSource: 'posix_proc_stat_starttime' as OsStartMarkerSource,
    spawnedAt: '2026-09-17T00:00:00Z',
    teardownRequestedAt: null,
    ...over
  }
}

export function openProcessBindingStore(db: SyncDatabase) {
  return new SqliteDispatchProcessBindingStore(db)
}

// ── Fake aiControl fence client (SPEC §4.8.5 `AiControlFenceClientPort`) ───
//
// Semantics re-derived this session, read-only, directly from the real
// `orca-fence.ts` at aiControlCenter `origin/master` (ab5967bdde5115afe5673e
// 8b520a73cfb29f0eaf) — `acquireOrcaFence`'s CAS (`status IN ('pending',
// 'queued') AND orca_fence_state = 'none'`), `safeReleaseOrcaFence`'s
// evidence-gated CAS (`orca_fence_state = 'fenced' AND orca_fence_token =
// token`), and `acknowledgeOrcaCutover`'s CAS (same predicate, sets
// 'cutover'). This fake reproduces the SAME outcome enums and the SAME
// idempotent/conflict dispositions in memory — it never opens a network
// connection or a real database, and it is never the real
// `AiControlFenceClientPort` production type (that type does not exist yet;
// see the coordinator/commit-step RED below). Test-only (§35 of this
// mission: "the minimum test fake needed to express the published aiControl
// contract").

export type FenceRow = {
  runId: string
  eligible: boolean
  state: 'none' | 'fenced' | 'cutover'
  token: string | null
}

export type AcquireFenceOutcome =
  | 'ACQUIRED'
  | 'ALREADY_FENCED_SAME_TOKEN'
  | 'CONFLICT_DIFFERENT_TOKEN'
  | 'ALREADY_CUTOVER'
  | 'NOT_ELIGIBLE'
  | 'ACQUISITION_DISABLED'

export type SafeReleaseOutcome = 'RELEASED' | 'REJECTED_NO_EVIDENCE' | 'REJECTED_STALE'
export type AcknowledgeOutcome = 'ACKNOWLEDGED' | 'REJECTED_STALE' | 'REJECTED_WRONG_TOKEN'

export class FakeAiControlFenceClient {
  private readonly rows = new Map<string, FenceRow>()
  acquisitionEnabled = true
  readonly acquireCalls: { runId: string; token: string }[] = []
  readonly releaseCalls: { runId: string; token: string; positiveNoCutoverEvidence: boolean }[] = []
  readonly acknowledgeCalls: { runId: string; token: string }[] = []

  /** Test setup only — models an eligible (pending/queued, unfenced) aiControl AgentRun. */
  seedEligible(runId: string): void {
    this.rows.set(runId, { runId, eligible: true, state: 'none', token: null })
  }

  seedIneligible(runId: string): void {
    this.rows.set(runId, { runId, eligible: false, state: 'none', token: null })
  }

  async acquireOrcaFence(input: {
    runId: string
    token: string
  }): Promise<{ outcome: AcquireFenceOutcome; runId: string; token?: string }> {
    this.acquireCalls.push({ runId: input.runId, token: input.token })
    if (!this.acquisitionEnabled) {
      return { outcome: 'ACQUISITION_DISABLED', runId: input.runId }
    }
    const row = this.rows.get(input.runId)
    if (!row) {
      return { outcome: 'NOT_ELIGIBLE', runId: input.runId }
    }
    if (row.state === 'none' && row.eligible) {
      row.state = 'fenced'
      row.token = input.token
      return { outcome: 'ACQUIRED', runId: input.runId, token: input.token }
    }
    if (row.state === 'fenced') {
      return row.token === input.token
        ? { outcome: 'ALREADY_FENCED_SAME_TOKEN', runId: input.runId, token: input.token }
        : { outcome: 'CONFLICT_DIFFERENT_TOKEN', runId: input.runId }
    }
    if (row.state === 'cutover') {
      return { outcome: 'ALREADY_CUTOVER', runId: input.runId }
    }
    return { outcome: 'NOT_ELIGIBLE', runId: input.runId }
  }

  async safeReleaseOrcaFence(input: {
    runId: string
    token: string
    positiveNoCutoverEvidence: boolean
  }): Promise<{ outcome: SafeReleaseOutcome; runId: string }> {
    this.releaseCalls.push(input)
    if (!input.positiveNoCutoverEvidence) {
      return { outcome: 'REJECTED_NO_EVIDENCE', runId: input.runId }
    }
    const row = this.rows.get(input.runId)
    if (row && row.state === 'fenced' && row.token === input.token) {
      row.state = 'none'
      row.token = null
      return { outcome: 'RELEASED', runId: input.runId }
    }
    return { outcome: 'REJECTED_STALE', runId: input.runId }
  }

  async acknowledgeOrcaCutover(input: {
    runId: string
    token: string
  }): Promise<{ outcome: AcknowledgeOutcome; runId: string }> {
    this.acknowledgeCalls.push(input)
    const row = this.rows.get(input.runId)
    if (row && row.state === 'fenced' && row.token === input.token) {
      row.state = 'cutover'
      return { outcome: 'ACKNOWLEDGED', runId: input.runId }
    }
    if (row && row.state === 'cutover' && row.token === input.token) {
      return { outcome: 'ACKNOWLEDGED', runId: input.runId }
    }
    if (row && row.state === 'fenced' && row.token !== input.token) {
      return { outcome: 'REJECTED_WRONG_TOKEN', runId: input.runId }
    }
    return { outcome: 'REJECTED_STALE', runId: input.runId }
  }

  /** Test-only introspection — never part of the future real port. */
  stateOf(runId: string): FenceRow['state'] | undefined {
    return this.rows.get(runId)?.state
  }
}

// ── Fake aiControl-native cancellation authority (§29/§30) ─────────────────
// Models ONLY the one fact §29/§30 need: whether aiControl-side cancellation
// has already won for a run, before any durable Maestro fact exists. Never a
// real route/IPC integration (mission §29: "no real route integration").
export class FakeAiControlCancellationAuthority {
  private readonly cancelled = new Set<string>()

  cancel(runId: string): void {
    this.cancelled.add(runId)
  }

  isCancelled(runId: string): boolean {
    return this.cancelled.has(runId)
  }
}
