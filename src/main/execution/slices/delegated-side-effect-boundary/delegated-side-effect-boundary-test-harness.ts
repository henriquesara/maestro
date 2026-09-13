import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SyncDatabase from '../../../sqlite/sync-database'
import {
  makeCorrelationId,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef,
  type RunBinding
} from '../../domain/execution-identity'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { SqliteDispatchWorktreeStore } from '../../infrastructure/sqlite-dispatch-worktree-store'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { SqliteRunBindingCandidateHeadStore } from '../../infrastructure/sqlite-run-binding-candidate-head-store'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import { SqliteWorktreeProvenanceIncidentStore } from '../../infrastructure/sqlite-worktree-provenance-incident-store'
import { SqliteWorktreeProvenanceStore } from '../../infrastructure/sqlite-worktree-provenance-store'

// ORCA-S4 slice test support — RED-ONLY shared fixture helpers. Test-only:
// never production behavior (AGENTS.md "Reuse Before Reimplementing" + the RED
// session's own "test-only fixtures/harnesses are allowed only to express the
// contract"). Mirrors `worktree-provenance-test-harness.ts` (S3) and
// `settlement-test-harness.ts` (S2) exactly, extended with S4's six new
// tables/stores. Kept SEPARATE from `openExecStores` (S1-S3, all real today) so
// a test that only needs S1-S3 fixtures never fails to import merely because an
// S4 store does not exist yet — each RED failure stays attributable to the one
// missing piece it actually exercises.

export function makeTmpDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort — Windows may hold a transient handle */
      }
    }
  }
}

export function fixtureBinding(over: Partial<RunBinding> = {}): RunBinding {
  return {
    correlationId: makeCorrelationId('corr_1'),
    governanceAgentRunId: 'gar_1' as never,
    aicontrolRunId: null,
    orcaRunId: makeOrcaRunRef('run_1'),
    orcaDispatchId: makeOrcaDispatchRef('ctx_1'),
    orgTaskId: makeOrgTaskRef('task_1'),
    sliceRef: 'ORCA-S4',
    baseCommit: 'base000',
    candidateHead: null,
    boundAt: '2026-09-13T00:00:00Z',
    ...over
  }
}

export function fixtureSettlementObservation(over: Record<string, unknown> = {}) {
  return {
    correlationId: 'corr_1',
    orcaDispatchId: 'ctx_1',
    orcaRunId: 'run_1',
    orgTaskId: 'task_1',
    sliceRef: 'ORCA-S4',
    status: 'observed' as const,
    sourceDispatchStatus: 'completed',
    sourceDispatchCompletedAt: '2026-09-13T00:00:00Z',
    sourceTaskStatus: 'completed',
    sourceTaskCompletedAt: '2026-09-13T00:00:00Z',
    sourceDigest: 'x'.repeat(64),
    observedOutcomeJson: '{}',
    provenanceJson: '{}',
    firstSeenAt: '2026-09-13T00:00:00Z',
    observedAt: '2026-09-13T00:00:00Z',
    conflictedAt: null,
    ...over
  }
}

export function fixtureWorktreeProvenance(over: Record<string, unknown> = {}) {
  return {
    correlationId: 'corr_1',
    orcaDispatchId: 'ctx_1',
    orcaRunId: 'run_1',
    sliceRef: 'ORCA-S4',
    status: 'recorded' as const,
    baseCommit: 'base000',
    candidateHead: 'head000',
    filesChangedJson: '[]',
    provenanceSource: 'synchronous_capture' as const,
    worktreePathRef: 'unused',
    provenanceDigest: 'y'.repeat(64),
    provenanceJson: '{}',
    firstSeenAt: '2026-09-13T00:00:00Z',
    observedAt: '2026-09-13T00:00:00Z',
    conflictedAt: null,
    ...over
  }
}

export function fixtureDispatchWorktree(over: Record<string, unknown> = {}) {
  return {
    orcaDispatchId: 'ctx_1',
    correlationId: 'corr_1',
    orcaRunId: 'run_1',
    worktreeNonce: 'wnonce_1',
    worktreePath: 'unused',
    rootRef: 'root_gen_1',
    openedAt: '2026-09-13T00:00:00Z',
    ...over
  }
}

/** Opens every S1-S3 store S4 reads as an eligibility input — all real today. */
export function openExecStores(dbPath: (string & {}) | ':memory:' = ':memory:') {
  const db = new SyncDatabase(dbPath)
  db.pragma('foreign_keys = OFF')
  migrateExecutionStore(db)
  return {
    db,
    store: new SqliteExecutionStore(db),
    reservations: new SqliteReservationStore(db),
    settlements: new SqliteSettlementObservationStore(db),
    dispatchWorktrees: new SqliteDispatchWorktreeStore(db),
    provenance: new SqliteWorktreeProvenanceStore(db),
    worktreeProvenanceIncidents: new SqliteWorktreeProvenanceIncidentStore(db),
    runBindingCandidateHead: new SqliteRunBindingCandidateHeadStore(db),
    close: () => db.close()
  }
}

/**
 * The process identity sidecar (§9.2 step 3/4, §4). Test-only writer — the
 * real bind-time seam does not exist yet (`ShadowLifecycleProcessPort` /
 * `shadow-observation-service.ts` extension, §9.2), so RED tests write the
 * sidecar directly to express the contract's shape, mirroring
 * `writeIdentitySidecarFixture` (S3).
 */
export type ProcessIdentitySidecar = {
  correlationId: string
  orcaRunId: string
  orcaDispatchId: string
  processNonce: string
  spawnedAt: string | null
  pid: number | null
  osStartMarker: string | null
  osStartMarkerSource: 'windows_creation_time' | 'posix_proc_stat_starttime' | 'posix_ps_lstart' | 'unavailable' | null
}

export function writeProcessIdentitySidecarFixture(
  durableLifecycleRoot: string,
  orcaDispatchId: string,
  sidecar: ProcessIdentitySidecar
): string {
  const dir = join(durableLifecycleRoot, 'process')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${orcaDispatchId}.json`)
  writeFileSync(path, JSON.stringify(sidecar))
  return path
}

export function fixtureProcessIdentitySidecar(
  over: Partial<ProcessIdentitySidecar> = {}
): ProcessIdentitySidecar {
  return {
    correlationId: 'corr_1',
    orcaRunId: 'run_1',
    orcaDispatchId: 'ctx_1',
    processNonce: 'nonce_1',
    spawnedAt: '2026-09-13T00:00:00Z',
    pid: 999999,
    osStartMarker: '1000',
    osStartMarkerSource: 'posix_proc_stat_starttime',
    ...over
  }
}

/** The disposable, separately-killable synthetic shadow lifecycle process fixture. */
export const SHADOW_LIFECYCLE_CHILD = join(__dirname, 'shadow-lifecycle-child.mjs')
