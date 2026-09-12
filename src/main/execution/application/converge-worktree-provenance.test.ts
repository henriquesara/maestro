import { describe, expect, it, vi } from 'vitest'
import {
  makeCorrelationId,
  makeOrcaDispatchRef,
  makeOrcaRunRef,
  makeOrgTaskRef,
  type RunBinding
} from '../domain/execution-identity'
import type { SettlementObservationRecord } from '../domain/settlement-observation'
import { ExecutionStoreBusyError } from '../infrastructure/with-immediate-transaction'
import {
  convergeWorktreeProvenance,
  type ConvergeWorktreeDeps,
  type WorktreeProvenanceConvergenceReport
} from './converge-worktree-provenance'

// ORCA-S3 §8 (Phase A record / Phase B re-verify), §12 PROV-1..12 — unit-level
// coverage of the sibling two-phase sweep against FAKE dependencies (real
// SQLite / real git are exercised at the slice-acceptance level). RED:
// `./converge-worktree-provenance` does not exist yet.

const SLICE = 'ORCA-S3'
const CID = 'corr_1'
const DISPATCH = 'ctx_1'
const RUN = 'run_1'
const TASK = 'task_1'

function binding(over: Partial<RunBinding> = {}): RunBinding {
  return {
    correlationId: makeCorrelationId(CID),
    governanceAgentRunId: 'gar_1' as never,
    aicontrolRunId: null,
    orcaRunId: makeOrcaRunRef(RUN),
    orcaDispatchId: makeOrcaDispatchRef(DISPATCH),
    orgTaskId: makeOrgTaskRef(TASK),
    sliceRef: SLICE,
    baseCommit: 'b'.repeat(40),
    candidateHead: null,
    boundAt: '2026-09-12T00:00:00Z',
    ...over
  }
}

function settlement(
  status: 'observed' | 'observed_conflicted' = 'observed'
): SettlementObservationRecord {
  return {
    correlationId: CID,
    orcaDispatchId: DISPATCH,
    orcaRunId: RUN,
    orgTaskId: TASK,
    sliceRef: SLICE,
    status,
    sourceDispatchStatus: 'completed',
    sourceDispatchCompletedAt: '2026-09-12T00:00:00Z',
    sourceTaskStatus: 'completed',
    sourceTaskCompletedAt: '2026-09-12T00:00:00Z',
    sourceDigest: 'x'.repeat(64),
    observedOutcomeJson: '{}',
    provenanceJson: '{}',
    firstSeenAt: '2026-09-12T00:00:00Z',
    observedAt: '2026-09-12T00:00:00Z',
    conflictedAt: null
  }
}

function dispatchWorktree(over: Record<string, unknown> = {}) {
  return {
    orcaDispatchId: DISPATCH,
    correlationId: CID,
    orcaRunId: RUN,
    worktreeNonce: 'nonce_1',
    worktreePath: '/durable/root/shadow-corr_1',
    rootRef: 'root_gen_1',
    openedAt: '2026-09-12T00:00:00Z',
    ...over
  }
}

function resolvedRead(over: Record<string, unknown> = {}) {
  return {
    kind: 'resolved' as const,
    baseCommit: 'b'.repeat(40),
    candidateHead: 'c'.repeat(40),
    filesChanged: ['a.ts'],
    provenanceDigest: 'd'.repeat(64),
    transcript: [{ cmd: 'rev-parse HEAD', outHash: 'h'.repeat(64) }],
    ...over
  }
}

