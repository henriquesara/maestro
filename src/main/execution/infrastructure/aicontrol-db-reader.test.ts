import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AiControlDbReader, sha256File } from './aicontrol-db-reader'
import {
  FROZEN_SAMPLE_REQUEST,
  makeTmpDir,
  writeFixtureAppDb
} from '../slices/shadow-identity-observation/shadow-observation.test-support'

// I1 — nothing this slice runs writes the authoritative aiControlCenter DB.
describe('AiControlDbReader zero authoritative write (amendment §S gate 4)', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  function fixtureDb(): string {
    const t = makeTmpDir('orca-s1-appdb-')
    cleanups.push(t.cleanup)
    const path = join(t.dir, 'app.db')
    writeFixtureAppDb(path)
    return path
  }

  it('leaves data/app.db byte-identical after a full sample read and creates no -wal/-shm', () => {
    const path = fixtureDb()
    const before = sha256File(path)
    const reader = new AiControlDbReader(path)
    const entries = reader.resolveSample(FROZEN_SAMPLE_REQUEST)
    reader.close()
    const after = sha256File(path)
    expect(after).toBe(before)
    expect(existsSync(`${path}-wal`)).toBe(false)
    expect(existsSync(`${path}-shm`)).toBe(false)
    expect(entries.length).toBe(FROZEN_SAMPLE_REQUEST.slots.length)
  })

  it('exposes no write-capable method', () => {
    const names = Object.getOwnPropertyNames(AiControlDbReader.prototype)
    for (const name of names) {
      expect(name).not.toMatch(/insert|update|delete|write|exec|migrate|record/i)
    }
  })
})
