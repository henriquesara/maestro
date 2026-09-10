import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildDurableSettlementSnapshot,
  canonicalSerialize,
  sourceDigest,
  type DurableSettlementSnapshot
} from './durable-settlement-snapshot'

const baseSnapshot = (): DurableSettlementSnapshot => ({
  correlationId: 'corr_1',
  orgTaskId: 'task_1',
  orcaRunId: 'run_1',
  orcaDispatchId: 'ctx_1',
  dispatchStatus: 'completed',
  dispatchCompletedAt: '2026-09-10T00:00:00.000Z',
  taskStatus: 'completed',
  taskCompletedAt: '2026-09-10T00:00:01.000Z',
  taskResultCanonical: { exitCode: 0, provenance: 'orca_s1_shadow' },
  attemptFactsCanonical: []
})

describe('canonicalSerialize (§6.1 — Execution-owned canonical serialiser)', () => {
  it('sorts object keys ascending, recursively, and preserves array order', () => {
    const a = canonicalSerialize({ b: 1, a: { d: [3, 1, 2], c: true } })
    const b = canonicalSerialize({ a: { c: true, d: [3, 1, 2] }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"c":true,"d":[3,1,2]},"b":1}')
  })

  it('encodes undefined as null (JSON has no undefined)', () => {
    expect(canonicalSerialize({ x: undefined })).toBe('{"x":null}')
  })

  it('is stable regardless of the field insertion order of a whole snapshot', () => {
    const ordered = baseSnapshot()
    const shuffled: DurableSettlementSnapshot = {
      attemptFactsCanonical: ordered.attemptFactsCanonical,
      taskResultCanonical: ordered.taskResultCanonical,
      taskCompletedAt: ordered.taskCompletedAt,
      taskStatus: ordered.taskStatus,
      dispatchCompletedAt: ordered.dispatchCompletedAt,
      dispatchStatus: ordered.dispatchStatus,
      orcaDispatchId: ordered.orcaDispatchId,
      orcaRunId: ordered.orcaRunId,
      orgTaskId: ordered.orgTaskId,
      correlationId: ordered.correlationId
    }
    expect(canonicalSerialize(shuffled)).toBe(canonicalSerialize(ordered))
  })

  it('recursively canonicalises objects nested inside arrays', () => {
    expect(canonicalSerialize([{ b: 2, a: 1 }])).toBe('[{"a":1,"b":2}]')
  })
})

describe('sourceDigest (§6.1)', () => {
  it('is the SHA-256 hex of the canonical serialisation of the whole snapshot', () => {
    const snap = baseSnapshot()
    const expected = createHash('sha256').update(canonicalSerialize(snap)).digest('hex')
    expect(sourceDigest(snap)).toBe(expected)
  })

  it('two structurally-equal snapshots produce an equal digest', () => {
    expect(sourceDigest(baseSnapshot())).toBe(sourceDigest(baseSnapshot()))
  })

  it('any field change produces a different digest', () => {
    const changed = { ...baseSnapshot(), taskCompletedAt: '2026-09-10T09:09:09.000Z' }
    expect(sourceDigest(changed)).not.toBe(sourceDigest(baseSnapshot()))
  })

  it('is direction-free: null vs a timestamp is just "different", no ordering implied', () => {
    const withTs = baseSnapshot()
    const withNull = { ...withTs, dispatchCompletedAt: null }
    expect(sourceDigest(withTs)).not.toBe(sourceDigest(withNull))
  })
})

describe('buildDurableSettlementSnapshot (§6.1 — from raw durable reads)', () => {
  const rawTerminal = {
    correlationId: 'corr_1',
    orgTaskId: 'task_1',
    orcaRunId: 'run_1',
    orcaDispatchId: 'ctx_1',
    dispatchStatus: 'completed' as const,
    dispatchCompletedAt: '2026-09-10T00:00:00.000Z',
    taskStatus: 'completed' as const,
    taskCompletedAt: '2026-09-10T00:00:01.000Z',
    taskResultRaw: JSON.stringify({ provenance: 'orca_s1_shadow', exitCode: 0 }),
    attemptFactsRaw: []
  }

  it('parses tasks.result into the canonical body and yields a digest', () => {
    const built = buildDurableSettlementSnapshot(rawTerminal)
    expect(built.ok).toBe(true)
    if (!built.ok) {
      return
    }
    expect(built.snapshot.taskResultCanonical).toEqual({
      provenance: 'orca_s1_shadow',
      exitCode: 0
    })
    expect(built.sourceDigest).toBe(sourceDigest(built.snapshot))
  })

  it('treats a NULL tasks.result as null (not an error) when status still classifies', () => {
    const built = buildDurableSettlementSnapshot({ ...rawTerminal, taskResultRaw: null })
    expect(built.ok).toBe(true)
    if (!built.ok) {
      return
    }
    expect(built.snapshot.taskResultCanonical).toBeNull()
  })

  it('fails closed when tasks.result is present but not valid JSON (→ invalid_or_unresolvable_source)', () => {
    const built = buildDurableSettlementSnapshot({ ...rawTerminal, taskResultRaw: '{not json' })
    expect(built.ok).toBe(false)
    if (built.ok) {
      return
    }
    expect(built.failedExpectation).toMatch(/json/i)
    expect(built.partial).toBeDefined()
  })

  it('orders attempt facts by (sequence, rowid) and canonicalises each payload', () => {
    const built = buildDurableSettlementSnapshot({
      ...rawTerminal,
      attemptFactsRaw: [
        {
          sequence: 1,
          rowid: 10,
          authorityId: 'a',
          authorityClock: 'home',
          facet: 'worker_report',
          payload: '{"b":2,"a":1}'
        },
        {
          sequence: 0,
          rowid: 9,
          authorityId: 'a',
          authorityClock: 'home',
          facet: 'worker_report',
          payload: '{"z":1}'
        }
      ]
    })
    expect(built.ok).toBe(true)
    if (!built.ok) {
      return
    }
    expect(
      built.snapshot.attemptFactsCanonical.map((f) => (f as { sequence: number }).sequence)
    ).toEqual([0, 1])
  })
})
