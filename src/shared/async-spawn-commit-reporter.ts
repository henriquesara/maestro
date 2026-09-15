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
 *  IS its own single, stable object through pending -> settled/rejected. */
export function createAsyncSpawnCommitReporter(
  callback?: () => Promise<DelegationCutoverCommitResult> | void
): () => Promise<DelegationCutoverCommitResult | void> {
  let promise: Promise<DelegationCutoverCommitResult | void> | undefined
  return (): Promise<DelegationCutoverCommitResult | void> => {
    if (!promise) {
      // First invocation only (guarded above): calls the underlying
      // callback synchronously, exactly once, matching SPEC.md §4.5.2's
      // own reference shape.
      promise = Promise.resolve(callback?.())
    }
    return promise
  }
}
