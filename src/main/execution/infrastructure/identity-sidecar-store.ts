import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Execution bounded context — infrastructure. §7.2, §7.6 step 2, §12
// PROV-3/PROV-5/PROV-11 — the Execution-owned identity sidecar. Lives at
// `<durableShadowWorktreeRoot>/identity/<orcaDispatchId>.json`, OUTSIDE
// `.git/`, OUTSIDE the worktree, and OUTSIDE all Git administrative storage —
// portable across standalone and linked worktrees. Written with NO Git
// command via an atomic temp-file + rename WITHIN the durable root.

export type IdentitySidecar = {
  correlationId: string
  orcaRunId: string
  orcaDispatchId: string
  worktreeNonce: string
  sliceRef: string
  worktreePath: string
}

const REQUIRED_FIELDS = [
  'correlationId',
  'orcaRunId',
  'orcaDispatchId',
  'worktreeNonce',
  'sliceRef',
  'worktreePath'
] as const

export type IdentitySidecarRead =
  | { kind: 'absent' }
  | { kind: 'corrupt' }
  | { kind: 'present'; identity: IdentitySidecar }

export function identitySidecarPath(
  durableShadowWorktreeRoot: string,
  orcaDispatchId: string
): string {
  return join(durableShadowWorktreeRoot, 'identity', `${orcaDispatchId}.json`)
}

function parseIdentitySidecarContent(raw: string): IdentitySidecar | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const obj = parsed as Record<string, unknown>
  if (REQUIRED_FIELDS.some((field) => typeof obj[field] !== 'string')) {
    return undefined
  }
  return obj as unknown as IdentitySidecar
}

/** Read a sidecar file at an exact path — no Git, no root-relative resolution. */
export function readIdentitySidecarFile(path: string): IdentitySidecarRead {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { kind: 'absent' }
  }
  const identity = parseIdentitySidecarContent(raw)
  return identity ? { kind: 'present', identity } : { kind: 'corrupt' }
}

export function readIdentitySidecar(
  durableShadowWorktreeRoot: string,
  orcaDispatchId: string
): IdentitySidecarRead {
  return readIdentitySidecarFile(identitySidecarPath(durableShadowWorktreeRoot, orcaDispatchId))
}

/** §7.6 step 2 — atomic temp-file + rename, within the same durable root. No Git command. */
export function writeIdentitySidecarAtomically(
  durableShadowWorktreeRoot: string,
  orcaDispatchId: string,
  identity: IdentitySidecar
): void {
  const identityDir = join(durableShadowWorktreeRoot, 'identity')
  mkdirSync(identityDir, { recursive: true })
  const finalPath = identitySidecarPath(durableShadowWorktreeRoot, orcaDispatchId)
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, JSON.stringify(identity))
  renameSync(tmpPath, finalPath)
}
