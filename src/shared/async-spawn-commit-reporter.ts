import type { DelegationCutoverCommitResult } from './delegation-cutover-commit-result'

/** Async-aware, fire-once guard for the spawn-commit seam
 *  (orca-delegated-cutover SPEC.md §4.5.2). Both real guard layers
 *  (`orca-runtime-report-pty-spawn-commit.ts`'s `createPtySpawnCommitReporter`,
 *  `spawn-options.ts`'s inline guard) share this exact implementation so
 *  their duplicate semantics can never diverge -- one specified shape, two
 *  call sites, per the frozen SPEC.
 *
 *  Why the returned function is NOT itself `async`: an `async function`
 *  mints a brand-new Promise on every call, even when its body immediately
 *  returns an already-cached value -- two calls that both hit the
 *  "duplicate while in flight" branch would then return two *different*
 *  Promise objects that happen to resolve to the same thing, never
 *  satisfying real `===` identity. Caching and returning the underlying
 *  Promise directly (a plain, non-async function) preserves true
 *  referential identity across every duplicate call, for its entire
 *  lifecycle (pending, then settled or rejected) -- exactly what gate 46
 *  requires, with no extra state machine needed: a native Promise already
 *  IS its own single, stable object through pending -> settled/rejected.
 *
 *  Why `promise` is installed via an exposed resolver BEFORE `callback` is
 *  invoked, rather than `promise = Promise.resolve(callback?.())`: that
 *  simpler shape (also SPEC.md §4.5.2's own illustrative pseudocode)
 *  evaluates `callback?.()` before the assignment completes, so a
 *  synchronous throw from `callback` escapes uncached (and even escapes
 *  the call to the returned function itself, not merely its Promise), and
 *  a synchronous reentrant call -- `callback` calling this same reporter
 *  before returning -- observes no cached state yet and re-invokes
 *  `callback`. Installing the pending Promise first makes both cases
 *  converge on the one already-installed operation.
 *
 *  Why a synchronous reentrant call POISONS the operation instead of
 *  quietly converging on it: `callback` can return -- directly, or
 *  indirectly through any wrapper (e.g. `async () => reporter()`) that
 *  *adopts* a reentrant call's eventual settlement -- a value that depends
 *  on this same in-flight `promise`. Adopting that value into `promise`
 *  (`promise.then(resolve, reject)` on itself, materially) creates a
 *  resolution cycle: `promise` can only settle via `resolve`/`reject`,
 *  which are only reachable as a reaction to `promise` itself settling --
 *  it never does, and the operation hangs forever with no observable
 *  failure. A check for `callbackResult === promise` cannot catch the
 *  wrapper-adoption shape, since the wrapper's own returned Promise is a
 *  distinct object. Tracking synchronous reentry *as an event*, rather
 *  than inspecting what the callback returns, closes both shapes: any
 *  reentrant call observed while `callback` is still synchronously
 *  executing means `callback`'s eventual return value can no longer be
 *  trusted to be independent of `promise`, so it is never adopted --
 *  `promise` is rejected with a stable internal identity instead, and the
 *  now-orphaned callback result (if it is a Promise) gets a harmless
 *  no-op rejection handler so it can never surface as an unhandled
 *  rejection once it settles per whatever it depended on. */
export function createAsyncSpawnCommitReporter(
  callback?: () => Promise<DelegationCutoverCommitResult> | void
): () => Promise<DelegationCutoverCommitResult | void> {
  let promise: Promise<DelegationCutoverCommitResult | void> | undefined
  let invokingCallback = false
  let reentryObserved = false
  return (): Promise<DelegationCutoverCommitResult | void> => {
    if (promise) {
      if (invokingCallback) {
        // A synchronous reentrant call: the operation cannot converge
        // safely on whatever `callback` eventually returns (see the doc
        // comment above) -- mark it so the outer invocation poisons
        // `promise` instead of adopting that result. Still returns the
        // SAME sentinel, still invokes `callback` zero additional times.
        reentryObserved = true
      }
      return promise
    }
    let resolve!: (value: DelegationCutoverCommitResult | void) => void
    let reject!: (reason: unknown) => void
    promise = new Promise<DelegationCutoverCommitResult | void>((res, rej) => {
      resolve = res
      reject = rej
    })
    // First invocation only (guarded above), with the cached `promise`
    // already installed: calls the underlying callback synchronously,
    // exactly once. A synchronous throw here rejects the already-installed
    // `promise` instead of escaping uncached; a synchronous reentrant call
    // into this same reporter observes `promise` above and returns it
    // without a second invocation.
    invokingCallback = true
    let callbackResult: Promise<DelegationCutoverCommitResult> | void = undefined
    let threw = false
    let thrownError: unknown
    try {
      callbackResult = callback?.()
    } catch (error) {
      threw = true
      thrownError = error
    }
    invokingCallback = false
    if (reentryObserved) {
      // Fail closed: never adopt a result that a synchronous reentrant
      // call may have influenced. If that result is itself a Promise,
      // attach a no-op rejection handler so its eventual settlement
      // (which may well be this same rejection, adopted) can never
      // surface as an unhandled rejection.
      if (!threw) {
        Promise.resolve(callbackResult).then(undefined, () => {})
      }
      reject(new Error('spawn_commit_reporter_synchronous_reentrancy'))
      return promise
    }
    if (threw) {
      reject(thrownError)
    } else {
      Promise.resolve(callbackResult).then(resolve, reject)
    }
    return promise
  }
}
