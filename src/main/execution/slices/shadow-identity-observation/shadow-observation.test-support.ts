import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import SyncDatabase from '../../../sqlite/sync-database'
import type { ExecutionPlane, SyntheticWorkload } from '../../application/execution-plane'
import type {
  AuthoritativeRunSource,
  SampleEntry,
  SampleRequest
} from '../../application/authoritative-run-source'
import {
  makeAiControlRunRef,
  makeGovernanceAgentRunRef,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef,
  type RunBinding
} from '../../domain/execution-identity'
import type { ExecutionOutcome } from '../../domain/parity'

// A parseable Orca coordinator pane key, matching the shape Orca's own
// orchestration tests use.
export const COORD_PANE_KEY = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

export function makeTmpDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        // best-effort: Windows can briefly hold a just-closed sqlite handle
      }
    }
  }
}

/** Minimal sqlite file shaped like aiControlCenter `data/app.db` (only the columns the reader touches). */
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
  // Two rows per (agent, status) so the reader's per-pair cursor binds each of
  // the 6 frozen slots to a distinct authoritative row. The 2nd completed-A row
  // carries a recorded `files_changed` (SPEC.md §10 row 2 — the deliberate,
  // *comparable* files-changed divergence); every other row's is null (legacy).
  const rows: [string, string, string, string | null, number, number][] = [
    ['run_a_1', 'agent-A', 'completed', null, 1200, 1],
    ['run_a_2', 'agent-A', 'completed', '["src/recorded-x.txt","src/recorded-y.txt"]', 900, 2],
    ['run_b_1', 'agent-B', 'failed', null, 300, 3],
    ['run_b_2', 'agent-B', 'failed', null, 250, 4],
    ['run_c_1', 'agent-C', 'cancelled', null, 100, 5],
    ['run_c_2', 'agent-C', 'cancelled', null, 80, 6]
  ]
  for (const r of rows) {
    ins.run(...r)
  }
  db.close()
}

export function syntheticWorkload(
  id: string,
  steps: SyntheticWorkload['steps']
): SyntheticWorkload {
  return { id, steps }
}

export { FROZEN_SAMPLE_REQUEST } from './frozen-sample'

export function outcome(partial: Partial<ExecutionOutcome>): ExecutionOutcome {
  return {
    terminalOutcome: 'completed',
    exitDisposition: 'zero_exit',
    cancellationBehavior: 'not_cancelled',
    filesChanged: null,
    ...partial
  }
}

export function fixtureBinding(overrides: Partial<RunBinding> = {}): RunBinding {
  return {
    governanceAgentRunId: makeGovernanceAgentRunRef('gar_1'),
    aicontrolRunId: makeAiControlRunRef('run_a_1'),
    orcaRunId: makeOrcaRunRef('run_orca_1'),
    orcaDispatchId: makeOrcaDispatchRef('ctx_1'),
    orgTaskId: makeOrgTaskRef('task_1'),
    sliceRef: 'ORCA-S1',
    baseCommit: 'base000',
    candidateHead: 'cand111',
    boundAt: '2026-09-08T00:00:00Z',
    ...overrides
  }
}

/** In-memory AuthoritativeRunSource for service tests (no DB). */
export function fakeSource(entries: SampleEntry[]): AuthoritativeRunSource {
  return { resolveSample: (_r: SampleRequest) => entries }
}

/** Vitest-spied ExecutionPlane whose methods can be overridden per test. */
export function fakePlane(overrides: Partial<ExecutionPlane> = {}) {
  const base: ExecutionPlane = {
    openShadowRun: vi.fn(async (i) => ({
      orcaRunRef: makeOrcaRunRef(`orca_run_${i.workloadId}`),
      orcaDispatchRef: makeOrcaDispatchRef(`ctx_${i.workloadId}`),
      orgTaskRef: makeOrgTaskRef(`task_${i.workloadId}`)
    })),
    runShadowWorkload: vi.fn(async () => ({
      exitCode: 0,
      filesChanged: [],
      cancelled: false,
      cancelledMidFlight: false
    })),
    settleShadow: vi.fn(async () => ({
      candidateHead: 'cand',
      outcome: outcome({})
    })),
    abandonShadow: vi.fn(async () => {})
  }
  return Object.assign(base, overrides) as ExecutionPlane & Record<string, ReturnType<typeof vi.fn>>
}
