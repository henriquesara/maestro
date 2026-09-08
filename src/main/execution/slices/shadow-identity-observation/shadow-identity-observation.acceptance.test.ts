import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../../runtime/orchestration/db'
import { sha256File } from '../../infrastructure/aicontrol-db-reader'
import { executeShadowIdentityObservationSlice } from './shadow-identity-observation'
import {
  EXPECTED_DIVERGENCES,
  FROZEN_SAMPLE_REQUEST,
  PARITY_SAMPLE_M,
  PARITY_SAMPLE_N
} from './frozen-sample'
import { COORD_PANE_KEY, makeTmpDir, writeFixtureAppDb } from './shadow-observation.test-support'

// Controlled shadow acceptance fixture (SPEC.md §11). The full ORCA-S1 vertical
// slice over the frozen N=6 / M=3 sample. AICONTROL_NATIVE — no authority moves.
describe('ORCA-S1 acceptance — Shadow Identity & Observation', () => {
  const cleanups: (() => void)[] = []
  let orch: OrchestrationDb | undefined

  afterEach(() => {
    orch?.close()
    orch = undefined
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  async function run() {
    const appDir = makeTmpDir('orca-s1-acc-app-')
    const wtDir = makeTmpDir('orca-s1-acc-wt-')
    cleanups.push(appDir.cleanup, wtDir.cleanup)
    const aicontrolDbPath = join(appDir.dir, 'app.db')
    writeFixtureAppDb(aicontrolDbPath)

    orch = new OrchestrationDb(':memory:')
    let n = 0
    const result = await executeShadowIdentityObservationSlice({
      aicontrolDbPath,
      executionStorePath: ':memory:',
      orchestration: orch,
      coordinatorPaneKey: COORD_PANE_KEY,
      makeWorktreeDir: (runId) => join(wtDir.dir, `wt_${++n}_${runId}`),
      now: () => '2026-09-08T00:00:00Z',
      newId: (prefix) =>
        `${prefix}_${prefix === 'gar' ? ++n : n}_${Math.random().toString(36).slice(2, 8)}`
    })
    return { result, aicontrolDbPath }
  }

  it('gate 6 — one durable binding per shadow run, no orphans, uniqueness holds', async () => {
    const { result } = await run()
    expect(result.bindings.length).toBe(PARITY_SAMPLE_N)
    const dispatchIds = new Set(result.bindings.map((b) => String(b.orcaDispatchId)))
    expect(dispatchIds.size).toBe(PARITY_SAMPLE_N)
    const aicontrolIds = result.bindings.map((b) => b.aicontrolRunId).filter((x) => x !== null)
    expect(new Set(aicontrolIds).size).toBe(aicontrolIds.length)
    // every binding names a real orca run + task + gar (no empty refs)
    for (const b of result.bindings) {
      expect(String(b.orcaRunId).length).toBeGreaterThan(0)
      expect(String(b.orgTaskId).length).toBeGreaterThan(0)
      expect(String(b.governanceAgentRunId).length).toBeGreaterThan(0)
      expect(b.candidateHead).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('gate 5 — every dispatched workload was side-effect-safe; zero exclusions', async () => {
    const { result } = await run()
    expect(result.exclusionCount).toBe(0)
    expect(FROZEN_SAMPLE_REQUEST.slots.every((s) => s.descriptor.kind === 'synthetic')).toBe(true)
  })

  it('gate 8 — parity recorded for all 6 runs; exactly the 2 frozen divergences, each root-caused; no unexpected divergence', async () => {
    const { result } = await run()
    expect(result.observations.length).toBe(PARITY_SAMPLE_N)
    for (const obs of result.observations) {
      if (!obs.parity.match) {
        expect((obs.rootCause ?? '').length).toBeGreaterThan(0)
      }
    }
    const gotDims = result.divergences.map((d) => `${d.dimension}:${d.rootCause}`).sort()
    const wantDims = EXPECTED_DIVERGENCES.map((d) => `${d.dimension}:${d.rootCause}`).sort()
    expect(gotDims).toEqual(wantDims)
    // no divergence tagged unexpected
    expect(result.divergences.some((d) => d.rootCause.includes('unexpected_divergence'))).toBe(
      false
    )
    expect(result.abandoned.length).toBe(0)
  })

  it('gate 8 — the parity comparison covers all four required dimensions', async () => {
    const { result } = await run()
    // rows 1/3/4/5 match on all dims; row 2 diverges on files_changed; row 6 on cancellation.
    const matched = result.observations.filter((o) => o.parity.match)
    expect(matched.length).toBe(4)
    const diverged = result.observations.filter((o) => !o.parity.match)
    const divergedDims = diverged
      .flatMap((o) => o.parity.divergences.map((d) => d.dimension))
      .sort()
    expect(divergedDims).toEqual(['cancellation', 'files_changed'])
  })

  it('gate 9 — data/app.db is byte-identical before and after, no -wal/-shm', async () => {
    const { result, aicontrolDbPath } = await run()
    expect(result.dbGuard.unchanged).toBe(true)
    expect(result.dbGuard.pathHashAfter).toBe(result.dbGuard.pathHashBefore)
    expect(result.dbGuard.sidecarsAfter).toBe(false)
    expect(sha256File(aicontrolDbPath)).toBe(result.dbGuard.pathHashBefore)
    expect(existsSync(`${aicontrolDbPath}-wal`)).toBe(false)
    expect(existsSync(`${aicontrolDbPath}-shm`)).toBe(false)
  })

  it('sample shape matches the frozen declaration (N / M)', () => {
    expect(FROZEN_SAMPLE_REQUEST.slots.length).toBe(PARITY_SAMPLE_N)
    expect(new Set(FROZEN_SAMPLE_REQUEST.slots.map((s) => s.profile)).size).toBe(PARITY_SAMPLE_M)
  })
})
