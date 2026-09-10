import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { ReadOnlyShadowSettlementSource } from './read-only-shadow-settlement-source'
import { finalizeShadowWriterJournal } from './shadow-orchestration-journal'
import { ShadowSettlementSourceMissingError } from './shadow-settlement-source-errors'

// ORCA-S2 acceptance criterion 5 — genuinely read-only source.

const CORRELATION_KEY = 'orcaS1CorrelationId'

type Seeded = { correlationId: string; runId: string; taskId: string; dispatchId: string }

describe('ReadOnlyShadowSettlementSource (§14, criterion 5)', () => {
  const dirs: string[] = []
  let writer: OrchestrationDb | undefined
  afterEach(() => {
    writer?.close()
    writer = undefined
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort */
      }
    }
  })

  function seedShadowDb(build: (w: OrchestrationDb) => Seeded): { path: string; seeded: Seeded } {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s2-src-'))
    dirs.push(dir)
    const path = join(dir, 'shadow-orchestration.db')
    const w = new OrchestrationDb(path)
    const seeded = build(w)
    w.close()
    // Close / checkpoint the writer BEFORE opening the read-only source (§14 WAL note).
    finalizeShadowWriterJournal(path)
    return { path, seeded }
  }

  function settleTerminal(
    w: OrchestrationDb,
    correlationId: string,
    outcome: 'succeeded' | 'failed',
    resultBody: unknown
  ): Seeded {
    const run = w.createRun({
      objective: 'shadow',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_orca_s2_shadow:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = w.createTask({
      spec: JSON.stringify({
        [CORRELATION_KEY]: correlationId,
        sliceRef: 'ORCA-S2',
        workloadId: 'w1'
      }),
      runId: run.id
    })
    const dispatch = w.createDispatchContext({
      taskId: task.id,
      assigneeHandle: 'term_worker',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    const settled = w.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome,
      result: JSON.stringify(resultBody)
    })
    expect(settled.action).toBe('settled')
    return { correlationId, runId: run.id, taskId: task.id, dispatchId: dispatch.id }
  }

  it('opens the shadow orchestration.db read-only and returns a terminal snapshot + digest', () => {
    const { path, seeded } = seedShadowDb((w) =>
      settleTerminal(w, 'corr_ok', 'succeeded', { provenance: 'orca_s1_shadow', exitCode: 0 })
    )
    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      const read = source.readSettlement({
        correlationId: 'corr_ok',
        boundDispatchId: seeded.dispatchId,
        boundRunId: seeded.runId
      })
      expect(read.kind).toBe('terminal')
      if (read.kind !== 'terminal') {
        return
      }
      expect(read.snapshot.orcaDispatchId).toBe(seeded.dispatchId)
      expect(read.snapshot.dispatchStatus).toBe('completed')
      expect(read.snapshot.taskResultCanonical).toEqual({
        provenance: 'orca_s1_shadow',
        exitCode: 0
      })
      expect(read.sourceDigest).toMatch(/^[0-9a-f]{64}$/)
      expect(source.openedReadonly).toBe(true)
    } finally {
      source.close()
    }
  })

  it('is opened SQLITE_OPEN_READONLY — a write attempt is rejected', () => {
    const { path } = seedShadowDb((w) => settleTerminal(w, 'corr_ro', 'succeeded', { exitCode: 0 }))
    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      expect(source.verifyReadOnly()).toBe(true)
    } finally {
      source.close()
    }
    // Independent proof at the handle level: the same open mode rejects an INSERT.
    const raw = new SyncDatabase(path, { readonly: true, fileMustExist: true })
    expect(() =>
      raw.prepare("INSERT INTO tasks (id, run_id, spec) VALUES ('x','y','{}')").run()
    ).toThrow()
    raw.close()
  })

  it('a full sweep leaves the sourceGuard counters all zero and creates/grows no -wal/-shm sidecar', () => {
    const { path, seeded } = seedShadowDb((w) =>
      settleTerminal(w, 'corr_g', 'succeeded', { exitCode: 0 })
    )
    // The writer's own -wal/-shm (if any) are that writer's artifacts, not S2's.
    const sidecarState = (p: string) => (existsSync(p) ? `exists:${statSync(p).size}` : 'absent')
    const walBefore = sidecarState(`${path}-wal`)
    const shmBefore = sidecarState(`${path}-shm`)

    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      source.readSettlement({
        correlationId: 'corr_g',
        boundDispatchId: seeded.dispatchId,
        boundRunId: seeded.runId
      })
      expect(source.sourceGuard()).toEqual({
        openedReadonly: true,
        ddlIssued: 0,
        pragmaJournalMutations: 0,
        triggersCreated: 0,
        metadataWrites: 0,
        sidecarsCreatedByS2: 0
      })
    } finally {
      source.close()
    }
    // S2 attributable delta is zero: the sidecar state is exactly what the writer left.
    expect(sidecarState(`${path}-wal`)).toBe(walBefore)
    expect(sidecarState(`${path}-shm`)).toBe(shmBefore)
  })

  it('resolves the LATEST dispatch per task (ORDER BY rowid DESC) and rejects a stale bound one as foreign', () => {
    const { path, seeded } = seedShadowDb((w) =>
      settleTerminal(w, 'corr_latest', 'succeeded', { exitCode: 0 })
    )
    // A newer dispatch row for the same task (as Orca's retry machinery would write)
    // makes the originally-bound dispatch stale: it is no longer ORDER BY rowid DESC LIMIT 1.
    const rw = new SyncDatabase(path)
    rw.prepare(
      `INSERT INTO dispatch_contexts (id, run_id, task_id, status, created_at)
       VALUES ('ctx_newer_stale', ?, ?, 'pending', '2026-09-10T02:00:00.000Z')`
    ).run(seeded.runId, seeded.taskId)
    rw.close()
    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      const read = source.readSettlement({
        correlationId: 'corr_latest',
        boundDispatchId: seeded.dispatchId,
        boundRunId: seeded.runId
      })
      expect(read.kind).toBe('foreign')
      if (read.kind !== 'foreign') {
        return
      }
      expect(read.failedCheck).toMatch(/dispatch/i)
    } finally {
      source.close()
    }
  })

  it('returns foreign when the latest dispatch run_id disagrees with the bound run id', () => {
    const { path, seeded } = seedShadowDb((w) =>
      settleTerminal(w, 'corr_run', 'succeeded', { exitCode: 0 })
    )
    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      const read = source.readSettlement({
        correlationId: 'corr_run',
        boundDispatchId: seeded.dispatchId,
        boundRunId: 'run_wrong'
      })
      expect(read.kind).toBe('foreign')
      if (read.kind !== 'foreign') {
        return
      }
      expect(read.failedCheck).toMatch(/run_id/i)
    } finally {
      source.close()
    }
  })

  it('returns no_task when no task carries the correlation marker', () => {
    const { path } = seedShadowDb((w) =>
      settleTerminal(w, 'corr_present', 'succeeded', { exitCode: 0 })
    )
    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      expect(
        source.readSettlement({
          correlationId: 'corr_absent',
          boundDispatchId: 'x',
          boundRunId: 'y'
        }).kind
      ).toBe('no_task')
    } finally {
      source.close()
    }
  })

  it('returns non_terminal for a bound dispatch that has not settled', () => {
    const { path, seeded } = seedShadowDb((w) => {
      const run = w.createRun({
        objective: 'shadow',
        coordinatorHandle: 'term_coord',
        coordinatorPaneKey: 'tab_orca_s2_shadow:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      })
      const task = w.createTask({
        spec: JSON.stringify({
          [CORRELATION_KEY]: 'corr_nt',
          sliceRef: 'ORCA-S2',
          workloadId: 'w1'
        }),
        runId: run.id
      })
      const dispatch = w.createDispatchContext({
        taskId: task.id,
        assigneeHandle: 'term_worker',
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER
      })
      return { correlationId: 'corr_nt', runId: run.id, taskId: task.id, dispatchId: dispatch.id }
    })
    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      const read = source.readSettlement({
        correlationId: 'corr_nt',
        boundDispatchId: seeded.dispatchId,
        boundRunId: seeded.runId
      })
      expect(read.kind).toBe('non_terminal')
    } finally {
      source.close()
    }
  })

  it('returns unresolvable when tasks.result is present but not valid JSON', () => {
    const { path, seeded } = seedShadowDb((w) => settleTerminal(w, 'corr_bad', 'succeeded', 0))
    // Corrupt tasks.result to a non-JSON string via a read-write handle (the S1 writer's side).
    const rw = new SyncDatabase(path)
    rw.prepare('UPDATE tasks SET result = ? WHERE id = ?').run('{not valid json', seeded.taskId)
    rw.close()
    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      const read = source.readSettlement({
        correlationId: 'corr_bad',
        boundDispatchId: seeded.dispatchId,
        boundRunId: seeded.runId
      })
      expect(read.kind).toBe('unresolvable')
      if (read.kind !== 'unresolvable') {
        return
      }
      expect(read.failedExpectation).toMatch(/json/i)
    } finally {
      source.close()
    }
  })

  it('throws ShadowSettlementSourceMissingError when the file does not exist', () => {
    expect(
      () => new ReadOnlyShadowSettlementSource(join(tmpdir(), 'nope-orca-s2-missing.db'))
    ).toThrow(ShadowSettlementSourceMissingError)
  })

  it('never constructs an OrchestrationDb (SELECT-only over the three Orca tables)', () => {
    const { path } = seedShadowDb((w) => settleTerminal(w, 'corr_c', 'succeeded', { exitCode: 0 }))
    const source = new ReadOnlyShadowSettlementSource(path)
    try {
      expect(source.constructedOrchestrationDb).toBe(false)
    } finally {
      source.close()
    }
  })
})
