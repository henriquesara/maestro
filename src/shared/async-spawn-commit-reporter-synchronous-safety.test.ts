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
//
// FIX #2 history: independent rereview of the blocker-1 fix (sentinel
// installed before callback) found the sentinel-before-callback shape is
// still unsafe against a callback that synchronously re-enters the reporter
// and then returns (directly or indirectly, via an async wrapper that
// adopts it) a Promise/value that depends on that same reentrant call --
// the reporter's own sentinel then waits on its own eventual settlement and
// hangs forever, with no thrown error, no rejection, and no observable
// failure. Empirically reproduced against ce0521e2a692424761b43be7284257f92713fb07
// (focused GREEN #1) before this fix. The frozen contract is tightened here:
// ANY synchronous reentry observed during the initial callback invocation
// poisons that logical operation -- it fails closed with a stable internal
// error, regardless of what the callback itself ultimately returns. This
// also flips the previously-accepted "synchronous-reentrancy safety
// (blocker 1b)" test below, which exercised exactly this reentrant-with-
// ignored-result shape and asserted it should still succeed; per the
// tightened contract that shape is no longer a safe "converges on the same
// operation" case -- reentrancy itself is evidence of a dependency cycle at
// this durability boundary, not a benign duplicate call.

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

// Deterministic hang-vs-settle harness: races the reporter's Promise against
// a short real timer used ONLY as a circuit breaker so a genuinely hung
// Promise cannot block the test process forever. Correctness is asserted
// from the returned `outcome.settled` state, never from the timer winning
// -- a "hung: true" result is itself a hard test failure, not the proof of
// anything.
type SettleOutcome<T> =
  | { hung: false; settled: 'fulfilled'; value: T }
  | { hung: false; settled: 'rejected'; reason: unknown }
  | { hung: true }

function settleOrHang<T>(promise: Promise<T>, guardMs = 200): Promise<SettleOutcome<T>> {
  return new Promise((resolveOutcome) => {
    let decided = false
    promise.then(
      (value) => {
        if (!decided) {
          decided = true
          resolveOutcome({ hung: false, settled: 'fulfilled', value })
        }
      },
      (reason) => {
        if (!decided) {
          decided = true
          resolveOutcome({ hung: false, settled: 'rejected', reason })
        }
      }
    )
    setTimeout(() => {
      if (!decided) {
        decided = true
        resolveOutcome({ hung: true })
      }
    }, guardMs)
  })
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
  it('a synchronously reentrant call observes the SAME in-flight sentinel -- exactly one underlying invocation, no recursion', async () => {
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
    // underlying operation, and the reentrant caller must observe the
    // exact same sentinel as the outer caller (no new operation, no
    // recursion) -- this much is unchanged by FIX #2.
    expect(invocationCount).toBe(1)
    expect(reentrantResult).toBe(outer)
    // FIX #2's tightened contract: this callback ignores the reentrant
    // call's result and otherwise returns a distinct successful value --
    // exactly the shape that now poisons the operation (see the dedicated
    // "reentrancy-with-ignored-result" test below for the full contract
    // assertion). Awaited here too so `outer`'s rejection is never left
    // unhandled by this test.
    await expect(outer).rejects.toThrow('spawn_commit_reporter_synchronous_reentrancy')
  })
})

