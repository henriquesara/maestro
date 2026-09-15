// Focused RED/GREEN evidence for the ORCA-S5 independent-acceptance
// blocker: async-spawn-commit-reporter.ts is not safe against a
// synchronously throwing or synchronously reentrant underlying callback
// (orca-delegated-cutover SPEC.md §4.5.2's fire-once contract: exactly one
// underlying callback invocation per execution identity, with the SAME
// cached outcome observed by every duplicate call).
//
// History: RED against GREEN candidate 9b31fb6ac7ef70b3f5de23fc7913c9e6f1a3de6a
// -- `promise = Promise.resolve(callback?.())` evaluates `callback?.()`
// before the assignment completes, so neither a synchronous throw nor a
// synchronous reentrant call observes any cached state yet.

import { describe, expect, it } from 'vitest'
import { createAsyncSpawnCommitReporter } from './async-spawn-commit-reporter'
import type { DelegationCutoverCommitResult } from './delegation-cutover-commit-result'

// The real callback signature is `() => Promise<DelegationCutoverCommitResult> | void`
// -- an async callback must resolve to a real result shape, not `Promise<void>`.
// These tests don't care about the value, only about invocation/caching semantics.
const DUMMY_RESULT: DelegationCutoverCommitResult = {
  outcome: 'COMMITTED',
  correlationId: 'sync-safety-test'
}

describe('createAsyncSpawnCommitReporter: synchronous-throw safety (blocker 1a)', () => {
  it('caches a synchronous throw as the permanent failure -- no retry on a duplicate call', async () => {
    let invocationCount = 0
    const reporter = createAsyncSpawnCommitReporter(() => {
      invocationCount++
      throw new Error('sync_boom')
    })

    const first = reporter()
    await expect(first).rejects.toThrow('sync_boom')
    expect(invocationCount).toBe(1)

    const second = reporter()
    await expect(second).rejects.toThrow('sync_boom')
    // FROZEN CONTRACT (§4.5.2): duplicate after failure never retries.
    expect(invocationCount).toBe(1)
    expect(second).toBe(first)
  })
})

describe('createAsyncSpawnCommitReporter: synchronous-reentrancy safety (blocker 1b)', () => {
  it('a synchronously reentrant call converges on the same in-flight operation -- exactly one underlying invocation', () => {
    let invocationCount = 0
    let reentrantResult: Promise<DelegationCutoverCommitResult | void> | undefined
    let reporter!: () => Promise<DelegationCutoverCommitResult | void>
    // Bounds runaway recursion against broken code so the test terminates
    // deterministically instead of stack-overflowing the worker;
    // invocationCount climbing past 1 still proves the defect without
    // hiding it behind a crashed process.
    const REENTRY_GUARD_LIMIT = 3

    reporter = createAsyncSpawnCommitReporter(() => {
      invocationCount++
      if (invocationCount <= REENTRY_GUARD_LIMIT) {
        // Synchronously re-enters the SAME reporter before this callback
        // (the first, outer invocation) has returned.
        reentrantResult = reporter()
      }
      return Promise.resolve(DUMMY_RESULT)
    })

    const outer = reporter()

    // FROZEN CONTRACT (§4.5.2): reentrancy must not start a second
    // underlying operation.
    expect(invocationCount).toBe(1)
    expect(reentrantResult).toBe(outer)
    return expect(outer).resolves.toBe(DUMMY_RESULT)
  })
})

describe('createAsyncSpawnCommitReporter: pending/success/failure caching preserved (regression guard)', () => {
  it('duplicate calls while the underlying operation is still pending return the SAME Promise', () => {
    let resolveUnderlying!: (result: DelegationCutoverCommitResult) => void
    const underlying = new Promise<DelegationCutoverCommitResult>((resolve) => {
      resolveUnderlying = resolve
    })
    const reporter = createAsyncSpawnCommitReporter(() => underlying)

    const first = reporter()
    const second = reporter()

    expect(first).toBe(second)
    resolveUnderlying(DUMMY_RESULT)
    return first
  })

  it('duplicate calls after success return the SAME cached successful result, without a second invocation', async () => {
    let invocationCount = 0
    const result: DelegationCutoverCommitResult = { outcome: 'COMMITTED', correlationId: 'c1' }
    const reporter = createAsyncSpawnCommitReporter(async () => {
      invocationCount++
      return result
    })

    await expect(reporter()).resolves.toBe(result)
    await expect(reporter()).resolves.toBe(result)
    expect(invocationCount).toBe(1)
  })

  it('duplicate calls after an async rejection cache and rethrow the SAME failure, without a retry', async () => {
    let invocationCount = 0
    const error = new Error('durable_commit_failed')
    const reporter = createAsyncSpawnCommitReporter(async () => {
      invocationCount++
      throw error
    })

    await expect(reporter()).rejects.toBe(error)
    await expect(reporter()).rejects.toBe(error)
    expect(invocationCount).toBe(1)
  })

  it('a callback returning void resolves the reporter to undefined', async () => {
    const reporter = createAsyncSpawnCommitReporter(() => {})
    await expect(reporter()).resolves.toBeUndefined()
  })
})
