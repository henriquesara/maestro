import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SyncDatabase from '../../../sqlite/sync-database'
import { OrchestrationDb } from '../../../runtime/orchestration/db'
import {
  runShadowObservation,
  type ShadowObservationReport,
  type ShadowSampleSlot
} from '../../application/shadow-observation-service'
import type { WorktreeProvenanceDeps } from '../../application/worktree-provenance-bind-step'
import type { ShadowSettlementDeps } from '../../application/reconcile-shadow-execution-state'
import {
  assertNoSqliteSidecars,
  DbGuardError,
  sha256File
} from '../../infrastructure/aicontrol-db-reader'
import type { NativeRunResult } from '../../infrastructure/aicontrol-native/disposable-aicontrol-env'
import { NativeResultsAuthoritativeExecutor } from '../../infrastructure/aicontrol-native/native-results-authoritative-executor'
import { DisposableShadowRoot } from '../../infrastructure/disposable-shadow-root'
import {
  durableShadowWorktreeDir,
  resolveDurableShadowWorktreeRoot
} from '../../infrastructure/durable-shadow-worktree-root'
import { resolveDurableShadowOrchestrationPath } from '../../infrastructure/durable-shadow-orchestration-path'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { assertExecutionStorePathNotAlias } from '../../infrastructure/execution-store-path-guard'
import { OrcaExecutionPlane } from '../../infrastructure/orca-execution-plane'
import { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { ReadOnlyWorktreeProvenanceSource } from '../../infrastructure/read-only-worktree-provenance-source'
import { SqliteDispatchWorktreeStore } from '../../infrastructure/sqlite-dispatch-worktree-store'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { SqliteRunBindingCandidateHeadStore } from '../../infrastructure/sqlite-run-binding-candidate-head-store'
import { SqliteSettlementIncidentStore } from '../../infrastructure/sqlite-settlement-incident-store'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import { SqliteWorktreeProvenanceIncidentStore } from '../../infrastructure/sqlite-worktree-provenance-incident-store'
import { SqliteWorktreeProvenanceStore } from '../../infrastructure/sqlite-worktree-provenance-store'
import { FROZEN_SLOTS, SHADOW_IDENTITY_OBSERVATION_SLICE_REF } from './frozen-sample'

// ORCA-S1 vertical slice composition root (bounded context: Execution).
// ORCA-S2 §17, §21 — extended, the SINGLE composition boundary: it resolves the
// durable OUT-OF-ROOT shadow orchestration.db path (config →
// execution_meta.shadow_orchestration_path persist / re-verify →
// ShadowSourcePathMismatchError / ShadowSettlementSourceMissingError), constructs
// the writer OrchestrationDb AND the read-only ReadOnlyShadowSettlementSource
// against that one path, owns the cleanup split (durable DB not disposed with the
// root), and invokes reconcileShadowExecutionState via runShadowObservation.
// - Gate 8 authoritative side: the REAL aiControl native `agent_runs` results.
// - B4: path-alias guard BEFORE any writable open.
// - Gate 9: canonical data/app.db guard (sha256 + sidecars) around the whole run.
// ORCA-S3 §10 — extended again, this SAME composition boundary: resolves the
// durable OUT-OF-DisposableShadowRoot shadow-worktree root (config →
// execution_meta.durable_shadow_worktree_root persist / re-verify →
// DurableShadowWorktreeRootMismatchError / DurableShadowWorktreeRootMissingError),
// routes worktreeDirFor('shadow', …) under it (the 'auth' worktree stays under
// DisposableShadowRoot), constructs the DurableWorktreeSource + the three S3
// stores, and owns the cleanup split (the durable shadow worktree root — worktrees
// AND identity sidecars — is not disposed with DisposableShadowRoot and is never
// removed by S3). Present only when a real durable shadow orchestration.db is
// also composed (S3 depends on S2's settled-status truth).

const SHADOW_COORD_PANE_KEY = 'tab_orca_s1_shadow:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEFAULT_DURABLE_SHADOW_DB = join(tmpdir(), 'maestro', 'orca-s2', 'shadow-orchestration.db')
const DEFAULT_DURABLE_SHADOW_WORKTREE_ROOT = join(tmpdir(), 'maestro', 'orca-s3', 'shadow-worktrees')

export type ShadowIdentityObservationInput = {
  /** Canonical aiControlCenter data/app.db — GUARD ONLY (sha256 + sidecars). Never opened. */
  aicontrolDbPath: string
  /** Execution-owned store path, or ':memory:'. Rejected if it aliases data/app.db. */
  executionStorePath: (string & {}) | ':memory:'
  /**
   * The ONE durable shadow orchestration.db path (§17), or ':memory:' for a
   * single-process test (no durable-path persistence, no S2 convergence).
   * Defaults to a stable out-of-root path.
   */
  shadowOrchestrationPath?: (string & {}) | ':memory:'
  /**
   * ORCA-S3 §10 — the ONE durable, out-of-DisposableShadowRoot shadow-worktree
   * root path. Defaults to a stable out-of-root path. Only resolved / composed
   * when a real durable shadow orchestration.db is also composed
   * (`shadowOrchestrationPath !== ':memory:'`).
   */
  durableShadowWorktreeRootPath?: string
  /** Real terminal results of the aiControl native runs (one per frozen workload). */
  nativeResults: readonly NativeRunResult[]
  /** §9 / §15.2 — cutoff after which a still-non-terminal bound Dispatch is abandoned. */
  staleAfter?: number
  now?: () => string
  newId?: (prefix: string) => string
}

export type ShadowIdentityObservationResult = ShadowObservationReport & {
  nativeProfiles: { agentId: string; runIds: string[] }[]
  dbGuard: {
    pathHashBefore: string
    pathHashAfter: string
    sidecarsAfter: boolean
    unchanged: boolean
  }
}

/** Group the native results into M controlled agent profiles (AMENDMENT-002 §5). */
function nativeProfiles(
  results: readonly NativeRunResult[]
): { agentId: string; runIds: string[] }[] {
  const byAgent = new Map<string, string[]>()
  for (const r of results) {
    const list = byAgent.get(r.agentId) ?? []
    list.push(r.aicontrolRunId)
    byAgent.set(r.agentId, list)
  }
  return [...byAgent.entries()].map(([agentId, runIds]) => ({ agentId, runIds }))
}

export async function executeShadowIdentityObservationSlice(
  input: ShadowIdentityObservationInput
): Promise<ShadowIdentityObservationResult> {
  if (!existsSync(input.aicontrolDbPath)) {
    throw new DbGuardError(`aiControlCenter DB not found: ${input.aicontrolDbPath}`)
  }
  assertNoSqliteSidecars(input.aicontrolDbPath)
  const pathHashBefore = sha256File(input.aicontrolDbPath)

  // B4 — refuse an Execution store path that aliases data/app.db, before opening it writable.
  assertExecutionStorePathNotAlias(input.executionStorePath, input.aicontrolDbPath)

  const shadowRoot = DisposableShadowRoot.create()
  const execDb = new SyncDatabase(input.executionStorePath)
  execDb.pragma('journal_mode = WAL')
  execDb.pragma('foreign_keys = ON')
  migrateExecutionStore(execDb)
  const store = new SqliteExecutionStore(execDb)
  const reservations = new SqliteReservationStore(execDb)

  const configuredShadowPath = input.shadowOrchestrationPath ?? DEFAULT_DURABLE_SHADOW_DB
  const memoryMode = configuredShadowPath === ':memory:'

  // §17 — resolve + re-verify the durable OUT-OF-ROOT path BEFORE first use.
  // Fails closed (ShadowSourcePathMismatchError / ShadowSettlementSourceMissingError).
  const durablePath = memoryMode
    ? null
    : resolveDurableShadowOrchestrationPath(execDb, configuredShadowPath)

  const shadowOrchestration = new OrchestrationDb(memoryMode ? ':memory:' : durablePath!)
  const plane = new OrcaExecutionPlane(shadowOrchestration, SHADOW_COORD_PANE_KEY)

  let source: ReadOnlyShadowSettlementSource | null = null
  let settlement: ShadowSettlementDeps | undefined
  let worktreeProvenance: WorktreeProvenanceDeps | undefined
  if (!memoryMode && durablePath) {
    source = new ReadOnlyShadowSettlementSource(durablePath)
    settlement = {
      source,
      observations: new SqliteSettlementObservationStore(execDb),
      incidents: new SqliteSettlementIncidentStore(execDb),
      txn: store,
      sourceDbPath: durablePath
    }

    // §10 — resolve + re-verify the durable shadow-worktree root BEFORE first
    // use. Fails closed (DurableShadowWorktreeRootMismatchError /
    // DurableShadowWorktreeRootMissingError).
    const configuredWorktreeRoot =
      input.durableShadowWorktreeRootPath ?? DEFAULT_DURABLE_SHADOW_WORKTREE_ROOT
    const durableWorktreeRoot = resolveDurableShadowWorktreeRoot(execDb, configuredWorktreeRoot)
    worktreeProvenance = {
      dispatchWorktrees: new SqliteDispatchWorktreeStore(execDb),
      provenance: new SqliteWorktreeProvenanceStore(execDb),
      incidents: new SqliteWorktreeProvenanceIncidentStore(execDb),
      runBindingCandidateHead: new SqliteRunBindingCandidateHeadStore(execDb),
      source: new ReadOnlyWorktreeProvenanceSource(),
      durableShadowWorktreeRoot: durableWorktreeRoot,
      txn: store
    }
  }

  const profiles = nativeProfiles(input.nativeResults)

  let counter = 0
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? ((prefix: string) => `${prefix}_${++counter}`)

  const nativeByWorkload = new Map(input.nativeResults.map((r) => [r.workloadId, r]))
  const slots: ShadowSampleSlot[] = FROZEN_SLOTS.map((frozen) => {
    const native = nativeByWorkload.get(frozen.workload.id)
    return {
      profile: native?.agentId ?? `profile-${frozen.profileIndex}`,
      authoritativeRunRef: native?.aicontrolRunId ?? null,
      descriptor: frozen.descriptor,
      workload: frozen.workload
    }
  })

  let report: ShadowObservationReport
  try {
    report = await runShadowObservation(
      {
        authoritativeExecutor: new NativeResultsAuthoritativeExecutor(input.nativeResults),
        plane,
        store,
        reservations,
        settlement,
        worktreeProvenance
      },
      {
        sliceRef: SHADOW_IDENTITY_OBSERVATION_SLICE_REF,
        slots,
        shadowRoot: shadowRoot.root,
        // §10 — the 'shadow' worktree lives under the durable, out-of-root
        // shadow-worktree root when S3 is composed; 'auth' always stays
        // disposable.
        shadowWorktreeRoot: worktreeProvenance?.durableShadowWorktreeRoot,
        worktreeDirFor: (kind, correlationId) =>
          kind === 'shadow' && worktreeProvenance
            ? durableShadowWorktreeDir(worktreeProvenance.durableShadowWorktreeRoot, `shadow-${correlationId}`)
            : shadowRoot.worktreeDir(`${kind}-${correlationId}`),
        now,
        newId,
        staleAfter: input.staleAfter
      }
    )
  } finally {
    // §17 cleanup split: the durable shadow orchestration.db is NOT disposed with
    // the root and is NEVER deleted here.
    source?.close()
    shadowOrchestration.close()
    execDb.close()
    shadowRoot.cleanup()
  }

  const pathHashAfter = sha256File(input.aicontrolDbPath)
  let sidecarsAfter = false
  try {
    assertNoSqliteSidecars(input.aicontrolDbPath)
  } catch {
    sidecarsAfter = true
  }

  return {
    ...report,
    nativeProfiles: profiles,
    dbGuard: {
      pathHashBefore,
      pathHashAfter,
      sidecarsAfter,
      unchanged: pathHashBefore === pathHashAfter && !sidecarsAfter
    }
  }
}
