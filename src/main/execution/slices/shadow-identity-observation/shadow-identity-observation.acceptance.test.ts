import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sha256File } from '../../infrastructure/aicontrol-db-reader'
import {
  resolveCanonicalAiControlRepo,
  runAiControlNativeFixture,
  type NativeFixtureOutcome
} from '../../infrastructure/aicontrol-native/disposable-aicontrol-env'
import { nativeOutcome } from '../../infrastructure/aicontrol-native/native-results-authoritative-executor'
import {
  executeShadowIdentityObservationSlice,
  type ShadowIdentityObservationResult
} from './shadow-identity-observation'
import {
  EXPECTED_DIVERGENCES,
  FROZEN_SLOTS,
  NATIVE_WORKLOAD_REQUESTS,
  PARITY_SAMPLE_M,
  PARITY_SAMPLE_N
} from './frozen-sample'

// ORCA-S1 acceptance — REAL aiControlCenter native parity (SPEC-AMENDMENT-002).
// The authoritative side of Gate 8 is an ACTUAL aiControl native execution:
// `createRun -> runAgent -> executeClaimedRun -> getExecutor(mock) ->
// finalizeRunOnce` driven in a DISPOSABLE copy of the canonical checkout. Six
// genuine disposable `agent_runs` across three controlled agent identities. The
// canonical data/app.db is read-only (sha256 verified before/after) and never
// opened. Authority stays AICONTROL_NATIVE.

const FORK_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')
const repo = resolveCanonicalAiControlRepo(FORK_ROOT)
const canonicalDbPath = join(repo.repoPath, 'data', 'app.db')
const CAN_RUN = repo.ok && existsSync(canonicalDbPath)

if (!CAN_RUN) {
  // eslint-disable-next-line no-console
  console.warn(
    `[ORCA-S1 native acceptance] SKIPPED — ${repo.reason ?? 'canonical data/app.db missing'}. ` +
      `Set ORCA_S1_AICONTROL_REPO to the aiControlCenter checkout to run it.`
  )
}

