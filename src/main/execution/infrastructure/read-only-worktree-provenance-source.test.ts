import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcessSync } from '../../../shared/child-process/run-process'
import { computeProvenanceDigest } from '../domain/worktree-provenance'
import { ReadOnlyWorktreeProvenanceSource } from './read-only-worktree-provenance-source'

// ORCA-S3 §9, §12 PROV-5/PROV-8, acceptance gates 6/11/12 — the ONLY Git
// dependency in S3: a read-only adapter restricted to an EXACT argv whitelist
// (rev-parse HEAD; cat-file -e <base>^{commit}; diff --name-only <base>..HEAD;
// -c core.fsmonitor=false rev-parse --is-inside-work-tree). RED:
// `./read-only-worktree-provenance-source` does not exist yet.

function git(args: string[], cwd: string): string {
  const r = runProcessSync({ program: 'git', args, cwd, timeoutMs: 20_000 })
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
  return r.stdout.trim()
}

function initRealWorktree(dir: string): { base: string; head: string } {
  mkdirSync(dir, { recursive: true })
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'orca-s3@test.local'], dir)
  git(['config', 'user.name', 'orca-s3'], dir)
  git(['config', 'commit.gpgsign', 'false'], dir)
  writeFileSync(join(dir, 'a.ts'), 'seed\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '-m', 'base'], dir)
  const base = git(['rev-parse', 'HEAD'], dir)
  writeFileSync(join(dir, 'b.ts'), 'change\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '-m', 'work'], dir)
  const head = git(['rev-parse', 'HEAD'], dir)
  return { base, head }
}

function objectCount(dir: string): number {
  const loose = Number(git(['count-objects', '-v'], dir).match(/^count: (\d+)/m)?.[1] ?? 0)
  const packed = Number(git(['count-objects', '-v'], dir).match(/^in-pack: (\d+)/m)?.[1] ?? 0)
  return loose + packed
}

function writeSidecar(root: string, dispatchId: string, identity: unknown): void {
  mkdirSync(join(root, 'identity'), { recursive: true })
  writeFileSync(join(root, 'identity', `${dispatchId}.json`), JSON.stringify(identity))
}

describe('ReadOnlyWorktreeProvenanceSource (§9)', () => {
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
    const d = mkdtempSync(join(tmpdir(), 'orca-s3-source-'))
    dirs.push(d)
    return d
  }

  const IDENTITY = { correlationId: 'corr_1', orcaRunId: 'run_1', orcaDispatchId: 'ctx_1', worktreeNonce: 'nonce_1' }

  it('resolves the real base_commit / HEAD / files-changed set when identity matches', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    const { base, head } = initRealWorktree(worktreePath)
    writeSidecar(root, 'ctx_1', { ...IDENTITY, sliceRef: 'ORCA-S3', worktreePath })

    const source = new ReadOnlyWorktreeProvenanceSource()
    const read = source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: base,
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY
    })

    expect(read.kind).toBe('resolved')
    if (read.kind === 'resolved') {
      expect(read.baseCommit).toBe(base)
      expect(read.candidateHead).toBe(head)
      expect(read.filesChanged).toEqual(['b.ts'])
      expect(read.provenanceDigest).toBe(
        computeProvenanceDigest({ baseCommit: base, candidateHead: head, filesChanged: ['b.ts'] })
      )
      expect(read.transcript.length).toBeGreaterThan(0)
    }
  })

  it('classifies "missing" for a confirmed non-repository directory', () => {
    const root = tmp()
    const worktreePath = join(root, 'not-a-repo')
    mkdirSync(worktreePath, { recursive: true })
    writeSidecar(root, 'ctx_1', { ...IDENTITY, sliceRef: 'ORCA-S3', worktreePath })

    const source = new ReadOnlyWorktreeProvenanceSource()
    const read = source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: 'b'.repeat(40),
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY
    })
    expect(read.kind).toBe('missing')
  })

  it('classifies "missing" for an absent worktree directory (ENOENT)', () => {
    const root = tmp()
    const worktreePath = join(root, 'never-created')
    writeSidecar(root, 'ctx_1', { ...IDENTITY, sliceRef: 'ORCA-S3', worktreePath })

    const source = new ReadOnlyWorktreeProvenanceSource()
    const read = source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: 'b'.repeat(40),
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY
    })
    expect(read.kind).toBe('missing')
  })

  it('classifies "identity_absent" when the sidecar file does not exist', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    initRealWorktree(worktreePath)

    const source = new ReadOnlyWorktreeProvenanceSource()
    const read = source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: 'b'.repeat(40),
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'), // never written
      expectedIdentity: IDENTITY
    })
    expect(read.kind).toBe('identity_absent')
  })

  it('classifies "identity_mismatch" when the sidecar identity disagrees with expectedIdentity', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    initRealWorktree(worktreePath)
    writeSidecar(root, 'ctx_1', {
      ...IDENTITY,
      worktreeNonce: 'WRONG_NONCE',
      sliceRef: 'ORCA-S3',
      worktreePath
    })

    const source = new ReadOnlyWorktreeProvenanceSource()
    const read = source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: 'b'.repeat(40),
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY
    })
    expect(read.kind).toBe('identity_mismatch')
  })

  it('classifies "identity_mismatch" when the sidecar worktreePath canonicalizes OUTSIDE the durable root', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    initRealWorktree(worktreePath)
    const outsideRoot = tmp()
    writeSidecar(root, 'ctx_1', { ...IDENTITY, sliceRef: 'ORCA-S3', worktreePath: join(outsideRoot, 'escaped') })

    const source = new ReadOnlyWorktreeProvenanceSource()
    const read = source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: 'b'.repeat(40),
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY,
      durableShadowWorktreeRoot: root
    })
    expect(read.kind).toBe('identity_mismatch')
  })

  it('classifies "operational_error" when git spawn/IO fails (injected fake git runner, never "missing")', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    initRealWorktree(worktreePath)
    writeSidecar(root, 'ctx_1', { ...IDENTITY, sliceRef: 'ORCA-S3', worktreePath })

    const source = new ReadOnlyWorktreeProvenanceSource({
      runGit: () => ({ code: null, stdout: '', stderr: 'timed out', timedOut: true })
    })
    const read = source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: 'b'.repeat(40),
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY
    })
    expect(read.kind).toBe('operational_error')
  })

  it('classifies "unstable" when a double-read of HEAD disagrees', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    const { base } = initRealWorktree(worktreePath)
    writeSidecar(root, 'ctx_1', { ...IDENTITY, sliceRef: 'ORCA-S3', worktreePath })

    let call = 0
    const source = new ReadOnlyWorktreeProvenanceSource({
      runGit: (args, cwd, timeoutMs) => {
        call += 1
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { code: 0, stdout: call === 1 ? `${'a'.repeat(40)}\n` : `${'b'.repeat(40)}\n`, stderr: '', timedOut: false }
        }
        return runProcessSync({ program: 'git', args, cwd, timeoutMs })
      }
    })
    const read = source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: base,
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY
    })
    expect(read.kind).toBe('unstable')
  })

  it('spawns ONLY the four whitelisted argv forms across a resolved read — never checkout/reset/commit/add/fetch/gc/config(write)', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    const { base } = initRealWorktree(worktreePath)
    writeSidecar(root, 'ctx_1', { ...IDENTITY, sliceRef: 'ORCA-S3', worktreePath })

    const spawned: string[][] = []
    const source = new ReadOnlyWorktreeProvenanceSource({
      runGit: (args, cwd, timeoutMs) => {
        spawned.push(args)
        return runProcessSync({ program: 'git', args, cwd, timeoutMs })
      }
    })
    source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: base,
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY
    })

    const ALLOWED = [
      ['rev-parse', 'HEAD'],
      ['cat-file', '-e', `${base}^{commit}`],
      ['diff', '--name-only', `${base}..HEAD`],
      ['-c', 'core.fsmonitor=false', 'rev-parse', '--is-inside-work-tree']
    ]
    expect(spawned.length).toBeGreaterThan(0)
    for (const args of spawned) {
      expect(ALLOWED.some((allowed) => JSON.stringify(allowed) === JSON.stringify(args))).toBe(true)
    }
    for (const forbidden of ['checkout', 'reset', 'commit', 'add', 'fetch', 'gc']) {
      expect(spawned.some((args) => args.includes(forbidden))).toBe(false)
    }
  })

  it('leaves HEAD, .git/index mtime, and the loose+packed object count unchanged across a full read (gate 6)', () => {
    const root = tmp()
    const worktreePath = join(root, 'shadow-corr_1')
    const { base } = initRealWorktree(worktreePath)
    writeSidecar(root, 'ctx_1', { ...IDENTITY, sliceRef: 'ORCA-S3', worktreePath })

    const headBefore = readFileSync(join(worktreePath, '.git', 'HEAD'), 'utf8')
    const indexMtimeBefore = statSync(join(worktreePath, '.git', 'index')).mtimeMs
    const objectsBefore = objectCount(worktreePath)

    const source = new ReadOnlyWorktreeProvenanceSource()
    source.readProvenance({
      correlationId: 'corr_1',
      boundDispatchId: 'ctx_1',
      boundRunId: 'run_1',
      boundBaseCommit: base,
      worktreePath,
      identitySidecarPath: join(root, 'identity', 'ctx_1.json'),
      expectedIdentity: IDENTITY
    })

    expect(readFileSync(join(worktreePath, '.git', 'HEAD'), 'utf8')).toBe(headBefore)
    expect(statSync(join(worktreePath, '.git', 'index')).mtimeMs).toBe(indexMtimeBefore)
    expect(objectCount(worktreePath)).toBe(objectsBefore)
  })
})