/** In-memory fakes for every S3 port. Each store starts empty unless seeded. */
function makeFakes(opts: {
  bindings?: RunBinding[]
  settlements?: Map<string, SettlementObservationRecord>
  dispatchWorktrees?: Map<string, ReturnType<typeof dispatchWorktree>>
  provenance?: Map<string, Record<string, unknown>>
  openIncidents?: Set<string>
  read?: unknown
  casResult?: 'set' | 'already_equal' | 'conflict'
  busy?: boolean
}) {
  const provenanceRows = opts.provenance ?? new Map<string, Record<string, unknown>>()
  const incidentsInserted: Record<string, unknown>[] = []
  const openIncidents = opts.openIncidents ?? new Set<string>()
  const conflicted: { correlationId: string; conflictedAt: string }[] = []
  const casCalls: { orcaDispatchId: string; candidateHead: string }[] = []

  const deps: ConvergeWorktreeDeps = {
    store: {
      listBindings: () => opts.bindings ?? [binding()]
    } as ConvergeWorktreeDeps['store'],
    settlements: {
      getByCorrelation: (cid: string) => opts.settlements?.get(cid)
    } as ConvergeWorktreeDeps['settlements'],
    dispatchWorktrees: {
      getByDispatchId: (id: string) => opts.dispatchWorktrees?.get(id)
    } as ConvergeWorktreeDeps['dispatchWorktrees'],
    provenance: {
      getByCorrelation: (cid: string) => provenanceRows.get(cid),
      insert: vi.fn((record: Record<string, unknown>) => {
        if (provenanceRows.has(record.correlationId as string)) {
          return { inserted: false }
        }
        provenanceRows.set(record.correlationId as string, record)
        return { inserted: true }
      }),
      markConflicted: vi.fn((cid: string, input: { conflictedAt: string }) => {
        conflicted.push({ correlationId: cid, conflictedAt: input.conflictedAt })
        const row = provenanceRows.get(cid)
        if (row) {
          row.status = 'conflicted'
          row.conflictedAt = input.conflictedAt
        }
      }),
      listBySlice: () => [...provenanceRows.values()]
    } as unknown as ConvergeWorktreeDeps['provenance'],
    incidents: {
      hasOpenIncident: (cid: string) => openIncidents.has(cid),
      insert: vi.fn((record: Record<string, unknown>) => {
        incidentsInserted.push(record)
        openIncidents.add(record.correlationId as string)
        return { inserted: true }
      }),
      listBySlice: () => incidentsInserted
    } as unknown as ConvergeWorktreeDeps['incidents'],
    runBindingCandidateHead: {
      casSetCandidateHead: vi.fn((orcaDispatchId: string, candidateHead: string) => {
        casCalls.push({ orcaDispatchId, candidateHead })
        return opts.casResult ?? 'set'
      })
    } as ConvergeWorktreeDeps['runBindingCandidateHead'],
    source: {
      readProvenance: vi.fn(() => opts.read ?? resolvedRead())
    } as unknown as ConvergeWorktreeDeps['source'],
    txn: {
      withImmediateTransaction: <T>(fn: () => T): T => {
        if (opts.busy) {
          throw new ExecutionStoreBusyError(5)
        }
        return fn()
      }
    },
    durableShadowWorktreeRoot: '/durable/root',
    newId: (() => {
      let n = 0
      return (prefix: string) => `${prefix}_${++n}`
    })(),
    now: () => '2026-09-12T00:00:00Z'
  }

  return { deps, provenanceRows, incidentsInserted, openIncidents, conflicted, casCalls }
}

function run(deps: ConvergeWorktreeDeps): WorktreeProvenanceConvergenceReport {
  return convergeWorktreeProvenance(deps, { sliceRef: SLICE })
}

