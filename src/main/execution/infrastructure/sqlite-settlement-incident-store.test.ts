import { describe, expect, it, afterEach } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { migrateExecutionStore } from './execution-schema'
import { SqliteSettlementIncidentStore } from './sqlite-settlement-incident-store'
import type { SettlementIncidentRecord } from '../domain/settlement-incident'

const incident = (over: Partial<SettlementIncidentRecord> = {}): SettlementIncidentRecord => ({
  id: 'inc_1',
  correlationId: 'corr_1',
  orcaDispatchId: 'ctx_1',
  sliceRef: 'ORCA-S2',
  kind: 'foreign_dispatch',
  evidenceDigest: 'e'.repeat(64),
  detailJson: JSON.stringify({ observed: 'only durable facts' }),
  blocked: true,
  resolvedAt: null,
  resolutionNote: null,
  raisedAt: '2026-09-10T00:00:00.000Z',
  ...over
})

describe('SqliteSettlementIncidentStore (§13, §21)', () => {
  let db: SyncDatabase | undefined
  afterEach(() => {
    db?.close()
    db = undefined
  })
  function store() {
    db = new SyncDatabase(':memory:')
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return new SqliteSettlementIncidentStore(db)
  }

  it('inserts and round-trips an incident', () => {
    const s = store()
    expect(s.insert(incident())).toEqual({ inserted: true })
    expect(s.listBySlice('ORCA-S2')).toEqual([incident()])
  })

  it('UNIQUE (correlation_id, kind, evidence_digest): re-insert of same evidence is a no-op, not a row', () => {
    const s = store()
    s.insert(incident())
    const dup = s.insert(incident({ id: 'inc_2', detailJson: '{"different":"detail"}' }))
    expect(dup).toEqual({ inserted: false })
    expect(s.listBySlice('ORCA-S2')).toHaveLength(1)
    expect(s.listBySlice('ORCA-S2')[0].id).toBe('inc_1') // first row retained as evidence
  })

  it('a genuinely different evidence_digest produces a NEW row (never overwrites)', () => {
    const s = store()
    s.insert(incident())
    s.insert(incident({ id: 'inc_2', evidenceDigest: 'f'.repeat(64) }))
    expect(s.listBySlice('ORCA-S2')).toHaveLength(2)
  })

  it('a different kind for the same binding is a separate row', () => {
    const s = store()
    s.insert(incident())
    s.insert(incident({ id: 'inc_2', kind: 'source_snapshot_changed' }))
    expect(s.listBySlice('ORCA-S2')).toHaveLength(2)
  })

  it('hasOpenIncident is true while resolved_at IS NULL, false once resolved', () => {
    const s = store()
    s.insert(incident())
    expect(s.hasOpenIncident('corr_1')).toBe(true)
    s.resolve('inc_1', { resolvedAt: '2026-09-10T05:00:00.000Z', resolutionNote: 'adjudicated' })
    expect(s.hasOpenIncident('corr_1')).toBe(false)
  })

  it('listOpenByCorrelation returns only unresolved incidents', () => {
    const s = store()
    s.insert(incident())
    s.insert(incident({ id: 'inc_2', kind: 'invalid_or_unresolvable_source' }))
    s.resolve('inc_1', { resolvedAt: '2026-09-10T05:00:00.000Z', resolutionNote: 'ok' })
    expect(s.listOpenByCorrelation('corr_1').map((i) => i.id)).toEqual(['inc_2'])
  })

  it('no sweep-clearing method exists — there is no auto-resolution path', () => {
    const s = store()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(s))
    expect(methods).not.toContain('clearBlocked')
    expect(methods).not.toContain('autoResolve')
  })
})
