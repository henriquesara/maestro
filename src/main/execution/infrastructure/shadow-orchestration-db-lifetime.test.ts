import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { DisposableShadowRoot } from './disposable-shadow-root'
import { migrateExecutionStore } from './execution-schema'
import {
  persistedShadowOrchestrationPath,
  rebuildSettlementProjection,
  resolveDurableShadowOrchestrationPath,
  SHADOW_ORCHESTRATION_PATH_KEY
} from './durable-shadow-orchestration-path'
import {
  ShadowSettlementSourceMissingError,
  ShadowSourcePathMismatchError
} from './shadow-settlement-source-errors'

// ORCA-S2 acceptance criterion 17 — durable shadow DB lifetime.

describe('durable shadow orchestration.db lifetime (§17, criterion 17)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* best-effort */
      }
    }
  })
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'orca-s2-life-'))
    dirs.push(d)
    return d
  }
  const execStore = () => {
    const db = new SyncDatabase(':memory:')
    db.pragma('foreign_keys = OFF')
    migrateExecutionStore(db)
    return db
  }
  const seedBinding = (db: SyncDatabase, cid: string) => {
    db.prepare(
      `INSERT INTO run_reservation (correlation_id, slice_ref, authoritative_run_ref, workload_id, state, created_at, updated_at)
       VALUES (?, 'ORCA-S2', NULL, 'w', 'settled', 't', 't')`
    ).run(cid)
    db.prepare(
      `INSERT INTO run_binding (orca_dispatch_id, correlation_id, governance_agent_run_id, orca_run_id, org_task_id, slice_ref, base_commit, bound_at)
       VALUES (?, ?, 'g', 'r', 'task', 'ORCA-S2', 'base', 't')`
    ).run(`ctx_${cid}`, cid)
  }

  it('the durable shadow orchestration.db lives OUTSIDE DisposableShadowRoot and survives cleanup()', () => {
    const root = DisposableShadowRoot.create()
    const durablePath = join(tmp(), 'shadow-orchestration.db')
    const w = new OrchestrationDb(durablePath)
    w.close()
    expect(root.contains(durablePath)).toBe(false)
    root.cleanup()
    expect(existsSync(durablePath)).toBe(true) // untouched by cleanup
  })

  it('first-init persists execution_meta.shadow_orchestration_path BEFORE first use (empty env)', () => {
    const db = execStore()
    const durablePath = join(tmp(), 'shadow-orchestration.db')
    expect(persistedShadowOrchestrationPath(db)).toBeUndefined()
    const resolved = resolveDurableShadowOrchestrationPath(db, durablePath)
    expect(resolved).toBe(durablePath)
    expect(persistedShadowOrchestrationPath(db)).toBe(durablePath)
    expect(
      db
        .prepare('SELECT value FROM execution_meta WHERE key = ?')
        .get(SHADOW_ORCHESTRATION_PATH_KEY)
    ).toEqual({ value: durablePath })
    db.close()
  })

  it('configured != persisted → fail closed with ShadowSourcePathMismatchError', () => {
    const db = execStore()
    const p1 = join(tmp(), 'a.db')
    new OrchestrationDb(p1).close()
    resolveDurableShadowOrchestrationPath(db, p1)
    const p2 = join(tmp(), 'b.db')
    new OrchestrationDb(p2).close()
    expect(() => resolveDurableShadowOrchestrationPath(db, p2)).toThrow(
      ShadowSourcePathMismatchError
    )
    db.close()
  })

  it('persisted path whose DB file is missing, with durable bindings present → ShadowSettlementSourceMissingError, no replacement created', () => {
    const db = execStore()
    const durablePath = join(tmp(), 'gone.db')
    new OrchestrationDb(durablePath).close()
    resolveDurableShadowOrchestrationPath(db, durablePath)
    seedBinding(db, 'corr_1')
    rmSync(durablePath, { force: true })
    rmSync(`${durablePath}-wal`, { force: true })
    rmSync(`${durablePath}-shm`, { force: true })

    expect(() => resolveDurableShadowOrchestrationPath(db, durablePath)).toThrow(
      ShadowSettlementSourceMissingError
    )
    expect(existsSync(durablePath)).toBe(false) // S2 created no replacement
    db.close()
  })

  it('an empty env whose persisted DB file went missing (no bindings) is allowed to re-create', () => {
    const db = execStore()
    const durablePath = join(tmp(), 'empty.db')
    new OrchestrationDb(durablePath).close()
    resolveDurableShadowOrchestrationPath(db, durablePath)
    rmSync(durablePath, { force: true })
    expect(() => resolveDurableShadowOrchestrationPath(db, durablePath)).not.toThrow()
    db.close()
  })

  it('key absent but the environment already has durable bindings and the file is missing → fail closed', () => {
    const db = execStore()
    const durablePath = join(tmp(), 'orphan.db')
    seedBinding(db, 'corr_1')
    expect(persistedShadowOrchestrationPath(db)).toBeUndefined()
    expect(() => resolveDurableShadowOrchestrationPath(db, durablePath)).toThrow(
      ShadowSettlementSourceMissingError
    )
    db.close()
  })

  it('a settlement-projection rebuild preserves run_binding, run_reservation, the path key, and the DB file', () => {
    const db = execStore()
    const durablePath = join(tmp(), 'keep.db')
    new OrchestrationDb(durablePath).close()
    resolveDurableShadowOrchestrationPath(db, durablePath)
    seedBinding(db, 'corr_1')
    db.prepare(
      `INSERT INTO settlement_observation (correlation_id, orca_dispatch_id, orca_run_id, org_task_id, slice_ref, status,
        source_dispatch_status, source_task_status, source_digest, observed_outcome_json, provenance_json, first_seen_at, observed_at)
       VALUES ('corr_1','ctx_corr_1','r','task','ORCA-S2','observed','completed','completed','dig','{}','{}','t','t')`
    ).run()
    db.prepare(
      `INSERT INTO settlement_incident (id, correlation_id, slice_ref, kind, evidence_digest, detail_json, raised_at)
       VALUES ('i1','corr_1','ORCA-S2','foreign_dispatch','ev','{}','t')`
    ).run()

    rebuildSettlementProjection(db)

    expect(db.prepare('SELECT COUNT(*) c FROM run_binding').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM run_reservation').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM settlement_observation').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM settlement_incident').get()).toEqual({ c: 0 })
    expect(persistedShadowOrchestrationPath(db)).toBe(durablePath)
    expect(existsSync(durablePath)).toBe(true)
    db.close()
  })

  it('rebuild drops ONLY the two S2 projection tables and never the durable source DB', () => {
    const db = execStore()
    const durablePath = join(tmp(), 'src.db')
    new OrchestrationDb(durablePath).close()
    resolveDurableShadowOrchestrationPath(db, durablePath)
    writeFileSync(`${durablePath}.sentinel`, 'x')
    rebuildSettlementProjection(db)
    expect(existsSync(durablePath)).toBe(true)
    expect(existsSync(`${durablePath}.sentinel`)).toBe(true)
    // the S1 tables and execution_meta are all still there
    for (const t of [
      'run_reservation',
      'run_binding',
      'parity_observation',
      'workload_exclusion',
      'execution_meta'
    ]) {
      expect(
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t)
      ).toEqual({ name: t })
    }
    db.close()
  })
})
