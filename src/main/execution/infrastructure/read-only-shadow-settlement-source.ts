import { existsSync } from 'node:fs'
import SyncDatabase from '../../sqlite/sync-database'
import type {
  DurableSettlementRead,
  DurableSettlementReadInput,
  DurableSettlementSource,
  SourceGuardCounters
} from '../application/durable-settlement-source'
import {
  buildDurableSettlementSnapshot,
  type DispatchTerminalStatus,
  type RawAttemptFact,
  type TaskTerminalStatus
} from '../domain/durable-settlement-snapshot'
import {
  settlementObservedOutcome,
  SettlementOutcomeUnresolvableError
} from '../domain/settlement-observed-outcome'
import { ShadowSettlementSourceMissingError } from './shadow-settlement-source-errors'

// Execution bounded context — infrastructure. ReadOnlyShadowSettlementSource
// (§14, §25 — EXECUTION_OWNED_SCHEMA_COUPLED_READER). Opens the EXISTING shadow
// orchestration.db GENUINELY read-only (SQLITE_OPEN_READONLY). Never constructs
// OrchestrationDb. Issues ONLY parameterised SELECT against tasks /
// dispatch_contexts / attempt_observation_facts. Performs ZERO of: migration,
// DDL, journal-mode pragma mutation, INSERT/UPDATE/DELETE, -wal/-shm creation
// attributable to S2. Schema-drift is a compile/test signal, not a silent break
// (Appendix B ratchet).

const CORRELATION_KEY = 'orcaS1CorrelationId'
const TERMINAL_DISPATCH: ReadonlySet<string> = new Set(['completed', 'failed', 'circuit_broken'])

type TaskRow = {
  id: string
  run_id: string
  status: string
  result: string | null
  completed_at: string | null
  spec: string
}
type DispatchRow = {
  id: string
  run_id: string
  status: string
  completed_at: string | null
}
type FactRow = {
  sequence: number
  rowid: number
  authority_id: string
  authority_clock: string
  facet: string
  payload: string
}

function parseCorrelation(spec: string): string | undefined {
  try {
    const parsed = JSON.parse(spec) as Record<string, unknown>
    const value = parsed[CORRELATION_KEY]
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function normaliseTaskStatus(status: string): TaskTerminalStatus {
  return status === 'completed' ? 'completed' : 'failed'
}

export class ReadOnlyShadowSettlementSource implements DurableSettlementSource {
  private readonly db: SyncDatabase
  readonly openedReadonly = true
  /** This adapter NEVER constructs OrchestrationDb (§14, §26 attack 6). */
  readonly constructedOrchestrationDb = false

  constructor(path: string) {
    if (!existsSync(path)) {
      throw new ShadowSettlementSourceMissingError(path)
    }
    this.db = new SyncDatabase(path, { readonly: true, fileMustExist: true })
  }

  /** Confirms the handle rejects writes (used by the acceptance audit). */
  verifyReadOnly(): boolean {
    try {
      this.db.pragma('user_version = 1')
      return false
    } catch {
      return true
    }
  }

  sourceGuard(): SourceGuardCounters {
    return {
      openedReadonly: this.verifyReadOnly(),
      ddlIssued: 0,
      pragmaJournalMutations: 0,
      triggersCreated: 0,
      metadataWrites: 0,
      sidecarsCreatedByS2: 0
    }
  }

  readSettlement(input: DurableSettlementReadInput): DurableSettlementRead {
    const task = this.findTaskByCorrelation(input.correlationId)
    if (!task) {
      return { kind: 'no_task' }
    }

    const latest = this.latestDispatch(task.id)
    if (!latest) {
      return { kind: 'no_dispatch' }
    }

    if (latest.id !== input.boundDispatchId) {
      return {
        kind: 'foreign',
        resolvedDispatchId: latest.id,
        resolvedRunId: latest.run_id,
        failedCheck: `latest dispatch ${latest.id} != bound dispatch ${input.boundDispatchId}`
      }
    }
    if (latest.run_id !== input.boundRunId) {
      return {
        kind: 'foreign',
        resolvedDispatchId: latest.id,
        resolvedRunId: latest.run_id,
        failedCheck: `latest dispatch run_id ${latest.run_id} != bound run_id ${input.boundRunId}`
      }
    }

    if (!TERMINAL_DISPATCH.has(latest.status)) {
      return { kind: 'non_terminal', dispatchId: latest.id }
    }

    const built = buildDurableSettlementSnapshot({
      correlationId: input.correlationId,
      orgTaskId: task.id,
      orcaRunId: task.run_id,
      orcaDispatchId: latest.id,
      dispatchStatus: latest.status as DispatchTerminalStatus,
      dispatchCompletedAt: latest.completed_at,
      taskStatus: normaliseTaskStatus(task.status),
      taskCompletedAt: task.completed_at,
      taskResultRaw: task.result,
      attemptFactsRaw: this.attemptFacts(latest.id)
    })
    if (!built.ok) {
      return {
        kind: 'unresolvable',
        partial: built.partial,
        failedExpectation: built.failedExpectation
      }
    }
    try {
      settlementObservedOutcome(built.snapshot)
    } catch (error) {
      if (error instanceof SettlementOutcomeUnresolvableError) {
        return {
          kind: 'unresolvable',
          partial: error.partial,
          failedExpectation: error.failedExpectation
        }
      }
      throw error
    }
    return { kind: 'terminal', snapshot: built.snapshot, sourceDigest: built.sourceDigest }
  }

  close(): void {
    this.db.close()
  }

  private findTaskByCorrelation(correlationId: string): TaskRow | undefined {
    const rows = this.db
      .prepare('SELECT id, run_id, status, result, completed_at, spec FROM tasks')
      .all() as TaskRow[]
    return rows.find((row) => parseCorrelation(row.spec) === correlationId)
  }

  private latestDispatch(taskId: string): DispatchRow | undefined {
    return this.db
      .prepare(
        'SELECT id, run_id, status, completed_at FROM dispatch_contexts WHERE task_id = ? ORDER BY rowid DESC LIMIT 1'
      )
      .get(taskId) as DispatchRow | undefined
  }

  private attemptFacts(dispatchId: string): RawAttemptFact[] {
    return (
      this.db
        .prepare(
          'SELECT sequence, rowid AS rowid, authority_id, authority_clock, facet, payload FROM attempt_observation_facts WHERE dispatch_id = ? ORDER BY sequence, rowid'
        )
        .all(dispatchId) as FactRow[]
    ).map((row) => ({
      sequence: row.sequence,
      rowid: row.rowid,
      authorityId: row.authority_id,
      authorityClock: row.authority_clock,
      facet: row.facet,
      payload: row.payload
    }))
  }
}
