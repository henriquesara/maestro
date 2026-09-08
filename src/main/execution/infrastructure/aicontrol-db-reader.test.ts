import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AiControlDbReader, sha256File } from './aicontrol-db-reader'
import {
  makeTmpDir,
  writeFixtureAppDb
} from '../slices/shadow-identity-observation/shadow-observation.test-support'

// I1 — the reader opens data/app.db read-only, has no write method, and never
// changes its bytes.
describe('AiControlDbReader zero authoritative write (amendment §S gate 4)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })
  function fixtureDb() {
    const t = makeTmpDir('orca-s1-appdb-')
    cleanups.push(t.cleanup)
    const p = join(t.dir, 'app.db')
    writeFixtureAppDb(p)
    return p
  }

  it('lists distinct agent profiles with their run ids and leaves the DB byte-identical', () => {
    const path = fixtureDb()
    const before = sha256File(path)
    const reader = new AiControlDbReader(path)
    const profiles = reader.listProfiles()
    reader.close()
    expect(sha256File(path)).toBe(before)
    expect(existsSync(`${path}-wal`)).toBe(false)
    expect(existsSync(`${path}-shm`)).toBe(false)
    expect(profiles.map((p) => p.agentId)).toEqual(['agent-A', 'agent-B', 'agent-C'])
    expect(profiles[0].runIds).toContain('run_a_1')
    expect(profiles[0].runIds.length).toBeGreaterThanOrEqual(2)
  })

  it('exposes no write-capable method', () => {
    for (const name of Object.getOwnPropertyNames(AiControlDbReader.prototype)) {
      expect(name).not.toMatch(/insert|update|delete|write|exec|migrate|record/i)
    }
  })
})
