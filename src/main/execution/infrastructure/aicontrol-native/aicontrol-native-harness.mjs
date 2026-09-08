// ORCA-S1 — aiControlCenter NATIVE execution harness (SPEC-AMENDMENT-002 §2-§5).
//
// Runs INSIDE a disposable copy of the aiControlCenter repo, under that repo's
// own vitest (so `@/` + the real module graph resolve exactly as in-repo). It
// drives the REAL native agent-run lifecycle (createRun -> runAgent ->
// executeClaimedRun -> getExecutor(mock) -> openExecutionAttempt ->
// finalizeRunOnce) against a disposable SQLite DB, and writes the real
// resulting agent_runs / execution_attempts rows to ORCA_S1_NATIVE_OUT as JSON.
//
// Deployed by disposable-aicontrol-env.ts as
// src/lib/agent-runner/__tests__/orca-s1-native-harness.test.ts. Modeled on the
// repo's own src/lib/agent-runner/__tests__/queue-pump-real-db.test.ts.
//
// No canonical state is touched: DATABASE_URL points at a fresh temp file before
// any app module is imported; the workspace dirs are fresh temp git repos.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const ROOT = process.cwd()
const OUT = process.env.ORCA_S1_NATIVE_OUT
const REQUESTS = JSON.parse(process.env.ORCA_S1_NATIVE_REQUESTS || '[]')
const prevDatabaseUrl = process.env.DATABASE_URL

let dbDir
let db
let schema
let createRun
let runAgent
let runCancellation
let finalizeRunOnce
let eq
let drizzlePushMs = 0

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'orca-s1',
  GIT_AUTHOR_EMAIL: 'orca-s1@disposable.local',
  GIT_COMMITTER_NAME: 'orca-s1',
  GIT_COMMITTER_EMAIL: 'orca-s1@disposable.local'
}
const git = (args, cwd) =>
  execFileSync('git', args, { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()

function freshWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'orca-s1-native-ws-'))
  git(['init', '-q', '-b', 'main'], ws)
  git(['config', 'commit.gpgsign', 'false'], ws)
  writeFileSync(join(ws, '.seed'), 'seed\n')
  git(['add', '-A'], ws)
  git(['commit', '-q', '-m', 'base'], ws)
  return { ws, baseCommit: git(['rev-parse', 'HEAD'], ws) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitForStatus(runId, want, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ status: schema.agentRuns.status })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, runId))
    if (row && want.includes(row.status)) {
      return row.status
    }
    await sleep(20)
  }
  return 'TIMEOUT'
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'orca-s1-native-db-'))
  process.env.DATABASE_URL = `file:${join(dbDir, 'acceptance.db')}`
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const t0 = Date.now()
  execFileSync(npx, ['drizzle-kit', 'push', '--force'], {
    cwd: ROOT,
    env: process.env,
    stdio: 'pipe',
    shell: process.platform === 'win32'
  })
  drizzlePushMs = Date.now() - t0

  db = (await import('@/lib/db')).db
  schema = await import('@/lib/db/schema')
  const runner = await import('@/lib/agent-runner/runner')
  createRun = runner.createRun
  runAgent = runner.runAgent
  runCancellation = (await import('@/lib/agent-runner/run-cancellation')).runCancellation
  finalizeRunOnce = (await import('@/lib/agent-runner/run-finalizer')).finalizeRunOnce
  ;({ eq } = await import('drizzle-orm'))
}, 180_000)

afterAll(async () => {
  process.env.DATABASE_URL = prevDatabaseUrl
  try {
    db.$client.close()
  } catch {
    /* best-effort */
  }
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dbDir, { recursive: true, force: true })
      break
    } catch {
      await sleep(100)
    }
  }
})

