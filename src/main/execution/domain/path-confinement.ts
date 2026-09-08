import { realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import type { WorkloadSpec } from './workload-spec'

// Execution bounded context — domain. Filesystem confinement for shadow
// workloads (amendment 001 §6, blocker B5). Every file effect must resolve
// inside the disposable shadow root; nothing may escape it.

export class PathConfinementError extends Error {
  constructor(
    readonly code: 'absolute' | 'traversal' | 'empty' | 'escape' | 'not_disposable',
    message: string
  ) {
    super(message)
    this.name = 'PathConfinementError'
  }
}

/** Canonicalise a path that already exists on disk; falls back to `resolve` when it does not yet. */
function canonical(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/** True when `child` is `root` or lives strictly under it, after canonicalisation. */
export function isInside(child: string, root: string): boolean {
  const c = canonical(child)
  const r = canonical(root)
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep)
}

/** Reject a workload-step relative path before it is ever joined to the worktree. */
export function assertRelativePathClean(relPath: string): void {
  if (typeof relPath !== 'string' || relPath.trim().length === 0) {
    throw new PathConfinementError('empty', 'workload step path is empty')
  }
  if (isAbsolute(relPath)) {
    throw new PathConfinementError('absolute', `workload step path is absolute: ${relPath}`)
  }
  const parts = relPath.split(/[\\/]+/)
  if (parts.some((s) => s === '..')) {
    throw new PathConfinementError(
      'traversal',
      `workload step path traversal — contains "..": ${relPath}`
    )
  }
}

/** Reject a resolved target that escapes the disposable shadow root (symlink/junction included). */
export function assertResolvedInsideRoot(targetPath: string, shadowRoot: string): void {
  if (!isInside(targetPath, shadowRoot)) {
    throw new PathConfinementError(
      'escape',
      `resolved target escapes the disposable shadow root: ${canonical(targetPath)} !⊂ ${canonical(shadowRoot)}`
    )
  }
}

/** Full pre-execution check for a whole WorkloadSpec against a specific worktree dir. */
export function assertWorkloadConfined(
  spec: WorkloadSpec,
  worktreeDir: string,
  shadowRoot: string
): void {
  if (!isInside(worktreeDir, shadowRoot)) {
    throw new PathConfinementError(
      'escape',
      `worktree dir is not under the disposable shadow root: ${worktreeDir}`
    )
  }
  for (const step of spec.steps) {
    if (step.op === 'write' || step.op === 'delete') {
      assertRelativePathClean(step.path)
      assertResolvedInsideRoot(resolve(worktreeDir, step.path), shadowRoot)
    }
  }
}
