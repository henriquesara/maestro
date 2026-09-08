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

export function makeTmpDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
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
  const rows: [string, string, string, string | null, number, number][] = [
    ['run_a_1', 'agent-A', 'completed', null, 1200, 1],
    ['run_a_2', 'agent-A', 'completed', null, 900, 2],
    ['run_b_1', 'agent-B', 'failed', null, 300, 3],
    ['run_b_2', 'agent-B', 'failed', null, 250, 4],
    ['run_c_1', 'agent-C', 'cancelled', null, 100, 5],
    ['run_c_2', 'agent-C', 'cancelled', null, 80, 6]
  ]
  for (const r of rows) ins.run(...r)
  db.close()
}

export function syntheticWorkload(id: string, steps: SyntheticWorkload['steps']): SyntheticWorkload {
  return { id, steps }
}

const synthetic = (id: string) =>
  ({ id, kind: 'synthetic', declaredCapabilities: [] }) as const

function slot(
  profile: string,
  agentIndex: number,
  status: 'completed' | 'failed' | 'cancelled',
  id: string,
  steps: SyntheticWorkload['steps']
) {
  return { profile, agentIndex, status, descriptor: synthetic(id), workload: syntheticWorkload(id, steps) }
}

export const FROZEN_SAMPLE_REQUEST: SampleRequest = {
  slots: [
    slot('A', 0, 'completed', 's1', [
      { op: 'write', path: 'src/a.txt', content: '1' },
      { op: 'write', path: 'src/b.txt', content: '2' },
      { op: 'exit', code: 0 }
    ]),
    slot('A', 0, 'completed', 's2', [
      { op: 'write', path: 'src/c.txt', content: '3' },
      { op: 'delete', path: 'src/a.txt' },
      { op: 'exit', code: 0 }
    ]),
    slot('B', 1, 'failed', 's3', [
      { op: 'write', path: 'src/d.txt', content: '4' },
      { op: 'exit', code: 1 }
    ]),
    slot('B', 1, 'failed', 's4', [
      { op: 'write', path: 'src/e.txt', content: '5' },
      { op: 'exit', code: 2 }
    ]),
    slot('C', 2, 'cancelled', 's5', [
      { op: 'write', path: 'src/f.txt', content: '6' },
      { op: 'cancel', midFlight: false }
    ]),
    slot('C', 2, 'cancelled', 's6', [
      { op: 'write', path: 'src/g.txt', content: '7' },
      { op: 'cancel', midFlight: true }
    ])
  ]
}

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
