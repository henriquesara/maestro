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
 *  converge on the one already-installed operation. */
export function createAsyncSpawnCommitReporter(
  callback?: () => Promise<DelegationCutoverCommitResult> | void
): () => Promise<DelegationCutoverCommitResult | void> {
  let promise: Promise<DelegationCutoverCommitResult | void> | undefined
  return (): Promise<DelegationCutoverCommitResult | void> => {
    if (promise) {
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
    try {
      Promise.resolve(callback?.()).then(resolve, reject)
    } catch (error) {
      reject(error)
    }
    return promise
  }
}
