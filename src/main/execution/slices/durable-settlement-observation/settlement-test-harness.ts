import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SyncDatabase from '../../../sqlite/sync-database'
import { OrchestrationDb } from '../../../runtime/orchestration/db'
import { migrateExecutionStore } from '../../infrastructure/execution-schema'
import type { ReadOnlyShadowSettlementSource } from '../../infrastructure/read-only-shadow-settlement-source'
import { finalizeShadowWriterJournal } from '../../infrastructure/shadow-orchestration-journal'
import { SqliteExecutionStore } from '../../infrastructure/sqlite-execution-store'
import { SqliteReservationStore } from '../../infrastructure/sqlite-reservation-store'
import { SqliteSettlementIncidentStore } from '../../infrastructure/sqlite-settlement-incident-store'
import { SqliteSettlementObservationStore } from '../../infrastructure/sqlite-settlement-observation-store'
import {
  convergeSettlements,
  type SettlementConvergenceReport
} from '../../application/converge-settlements'
import {
  makeCorrelationId,
  makeGovernanceAgentRunRef,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef
} from '../../domain/execution-identity'

export const S2_SLICE = 'ORCA-S2-durable-settlement-observation'
const CORRELATION_KEY = 'orcaS1CorrelationId'
const PANE_KEY = 'tab_orca_s2_shadow:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

export type SeededSettlement = {
  correlationId: string
  runId: string
  taskId: string
  dispatchId: string
}

export function makeS2TmpDir(prefix = 'orca-s2-'): { dir: string; cleanup: () => void } {
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

/** Seed one shadow orchestration.db with N terminal settlements, then checkpoint/close it. */
export function seedShadowSettlements(
  path: string,
  entries: {
    correlationId: string
    outcome: 'succeeded' | 'failed'
    result: unknown
    extraStaleDispatch?: boolean
  }[]
): SeededSettlement[] {
  const w = new OrchestrationDb(path)
  const seeded: SeededSettlement[] = []
  for (const entry of entries) {
    const run = w.createRun({
      objective: `shadow ${entry.correlationId}`,
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: PANE_KEY
    })
    const task = w.createTask({
      spec: JSON.stringify({
        [CORRELATION_KEY]: entry.correlationId,
        sliceRef: S2_SLICE,
        workloadId: `w_${entry.correlationId}`
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
      outcome: entry.outcome,
      result: JSON.stringify(entry.result)
    })
    if (settled.action !== 'settled') {
      throw new Error(`seed settle failed: ${JSON.stringify(settled)}`)
    }
    seeded.push({
      correlationId: entry.correlationId,
      runId: run.id,
      taskId: task.id,
      dispatchId: dispatch.id
    })
  }
  w.close()
  finalizeShadowWriterJournal(path)

  if (entries.some((e) => e.extraStaleDispatch)) {
    const rw = new SyncDatabase(path)
    for (let i = 0; i < entries.length; i += 1) {
      if (!entries[i].extraStaleDispatch) {
        continue
      }
      rw.prepare(
        `INSERT INTO dispatch_contexts (id, run_id, task_id, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`
      ).run(
        `${seeded[i].dispatchId}_newer`,
        seeded[i].runId,
        seeded[i].taskId,
        new Date(Date.now() + 1000).toISOString()
      )
    }
    rw.close()
    finalizeShadowWriterJournal(path)
  }
  return seeded
}

export function openS2Stores(execDbPath: (string & {}) | ':memory:' = ':memory:') {
  const db = new SyncDatabase(execDbPath)
  db.pragma('foreign_keys = OFF')
  migrateExecutionStore(db)
  return {
    db,
    store: new SqliteExecutionStore(db),
    reservations: new SqliteReservationStore(db),
    observations: new SqliteSettlementObservationStore(db),
    incidents: new SqliteSettlementIncidentStore(db),
    close: () => db.close()
  }
}

export function recordBoundReservation(
  ctx: ReturnType<typeof openS2Stores>,
  s: SeededSettlement,
  state: 'bound' | 'settled' | 'executed' = 'settled'
): void {
  const cid = makeCorrelationId(s.correlationId)
  ctx.reservations.reserve({
    correlationId: cid,
    sliceRef: S2_SLICE,
    authoritativeRunRef: null,
    workloadId: `w_${s.correlationId}`,
    now: '2026-09-10T00:00:00.000Z'
  })
  ctx.reservations.advance(cid, state, {
    orcaRunId: s.runId,
    orcaDispatchId: s.dispatchId,
    orgTaskId: s.taskId,
    now: '2026-09-10T00:00:00.000Z'
  })
  ctx.store.recordBinding({
    correlationId: cid,
    governanceAgentRunId: makeGovernanceAgentRunRef(`gar_${s.correlationId}`),
    aicontrolRunId: null,
    orcaRunId: makeOrcaRunRef(s.runId),
    orcaDispatchId: makeOrcaDispatchRef(s.dispatchId),
    orgTaskId: makeOrgTaskRef(s.taskId),
    sliceRef: S2_SLICE,
    baseCommit: 'base',
    candidateHead: null,
    boundAt: '2026-09-10T00:00:00.000Z'
  })
}

export function converge(
  ctx: ReturnType<typeof openS2Stores>,
  source: ReadOnlyShadowSettlementSource,
  sourceDbPath: string,
  seq = { n: 0 }
): SettlementConvergenceReport {
  return convergeSettlements(
    {
      store: ctx.store,
      reservations: ctx.reservations,
      observations: ctx.observations,
      incidents: ctx.incidents,
      source,
      txn: ctx.store,
      sourceDbPath,
      newId: (p) => `${p}_${seq.n++}`,
      now: () => `2026-09-10T21:00:${String(seq.n++).padStart(2, '0')}.000Z`
    },
    { sliceRef: S2_SLICE }
  )
}
