import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertRelativePathClean,
  assertResolvedInsideRoot,
  assertWorkloadConfined,
  PathConfinementError
} from './path-confinement'
import type { WorkloadSpec } from './workload-spec'

// Blocker B5 — filesystem confinement: every file effect must stay inside the
// disposable shadow root. Absolute paths, `..` traversal, and symlink/junction
// escapes are rejected before execution.
describe('path confinement (amendment 001 §6)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop()
      if (d) {
        rmSync(d, { recursive: true, force: true })
      }
    }
  })
  function root() {
    const d = mkdtempSync(join(tmpdir(), 'orca-s1-conf-'))
    dirs.push(d)
    return d
  }

  it('rejects an absolute step path', () => {
    expect(() => assertRelativePathClean('/etc/passwd')).toThrow(PathConfinementError)
  })

  it('rejects a step path containing ".."', () => {
    expect(() => assertRelativePathClean('src/../../escape.txt')).toThrow(/traversal/)
  })

  it('rejects an empty step path', () => {
    expect(() => assertRelativePathClean('   ')).toThrow(/empty/)
  })

  it('accepts a clean relative path', () => {
    expect(() => assertRelativePathClean('src/nested/ok.txt')).not.toThrow()
  })

  it('rejects a resolved target outside the shadow root', () => {
    const r = root()
    const outside = mkdtempSync(join(tmpdir(), 'orca-s1-out-'))
    dirs.push(outside)
    expect(() => assertResolvedInsideRoot(join(outside, 'x.txt'), r)).toThrow(/escape/)
  })

  it('assertWorkloadConfined rejects a worktree dir outside the root', () => {
    const r = root()
    const spec: WorkloadSpec = { id: 'w', steps: [{ op: 'write', path: 'a.txt', content: '1' }] }
    expect(() => assertWorkloadConfined(spec, join(tmpdir(), 'not-under-root'), r)).toThrow(
      PathConfinementError
    )
  })

  it('assertWorkloadConfined rejects a traversal step even under a valid worktree', () => {
    const r = root()
    const wt = join(r, 'worktrees', 'wt1')
    const spec: WorkloadSpec = {
      id: 'w',
      steps: [{ op: 'write', path: '../../../evil.txt', content: '1' }]
    }
    expect(() => assertWorkloadConfined(spec, wt, r)).toThrow(PathConfinementError)
  })

  it('rejects a symlink escape when the platform supports symlinks', () => {
    const r = root()
    const outside = mkdtempSync(join(tmpdir(), 'orca-s1-symtarget-'))
    dirs.push(outside)
    const link = join(r, 'evil-link')
    try {
      symlinkSync(outside, link, 'dir')
    } catch {
      return // platform without symlink privilege — string checks above still cover it
    }
    expect(() => assertResolvedInsideRoot(join(link, 'x.txt'), r)).toThrow(/escape/)
  })
})
