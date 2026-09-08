import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runProcessSync } from '../../../shared/child-process/run-process'
import type { ExecutionOutcome } from '../domain/parity'
import { filesChangedSet } from '../domain/parity'
import type { WorkloadSpec } from '../domain/workload-spec'

// Execution bounded context — infrastructure. Shared deterministic runtime for a
// WorkloadSpec against a real disposable git worktree. Used by BOTH the
// authoritative reference executor and the Orca shadow adapter so the parity
// comparison is same-workload (amendment 001 §3). files_changed is derived
// ONLY from `git diff --name-only base..HEAD` — never a synthetic union, and an
// attempted delete of a nonexistent path is a no-op in the diff (blocker B8).

export class WorkloadGitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkloadGitError'
  }
}

export function git(args: string[], cwd: string): string {
  const result = runProcessSync({ program: 'git', args, cwd, timeoutMs: 20_000 })
  if (result.code !== 0) {
    throw new WorkloadGitError(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

export type WorkloadRunResult = {
  baseCommit: string
  headCommit: string
  exitCode: number | null
  cancelled: boolean
  cancelledMidFlight: boolean
  filesChanged: readonly string[]
}

function writeSeed(worktreeDir: string, files: readonly { path: string; content: string }[]): void {
  for (const f of files) {
    const full = join(worktreeDir, f.path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, f.content)
  }
}

/**
 * Init a disposable git worktree. `seededFiles` are committed into the base;
 * `postBaseFiles` are written AFTER the base commit (untracked) — the shadow
 * side uses this to model an input worktree that carried extra content, which
 * the workload commit then sweeps into the `base..HEAD` diff (amendment 001 §4
 * row 2, a genuine explained files-changed divergence).
 */
export function initSeededWorktree(
  worktreeDir: string,
  seededFiles: readonly { path: string; content: string }[],
  postBaseFiles: readonly { path: string; content: string }[] = []
): string {
  mkdirSync(worktreeDir, { recursive: true })
  git(['init', '-q'], worktreeDir)
  git(['config', 'user.email', 'shadow@orca-s1.local'], worktreeDir)
  git(['config', 'user.name', 'orca-s1'], worktreeDir)
  git(['config', 'commit.gpgsign', 'false'], worktreeDir)
  writeFileSync(join(worktreeDir, '.orca-s1-seed'), 'seed\n')
  writeSeed(worktreeDir, seededFiles)
  git(['add', '-A'], worktreeDir)
  git(['commit', '-q', '-m', 'base'], worktreeDir)
  const base = git(['rev-parse', 'HEAD'], worktreeDir)
  writeSeed(worktreeDir, postBaseFiles)
  return base
}

/** Apply a WorkloadSpec's steps in an already-initialised, already-seeded worktree. */
export function applyWorkload(
  spec: WorkloadSpec,
  worktreeDir: string,
  baseCommit: string
): WorkloadRunResult {
  let exitCode: number | null = null
  let cancelled = false
  let cancelledMidFlight = false

  for (const step of spec.steps) {
    if (step.op === 'write') {
      const full = join(worktreeDir, step.path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, step.content)
    } else if (step.op === 'delete') {
      // B8 — deleting a path that does not exist changes nothing; git decides.
      if (existsSync(join(worktreeDir, step.path))) {
        rmSync(join(worktreeDir, step.path), { force: true })
      }
    } else if (step.op === 'exit') {
      exitCode = step.code
      break
    } else if (step.op === 'cancel') {
      cancelled = true
      cancelledMidFlight = step.midFlight
      break
    }
  }

  git(['add', '-A'], worktreeDir)
  git(['commit', '-q', '--allow-empty', '-m', `workload ${spec.id}`], worktreeDir)
  const headCommit = git(['rev-parse', 'HEAD'], worktreeDir)
  const filesChanged = git(['diff', '--name-only', `${baseCommit}..HEAD`], worktreeDir)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  return {
    baseCommit,
    headCommit,
    exitCode: cancelled ? null : exitCode,
    cancelled,
    cancelledMidFlight,
    filesChanged: filesChangedSet(filesChanged)
  }
}

export function toExecutionOutcome(r: WorkloadRunResult): ExecutionOutcome {
  if (r.cancelled) {
    return {
      terminalOutcome: 'cancelled',
      exitDisposition: 'no_exit',
      cancellationBehavior: r.cancelledMidFlight ? 'cancelled_mid_flight' : 'cancelled_clean',
      filesChanged: r.filesChanged
    }
  }
  const zero = r.exitCode === 0
  return {
    terminalOutcome: zero ? 'completed' : 'failed',
    exitDisposition: r.exitCode === null ? 'no_exit' : zero ? 'zero_exit' : 'non_zero_exit',
    cancellationBehavior: 'not_cancelled',
    filesChanged: r.filesChanged
  }
}
