// ORCA-S3 §7.6 / acceptance gate 10 — a SEPARATELY KILLABLE process that
// performs the PINNED bind-time write ordering (§7.6 steps 1-6) so the parent
// can SIGKILL it at each crash window and assert what survives. Plain ESM +
// node:sqlite + a real `git` child process only — this is a TEST FIXTURE, not
// the S3 production bind path (which does not exist yet). Mirrors
// `settlement-converge-child.mjs` (ORCA-S2 gate 10).
//
// Pinned ordering (§7.6):
//   1. create the durable shadow worktree (real git init + one commit)
//   2. atomically write the identity sidecar (temp file + rename, same durable root)
//   3. BEGIN IMMEDIATE
//   4. INSERT run_binding
//   5. INSERT dispatch_worktree
//   6. COMMIT
//
// argv: [execDbPath, durableRoot, sliceRef, correlationId, dispatchId, runId,
//        taskId, worktreeNonce, haltAt('A'|'B'|'C'|'D'), readyMarker]
//
// haltAt semantics — write READY then hang FOREVER (the parent SIGKILLs here):
//   'A' — after step 1, BEFORE step 2 (sidecar)
//   'B' — after step 2, BEFORE step 3 (BEGIN IMMEDIATE)
//   'C' — after step 4 (INSERT run_binding), inside the open transaction, BEFORE step 5/COMMIT
//   'D' — after step 6 (COMMIT) — the full, restart-safe happy path

import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [
  execDbPath,
  durableRoot,
  sliceRef,
  correlationId,
  dispatchId,
  runId,
  taskId,
  worktreeNonce,
  haltAt,
  readyMarker
] = process.argv.slice(2)

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function hangForever(markerPath) {
  writeFileSync(markerPath, 'READY')
  setInterval(() => {}, 1000)
}

// --- step 1: create the durable shadow worktree ---
const worktreePath = join(durableRoot, `shadow-${correlationId}`)
mkdirSync(worktreePath, { recursive: true })
git(['init', '-q'], worktreePath)
git(['config', 'user.email', 'orca-s3@test.local'], worktreePath)
git(['config', 'user.name', 'orca-s3'], worktreePath)
git(['config', 'commit.gpgsign', 'false'], worktreePath)
writeFileSync(join(worktreePath, 'seed.ts'), 'seed\n')
git(['add', '-A'], worktreePath)
git(['commit', '-q', '-m', 'base'], worktreePath)

if (haltAt === 'A') {
  hangForever(readyMarker)
}

// --- step 2: atomically write the identity sidecar (temp file + rename) ---
const identityDir = join(durableRoot, 'identity')
mkdirSync(identityDir, { recursive: true })
const sidecarPath = join(identityDir, `${dispatchId}.json`)
const sidecarTmp = `${sidecarPath}.tmp-${process.pid}`
writeFileSync(
  sidecarTmp,
  JSON.stringify({ correlationId, orcaRunId: runId, orcaDispatchId: dispatchId, worktreeNonce, sliceRef, worktreePath })
)
renameSync(sidecarTmp, sidecarPath)

if (haltAt === 'B') {
  hangForever(readyMarker)
}

// --- steps 3-6: one SQLite transaction across run_binding + dispatch_worktree ---
const exec = new DatabaseSync(execDbPath)
exec.exec('PRAGMA journal_mode = WAL')
exec.exec('BEGIN IMMEDIATE')

const nowIso = new Date().toISOString()
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

if (haltAt === 'C') {
  // Still inside the OPEN, uncommitted transaction — SIGKILL here must roll
  // BOTH inserts back (steps 4-5 are one transaction; §7.6 window C).
  hangForever(readyMarker)
}

exec
  .prepare(
    `INSERT INTO dispatch_worktree
       (orca_dispatch_id, correlation_id, orca_run_id, worktree_nonce, worktree_path, root_ref, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  .run(dispatchId, correlationId, runId, worktreeNonce, worktreePath, 'root_gen_1', nowIso)

exec.exec('COMMIT')
exec.exec('PRAGMA wal_checkpoint(TRUNCATE)')
exec.close()

// haltAt === 'D' (or anything else): the full, restart-safe happy path.
hangForever(readyMarker)
