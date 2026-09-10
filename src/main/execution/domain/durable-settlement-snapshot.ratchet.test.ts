import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './durable-settlement-snapshot'

// §6.1 / §21 — compatibility / ratchet test. S2's `canonicalSerialize` MUST mirror
// Orca's module-private `canonicalPayload` normalization semantics. We do NOT
// import that function (no Orca-core export change). Instead we:
//   (1) pin the vendored source of `canonicalPayload` verbatim — a drift at a
//       future Orca base fails THIS test loudly, not silently in production;
//   (2) run a local reference implementation matching that pinned body against a
//       table of values and assert `canonicalSerialize` agrees.

const ORCA_ATTEMPT_STORE = join(
  __dirname,
  '..',
  '..',
  'runtime',
  'orchestration',
  'db',
  'attempt-observation-store.ts'
)

const PINNED_CANONICAL_PAYLOAD = `function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) {
    return \`[\${value.map(canonicalPayload).join(',')}]\`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return \`{\${Object.keys(record)
      .sort()
      .map((key) => \`\${JSON.stringify(key)}:\${canonicalPayload(record[key])}\`)
      .join(',')}}\`
  }
  // JSON has no representation for undefined; preserve valid replayable JSON.
  return value === undefined ? 'null' : JSON.stringify(value)
}`

/** A local reference matching PINNED_CANONICAL_PAYLOAD — never imported from Orca. */
function referenceCanonicalPayload(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(referenceCanonicalPayload).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${referenceCanonicalPayload(record[key])}`)
      .join(',')}}`
  }
  return value === undefined ? 'null' : JSON.stringify(value)
}

describe('canonicalSerialize ratchet against Orca canonicalPayload (§6.1, §21)', () => {
  it('the vendored Orca canonicalPayload source is byte-identical to the pinned reference', () => {
    const source = readFileSync(ORCA_ATTEMPT_STORE, 'utf8').replace(/\r\n/g, '\n')
    expect(source).toContain(PINNED_CANONICAL_PAYLOAD)
  })

  const cases: unknown[] = [
    {},
    { a: 1, b: 2 },
    { b: 2, a: 1 },
    { z: [3, 1, 2], a: { d: true, c: null } },
    [
      { b: 2, a: 1 },
      { d: 4, c: 3 }
    ],
    { x: undefined, y: 'keep' },
    'string',
    42,
    true,
    null,
    { nested: { deep: { deeper: [{ k: 'v', a: undefined }] } } }
  ]
  for (const [i, value] of cases.entries()) {
    it(`case ${i}: canonicalSerialize matches the reference canonical form`, () => {
      expect(canonicalSerialize(value)).toBe(referenceCanonicalPayload(value))
    })
  }
})
