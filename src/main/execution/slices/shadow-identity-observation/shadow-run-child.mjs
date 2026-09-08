// Blocker B10 — a SEPARATELY KILLABLE shadow process. Plain ESM + node:sqlite
// only (the TS Execution modules use extensionless imports the raw node
// resolver cannot load). It writes the durable run_reservation intent row
// (state 'reserved' — crash window A: durable intent exists, Orca Dispatch not
// yet created), writes a READY marker, then hangs so the parent can SIGKILL it
// mid-run. It never opens data/app.db.
//
// argv: [execDbPath, correlationId, sliceRef, authoritativeRunRef, workloadId, readyMarkerPath]

import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const [execDbPath, correlationId, sliceRef, authoritativeRunRef, workloadId, readyMarker] =
  process.argv.slice(2)

const db = new DatabaseSync(execDbPath)
const now = new Date().toISOString()
db.prepare(
  `INSERT INTO run_reservation
     (correlation_id, slice_ref, authoritative_run_ref, workload_id, state, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'reserved', ?, ?)`
).run(correlationId, sliceRef, authoritativeRunRef, workloadId, now, now)
db.close()

writeFileSync(readyMarker, 'READY')

// Hang forever — the parent SIGKILLs us here, mid-run.
setInterval(() => {}, 1000)
