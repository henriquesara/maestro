import { describe, expect, it } from 'vitest'
import {
  insertOrConverge,
  isUniqueConstraintViolation,
  LifecycleRaceConflictError
} from './converge-delegated-lifecycle-steps'

// ORCA-S5 SPEC §14 X12 — "whichever path commits first wins; the loser is a PK-collision no-op".
// A COMPATIBLE loser converges; an INCOMPATIBLE canonical row fails closed; an error that is not a
// benign constraint race (busy, aborted write, anything else) is never swallowed.

const pkViolation = () =>
  Object.assign(new Error('UNIQUE constraint failed: t.id'), { errcode: 1555 })
const uniqueViolation = () =>
  Object.assign(new Error('UNIQUE constraint failed: t.u'), { errcode: 2067 })

describe('isUniqueConstraintViolation', () => {
  it('recognizes PRIMARY KEY and UNIQUE violations only', () => {
    expect(isUniqueConstraintViolation(pkViolation())).toBe(true)
    expect(isUniqueConstraintViolation(uniqueViolation())).toBe(true)
    expect(isUniqueConstraintViolation(Object.assign(new Error('abort'), { errcode: 1811 }))).toBe(
      false
    )
    expect(isUniqueConstraintViolation(Object.assign(new Error('busy'), { errcode: 5 }))).toBe(
      false
    )
    expect(isUniqueConstraintViolation(new Error('plain'))).toBe(false)
    expect(isUniqueConstraintViolation(null)).toBe(false)
  })
})

describe('insertOrConverge', () => {
  it('a clean write is reported as inserted and never re-reads', async () => {
    let reads = 0
    const read = (): undefined => {
      reads += 1
      return undefined
    }
    expect(
      await insertOrConverge(
        () => undefined,
        read,
        () => true,
        'x'
      )
    ).toBe('inserted')
    expect(reads).toBe(0)
  })

  it('awaits an async write (the finalizer is async)', async () => {
    let done = false
    await insertOrConverge(
      async () => {
        await Promise.resolve()
        done = true
      },
      () => undefined,
      () => true,
      'x'
    )
    expect(done).toBe(true)
  })

  it('a collision with a COMPATIBLE canonical row converges (no-op success)', async () => {
    const result = await insertOrConverge(
      () => {
        throw pkViolation()
      },
      () => ({ dispatch: 'd1' }),
      (canonical) => canonical.dispatch === 'd1',
      'dispatch_termination'
    )
    expect(result).toBe('converged')
  })

  it('a collision with an INCOMPATIBLE canonical row fails closed', async () => {
    await expect(
      insertOrConverge(
        () => {
          throw pkViolation()
        },
        () => ({ dispatch: 'other' }),
        (canonical) => canonical.dispatch === 'd1',
        'dispatch_lifecycle_closure'
      )
    ).rejects.toBeInstanceOf(LifecycleRaceConflictError)
  })

  it('a constraint error with NO readable canonical row is not a race: the original error propagates', async () => {
    const original = uniqueViolation()
    await expect(
      insertOrConverge(
        () => {
          throw original
        },
        () => undefined,
        () => true,
        'x'
      )
    ).rejects.toBe(original)
  })

  it.each([
    Object.assign(new Error('INJECTED_CRASH'), { errcode: 1811 }),
    Object.assign(new Error('busy'), { code: 'LIFECYCLE_STORE_BUSY_RETRYABLE' }),
    new Error('disk full')
  ])(
    'a non-race failure (%s) is NEVER swallowed and the canonical row is not consulted',
    async (failure) => {
      let reads = 0
      const read = () => {
        reads += 1
        return { any: 1 }
      }
      await expect(
        insertOrConverge(
          () => {
            throw failure
          },
          read,
          () => true,
          'x'
        )
      ).rejects.toBe(failure)
      expect(reads).toBe(0)
    }
  )
})
