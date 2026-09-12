import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  identitySidecarPath,
  readIdentitySidecar,
  writeIdentitySidecarAtomically
} from './identity-sidecar-store'

// ORCA-S3 §7.2, §7.6 step 2, §12 PROV-3/PROV-5/PROV-11 — the Execution-owned
// identity sidecar lives at `<durableShadowWorktreeRoot>/identity/<orcaDispatchId>.json`,
// OUTSIDE `.git/`, OUTSIDE the worktree, and OUTSIDE all Git administrative
// storage, written with NO Git command via an atomic temp-file + rename WITHIN
// the durable root. RED: `./identity-sidecar-store` does not exist yet.

const IDENTITY = {
  correlationId: 'corr_1',
  orcaRunId: 'run_1',
  orcaDispatchId: 'ctx_1',
  worktreeNonce: 'nonce_1',
  sliceRef: 'ORCA-S3',
  worktreePath: '' // filled per-test to the real durable root child
}

describe('identity sidecar (§7.2, §7.6 step 2)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort */
      }
    }
  })
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'orca-s3-sidecar-'))
    dirs.push(d)
    return d
  }

  it('identitySidecarPath is <root>/identity/<orcaDispatchId>.json — never under a worktree or .git/', () => {
    const root = tmp()
    const path = identitySidecarPath(root, 'ctx_1')
    expect(path).toBe(join(root, 'identity', 'ctx_1.json'))
    expect(path).not.toMatch(/\.git/)
  })

  it('writes atomically (no leftover temp file after a successful write) and reads back the exact identity', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    mkdirSync(worktreePath, { recursive: true })
    writeIdentitySidecarAtomically(root, 'ctx_1', { ...IDENTITY, worktreePath })
    const read = readIdentitySidecar(root, 'ctx_1')
    expect(read).toEqual({ kind: 'present', identity: { ...IDENTITY, worktreePath } })
    const files = readdirSync(join(root, 'identity'))
    expect(files).toEqual(['ctx_1.json']) // no .tmp sibling left behind
  })

  it('creates the identity/ subdirectory on first write when the durable root pre-exists but identity/ does not', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    mkdirSync(worktreePath, { recursive: true })
    expect(existsSync(join(root, 'identity'))).toBe(false)
    writeIdentitySidecarAtomically(root, 'ctx_1', { ...IDENTITY, worktreePath })
    expect(existsSync(join(root, 'identity'))).toBe(true)
  })

  it('readIdentitySidecar returns { kind: "absent" } when the file does not exist', () => {
    const root = tmp()
    expect(readIdentitySidecar(root, 'never-written')).toEqual({ kind: 'absent' })
  })

  it('readIdentitySidecar returns { kind: "corrupt" } for unparseable JSON — never throws, never fabricates', () => {
    const root = tmp()
    mkdirSync(join(root, 'identity'), { recursive: true })
    writeFileSync(join(root, 'identity', 'ctx_1.json'), '{ not json')
    expect(readIdentitySidecar(root, 'ctx_1')).toEqual({ kind: 'corrupt' })
  })

  it('readIdentitySidecar returns { kind: "corrupt" } when a required field is missing', () => {
    const root = tmp()
    mkdirSync(join(root, 'identity'), { recursive: true })
    writeFileSync(
      join(root, 'identity', 'ctx_1.json'),
      JSON.stringify({ correlationId: 'corr_1', orcaRunId: 'run_1' }) // missing orcaDispatchId, worktreeNonce
    )
    expect(readIdentitySidecar(root, 'ctx_1')).toEqual({ kind: 'corrupt' })
  })

  it('a second write for the same dispatch id overwrites the sidecar in place (still one file, still atomic)', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    mkdirSync(worktreePath, { recursive: true })
    writeIdentitySidecarAtomically(root, 'ctx_1', { ...IDENTITY, worktreePath })
    const rewritten = { ...IDENTITY, worktreePath, worktreeNonce: 'nonce_2' }
    writeIdentitySidecarAtomically(root, 'ctx_1', rewritten)
    expect(readIdentitySidecar(root, 'ctx_1')).toEqual({ kind: 'present', identity: rewritten })
    expect(readdirSync(join(root, 'identity'))).toEqual(['ctx_1.json'])
  })

  it('two different dispatch ids under the same root get independent sidecar files', () => {
    const root = tmp()
    writeIdentitySidecarAtomically(root, 'ctx_1', { ...IDENTITY, worktreePath: join(root, 'a') })
    writeIdentitySidecarAtomically(root, 'ctx_2', {
      ...IDENTITY,
      orcaDispatchId: 'ctx_2',
      worktreePath: join(root, 'b')
    })
    expect(readdirSync(join(root, 'identity')).sort()).toEqual(['ctx_1.json', 'ctx_2.json'])
  })
})
