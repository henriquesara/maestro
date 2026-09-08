import { existsSync } from 'node:fs'
import type { OrchestrationDb } from '../../../runtime/orchestration/db'
import {
  runShadowObservation,
  type ShadowObservationReport
} from '../../application/shadow-observation-service'
import {
  AiControlDbReader,
  assertNoSqliteSidecars,
  DbGuardError,
  sha256File
} from '../../infrastructure/aicontrol-db-reader'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { OrcaExecutionPlane } from '../../infrastructure/orca-execution-plane'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { FROZEN_SAMPLE_REQUEST, SHADOW_IDENTITY_OBSERVATION_SLICE_REF } from './frozen-sample'

// ORCA-S1 vertical slice composition root (bounded context: Execution).
// Wires the read-only authoritative source + Execution-owned store + the Orca
// shadow adapter, runs the shadow observation, and asserts the operational
// DB guard (SPEC.md §11 gate 9) around the whole thing.

export type ShadowIdentityObservationInput = {
  aicontrolDbPath: string
  /** Execution-owned store path, or ':memory:'. Never data/app.db. */
  executionStorePath: (string & {}) | ':memory:'
  orchestration: OrchestrationDb
  coordinatorPaneKey: string
  /** Disposable root for shadow worktrees. */
  makeWorktreeDir: (runId: string) => string
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

  const reader = new AiControlDbReader(input.aicontrolDbPath)
  const store = new SqliteExecutionStore(input.executionStorePath)
  migrateExecutionStore(store.database)
  const plane = new OrcaExecutionPlane(
    input.orchestration,
    input.coordinatorPaneKey,
    input.makeWorktreeDir
  )

  let counter = 0
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? ((prefix: string) => `${prefix}_${++counter}`)

  let report: ShadowObservationReport
  try {
    report = await runShadowObservation(
      { source: reader, plane, store },
      {
        sliceRef: SHADOW_IDENTITY_OBSERVATION_SLICE_REF,
        request: FROZEN_SAMPLE_REQUEST,
        worktreeRoot: '',
        makeWorktreeDir: input.makeWorktreeDir,
        now,
        newId
      }
    )
  } finally {
    reader.close()
    store.close()
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