async function provisionProfiles(count) {
  const [project] = await db
    .insert(schema.projects)
    .values({ name: `orca-s1-native-${randomUUID()}`, workspacePath: ROOT })
    .returning({ id: schema.projects.id })

  const agentIds = []
  for (let i = 0; i < count; i++) {
    const [provider] = await db
      .insert(schema.providers)
      .values({
        name: `orca-s1-mock-${i}-${randomUUID()}`,
        type: 'mock',
        baseCommand: 'mock',
        active: true,
        healthStatus: 'healthy'
      })
      .returning({ id: schema.providers.id })
    const [model] = await db
      .insert(schema.models)
      .values({
        providerId: provider.id,
        name: `orca-s1-mock-model-${i}`,
        displayName: `ORCA-S1 Mock ${i}`,
        active: true,
        availabilityStatus: 'available'
      })
      .returning({ id: schema.models.id })
    const [agent] = await db
      .insert(schema.agents)
      .values({
        projectId: project.id,
        name: `orca-s1-agent-${i}`,
        role: 'worker_developer',
        providerId: provider.id,
        modelId: model.id,
        active: true
      })
      .returning({ id: schema.agents.id })
    agentIds.push(agent.id)
  }
  return { projectId: project.id, agentIds }
}

async function readRun(runId) {
  const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId))
  const [attempt] = await db
    .select()
    .from(schema.executionAttempts)
    .where(eq(schema.executionAttempts.runId, runId))
  return { run, attempt }
}

describe('ORCA-S1 native aiControl execution harness', () => {
  it('drives N real agent_runs across M controlled profiles and records them', async () => {
    const profileCount = Math.max(1, ...REQUESTS.map((r) => r.profileIndex + 1))
    const { projectId, agentIds } = await provisionProfiles(profileCount)

    const results = []
    for (const req of REQUESTS) {
      const { ws, baseCommit } = freshWorkspace()
      // Point THIS run at its own disposable git workspace.
      await db
        .update(schema.projects)
        .set({ workspacePath: ws })
        .where(eq(schema.projects.id, projectId))

      const agentId = agentIds[req.profileIndex]
      const runId = await createRun({
        projectId,
        agentId,
        prompt: `ORCA-S1 native workload ${req.workloadId}`,
        command: req.command
      })

      if (req.cancel) {
        const p = runAgent(runId)
        const reached = await waitForStatus(runId, ['running', 'completed', 'failed', 'cancelled'])
        // Cancel while the run is genuinely 'running' — the real CAS transition.
        if (reached === 'running') {
          await runCancellation.requestRunTermination(runId, 'cancelled')
          await finalizeRunOnce({ runId, status: 'cancelled', sseExitCode: 130 })
        }
        await p
      } else {
        await runAgent(runId)
      }

      const { run, attempt } = await readRun(runId)
      const filesChanged = git(['diff', '--name-only', `${baseCommit}..HEAD`], ws)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const headCommit = git(['rev-parse', 'HEAD'], ws)

      results.push({
        workloadId: req.workloadId,
        profileIndex: req.profileIndex,
        aicontrolRunId: run.id,
        agentId,
        status: run.status,
        attemptStatus: attempt ? attempt.status : null,
        attemptExitCode: attempt ? attempt.exitCode : null,
        attemptErrorClassification: attempt ? attempt.errorClassification : null,
        gitDiffAfterEmpty: (run.gitDiffAfter ?? '').trim().length === 0,
        filesChanged,
        baseCommit,
        headCommit
      })

      rmSync(ws, { recursive: true, force: true })
    }

    const payload = {
      results,
      distinctAgentIds: [...new Set(results.map((r) => r.agentId))],
      distinctRunIds: [...new Set(results.map((r) => r.aicontrolRunId))],
      drizzlePushMs,
      generatedAt: new Date().toISOString()
    }
    if (OUT) {
      writeFileSync(OUT, JSON.stringify(payload, null, 2))
    }

    // Fail LOUD inside the harness if the native path did not really run.
    expect(results.length).toBe(REQUESTS.length)
    for (const r of results) {
      expect(['completed', 'failed', 'cancelled', 'timeout']).toContain(r.status)
      expect(r.aicontrolRunId).toMatch(/[0-9a-f-]{16,}/)
    }
    // Round-trip check: OUT was written and parses.
    if (OUT) {
      expect(JSON.parse(readFileSync(OUT, 'utf8')).results.length).toBe(REQUESTS.length)
    }
  }, 180_000)
})
