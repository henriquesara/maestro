import { existsSync, statSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

// Execution bounded context — infrastructure. Blocker B4: refuse to open the
// Execution store read-write when its path resolves to the SAME underlying file
// as the aiControlCenter operational DB, through any alias — identical path,
// relative/absolute, symlink, hard link, or equivalent canonical filesystem
// identity. Enforced BEFORE the writable open; never relies on the post-run
// SHA guard.

export class ExecutionStorePathAliasError extends Error {
  constructor(
    readonly code: 'identical_path' | 'canonical_path' | 'filesystem_identity',
    message: string
  ) {
    super(message)
    this.name = 'ExecutionStorePathAliasError'
  }
}

function canonicalPath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

function fsIdentity(p: string): string | null {
  if (!existsSync(p)) {
    return null
  }
  try {
    const s = statSync(p)
    // dev + ino uniquely identify a file on POSIX; on Windows better-sqlite3/node
    // populate ino for NTFS. A hard link shares (dev, ino) with its target.
    return `${s.dev}:${s.ino}`
  } catch {
    return null
  }
}

/**
 * Throws if `executionStorePath` aliases `aicontrolDbPath`. `:memory:` is always
 * safe. Call this before constructing any writable SQLite handle on the store.
 */
export function assertExecutionStorePathNotAlias(
  executionStorePath: string,
  aicontrolDbPath: string
): void {
  if (executionStorePath === ':memory:') {
    return
  }

  const rawEq = resolve(executionStorePath) === resolve(aicontrolDbPath)
  if (rawEq) {
    throw new ExecutionStorePathAliasError(
      'identical_path',
      `executionStorePath resolves to the same path as data/app.db: ${resolve(executionStorePath)}`
    )
  }

  const canEq = canonicalPath(executionStorePath) === canonicalPath(aicontrolDbPath)
  if (canEq) {
    throw new ExecutionStorePathAliasError(
      'canonical_path',
      `executionStorePath canonicalises to data/app.db: ${canonicalPath(executionStorePath)}`
    )
  }

  const idA = fsIdentity(executionStorePath)
  const idB = fsIdentity(aicontrolDbPath)
  if (idA !== null && idB !== null && idA === idB) {
    throw new ExecutionStorePathAliasError(
      'filesystem_identity',
      `executionStorePath shares filesystem identity (${idA}) with data/app.db — a hard link or equivalent alias`
    )
  }
}
