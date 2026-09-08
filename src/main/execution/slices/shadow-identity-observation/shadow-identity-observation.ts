import { existsSync } from 'node:fs'
import SyncDatabase from '../../../sqlite/sync-database'
import { OrchestrationDb } from '../../../runtime/orchestration/db'
import {
  runShadowObservation,
  type ShadowObservationReport,
  type ShadowSampleSlot
} from '../../application/shadow-observation-service'
import {
  AiControlDbReader,
  assertNoSqliteSidecars,
  DbGuardError,
  sha256File
} from '../../infrastructure/aicontrol-db-reader'
import { AuthoritativeReferenceExecutor } from '../../infrastructure/authoritative-reference-executor'
import { DisposableShadowRoot } from '../../infrastructure/disposable-shadow-root'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { assertExecutionStorePathNotAlias } from '../../infrastructure/execution-store-path-guard'
import { OrcaExecutionPlane } from '../../infrastructure/orca-execution-plane'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import {
  FROZEN_SLOTS,
  PARITY_SAMPLE_M,
  SHADOW_IDENTITY_OBSERVATION_SLICE_REF
} from './frozen-sample'

// ORCA-S1 vertical slice composition root (bounded context: Execution).
// - B4: path-alias guard BEFORE any writable open.
// - B6: constructs its OWN dedicated shadow OrchestrationDb + a dedicated shadow
//   coordinator pane key; never accepts a caller's live OrchestrationDb.
// - B5: every worktree lives under one disposable shadow root.
// - B2: reconciliation runs first inside runShadowObservation.
// - Gate 9: operational DB guard around the whole thing.

// A pane key shape no real Orca run uses — so createRun's unbindOtherRunsForPane
// can never touch a real run.
const SHADOW_COORD_PANE_KEY = 'tab_orca_s1_shadow:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

export type ShadowIdentityObservationInput = {
  aicontrolDbPath: string
  /** Execution-owned store path, or ':memory:'. Rejected if it aliases data/app.db. */
  executionStorePath: (string & {}) | ':memory:'
  /** Shadow orchestration DB path, or ':memory:'. Defaults to a file under the disposable root. */
  shadowOrchestrationPath?: (string & {}) | ':memory:'
  now?: () => string
  newId?: (prefix: string) => string
}

export type ShadowIdentityObservationResult = ShadowObservationReport & {
  dbGuard: {
    pathHashBefore: string
    pathHashAfter: string
    sidecarsAfter: boolean
    unchanged: boolean
  }
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

  const shadowOrchPath = input.shadowOrchestrationPath ?? shadowRoot.shadowOrchestrationDbPath()
  const shadowOrchestration = new OrchestrationDb(shadowOrchPath)
  const plane = new OrcaExecutionPlane(shadowOrchestration, SHADOW_COORD_PANE_KEY)

  const reader = new AiControlDbReader(input.aicontrolDbPath)
  const profiles = reader.listProfiles()
  reader.close()

  let counter = 0
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? ((prefix: string) => `${prefix}_${++counter}`)

  const slots: ShadowSampleSlot[] = []
  for (const frozen of FROZEN_SLOTS) {
    const profile =
      frozen.profileIndex < PARITY_SAMPLE_M ? profiles[frozen.profileIndex] : undefined
    const authoritativeRunRef = profile?.runIds[frozen.occurrence] ?? null
    slots.push({
      profile: profile?.agentId ?? `profile-${frozen.profileIndex}`,
      authoritativeRunRef,
      descriptor: frozen.descriptor,
      workload: frozen.workload
    })
  }

  let report: ShadowObservationReport
  try {
    report = await runShadowObservation(
      {
        authoritativeExecutor: new AuthoritativeReferenceExecutor(),
        plane,
        store,
        reservations
      },
      {
        sliceRef: SHADOW_IDENTITY_OBSERVATION_SLICE_REF,
        slots,
        shadowRoot: shadowRoot.root,
        worktreeDirFor: (kind, correlationId) => shadowRoot.worktreeDir(`${kind}-${correlationId}`),
        now,
        newId
      }
    )
  } finally {
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
    dbGuard: {
      pathHashBefore,
      pathHashAfter,
      sidecarsAfter,
      unchanged: pathHashBefore === pathHashAfter && !sidecarsAfter
    }
  }
}