describe('createAsyncSpawnCommitReporter: reentrant self-dependency / Promise-cycle safety (FIX #2)', () => {
  it('direct self-return: callback synchronously re-enters the reporter and returns that reentrant Promise -- does not hang, fails closed', async () => {
    let invocationCount = 0
    let reporter!: () => Promise<DelegationCutoverCommitResult | void>

    reporter = createAsyncSpawnCommitReporter(() => {
      invocationCount++
      // Synchronously re-enters the SAME reporter and returns the exact
      // Promise obtained from that reentrant call -- the shape empirically
      // shown (against ce0521e2a6) to make `Promise.resolve(callback?.())
      // .then(resolve, reject)` register the sentinel's own resolver as a
      // reaction to itself, which then never fires.
      // Cast: the reentrant call's Promise never actually resolves to a
      // real `DelegationCutoverCommitResult` on this adversarial path (it
      // is always poisoned/rejected) -- only its `void`-union placement
      // differs from the callback's declared return type.
      return reporter() as Promise<DelegationCutoverCommitResult>
    })

    const outer = reporter()
    const outcome = await settleOrHang(outer)

    expect(outcome.hung).toBe(false)
    if (!outcome.hung) {
      expect(outcome.settled).toBe('rejected')
    }
    expect(invocationCount).toBe(1)

    // Duplicate call after poisoning: same cached failure, no retry.
    const second = reporter()
    expect(second).toBe(outer)
    await expect(second).rejects.toBeDefined()
    expect(invocationCount).toBe(1)
  })

  it('indirect self-dependency: an async wrapper returns a DISTINCT Promise that adopts the reentrant call -- Promise identity alone cannot detect this', async () => {
    let invocationCount = 0
    let reporter!: () => Promise<DelegationCutoverCommitResult | void>

    reporter = createAsyncSpawnCommitReporter(async () => {
      invocationCount++
      // `async` wraps the reentrant call: the function's own returned
      // Promise is a DIFFERENT object from `reporter()`'s sentinel, but its
      // eventual settlement is entirely adopted from (depends on) that same
      // sentinel -- a solution based only on `callbackResult === sentinel`
      // is blind to this shape.
      return reporter() as Promise<DelegationCutoverCommitResult>
    })

    const outer = reporter()
    const outcome = await settleOrHang(outer)

    expect(outcome.hung).toBe(false)
    if (!outcome.hung) {
      expect(outcome.settled).toBe('rejected')
    }
    expect(invocationCount).toBe(1)
    // Lets the async wrapper's own Promise (a distinct object from the
    // sentinel, adopting it via a deferred PromiseResolveThenableJob) fully
    // settle before this test ends, so its settlement can't be observed as
    // a cross-test-timing artifact by a later test's own unhandledRejection
    // listener (see the dedicated unhandled-rejection test below).
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('reentrancy-with-ignored-result: synchronous reentry poisons the operation even when the callback otherwise completes normally', async () => {
    let invocationCount = 0
    let reentrantRef: Promise<DelegationCutoverCommitResult | void> | undefined
    let reporter!: () => Promise<DelegationCutoverCommitResult | void>

    reporter = createAsyncSpawnCommitReporter(() => {
      invocationCount++
      // Reentrant call's own result is discarded by the callback -- the
      // callback otherwise behaves like an entirely ordinary, successful
      // synchronous-value callback.
      reentrantRef = reporter()
      return Promise.resolve(DUMMY_RESULT)
    })

    const outer = reporter()
    const outcome = await settleOrHang(outer)

    // FROZEN CONTRACT (this fix): ANY synchronous reentry observed during
    // the initial callback invocation poisons the logical operation --
    // reentrancy itself is evidence of a dependency cycle at this
    // durability boundary, never a benign duplicate to be silently
    // resolved by whatever the callback happens to return afterward.
    expect(outcome.hung).toBe(false)
    if (!outcome.hung) {
      expect(outcome.settled).toBe('rejected')
    }
    expect(invocationCount).toBe(1)
    expect(reentrantRef).toBe(outer)
  })

  it('a synchronous throw WITHOUT reentry is unaffected by the poison logic -- still caches the real thrown error, not a generic poison error', async () => {
    let invocationCount = 0
    const reporter = createAsyncSpawnCommitReporter(() => {
      invocationCount++
      throw new Error('sync_boom_no_reentry')
    })

    const outcome = await settleOrHang(reporter())
    expect(outcome.hung).toBe(false)
    if (!outcome.hung && outcome.settled === 'rejected') {
      expect((outcome.reason as Error).message).toBe('sync_boom_no_reentry')
    }
    expect(invocationCount).toBe(1)
  })

  it('does not produce an unhandled rejection from the callback-returned Promise that was never adopted', async () => {
    let invocationCount = 0
    let unhandled: unknown
    const onUnhandledRejection = (reason: unknown) => {
      unhandled = reason
    }
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      let reporter!: () => Promise<DelegationCutoverCommitResult | void>
      reporter = createAsyncSpawnCommitReporter(async () => {
        invocationCount++
        return reporter() as Promise<DelegationCutoverCommitResult>
      })

      await settleOrHang(reporter())
      // Give the discarded, adopted wrapper Promise a chance to settle and
      // for Node to flag it as unhandled if nothing observed it.
      await new Promise((r) => setTimeout(r, 50))
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }

    expect(unhandled).toBeUndefined()
    expect(invocationCount).toBe(1)
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
