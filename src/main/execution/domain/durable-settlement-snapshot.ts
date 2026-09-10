import { createHash } from 'node:crypto'

// Execution bounded context — domain. Pure. No infrastructure, no Orca types.
// The canonical, source-only value S2 derives every settlement observation from
// (ORCA-S2 SPEC §6.1). Contains NO local clock, NO Git state, NO in-process result.

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson }

export type DispatchTerminalStatus = 'completed' | 'failed' | 'circuit_broken'
export type TaskTerminalStatus = 'completed' | 'failed'

/** §6.1 — documented field set. `canonicalSerialize` sorts keys, so this order is for readers only. */
export type DurableSettlementSnapshot = {
  correlationId: string
  orgTaskId: string
  orcaRunId: string
  orcaDispatchId: string
  dispatchStatus: DispatchTerminalStatus
  dispatchCompletedAt: string | null
  taskStatus: TaskTerminalStatus
  taskCompletedAt: string | null
  taskResultCanonical: CanonicalJson | null
  attemptFactsCanonical: CanonicalJson[]
}

/**
 * §6.1 canonical serialisation — Execution-owned. Mirrors Orca `canonicalPayload`
 * normalization semantics (recursive key-sort, array order preserved, minimal
 * scalar encoding, `undefined → null`). NOT an import of Orca's module-private
 * function; the ratchet test pins the two forms together.
 */
export function canonicalSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
      .join(',')}}`
  }
  return value === undefined ? 'null' : JSON.stringify(value)
}

/** §6.1 — SHA-256 hex over the canonical serialisation of the whole snapshot. Direction-free. */
export function sourceDigest(snapshot: DurableSettlementSnapshot): string {
  return createHash('sha256').update(canonicalSerialize(snapshot)).digest('hex')
}

/** One durable `attempt_observation_facts` row as read from the shadow orchestration.db. */
export type RawAttemptFact = {
  sequence: number
  rowid: number
  authorityId: string
  authorityClock: string
  facet: string
  payload: string
}

export type RawDurableSettlement = {
  correlationId: string
  orgTaskId: string
  orcaRunId: string
  orcaDispatchId: string
  dispatchStatus: DispatchTerminalStatus
  dispatchCompletedAt: string | null
  taskStatus: TaskTerminalStatus
  taskCompletedAt: string | null
  /** `tasks.result` verbatim; `null` when the column is NULL. */
  taskResultRaw: string | null
  attemptFactsRaw: RawAttemptFact[]
}

export type SnapshotBuildResult =
  | { ok: true; snapshot: DurableSettlementSnapshot; sourceDigest: string }
  | { ok: false; partial: Record<string, unknown>; failedExpectation: string }

function parseJsonOrThrow(raw: string): CanonicalJson {
  return JSON.parse(raw) as CanonicalJson
}

/**
 * §6.1 — build the canonical snapshot from raw durable reads. A `tasks.result`
 * that is present but not valid JSON is NOT a snapshot → the caller raises an
 * `invalid_or_unresolvable_source` incident (never an invented outcome).
 */
export function buildDurableSettlementSnapshot(raw: RawDurableSettlement): SnapshotBuildResult {
  let taskResultCanonical: CanonicalJson | null = null
  if (raw.taskResultRaw !== null) {
    try {
      taskResultCanonical = parseJsonOrThrow(raw.taskResultRaw)
    } catch (error) {
      return {
        ok: false,
        partial: {
          correlationId: raw.correlationId,
          orcaDispatchId: raw.orcaDispatchId,
          dispatchStatus: raw.dispatchStatus,
          taskStatus: raw.taskStatus,
          taskResultRaw: raw.taskResultRaw
        },
        failedExpectation: `tasks.result is present but not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
    }
  }

  const attemptFactsCanonical: CanonicalJson[] = [...raw.attemptFactsRaw]
    .sort((a, b) => a.sequence - b.sequence || a.rowid - b.rowid)
    .map((fact) => {
      let payload: CanonicalJson = null
      try {
        payload = parseJsonOrThrow(fact.payload)
      } catch {
        payload = fact.payload
      }
      return {
        sequence: fact.sequence,
        authorityId: fact.authorityId,
        authorityClock: fact.authorityClock,
        facet: fact.facet,
        payload
      }
    })

  const snapshot: DurableSettlementSnapshot = {
    correlationId: raw.correlationId,
    orgTaskId: raw.orgTaskId,
    orcaRunId: raw.orcaRunId,
    orcaDispatchId: raw.orcaDispatchId,
    dispatchStatus: raw.dispatchStatus,
    dispatchCompletedAt: raw.dispatchCompletedAt,
    taskStatus: raw.taskStatus,
    taskCompletedAt: raw.taskCompletedAt,
    taskResultCanonical,
    attemptFactsCanonical
  }
  return { ok: true, snapshot, sourceDigest: sourceDigest(snapshot) }
}
