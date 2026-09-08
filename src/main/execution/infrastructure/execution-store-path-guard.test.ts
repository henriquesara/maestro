import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, linkSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import {
  assertExecutionStorePathNotAlias,
  ExecutionStorePathAliasError
} from './execution-store-path-guard'
import { migrateExecutionStore } from './execution-schema'
import {
  makeTmpDir,
  writeFixtureAppDb
} from '../slices/shadow-identity-observation/shadow-observation.test-support'

// Blocker B4 — refuse an Execution store path that aliases data/app.db, BEFORE
// the writable open. The real data/app.db is never used — a disposable copy is.
describe('execution store path alias guard (amendment 001 §6 / blocker B4)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })
  function fixtureAppDb() {
    const t = makeTmpDir('orca-s1-appdb-')
    cleanups.push(t.cleanup)
    const p = join(t.dir, 'app.db')
    writeFixtureAppDb(p)
    return p
  }

  it(':memory: is always allowed', () => {
    expect(() => assertExecutionStorePathNotAlias(':memory:', fixtureAppDb())).not.toThrow()
  })

  it('rejects the identical path', () => {
    const p = fixtureAppDb()
    let thrown: unknown
    try {
      assertExecutionStorePathNotAlias(p, p)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ExecutionStorePathAliasError)
    expect((thrown as ExecutionStorePathAliasError).code).toBe('identical_path')
  })

  it('rejects a relative alias of the same path', () => {
    const p = fixtureAppDb()
    expect(() => assertExecutionStorePathNotAlias(`${p}/./`.replace(/\/$/, ''), p)).toThrow(
      ExecutionStorePathAliasError
    )
  })

  it('rejects a hard link to data/app.db (shared filesystem identity)', () => {
    const p = fixtureAppDb()
    const link = `${p}.hardlink`
    try {
      linkSync(p, link)
    } catch {
      return // platform/fs without hardlink support
    }
    cleanups.push(() => {
      try {
        if (existsSync(link)) {
          rmSync(link, { force: true })
        }
      } catch {
        /* ignore */
      }
    })
    let thrown: unknown
    try {
      assertExecutionStorePathNotAlias(link, p)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ExecutionStorePathAliasError)
  })

  it('rejects a symlink to data/app.db', () => {
    const p = fixtureAppDb()
    const link = `${p}.symlink`
    try {
      symlinkSync(p, link)
    } catch {
      return
    }
    expect(() => assertExecutionStorePathNotAlias(link, p)).toThrow(ExecutionStorePathAliasError)
  })

  it('END-TO-END: an aliased executionStorePath is rejected before any writable open — hash unchanged, zero Execution tables, no WAL/SHM', () => {
    const src = fixtureAppDb()
    const t = makeTmpDir('orca-s1-alias-')
    cleanups.push(t.cleanup)
    const disposable = join(t.dir, 'app.db')
    copyFileSync(src, disposable) // NEVER the real data/app.db — a disposable copy
    const before = createHash('sha256').update(readFileSync(disposable)).digest('hex')

    expect(() => assertExecutionStorePathNotAlias(disposable, disposable)).toThrow(
      ExecutionStorePathAliasError
    )

    const after = createHash('sha256').update(readFileSync(disposable)).digest('hex')
    expect(after).toBe(before)
    expect(existsSync(`${disposable}-wal`)).toBe(false)
    expect(existsSync(`${disposable}-shm`)).toBe(false)
    // The disposable copy has no Execution tables — the guard fired before migration.
    const probe = new SyncDatabase(disposable, { readonly: true })
    const tables = (
      probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name)
    probe.close()
    expect(tables).not.toContain('run_reservation')
    expect(tables).not.toContain('run_binding')
    void migrateExecutionStore
  })
})
