import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import type {
  DurableWorktreeRead,
  DurableWorktreeReadInput,
  DurableWorktreeSource
} from '../application/durable-worktree-source'
import {
  canonicalizesInsideRoot,
  computeProvenanceDigest,
  identityEquals,
  observedIdentityDigest,
  type WorktreeIdentity
} from '../domain/worktree-provenance'
import { filesChangedSet } from '../domain/parity'
import { readIdentitySidecarFile } from './identity-sidecar-store'
import { runProcessSync } from '../../../shared/child-process/run-process'

// Execution bounded context — infrastructure. ReadOnlyWorktreeProvenanceSource
// (§9, §12 PROV-5/PROV-8) — the ONLY Git dependency in S3. Verifies identity
// FIRST, via a plain file read of the Execution-owned sidecar (no Git), then
// spawns ONLY an exact four-form argv whitelist over the shared runProcess.
// Zero worktree mutation; never constructs an Orca row type.

type RawGitResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean }
type RunGit = (args: string[], cwd: string, timeoutMs: number) => RawGitResult

const GIT_TIMEOUT_MS = 20_000
const NOT_A_REPO_PATTERN = /not a git repository/i

function defaultRunGit(args: string[], cwd: string, timeoutMs: number): RawGitResult {
  try {
    const r = runProcessSync({ program: 'git', args: [...args], cwd, timeoutMs })
    return { code: r.code, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut }
  } catch (error) {
    // A cwd that vanished between the existsSync check and the spawn, or any
    // other spawn-level failure — never fabricate a result, surface it as
    // operational (never "missing": only a confirmed non-repository is that).
    return {
      code: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      timedOut: false
    }
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export class ReadOnlyWorktreeProvenanceSource implements DurableWorktreeSource {
  private readonly runGit: RunGit

  constructor(opts: { runGit?: RunGit } = {}) {
    this.runGit = opts.runGit ?? defaultRunGit
  }

  readProvenance(input: DurableWorktreeReadInput): DurableWorktreeRead {
    const identityRead = readIdentitySidecarFile(input.identitySidecarPath)
    if (identityRead.kind === 'absent' || identityRead.kind === 'corrupt') {
      return { kind: 'identity_absent' }
    }
    const observed: WorktreeIdentity = {
      correlationId: identityRead.identity.correlationId,
      orcaRunId: identityRead.identity.orcaRunId,
      orcaDispatchId: identityRead.identity.orcaDispatchId,
      worktreeNonce: identityRead.identity.worktreeNonce
    }
    const insideRoot =
      input.durableShadowWorktreeRoot === undefined ||
      canonicalizesInsideRoot(identityRead.identity.worktreePath, input.durableShadowWorktreeRoot)
    if (!identityEquals(observed, input.expectedIdentity) || !insideRoot) {
      return { kind: 'identity_mismatch', observedIdentityDigest: observedIdentityDigest(observed) }
    }

    if (!existsSync(input.worktreePath)) {
      return { kind: 'missing' }
    }

    const head1 = this.runGit(['rev-parse', 'HEAD'], input.worktreePath, GIT_TIMEOUT_MS)
    const classified1 = this.classifyFailure(head1, input.worktreePath)
    if (classified1) {
      return classified1
    }
    const head2 = this.runGit(['rev-parse', 'HEAD'], input.worktreePath, GIT_TIMEOUT_MS)
    const classified2 = this.classifyFailure(head2, input.worktreePath)
    if (classified2) {
      return classified2
    }
    const headValue1 = head1.stdout.trim()
    const headValue2 = head2.stdout.trim()
    if (headValue1 !== headValue2) {
      return { kind: 'unstable' }
    }

    const catFile = this.runGit(
      ['cat-file', '-e', `${input.boundBaseCommit}^{commit}`],
      input.worktreePath,
      GIT_TIMEOUT_MS
    )
    if (catFile.timedOut || catFile.code !== 0) {
      return { kind: 'operational_error', detail: catFile.stderr || 'cat-file -e failed' }
    }

    const diff = this.runGit(
      ['diff', '--name-only', `${input.boundBaseCommit}..HEAD`],
      input.worktreePath,
      GIT_TIMEOUT_MS
    )
    if (diff.timedOut || diff.code !== 0) {
      return { kind: 'operational_error', detail: diff.stderr || 'diff --name-only failed' }
    }

    const filesChanged = filesChangedSet(diff.stdout.split('\n'))
    const provenanceDigest = computeProvenanceDigest({
      baseCommit: input.boundBaseCommit,
      candidateHead: headValue1,
      filesChanged
    })
    return {
      kind: 'resolved',
      baseCommit: input.boundBaseCommit,
      candidateHead: headValue1,
      filesChanged,
      provenanceDigest,
      transcript: [
        { cmd: 'rev-parse HEAD', outHash: sha256(head1.stdout) },
        { cmd: `cat-file -e ${input.boundBaseCommit}^{commit}`, outHash: sha256(catFile.stdout) },
        { cmd: `diff --name-only ${input.boundBaseCommit}..HEAD`, outHash: sha256(diff.stdout) }
      ]
    }
  }

  /** Distinguishes a confirmed non-repository from an operational (retryable) git failure. */
  private classifyFailure(
    result: RawGitResult,
    worktreePath: string
  ): { kind: 'missing' } | { kind: 'operational_error'; detail: string } | undefined {
    if (result.timedOut) {
      return { kind: 'operational_error', detail: result.stderr || 'git timed out' }
    }
    if (result.code === 0) {
      return undefined
    }
    const probe = this.runGit(
      ['-c', 'core.fsmonitor=false', 'rev-parse', '--is-inside-work-tree'],
      worktreePath,
      GIT_TIMEOUT_MS
    )
    if (probe.timedOut) {
      return { kind: 'operational_error', detail: probe.stderr || 'git timed out' }
    }
    const confirmedNonRepo =
      (probe.code === 0 && probe.stdout.trim() === 'false') ||
      (probe.code !== 0 && NOT_A_REPO_PATTERN.test(probe.stderr))
    if (confirmedNonRepo) {
      return { kind: 'missing' }
    }
    return { kind: 'operational_error', detail: result.stderr || 'non-classifiable git failure' }
  }
}
