import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import SyncDatabase from '../../sqlite/sync-database'
import type {
  AuthoritativeRunSource,
  SampleEntry,
  SampleRequest
} from '../application/authoritative-run-source'

// Execution bounded context — infrastructure. Read-only reader of the
// aiControlCenter operational DB (amendment §S: "pode ler data/app.db";
// "NÃO pode escrever"). No write method exists on this class (I1).
// RED: not implemented yet.

export class DbGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DbGuardError'
  }
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function assertNoSqliteSidecars(path: string): void {
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(path + suffix)) {
      throw new DbGuardError(`operational DB sidecar present: ${path}${suffix}`)
    }
  }
}

export class AiControlDbReader implements AuthoritativeRunSource {
  private readonly db: SyncDatabase

  constructor(readonly dbPath: string) {
    if (!existsSync(dbPath)) {
      throw new DbGuardError(`aiControlCenter DB not found: ${dbPath}`)
    }
    assertNoSqliteSidecars(dbPath)
    this.db = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true })
  }

  resolveSample(_request: SampleRequest): SampleEntry[] {
    throw new Error('NOT_IMPLEMENTED: I1 resolveSample')
  }

  close(): void {
    this.db.close()
  }
}
