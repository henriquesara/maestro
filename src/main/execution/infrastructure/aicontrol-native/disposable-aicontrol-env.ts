import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runProcessSync, spawnProcess } from '../../../../shared/child-process/run-process'

// Execution bounded context — infrastructure. Builds and tears down a DISPOSABLE
// copy of the canonical aiControlCenter repo so ORCA-S1 acceptance can drive the
// REAL native agent-run lifecycle (SPEC-AMENDMENT-002 §2-§3). The canonical
// checkout is only ever READ: `git archive HEAD` (no worktree registration, no
// ref change) + a filesystem junction to its node_modules. The canonical
// data/app.db is never referenced here.

const HARNESS_SRC = join(import.meta.dirname, 'aicontrol-native-harness.mjs')
export const NATIVE_HARNESS_DEST_REL =
  'src/lib/agent-runner/__tests__/orca-s1-native-harness.test.ts'

export type NativeWorkloadRequest = {
  workloadId: string
  /** aiControl provider command — `mock`, `mock exit=N`. */
  command: string
  cancel: boolean
  profileIndex: number
}

export type NativeRunResult = {
  workloadId: string
  profileIndex: number
  aicontrolRunId: string
  agentId: string
  status: 'completed' | 'failed' | 'cancelled' | 'timeout'
  attemptStatus: string | null
  attemptExitCode: number | null
  attemptErrorClassification: string | null
  gitDiffAfterEmpty: boolean
  filesChanged: string[]
  baseCommit: string
  headCommit: string
}

export type NativeFixtureOutcome = {
  results: NativeRunResult[]
  distinctAgentIds: string[]
  distinctRunIds: string[]
  drizzlePushMs: number
  generatedAt: string
}

export type ResolvedAiControlRepo = { ok: boolean; repoPath: string; reason?: string }

/** Canonical aiControlCenter checkout: env override, else sibling of the fork. */
export function resolveCanonicalAiControlRepo(forkRepoRoot: string): ResolvedAiControlRepo {
  const repoPath = resolve(
    process.env.ORCA_S1_AICONTROL_REPO ?? join(forkRepoRoot, '..', 'aiControlCenter')
  )
  if (!existsSync(repoPath)) {
    return { ok: false, repoPath, reason: `aiControlCenter checkout not found at ${repoPath}` }
  }
  if (!existsSync(join(repoPath, 'node_modules', 'vitest'))) {
    return { ok: false, repoPath, reason: `aiControlCenter node_modules not installed` }
  }
  if (!existsSync(join(repoPath, 'src', 'lib', 'agent-runner', 'runner.ts'))) {
    return { ok: false, repoPath, reason: `aiControlCenter runner.ts not found` }
  }
  return { ok: true, repoPath }
}

export type DisposableAiControlEnv = { envDir: string; cleanup: () => void }

/** Snapshot the tracked-tree files at HEAD into a fresh temp dir; junction node_modules. */
export function buildDisposableAiControlEnv(
  repoPath: string,
  scratchDir?: string
): DisposableAiControlEnv {
  const base = scratchDir ?? tmpdir()
  mkdirSync(base, { recursive: true })
  const envDir = mkdtempSync(join(base, 'aicc-native-env-'))

  // The exact tracked-file set at HEAD (read-only on the canonical checkout —
  // no worktree registration, no ref change).
  const ls = runProcessSync({
    program: 'git',
    args: ['-C', repoPath, 'ls-tree', '-r', '-z', '--name-only', 'HEAD'],
    timeoutMs: 60_000,
    maxOutputBytes: 32 * 1024 * 1024
  })
  if (ls.code !== 0) {
    throw new Error(`git ls-tree failed (${ls.code}): ${ls.stderr.slice(0, 400)}`)
  }
  const tracked = ls.stdout.split('\0').filter(Boolean)
  // Never copy the operational DB or anything under data/ — the harness makes
  // its own disposable DB; drizzle.config recreates ./data itself.
  for (const rel of tracked) {
    if (rel.startsWith('data/') || rel === '.git') {
      continue
    }
    const from = join(repoPath, rel)
    const to = join(envDir, rel)
    if (!existsSync(from)) {
      continue
    }
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to)
  }

  // Reuse the canonical node_modules in place — junction, never written.
  symlinkSync(join(repoPath, 'node_modules'), join(envDir, 'node_modules'), 'junction')

  // Land the harness where aiControlCenter's own vitest `include` glob matches.
  const dest = join(envDir, ...NATIVE_HARNESS_DEST_REL.split('/'))
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(HARNESS_SRC, dest)

  return { envDir, cleanup: () => removeWithRetry(envDir) }
}

function removeWithRetry(dir: string): void {
  for (let i = 0; i < 6; i += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      // Windows: a lingering libsql/vitest handle — brief spin, then retry.
      runProcessSync({ program: process.execPath, args: ['-e', ''], timeoutMs: 5_000 })
    }
  }
}

export type NativeFixtureHandle = {
  /** Resolves with the parsed native outcome once the vitest subprocess exits 0. */
  done: Promise<NativeFixtureOutcome>
  /** PID of the vitest subprocess — a genuinely separate OS process. */
  pid: number | undefined
  cleanup: () => void
}

/**
 * Start the native harness as a SEPARATE OS process (vitest subprocess) inside a
 * fresh disposable env. Non-blocking: for crash-isolation the caller kills the
 * shadow process while this is still running.
 */
export function startAiControlNativeFixture(input: {
  repoPath: string
  requests: NativeWorkloadRequest[]
  scratchDir?: string
}): NativeFixtureHandle {
  const env = buildDisposableAiControlEnv(input.repoPath, input.scratchDir)
  const outPath = join(env.envDir, '__native-result.json')
  const vitestMjs = join(env.envDir, 'node_modules', 'vitest', 'vitest.mjs')

  const child = spawnProcess({
    program: process.execPath,
    args: [vitestMjs, 'run', NATIVE_HARNESS_DEST_REL, '--environment=node', '--no-coverage'],
    cwd: env.envDir,
    env: {
      ...process.env,
      DATABASE_URL: '',
      ORCA_S1_NATIVE_REQUESTS: JSON.stringify(input.requests),
      ORCA_S1_NATIVE_OUT: outPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  child.stdout?.on('data', () => {})

  const done = new Promise<NativeFixtureOutcome>((resolvePromise, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`native harness exited ${code}\n${stderr.slice(-4000)}`))
        return
      }
      try {
        resolvePromise(JSON.parse(readFileSync(outPath, 'utf8')) as NativeFixtureOutcome)
      } catch (error) {
        reject(new Error(`native harness produced no readable result: ${String(error)}`))
      }
    })
  })

  return { done, pid: child.pid, cleanup: env.cleanup }
}

/** Blocking convenience: build, run to completion, tear down. */
export async function runAiControlNativeFixture(input: {
  repoPath: string
  requests: NativeWorkloadRequest[]
  scratchDir?: string
}): Promise<NativeFixtureOutcome> {
  const handle = startAiControlNativeFixture(input)
  try {
    return await handle.done
  } finally {
    handle.cleanup()
  }
}
