// PRE_IMPLEMENTATION RED baseline for orca-delegated-cutover SPEC.md §4.5.1
// site #6 (`createPtySpawnCommitReporter`, guard layer 1) and §4.5.2's
// async-aware fire-once guard contract. Gates 44, 45, 46, 47, 48, 61.
//
// `createPtySpawnCommitReporter` is typed `(callback?: () => void) => () =>
// void` today: it cannot carry a Promise in either direction. Each test below
// asserts the FROZEN future contract (§4.5.2) directly against the real,
// unmodified function, and is expected to fail now -- no async-aware
// replacement is implemented in this session.

import { describe, expect, it, vi } from 'vitest'
import { createPtySpawnCommitReporter } from './orca-runtime-report-pty-spawn-commit'

describe('createPtySpawnCommitReporter (guard layer 1, SPEC §4.5.1 site #6, RED)', () => {
  it('RED (gate 44): must return a Promise a caller can await for the durable result', async () => {
    let settled = false
    const callback = vi.fn(() => {
      return Promise.resolve().then(() => {
        settled = true
      }) as unknown as void
    })

    const reporter = createPtySpawnCommitReporter(callback)
    const returned = reporter()

    // FROZEN CONTRACT (§4.5.1 site #6): must return
    // Promise<DelegationCutoverCommitResult | void>. Fails today -- `returned`
    // is `undefined`, a bare `void`.
    expect(returned).toBeInstanceOf(Promise)
    await (returned as unknown as Promise<unknown>)
    expect(settled).toBe(true)
  })

  it('RED (gate 46): duplicate invocation while in-flight must return the SAME in-flight Promise', async () => {
    let resolveUnderlying!: () => void
    const underlying = new Promise<void>((resolve) => {
      resolveUnderlying = resolve
    })
    const callback = vi.fn(() => underlying as unknown as void)

    const reporter = createPtySpawnCommitReporter(callback)
    const first = reporter()
    const second = reporter()

    // FROZEN CONTRACT (§4.5.2, "duplicate while in flight"): referential
    // equality of the returned Promise. Fails today -- both calls return
    // `undefined`, so there is no Promise identity to compare.
    expect(first).toBeInstanceOf(Promise)
    expect(first).toBe(second)

    resolveUnderlying()
    await underlying
  })

  it('RED (gate 45/47): the returned Promise does not settle before the real callback settles', async () => {
    let resolveUnderlying!: () => void
    const underlying = new Promise<void>((resolve) => {
      resolveUnderlying = resolve
    })
    const callback = vi.fn(() => underlying as unknown as void)

    const reporter = createPtySpawnCommitReporter(callback)
    const returned = reporter()

    // FROZEN CONTRACT: the outer caller (mirrors create-terminal.ts:179's
    // `await reportPtySpawnCommitted()`) must not observe completion before
    // the real durable transaction resolves. Fails today because `returned`
    // is not a Promise at all -- there is nothing to await, so a caller
    // "observes completion" (of nothing) immediately, always.
    expect(returned).toBeInstanceOf(Promise)

    let observedBeforeResolve = 'not-a-promise'
    void (returned as unknown as Promise<unknown>).then(() => {
      observedBeforeResolve = 'resolved'
    })
    await Promise.resolve()
    expect(observedBeforeResolve).toBe('not-a-promise')

    resolveUnderlying()
    await underlying
  })

  it('RED (gate 48/61): the guard must expose a real callback rejection, not discard it', async () => {
    const rejectionError = new Error('durable_commit_failed')
    let capturedPromise: Promise<void> | undefined
    const callback = vi.fn(() => {
      capturedPromise = Promise.reject(rejectionError)
      return capturedPromise as unknown as void
    })

    const reporter = createPtySpawnCommitReporter(callback)
    const returned = reporter()
    // Why: keeps this deterministic and prevents a real process-level
    // unhandledRejection regardless of what the guard does with the
    // callback's promise (Area K's own instruction: assert the owning
    // operation's contract directly, not global rejection timing).
    await capturedPromise?.catch(() => {})

    // FROZEN CONTRACT (§4.5.2, "duplicate after failure"): the guard's own
    // returned Promise must reject with this error. Fails today -- `returned`
    // is `undefined`; the rejection is silently discarded by `callback?.()`.
    expect(returned).toBeInstanceOf(Promise)
    await expect(returned as unknown as Promise<unknown>).rejects.toBe(rejectionError)
  })

  it('invariant preserved (not RED): the underlying callback still fires exactly once across duplicates', () => {
    const callback = vi.fn()
    const reporter = createPtySpawnCommitReporter(callback)

    reporter()
    reporter()
    reporter()

    expect(callback).toHaveBeenCalledTimes(1)
  })
})
