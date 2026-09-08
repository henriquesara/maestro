import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adjudicate,
  runShadowObservation,
  type ShadowSampleSlot
} from './shadow-observation-service'
import { compareOutcomes } from '../domain/parity'
import {
  fakeAuthoritativeExecutor,
  fakePlane,
  openExecStores,
  outcome,
  workloadSpec
} from '../slices/shadow-identity-observation/shadow-observation.test-support'

const SYN = { kind: 'synthetic' as const, declaredCapabilities: [] as const }

function slot(id: string, over: Partial<ShadowSampleSlot> = {}): ShadowSampleSlot {
  return {
    profile: 'p',
    authoritativeRunRef: `run_${id}`,
    descriptor: { id, ...SYN },
    workload: workloadSpec(id, [{ op: 'exit', code: 0 }]),
    ...over
  }
}

function input(slots: ShadowSampleSlot[]) {
  let n = 0
  return {
    sliceRef: 'ORCA-S1',
    slots,
    shadowRoot: process.cwd(), // confinement checks are exercised elsewhere; steps here are exit-only
    worktreeDirFor: (k: 'auth' | 'shadow', c: string) => `${process.cwd()}/x/${k}-${c}`,
    now: () => '2026-09-08T00:00:00Z',
    newId: (p: string) => `${p}_${++n}`
  }
}

describe('runShadowObservation — I2 / I5 / B9 with a durable reservation lifecycle', () => {
  let ctx: ReturnType<typeof openExecStores> | undefined
  afterEach(() => {
    ctx?.close()
    ctx = undefined
  })

  it('I2 — an ineligible workload never reaches the ExecutionPlane', async () => {
    ctx = openExecStores()
    const plane = fakePlane()
    const bad = slot('bad', {
      descriptor: {
        id: 'bad',
        kind: 'external_effect',
        declaredCapabilities: ['mutating_external_api']
      }
    })
    await runShadowObservation(
      {
        authoritativeExecutor: fakeAuthoritativeExecutor(),
        plane,
        store: ctx.store,
        reservations: ctx.reservations
      },
      input([bad])
    )
    expect(plane.openShadowRun).not.toHaveBeenCalled()
    expect(ctx.store.listExclusions('ORCA-S1').length).toBe(1)
    expect(ctx.reservations.listAll('ORCA-S1').length).toBe(0)
  })

  it('I5 — a plane failure is contained: run abandoned, reservation abandoned, does not reject', async () => {
    ctx = openExecStores()
    const plane = fakePlane({
      runShadowWorkload: vi.fn(async () => {
        throw new Error('boom in the shadow adapter')
      })
    })
    const report = await runShadowObservation(
      {
        authoritativeExecutor: fakeAuthoritativeExecutor(),
        plane,
        store: ctx.store,
        reservations: ctx.reservations
      },
      input([slot('w1')])
    )
    expect(report.abandoned.length).toBe(1)
    expect(plane.abandonShadow).toHaveBeenCalled()
    expect(ctx.reservations.listAll('ORCA-S1')[0].state).toBe('abandoned')
  })

  it('B9 — an unexplained mismatch throws inside the run and is contained as abandoned (never accepted)', async () => {
    ctx = openExecStores()
    const plane = fakePlane({
      settleShadow: vi.fn(async () => ({
        candidateHead: '0'.repeat(40),
        // diverges on terminal_outcome — no deliberate cause → unresolved
        outcome: outcome({ terminalOutcome: 'failed', exitDisposition: 'non_zero_exit' })
      }))
    })
    const report = await runShadowObservation(
      {
        authoritativeExecutor: fakeAuthoritativeExecutor(() => outcome()),
        plane,
        store: ctx.store,
        reservations: ctx.reservations
      },
      input([slot('w1')])
    )
    expect(report.observations.length).toBe(0)
    expect(report.abandoned.length).toBe(1)
    expect(report.abandoned[0].reason).toMatch(/unresolved|not explained/i)
  })

  it('records a full binding + observation for a clean same-workload run', async () => {
    ctx = openExecStores()
    const plane = fakePlane()
    const report = await runShadowObservation(
      {
        authoritativeExecutor: fakeAuthoritativeExecutor(() => outcome()),
        plane,
        store: ctx.store,
        reservations: ctx.reservations
      },
      input([slot('w1')])
    )
    expect(report.bindings.length).toBe(1)
    expect(report.observations.length).toBe(1)
    expect(ctx.reservations.listAll('ORCA-S1')[0].state).toBe('observed')
    expect(
      ctx.store.getBindingByCorrelation(String(report.bindings[0].correlationId))
    ).toBeDefined()
  })

  it('B2 idempotency — a re-run with an already-observed reservation does not re-dispatch', async () => {
    ctx = openExecStores()
    const plane = fakePlane()
    const one = input([slot('w1')])
    await runShadowObservation(
      {
        authoritativeExecutor: fakeAuthoritativeExecutor(),
        plane,
        store: ctx.store,
        reservations: ctx.reservations
      },
      one
    )
    ;(plane.openShadowRun as ReturnType<typeof vi.fn>).mockClear()
    await runShadowObservation(
      {
        authoritativeExecutor: fakeAuthoritativeExecutor(),
        plane,
        store: ctx.store,
        reservations: ctx.reservations
      },
      input([slot('w1')])
    )
    expect(plane.openShadowRun).not.toHaveBeenCalled()
  })
})

describe('adjudicate (blocker B9)', () => {
  it('explains a files_changed divergence when the spec carries shadowInputExtras', () => {
    const spec = workloadSpec('s2', [{ op: 'exit', code: 0 }], {
      shadowInputExtras: [{ path: 'src/extra.txt', content: 'x' }]
    })
    const parity = compareOutcomes(
      outcome({ filesChanged: ['src/a.txt'] }),
      outcome({ filesChanged: ['src/a.txt', 'src/extra.txt'] })
    )
    const [adj] = adjudicate(
      parity,
      spec,
      outcome(),
      outcome({ filesChanged: ['src/a.txt', 'src/extra.txt'] })
    )
    expect(adj.status).toBe('explained')
    expect(adj.classifiedCause).toBe('shadow_input_worktree_divergence')
    expect(adj.evidence.length).toBeGreaterThan(0)
  })

  it('leaves an unexpected divergence unresolved', () => {
    const spec = workloadSpec('s', [{ op: 'exit', code: 0 }])
    const parity = compareOutcomes(
      outcome(),
      outcome({ terminalOutcome: 'failed', exitDisposition: 'non_zero_exit' })
    )
    const adjs = adjudicate(parity, spec, outcome(), outcome({ terminalOutcome: 'failed' }))
    expect(adjs.every((a) => a.status === 'unresolved')).toBe(true)
  })
})
