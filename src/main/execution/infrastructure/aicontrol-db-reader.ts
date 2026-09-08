import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import SyncDatabase from '../../sqlite/sync-database'
import type {
  AuthoritativeRunSource,
  SampleEntry,
  SampleRequest,
  SampleSlot
} from '../application/authoritative-run-source'
import { filesChangedSet, type ExecutionOutcome } from '../domain/parity'

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

  /** Read-only. One SELECT per slot; never a write. */
  resolveSample(request: SampleRequest): SampleEntry[] {
    const agentIds = (
      this.db.prepare('SELECT DISTINCT agent_id FROM agent_runs ORDER BY agent_id').all() as {
        agent_id: string
      }[]
    ).map((r) => r.agent_id)

    // Per-(agent, status) cursor so two slots for the same pair bind to two
    // *distinct* rows — keeping aicontrol_run_id unique across the sample.
    const cursor = new Map<string, number>()
    return request.slots.map((slot) => this.resolveSlot(slot, agentIds, cursor))
  }

  private resolveSlot(
    slot: SampleSlot,
    agentIds: readonly string[],
    cursor: Map<string, number>
  ): SampleEntry {
    const agentId = agentIds[slot.agentIndex]
    if (agentId === undefined) {
      return { kind: 'unavailable', profile: slot.profile, reason: 'sample_source_unavailable' }
    }
    const key = `${agentId}:${slot.status}`
    const offset = cursor.get(key) ?? 0
    cursor.set(key, offset + 1)
    const row = this.db
      .prepare(
        'SELECT id, files_changed FROM agent_runs WHERE agent_id = ? AND status = ? ORDER BY created_at, id LIMIT 1 OFFSET ?'
      )
      .get(agentId, slot.status, offset) as { id: string; files_changed: string | null } | undefined
    if (!row) {
      return { kind: 'unavailable', profile: slot.profile, reason: 'sample_source_unavailable' }
    }
    return {
      kind: 'record',
      profile: slot.profile,
      record: {
        aicontrolRunId: row.id,
        agentId,
        recordedOutcome: recordedOutcome(slot.status, row.files_changed),
        descriptor: slot.descriptor,
        workload: slot.workload
      }
    }
  }

  close(): void {
    this.db.close()
  }
}

function recordedOutcome(
  status: 'completed' | 'failed' | 'cancelled',
  filesChangedRaw: string | null
): ExecutionOutcome {
  let filesChanged: ExecutionOutcome['filesChanged'] = null
  if (filesChangedRaw && filesChangedRaw.trim().length > 0) {
    try {
      const parsed = JSON.parse(filesChangedRaw) as unknown
      if (Array.isArray(parsed)) {
        filesChanged = filesChangedSet(parsed.filter((p): p is string => typeof p === 'string'))
      }
    } catch {
      filesChanged = null
    }
  }
  if (status === 'completed') {
    return {
      terminalOutcome: 'completed',
      exitDisposition: 'zero_exit',
      cancellationBehavior: 'not_cancelled',
      filesChanged
    }
  }
  if (status === 'failed') {
    return {
      terminalOutcome: 'failed',
      exitDisposition: 'non_zero_exit',
      cancellationBehavior: 'not_cancelled',
      filesChanged
    }
  }
  // Recorded cancellation granularity is coarse — the row does not distinguish
  // mid-flight from clean, so the recorded behavior is 'cancelled_clean'.
  return {
    terminalOutcome: 'cancelled',
    exitDisposition: 'no_exit',
    cancellationBehavior: 'cancelled_clean',
    filesChanged
  }
}
