// ORCA-S2 §15 / criterion 10 — a SEPARATELY KILLABLE process that establishes the
// DURABLE settlement fact independent of the Maestro process. Plain ESM +
// node:sqlite only (the TS Execution modules use extensionless imports the raw
// node resolver cannot load). It:
//   1. writes the durable run_reservation intent + run_binding into the Execution store,
//   2. durably settles the shadow Dispatch in the shared durable shadow orchestration.db
//      (tasks + dispatch_contexts terminal rows) — the fact S2 converges from,
//   3. CHECKPOINTS / closes both DBs (§14 WAL note),
//   4. writes a READY marker, then hangs so the parent can SIGKILL it.
// It never opens data/app.db.
//
// argv: [execDbPath, shadowOrchPath, sliceRef, correlationId, dispatchId, runId,
//        taskId, outcome('succeeded'|'failed'), resultJson, extraStaleDispatch('1'|'0'), readyMarker]

import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const [
  execDbPath,
  shadowOrchPath,
  sliceRef,
  correlationId,
  dispatchId,
  runId,
  taskId,
  outcome,
  resultJson,
  extraStaleDispatch,
  readyMarker
] = process.argv.slice(2)

const nowIso = new Date().toISOString()
const dispatchStatus = outcome === 'succeeded' ? 'completed' : 'failed'
const taskStatus = outcome === 'succeeded' ? 'completed' : 'failed'

// 1 + partial of 3 — Execution store: durable reservation intent + binding.
const exec = new DatabaseSync(execDbPath)
exec
  .prepare(
    `INSERT INTO run_reservation
       (correlation_id, slice_ref, authoritative_run_ref, workload_id, state, orca_run_id, orca_dispatch_id, org_task_id, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'settled', ?, ?, ?, ?, ?)`
  )
  .run(correlationId, sliceRef, `w_${correlationId}`, runId, dispatchId, taskId, nowIso, nowIso)
exec
  .prepare(
    `INSERT INTO run_binding
       (orca_dispatch_id, correlation_id, governance_agent_run_id, aicontrol_run_id, orca_run_id, org_task_id, slice_ref, base_commit, candidate_head, bound_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 'base', NULL, ?)`
  )
  .run(dispatchId, correlationId, `gar_${correlationId}`, runId, taskId, sliceRef, nowIso)
exec.exec('PRAGMA wal_checkpoint(TRUNCATE)')
exec.close()

// 2 — durably settle the shadow Dispatch in the shared durable shadow orchestration.db.
const orch = new DatabaseSync(shadowOrchPath)
orch
  .prepare(
    `INSERT INTO tasks (id, run_id, spec, status, result, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  .run(
    taskId,
    runId,
    JSON.stringify({
      orcaS1CorrelationId: correlationId,
      sliceRef,
      workloadId: `w_${correlationId}`
    }),
    taskStatus,
    resultJson,
    nowIso
  )
orch
  .prepare(
    `INSERT INTO dispatch_contexts (id, run_id, task_id, status, completed_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  .run(dispatchId, runId, taskId, dispatchStatus, nowIso)

if (extraStaleDispatch === '1') {
  // A newer dispatch row for the same task makes the bound one non-latest → foreign (G4).
  orch
    .prepare(
      `INSERT INTO dispatch_contexts (id, run_id, task_id, status, completed_at, created_at)
       VALUES (?, ?, ?, 'pending', NULL, ?)`
    )
    .run(`${dispatchId}_newer`, runId, taskId, new Date(Date.now() + 1000).toISOString())
}

// 3 — checkpoint / close so the parent's read-only open needs no sidecar.
orch.exec('PRAGMA wal_checkpoint(TRUNCATE)')
orch.exec('PRAGMA journal_mode = DELETE')
orch.close()

writeFileSync(readyMarker, 'READY')

// Hang forever — the parent SIGKILLs us here.
setInterval(() => {}, 1000)
