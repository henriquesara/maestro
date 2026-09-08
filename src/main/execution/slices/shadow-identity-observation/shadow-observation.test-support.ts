import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import type { AuthoritativeExecutor } from '../../application/authoritative-executor'
import type { ExecutionPlane } from '../../application/execution-plane'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import {
  makeCorrelationId,
  makeGovernanceAgentRunRef,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef,
  type RunBinding
} from '../../domain/execution-identity'
import type { ExecutionOutcome } from '../../domain/parity'
import type { WorkloadSpec } from '../../domain/workload-spec'

export const SHADOW_COORD_PANE_KEY = 'tab_orca_s1_shadow:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

export function makeTmpDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort */
      }
    }
  }
}

/** Minimal sqlite file shaped like aiControlCenter `data/app.db`. 3 agents, 2+ rows each. */
export function writeFixtureAppDb(path: string): void {
  const db = new SyncDatabase(path)
  db.exec(`
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL,
      files_changed TEXT, duration_ms INTEGER, created_at INTEGER NOT NULL
    );
  `)
  const ins = db.prepare(
    'INSERT INTO agent_runs (id, agent_id, status, files_changed, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const rows: [string, string, string, string | null, number, number][] = [
    ['run_a_1', 'agent-A', 'completed', null, 1200, 1],
    ['run_a_2', 'agent-A', 'completed', null, 900, 2],
    ['run_a_3', 'agent-A', 'completed', null, 800, 3],
    ['run_b_1', 'agent-B', 'failed', null, 300, 4],
    ['run_b_2', 'agent-B', 'failed', null, 250, 5],
    ['run_c_1', 'agent-C', 'cancelled', null, 100, 6],
    ['run_c_2', 'agent-C', 'cancelled', null, 80, 7]
  ]
  for (const r of rows) {
    ins.run(...r)
  }
  db.close()
}

export function openExecStores(dbPath: (string & {}) | ':memory:' = ':memory:') {
  const db = new SyncDatabase(dbPath)
  db.pragma('foreign_keys = ON')
  migrateExecutionStore(db)
  return {
    db,
    store: new SqliteExecutionStore(db),
    reservations: new SqliteReservationStore(db),
    close: () => db.close()
  }
}

export function workloadSpec(
  id: string,
  steps: WorkloadSpec['steps'],
  extra: Partial<WorkloadSpec> = {}
): WorkloadSpec {
  return { id, steps, ...extra }
}

export function outcome(partial: Partial<ExecutionOutcome> = {}): ExecutionOutcome {
  return {
    terminalOutcome: 'completed',
    exitDisposition: 'zero_exit',
    cancellationBehavior: 'not_cancelled',
    filesChanged: [],
    ...partial
  }
}

export function fixtureBinding(over: Partial<RunBinding> = {}): RunBinding {
  return {
    correlationId: makeCorrelationId('corr_1'),
    governanceAgentRunId: makeGovernanceAgentRunRef('gar_1'),
    aicontrolRunId: null,
    orcaRunId: makeOrcaRunRef('run_orca_1'),
    orcaDispatchId: makeOrcaDispatchRef('ctx_1'),
    orgTaskId: makeOrgTaskRef('task_1'),
    sliceRef: 'ORCA-S1',
    baseCommit: 'base000',
    candidateHead: 'cand111',
    boundAt: '2026-09-08T00:00:00Z',
    ...over
  }
}

/** A vitest-spied ExecutionPlane whose methods can be overridden per test. */
export function fakePlane(overrides: Partial<ExecutionPlane> = {}) {
  const state = new Map<string, { runRef: string; correlationId: string; settled: boolean }>()
  const base: ExecutionPlane = {
    openShadowRun: vi.fn(async (i) => {
      const dispatchId = `ctx_${i.workloadId}`
      state.set(dispatchId, {
        runRef: `orca_run_${i.workloadId}`,
        correlationId: String(i.correlationId),
        settled: false
      })
      return {
        orcaRunRef: makeOrcaRunRef(`orca_run_${i.workloadId}`),
        orcaDispatchRef: makeOrcaDispatchRef(dispatchId),
        orgTaskRef: makeOrgTaskRef(`task_${i.workloadId}`),
        baseCommit: 'base000'
      }
    }),
    runShadowWorkload: vi.fn(async () => ({
      exitCode: 0,
      filesChanged: [],
      cancelled: false,
      cancelledMidFlight: false
    })),
    settleShadow: vi.fn(async (i) => {
      const s = state.get(String(i.orcaDispatchRef))
      if (s) {
        s.settled = true
      }
      return { candidateHead: '0'.repeat(40), outcome: outcome() }
    }),
    abandonShadow: vi.fn(async (i) => {
      const s = state.get(String(i.orcaDispatchRef))
      if (s) {
        s.settled = true
      }
    }),
    findShadowRunByCorrelation: vi.fn((cid) => {
      for (const [dispatchId, s] of state) {
        if (s.correlationId === String(cid)) {
          return {
            orcaRunRef: makeOrcaRunRef(s.runRef),
            orcaDispatchRef: makeOrcaDispatchRef(dispatchId),
            orgTaskRef: makeOrgTaskRef(`task_${dispatchId}`),
            settled: s.settled
          }
        }
      }
      return undefined
    })
  }
  return Object.assign(base, overrides) as ExecutionPlane & Record<string, ReturnType<typeof vi.fn>>
}

/** A deterministic in-memory AuthoritativeExecutor for service tests. */
export function fakeAuthoritativeExecutor(
  fn?: (spec: WorkloadSpec) => ExecutionOutcome
): AuthoritativeExecutor {
  return {
    execute: async ({ spec }) => ({
      outcome: fn ? fn(spec) : outcome(),
      baseCommit: 'b'.repeat(40),
      headCommit: 'h'.repeat(40)
    })
  }
}
