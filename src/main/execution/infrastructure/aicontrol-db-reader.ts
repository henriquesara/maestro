import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import SyncDatabase from '../../sqlite/sync-database'

// Execution bounded context — infrastructure. Read-only reader of the
// aiControlCenter operational DB (amendment §S: "pode ler data/app.db"; "NÃO
// pode escrever"). No write method exists on this class (I1). It supplies only
// the authoritative agent profiles and their run ids for traceability — never a
// parity outcome (blocker B7: outcomes come from the same-workload comparison).

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
    if (existsSync(`${path}${suffix}`)) {
      throw new DbGuardError(`operational DB sidecar present: ${path}${suffix}`)
    }
  }
}

export type AuthoritativeProfile = {
  agentId: string
  /** Real `agent_runs.id`s for this agent, oldest first — used only as `authoritativeRunRef`. */
  runIds: readonly string[]
}

export class AiControlDbReader {
  private readonly db: SyncDatabase

  constructor(readonly dbPath: string) {
    if (!existsSync(dbPath)) {
      throw new DbGuardError(`aiControlCenter DB not found: ${dbPath}`)
    }
    assertNoSqliteSidecars(dbPath)
    this.db = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true })
  }

  /** Read-only. Distinct agent profiles with their run ids, oldest first. */
  listProfiles(limitPerAgent = 8): AuthoritativeProfile[] {
    const agentIds = (
      this.db.prepare('SELECT DISTINCT agent_id FROM agent_runs ORDER BY agent_id').all() as {
        agent_id: string
      }[]
    ).map((r) => r.agent_id)

    return agentIds.map((agentId) => ({
      agentId,
      runIds: (
        this.db
          .prepare('SELECT id FROM agent_runs WHERE agent_id = ? ORDER BY created_at, id LIMIT ?')
          .all(agentId, limitPerAgent) as { id: string }[]
      ).map((r) => r.id)
    }))
  }

  close(): void {
    this.db.close()
  }
}