describe('convergeWorktreeProvenance — Phase A (record)', () => {
  it('skips a binding with no settlement_observation yet', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({ settlements: new Map() })
    const report = run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(incidentsInserted).toHaveLength(0)
    expect(report.observed).toHaveLength(0)
  })

  it('skips a binding with an open worktree_provenance_incident (S3-only block)', () => {
    const { deps, provenanceRows } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      openIncidents: new Set([CID])
    })
    const report = run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(report.observed).toHaveLength(0)
  })

  it('PROV-12 / §7.6 window F — settlement_observation present, NO dispatch_worktree row, no prior provenance: LEGACY_BINDING_NOT_CONVERGEABLE, 0 rows, 0 incidents, not blocked', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map()
    })
    const report = run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(incidentsInserted).toHaveLength(0)
    expect(report.legacyNotConvergeable).toContain(CID)
  })

  it('PROV-3 — identity sidecar absent: worktree_dispatch_mismatch(identity_discriminator_absent), NO row', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      read: { kind: 'identity_absent' }
    })
    run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(incidentsInserted).toHaveLength(1)
    expect(incidentsInserted[0]).toMatchObject({
      kind: 'worktree_dispatch_mismatch',
      correlationId: CID
    })
    expect(JSON.parse(incidentsInserted[0].detailJson as string).failed_check).toBe(
      'identity_discriminator_absent'
    )
  })

  it('PROV-3 — identity mismatch: worktree_dispatch_mismatch(identity_discriminator_mismatch), NO row', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      read: { kind: 'identity_mismatch', observedIdentityDigest: 'z'.repeat(64) }
    })
    run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(JSON.parse(incidentsInserted[0].detailJson as string).failed_check).toBe(
      'identity_discriminator_mismatch'
    )
  })

  it('PROV-1 — confirmed non-repository: worktree_missing incident, blocked, NO row, NO fabricated SHA', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      read: { kind: 'missing' }
    })
    run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(incidentsInserted[0]).toMatchObject({ kind: 'worktree_missing', blocked: true })
  })

  it('operational failure: WORKTREE_SOURCE_OPERATIONAL_RETRYABLE — NO row, NO incident, not blocked, surfaced', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      read: { kind: 'operational_error', detail: 'timeout' }
    })
    const report = run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(incidentsInserted).toHaveLength(0)
    expect(report.retryable).toContainEqual(
      expect.objectContaining({
        correlationId: CID,
        reason: 'WORKTREE_SOURCE_OPERATIONAL_RETRYABLE'
      })
    )
  })

  it('unstable double-read across the budget: WORKTREE_SOURCE_UNSTABLE_RETRYABLE — NO row, NO incident, not blocked', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      read: { kind: 'unstable' }
    })
    const report = run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(incidentsInserted).toHaveLength(0)
    expect(report.retryable).toContainEqual(
      expect.objectContaining({ correlationId: CID, reason: 'WORKTREE_SOURCE_UNSTABLE_RETRYABLE' })
    )
  })

  it('base_commit disagreement: worktree_dispatch_mismatch(base_commit_disagreement), NO row', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      read: resolvedRead({ baseCommit: 'DIFFERENT'.padEnd(40, '0') })
    })
    run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(JSON.parse(incidentsInserted[0].detailJson as string).failed_check).toBe(
      'base_commit_disagreement'
    )
  })

  it('R2 — run_binding.candidate_head already non-null and DIFFERENT from the read HEAD: worktree_dispatch_mismatch(candidate_head_disagreement), NO row, never overwrite', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      bindings: [binding({ candidateHead: 'z'.repeat(40) })],
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      read: resolvedRead({ candidateHead: 'c'.repeat(40) })
    })
    run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(JSON.parse(incidentsInserted[0].detailJson as string).failed_check).toBe(
      'candidate_head_disagreement'
    )
  })

  it('terminal + stable + identity-matched: converges — inserts worktree_provenance(status=recorded, provenance_source=converged_from_worktree) and CAS-fills candidate_head in one pass', () => {
    const { deps, provenanceRows, casCalls } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]])
    })
    const report = run(deps)
    expect(provenanceRows.size).toBe(1)
    const row = provenanceRows.get(CID)!
    expect(row.status).toBe('recorded')
    expect(row.provenanceSource).toBe('converged_from_worktree')
    expect(report.observed).toContainEqual(expect.objectContaining({ correlationId: CID }))
    expect(casCalls).toContainEqual({ orcaDispatchId: DISPATCH, candidateHead: 'c'.repeat(40) })
  })

  it('PROV-2 idempotency — a correlation_id PK collision on retry is a no-op, not an error, not a duplicate row', () => {
    const { deps, provenanceRows } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]])
    })
    run(deps)
    expect(provenanceRows.size).toBe(1)
    expect(() => run(deps)).not.toThrow()
  })

  it('EXECUTION_STORE_BUSY_RETRYABLE — write-txn not acquired: NO row, NO incident, not blocked, surfaced with attempt count', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      busy: true
    })
    const report = run(deps)
    expect(provenanceRows.size).toBe(0)
    expect(incidentsInserted).toHaveLength(0)
    expect(report.retryable).toContainEqual(
      expect.objectContaining({ correlationId: CID, reason: 'EXECUTION_STORE_BUSY_RETRYABLE' })
    )
  })
})

