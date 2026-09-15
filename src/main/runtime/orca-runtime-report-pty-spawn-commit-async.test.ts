// GREEN evidence for orca-delegated-cutover SPEC.md §4.5.1 site #6
// (`createPtySpawnCommitReporter`, guard layer 1) and §4.5.2's async-aware
// fire-once guard contract. Gates 44, 45, 46, 47, 48, 61.
//
// History: started RED (commit 0a1bf4c265) -- `createPtySpawnCommitReporter`
// was typed `(callback?: () => void) => () => void`, unable to carry a
// Promise in either direction. The GREEN implementation session replaced it
// with `createAsyncSpawnCommitReporter` (src/shared/async-spawn-commit-reporter.ts),
// shared with guard layer 2. Each test below asserts the FROZEN contract
// (§4.5.2) directly against the real, unmodified function; production now
// satisfies every one of them.

import { describe, expect, it, vi } from 'vitest'
import { createPtySpawnCommitReporter } from './orca-runtime-report-pty-spawn-commit'

describe('createPtySpawnCommitReporter (guard layer 1, SPEC §4.5.1 site #6, GREEN)', () => {
  it('GREEN (gate 44): returns a Promise a caller can await for the durable result', async () => {
    let settled = false
    const callback = vi.fn(() => {
      return Promise.resolve().then(() => {
        settled = true
      }) as unknown as void
    })

    const reporter = createPtySpawnCommitReporter(callback)
    const returned = reporter()

    // FROZEN CONTRACT (§4.5.1 site #6): GREEN -- returns
    // Promise<DelegationCutoverCommitResult | void>.
    expect(returned).toBeInstanceOf(Promise)
    await (returned as unknown as Promise<unknown>)
    expect(settled).toBe(true)
  })

  it('GREEN (gate 46): duplicate invocation while in-flight returns the SAME in-flight Promise', async () => {
    let resolveUnderlying!: () => void
    const underlying = new Promise<void>((resolve) => {
      resolveUnderlying = resolve
    })
    const callback = vi.fn(() => underlying as unknown as void)

    const reporter = createPtySpawnCommitReporter(callback)
    const first = reporter()
    const second = reporter()

    // FROZEN CONTRACT (§4.5.2, "duplicate while in flight"): GREEN --
    // referential equality of the returned Promise.
    expect(first).toBeInstanceOf(Promise)
    expect(first).toBe(second)

    resolveUnderlying()
    await underlying
  })

  it('GREEN (gate 45/47): the returned Promise does not settle before the real callback settles', async () => {
    let resolveUnderlying!: () => void
    const underlying = new Promise<void>((resolve) => {
      resolveUnderlying = resolve
    })
    const callback = vi.fn(() => underlying as unknown as void)

    const reporter = createPtySpawnCommitReporter(callback)
    const returned = reporter()

    // FROZEN CONTRACT: the outer caller (mirrors create-terminal.ts:179's
    // `await reportPtySpawnCommitted()`) must not observe completion before
    // the real durable transaction resolves. GREEN.
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

  it('GREEN (gate 48/61): the guard exposes a real callback rejection, never discards it', async () => {
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

    // FROZEN CONTRACT (§4.5.2, "duplicate after failure"): GREEN -- the
    // guard's own returned Promise rejects with this exact error.
    expect(returned).toBeInstanceOf(Promise)
    await expect(returned as unknown as Promise<unknown>).rejects.toBe(rejectionError)
  })

  it('invariant preserved: the underlying callback still fires exactly once across duplicates', () => {
    const callback = vi.fn()
    const reporter = createPtySpawnCommitReporter(callback)

    reporter()
    reporter()
    reporter()

    expect(callback).toHaveBeenCalledTimes(1)
  })
})