describe.skipIf(!CAN_RUN)('ORCA-S1 acceptance — native aiControl parity (AMENDMENT-002)', () => {
  let native: NativeFixtureOutcome
  let result: ShadowIdentityObservationResult
  let dbHashBefore: string
  let dbHashAfter: string

  beforeAll(async () => {
    dbHashBefore = sha256File(canonicalDbPath)

    native = await runAiControlNativeFixture({
      repoPath: repo.repoPath,
      requests: [...NATIVE_WORKLOAD_REQUESTS],
      scratchDir: join(tmpdir(), 'orca-s1-native-acceptance')
    })

    let n = 0
    result = await executeShadowIdentityObservationSlice({
      aicontrolDbPath: canonicalDbPath,
      executionStorePath: ':memory:',
      shadowOrchestrationPath: ':memory:',
      nativeResults: native.results,
      now: () => '2026-09-08T00:00:00Z',
      newId: (p) => `${p}_${++n}`
    })

    dbHashAfter = sha256File(canonicalDbPath)
  }, 300_000)

  afterAll(() => {
    // scratchDir copies are self-cleaned by runAiControlNativeFixture.
  })

  it('produced six GENUINE disposable agent_runs across three controlled profiles', () => {
    expect(native.results.length).toBe(PARITY_SAMPLE_N)
    expect(native.distinctRunIds.length).toBe(PARITY_SAMPLE_N)
    expect(native.distinctAgentIds.length).toBe(PARITY_SAMPLE_M)
    for (const r of native.results) {
      expect(r.aicontrolRunId).toMatch(/[0-9a-f-]{16,}/) // a real agent_runs.id
      expect(['completed', 'failed', 'cancelled', 'timeout']).toContain(r.status)
      // A real execution_attempts row closed by the native lifecycle:
      if (r.status !== 'cancelled') {
        expect(r.attemptStatus).not.toBeNull()
      }
    }
    expect(result.nativeProfiles.length).toBe(PARITY_SAMPLE_M)
    expect(result.nativeProfiles.every((p) => p.runIds.length === 2)).toBe(true)
  })

  it('the native terminal outcomes match the controlled workload shapes (read back, not derived)', () => {
    const byId = new Map(native.results.map((r) => [r.workloadId, r]))
    expect(byId.get('s1')!.status).toBe('completed')
    expect(byId.get('s2')!.status).toBe('completed')
    expect(byId.get('s3')!.status).toBe('failed')
    expect(byId.get('s3')!.attemptExitCode).toBe(2)
    expect(byId.get('s3')!.attemptErrorClassification).toBe('NONZERO_EXIT')
    expect(byId.get('s4')!.status).toBe('failed')
    expect(byId.get('s4')!.attemptExitCode).toBe(5)
    expect(byId.get('s5')!.status).toBe('cancelled')
    expect(byId.get('s6')!.status).toBe('cancelled')
  })

  it('gate 6 — one durable binding per shadow run, distinct dispatch + correlation ids, no orphans', () => {
    expect(result.bindings.length).toBe(PARITY_SAMPLE_N)
    expect(new Set(result.bindings.map((b) => String(b.orcaDispatchId))).size).toBe(PARITY_SAMPLE_N)
    expect(new Set(result.bindings.map((b) => String(b.correlationId))).size).toBe(PARITY_SAMPLE_N)
    const authIds = result.bindings.map((b) => b.aicontrolRunId).filter((x) => x !== null)
    expect(new Set(authIds).size).toBe(authIds.length)
    expect(authIds.length).toBe(PARITY_SAMPLE_N) // every binding carries a real native run id
    for (const b of result.bindings) {
      expect(b.candidateHead).toMatch(/^[0-9a-f]{40}$/)
      expect(String(b.orcaRunId).length).toBeGreaterThan(0)
    }
  })

  it('gate 5 — every dispatched workload auto-admitted synthetic; zero exclusions; zero abandoned', () => {
    expect(result.exclusionCount).toBe(0)
    expect(result.abandoned.length).toBe(0)
    expect(FROZEN_SLOTS.every((s) => s.descriptor.kind === 'synthetic')).toBe(true)
  })

  it('gate 8 — all six naturally match on all four dimensions; zero divergences; nothing manufactured', () => {
    expect(result.observations.length).toBe(PARITY_SAMPLE_N)
    expect(EXPECTED_DIVERGENCES.length).toBe(0)
    for (const obs of result.observations) {
      expect(obs.parity.match).toBe(true)
      expect(obs.parity.divergences.length).toBe(0)
      expect(obs.adjudications.length).toBe(0) // no divergence => no adjudication needed
    }
    expect(result.divergences.length).toBe(0)
  })

  it('gate 8 — authoritative (native) and shadow outcome vectors are equal per workload', () => {
    const nativeById = new Map(native.results.map((r) => [r.workloadId, nativeOutcome(r)]))
    for (const obs of result.observations) {
      const auth = nativeById.get(obs.workloadId)!
      expect(obs.authoritative.terminalOutcome).toBe(auth.terminalOutcome)
      expect(obs.authoritative.exitDisposition).toBe(auth.exitDisposition)
      expect(obs.authoritative.cancellationBehavior).toBe(auth.cancellationBehavior)
      expect(obs.authoritative).toEqual(obs.shadow)
    }
  })

  it('gate 8 — files_changed came from real repository evidence and is empty on both sides', () => {
    for (const r of native.results) {
      expect(r.filesChanged).toEqual([]) // git diff --name-only in the disposable workspace
      expect(r.gitDiffAfterEmpty).toBe(true) // runner.ts captured an empty git_diff_after
    }
    for (const obs of result.observations) {
      expect(obs.authoritative.filesChanged).toEqual([])
      expect(obs.shadow.filesChanged).toEqual([])
    }
  })

  it('gate 9 — canonical data/app.db byte-identical before and after; no -wal/-shm', () => {
    expect(dbHashAfter).toBe(dbHashBefore)
    expect(result.dbGuard.unchanged).toBe(true)
    expect(result.dbGuard.pathHashAfter).toBe(dbHashBefore)
    expect(sha256File(canonicalDbPath)).toBe(dbHashBefore)
    expect(existsSync(`${canonicalDbPath}-wal`)).toBe(false)
    expect(existsSync(`${canonicalDbPath}-shm`)).toBe(false)
  })

  it('B2 — reconcile ran first and found nothing to recover on a clean pass', () => {
    expect(result.reconcile.scanned).toBe(0)
    expect(result.reconcile.abandoned).toBe(0)
  })

  it('sample shape matches the frozen declaration (N / M)', () => {
    expect(FROZEN_SLOTS.length).toBe(PARITY_SAMPLE_N)
    expect(new Set(FROZEN_SLOTS.map((s) => s.profileIndex)).size).toBe(PARITY_SAMPLE_M)
    expect(NATIVE_WORKLOAD_REQUESTS.length).toBe(PARITY_SAMPLE_N)
  })
})