describe('convergeWorktreeProvenance — Phase B (re-verify)', () => {
  function seeded(over: Record<string, unknown> = {}) {
    return new Map([
      [
        CID,
        {
          correlationId: CID,
          orcaDispatchId: DISPATCH,
          orcaRunId: RUN,
          sliceRef: SLICE,
          status: 'recorded',
          baseCommit: 'b'.repeat(40),
          candidateHead: 'c'.repeat(40),
          filesChangedJson: JSON.stringify(['a.ts']),
          provenanceSource: 'converged_from_worktree',
          worktreePathRef: '/durable/root/shadow-corr_1',
          provenanceDigest: 'd'.repeat(64),
          provenanceJson: '{}',
          firstSeenAt: '2026-09-12T00:00:00Z',
          observedAt: '2026-09-12T00:00:00Z',
          conflictedAt: null,
          ...over
        }
      ]
    ])
  }

  it('stable-and-equal re-read: no-op', () => {
    const { deps, incidentsInserted, conflicted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      provenance: seeded(),
      read: resolvedRead({ provenanceDigest: 'd'.repeat(64) })
    })
    run(deps)
    expect(incidentsInserted).toHaveLength(0)
    expect(conflicted).toHaveLength(0)
  })

  it('stable-and-DIFFERENT digest: exactly one provenance_snapshot_changed incident, status -> conflicted, artifact columns byte-preserved', () => {
    const { deps, provenanceRows, incidentsInserted, conflicted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      provenance: seeded(),
      read: resolvedRead({ candidateHead: 'e'.repeat(40), provenanceDigest: 'f'.repeat(64) })
    })
    run(deps)
    expect(incidentsInserted).toHaveLength(1)
    expect(incidentsInserted[0].kind).toBe('provenance_snapshot_changed')
    expect(conflicted).toHaveLength(1)
    const row = provenanceRows.get(CID)!
    expect(row.status).toBe('conflicted')
    expect(row.baseCommit).toBe('b'.repeat(40)) // byte-preserved
    expect(row.candidateHead).toBe('c'.repeat(40)) // byte-preserved — NOT rewritten to e...e
  })

  it('§7.6 window G — dispatch_worktree source row now ABSENT for an already-recorded provenance: worktree_dispatch_mismatch(dispatch_worktree_row_absent), status UNCHANGED, no row rewrite, blocked', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map(), // vanished since Phase A recorded this row
      provenance: seeded()
    })
    run(deps)
    expect(JSON.parse(incidentsInserted[0].detailJson as string).failed_check).toBe(
      'dispatch_worktree_row_absent'
    )
    expect(provenanceRows.get(CID)!.status).toBe('recorded') // unchanged, not conflicted
  })

  it('window G variant — identity now mismatched for an already-recorded provenance: worktree_dispatch_mismatch(identity_discriminator_mismatch), status unchanged', () => {
    const { deps, provenanceRows, incidentsInserted } = makeFakes({
      settlements: new Map([[CID, settlement()]]),
      dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
      provenance: seeded(),
      read: { kind: 'identity_mismatch', observedIdentityDigest: 'z'.repeat(64) }
    })
    run(deps)
    expect(JSON.parse(incidentsInserted[0].detailJson as string).failed_check).toBe(
      'identity_discriminator_mismatch'
    )
    expect(provenanceRows.get(CID)!.status).toBe('recorded')
  })

  it('operational / unstable / busy in Phase B: no mutation, no incident, surfaced as retryable', () => {
    for (const read of [{ kind: 'operational_error', detail: 'x' }, { kind: 'unstable' }]) {
      const { deps, provenanceRows, incidentsInserted, conflicted } = makeFakes({
        settlements: new Map([[CID, settlement()]]),
        dispatchWorktrees: new Map([[DISPATCH, dispatchWorktree()]]),
        provenance: seeded(),
        read
      })
      const report = run(deps)
      expect(incidentsInserted).toHaveLength(0)
      expect(conflicted).toHaveLength(0)
      expect(provenanceRows.get(CID)!.status).toBe('recorded')
      expect(report.retryable.length).toBeGreaterThan(0)
    }
  })

  it('PROV-10 — a Phase-B-open incident for one binding does not block Phase A/B for a DIFFERENT binding', () => {
    const other: RunBinding = binding({
      correlationId: makeCorrelationId('corr_2'),
      orcaDispatchId: makeOrcaDispatchRef('ctx_2')
    })
    const { deps, provenanceRows } = makeFakes({
      bindings: [binding(), other],
      settlements: new Map([
        [CID, settlement()],
        ['corr_2', { ...settlement(), correlationId: 'corr_2', orcaDispatchId: 'ctx_2' }]
      ]),
      dispatchWorktrees: new Map([
        [DISPATCH, dispatchWorktree()],
        ['ctx_2', dispatchWorktree({ orcaDispatchId: 'ctx_2', correlationId: 'corr_2' })]
      ]),
      openIncidents: new Set([CID]) // only corr_1 is blocked
    })
    run(deps)
    expect(provenanceRows.has(CID)).toBe(false)
    expect(provenanceRows.has('corr_2')).toBe(true)
  })
})
