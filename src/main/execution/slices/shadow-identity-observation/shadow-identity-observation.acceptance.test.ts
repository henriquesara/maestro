import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sha256File } from '../../infrastructure/aicontrol-db-reader'
import {
  executeShadowIdentityObservationSlice,
  type ShadowIdentityObservationResult
} from './shadow-identity-observation'
import {
  EXPECTED_DIVERGENCES,
  FROZEN_SLOTS,
  PARITY_SAMPLE_M,
  PARITY_SAMPLE_N
} from './frozen-sample'
import { makeTmpDir, writeFixtureAppDb } from './shadow-observation.test-support'

// Controlled same-workload acceptance fixture (SPEC.md §11 + SPEC-AMENDMENT-001).
// The full ORCA-S1 vertical slice — AICONTROL_NATIVE, no authority moves. The
// slice constructs its own dedicated shadow OrchestrationDb + disposable root;
// the fixture only supplies a disposable data/app.db copy (never the real one).
describe('ORCA-S1 acceptance — Shadow Identity & Observation (corrected)', () => {
  let appDir: { dir: string; cleanup: () => void }
  let aicontrolDbPath: string
  let result: ShadowIdentityObservationResult
  let hashBefore: string

  beforeAll(async () => {
    appDir = makeTmpDir('orca-s1-acc-app-')
    aicontrolDbPath = join(appDir.dir, 'app.db')
    writeFixtureAppDb(aicontrolDbPath)
    hashBefore = sha256File(aicontrolDbPath)
    let n = 0
    result = await executeShadowIdentityObservationSlice({
      aicontrolDbPath,
      executionStorePath: ':memory:',
      shadowOrchestrationPath: ':memory:',
      now: () => '2026-09-08T00:00:00Z',
      newId: (p) => `${p}_${++n}`
    })
  }, 60_000)

  afterAll(() => appDir.cleanup())

  it('gate 6 — one durable binding per shadow run, distinct dispatch + correlation ids, no orphans', () => {
    expect(result.bindings.length).toBe(PARITY_SAMPLE_N)
    expect(new Set(result.bindings.map((b) => String(b.orcaDispatchId))).size).toBe(PARITY_SAMPLE_N)
    expect(new Set(result.bindings.map((b) => String(b.correlationId))).size).toBe(PARITY_SAMPLE_N)
    const authIds = result.bindings.map((b) => b.aicontrolRunId).filter((x) => x !== null)
    expect(new Set(authIds).size).toBe(authIds.length)
    for (const b of result.bindings) {
      expect(b.candidateHead).toMatch(/^[0-9a-f]{40}$/)
      expect(String(b.orcaRunId).length).toBeGreaterThan(0)
    }
  })

  it('gate 5 — every dispatched workload was auto-admitted synthetic; zero exclusions; zero abandoned', () => {
    expect(result.exclusionCount).toBe(0)
    expect(result.abandoned.length).toBe(0)
    expect(FROZEN_SLOTS.every((s) => s.descriptor.kind === 'synthetic')).toBe(true)
  })

  it('gate 8 — same-workload parity for all 6 runs; exactly the 2 frozen divergences, each explained with evidence', () => {
    expect(result.observations.length).toBe(PARITY_SAMPLE_N)
    for (const obs of result.observations) {
      for (const adj of obs.adjudications) {
        expect(adj.status).toBe('explained')
        expect(adj.evidence.length).toBeGreaterThan(0)
      }
    }
    const got = result.observations
      .filter((o) => !o.parity.match)
      .flatMap((o) =>
        o.parity.divergences.map((d) => ({
          workloadId: o.workloadId,
          dimension: d.dimension,
          classifiedCause: o.adjudications.find((a) => a.dimension === d.dimension)?.classifiedCause
        }))
      )
      .sort((a, b) => a.workloadId.localeCompare(b.workloadId))
    expect(got).toEqual(
      [...EXPECTED_DIVERGENCES].sort((a, b) => a.workloadId.localeCompare(b.workloadId))
    )
    expect(result.divergences.some((d) => d.adjudicationStatus !== 'explained')).toBe(false)
  })

  it('gate 8 — the 4 non-divergent runs match on all four dimensions; the divergent runs match on the others', () => {
    const matched = result.observations.filter((o) => o.parity.match)
    expect(matched.length).toBe(4)
    const divergedDims = result.observations
      .filter((o) => !o.parity.match)
      .flatMap((o) => o.parity.divergences.map((d) => d.dimension))
      .sort()
    expect(divergedDims).toEqual(['cancellation', 'files_changed'])
  })

  it('gate 8 — files_changed comes from a real diff: s4 records the real deletion', () => {
    const s4 = result.observations.find((o) => o.workloadId === 's4')!
    expect(s4.authoritative.filesChanged).toEqual(['src/e.txt', 'src/to-delete.txt'].sort())
    expect(s4.parity.match).toBe(true)
  })

  it('gate 9 — data/app.db byte-identical before and after; no -wal/-shm', () => {
    expect(result.dbGuard.unchanged).toBe(true)
    expect(result.dbGuard.pathHashAfter).toBe(hashBefore)
    expect(sha256File(aicontrolDbPath)).toBe(hashBefore)
    expect(existsSync(`${aicontrolDbPath}-wal`)).toBe(false)
    expect(existsSync(`${aicontrolDbPath}-shm`)).toBe(false)
  })

  it('B2 — reconcile ran first and found nothing to recover on a clean pass', () => {
    expect(result.reconcile.scanned).toBe(0)
    expect(result.reconcile.abandoned).toBe(0)
  })

  it('sample shape matches the frozen declaration (N / M)', () => {
    expect(FROZEN_SLOTS.length).toBe(PARITY_SAMPLE_N)
    expect(new Set(FROZEN_SLOTS.map((s) => s.profileIndex)).size).toBe(PARITY_SAMPLE_M)
  })
})
