import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SyncDatabase from '../../../sqlite/sync-database'
import { runProcessSync } from '../../../../shared/child-process/run-process'
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

// ORCA-S3 slice test support — shared fixture helpers for the acceptance /
// adversarial / restart suites. Test-only: never production behavior. Mirrors
// `shadow-observation.test-support.ts` (S1/S2) and `workload-git-runtime.ts`'s
// `git()` helper.

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

export function git(args: string[], cwd: string): string {
  const r = runProcessSync({ program: 'git', args, cwd, timeoutMs: 20_000 })
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
  return r.stdout.trim()
}

/** A real, disposable git worktree with one base commit and one work commit. */
export function initRealDurableWorktree(worktreeDir: string): { base: string; head: string } {
  mkdirSync(worktreeDir, { recursive: true })
  git(['init', '-q'], worktreeDir)
  git(['config', 'user.email', 'orca-s3@test.local'], worktreeDir)
  git(['config', 'user.name', 'orca-s3'], worktreeDir)
  git(['config', 'commit.gpgsign', 'false'], worktreeDir)
  writeFileSync(join(worktreeDir, 'a.ts'), 'seed\n')
  git(['add', '-A'], worktreeDir)
  git(['commit', '-q', '-m', 'base'], worktreeDir)
  const base = git(['rev-parse', 'HEAD'], worktreeDir)
  writeFileSync(join(worktreeDir, 'b.ts'), 'change\n')
  git(['add', '-A'], worktreeDir)
  git(['commit', '-q', '-m', 'work'], worktreeDir)
  const head = git(['rev-parse', 'HEAD'], worktreeDir)
  return { base, head }
}

export function writeIdentitySidecarFixture(
  durableRoot: string,
  orcaDispatchId: string,
  identity: {
    correlationId: string
    orcaRunId: string
    orcaDispatchId: string
    worktreeNonce: string
    sliceRef: string
    worktreePath: string
  }
): void {
  mkdirSync(join(durableRoot, 'identity'), { recursive: true })
  writeFileSync(join(durableRoot, 'identity', `${orcaDispatchId}.json`), JSON.stringify(identity))
}

export function fixtureBinding(over: Partial<RunBinding> = {}): RunBinding {
  return {
    correlationId: makeCorrelationId('corr_1'),
    governanceAgentRunId: 'gar_1' as never,
    aicontrolRunId: null,
    orcaRunId: makeOrcaRunRef('run_1'),
    orcaDispatchId: makeOrcaDispatchRef('ctx_1'),
    orgTaskId: makeOrgTaskRef('task_1'),
    sliceRef: 'ORCA-S3',
    baseCommit: 'base000',
    candidateHead: null,
    boundAt: '2026-09-12T00:00:00Z',
    ...over
  }
}

export function fixtureSettlementObservation(over: Record<string, unknown> = {}) {
  return {
    correlationId: 'corr_1',
    orcaDispatchId: 'ctx_1',
    orcaRunId: 'run_1',
    orgTaskId: 'task_1',
    sliceRef: 'ORCA-S3',
    status: 'observed' as const,
    sourceDispatchStatus: 'completed',
    sourceDispatchCompletedAt: '2026-09-12T00:00:00Z',
    sourceTaskStatus: 'completed',
    sourceTaskCompletedAt: '2026-09-12T00:00:00Z',
    sourceDigest: 'x'.repeat(64),
    observedOutcomeJson: '{}',
    provenanceJson: '{}',
    firstSeenAt: '2026-09-12T00:00:00Z',
    observedAt: '2026-09-12T00:00:00Z',
    conflictedAt: null,
    ...over
  }
}

/** Opens every store S3 needs against one real (or ':memory:') Execution SQLite file. */
export function openExecStores(dbPath: (string & {}) | ':memory:' = ':memory:') {
  const db = new SyncDatabase(dbPath)
  // Mirrors settlement-test-harness.ts (S2): fixtures write run_binding /
  // dispatch_worktree / worktree_provenance directly without seeding a
  // matching run_reservation row first, so FK enforcement stays off here.
  db.pragma('foreign_keys = OFF')
  migrateExecutionStore(db)
  return {
    db,
    store: new SqliteExecutionStore(db),
    reservations: new SqliteReservationStore(db),
    settlements: new SqliteSettlementObservationStore(db),
    dispatchWorktrees: new SqliteDispatchWorktreeStore(db),
    provenance: new SqliteWorktreeProvenanceStore(db),
    incidents: new SqliteWorktreeProvenanceIncidentStore(db),
    runBindingCandidateHead: new SqliteRunBindingCandidateHeadStore(db),
    close: () => db.close()
  }
}
