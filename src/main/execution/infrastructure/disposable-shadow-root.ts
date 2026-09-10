import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isInside } from '../domain/path-confinement'

// Execution bounded context — infrastructure. One disposable root that owns
// every shadow worktree + the dedicated shadow orchestration DB for a slice run
// (amendment 001 §6, §9). Nothing shadow ever writes outside this root.

export class DisposableShadowRoot {
  readonly root: string

  private constructor(root: string) {
    this.root = realpathSync(root)
  }

  static create(): DisposableShadowRoot {
    const dir = mkdtempSync(join(tmpdir(), 'orca-s1-shadow-'))
    return new DisposableShadowRoot(dir)
  }

  /** A fresh worktree dir under the root. Refuses a name that would escape it. */
  worktreeDir(name: string): string {
    const target = resolve(this.root, 'worktrees', name.replace(/[^a-zA-Z0-9._-]/g, '_'))
    if (!isInside(target, this.root)) {
      throw new Error(`worktree dir escapes the disposable shadow root: ${target}`)
    }
    mkdirSync(target, { recursive: true })
    return target
  }

  // ORCA-S2 §17 — this root NO LONGER owns the durable convergence DB. The single
  // durable shadow orchestration.db lives OUTSIDE this root, at a stable configured
  // path re-verified against execution_meta.shadow_orchestration_path; `cleanup()`
  // (rmSync of the whole tree) must never reach it. Disposable *worktrees* stay
  // under this root, unchanged.

  /** True when `dir` (already-existing or not) lives under this disposable root. */
  contains(dir: string): boolean {
    return isInside(dir, this.root)
  }

  cleanup(): void {
    try {
      rmSync(this.root, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // best-effort — disposable, shadow-only artifacts
    }
  }
}
