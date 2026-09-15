# Focused blocker fix #2 — reentrant self-dependency / Promise-cycle safety

## Provenance

- Starting focused GREEN #1: `ce0521e2a692424761b43be7284257f92713fb07`
- This RED commit: focused tests + this evidence file only, no production changes.
- Follows a fresh independent rereview of focused GREEN #1 (`ORCA_S5_PREIMPLEMENTATION_SEAM_BLOCKERS_REMAIN`),
  which accepted both original blockers (sentinel-before-callback for sync
  throw/reentrancy; the `deferDelegatedCommandDelivery`/`onPtySpawnCommitted`
  construction-safety pairing) as genuinely fixed, but found one remaining
  gap via an adversarial probe of the §6-shape reentrant self-return case
  that the focused GREEN #1 test suite did not cover.

## The gap

`createAsyncSpawnCommitReporter` (focused GREEN #1) installs its sentinel
`Promise` (via an exposed `resolve`/`reject` pair) before invoking the
underlying callback, which correctly fixes:

- a synchronous throw from the callback (cached, not escaping uncached);
- ordinary synchronous reentrancy where the callback ignores the reentrant
  call's *return value* only up to a point -- see below, this shape is
  actually the same gap.

It does **not** handle a callback that synchronously re-enters the reporter
and then returns (directly, or indirectly via any wrapper -- e.g. an `async`
function -- that *adopts* the reentrant call's eventual settlement) a
value that depends on that same in-flight sentinel. Concretely:

```ts
let reporter
reporter = createAsyncSpawnCommitReporter(() => {
  invocationCount++
  return reporter() // returns the SAME sentinel Promise being constructed
})
reporter()
```

Inside the reporter, this becomes (materially) `promise.then(resolve, reject)`
where `resolve`/`reject` are `promise`'s own executor resolvers -- a
resolution cycle. `promise` can only settle when `resolve`/`reject` is
called; the only call site for `resolve`/`reject` is the reaction registered
on `promise` itself via that `.then`; that reaction only fires once `promise`
settles. `promise` never settles. **The returned Promise hangs forever, with
no thrown error, no rejection, and no unhandled-rejection warning** -- a
silent, permanently pending operation.

This was empirically reproduced standalone (outside the test framework, via
a Node script running the reporter's exact logic) against
`ce0521e2a692424761b43be7284257f92713fb07` before writing this RED: the
Promise never settled inside a 2-second window, with the callback invoked
exactly once (no double-invocation, no recursion -- purely a hang).

## Tightened frozen contract (this fix)

Per the independent rereview's own explicit requirement: this is not solvable
by checking `callbackResult === sentinel` (an `async` wrapper produces a
*distinct* Promise object that nevertheless depends on the sentinel, so
identity comparison is blind to it). The contract is therefore tightened at
the level of **synchronous reentry observation**, not Promise object
identity:

> **ANY synchronous reentry into the reporter, observed while the initial
> callback invocation is still synchronously executing, poisons that
> logical spawn-commit operation.** It fails closed with a stable internal
> error (`spawn_commit_reporter_synchronous_reentrancy`), regardless of what
> the callback itself ultimately returns -- direct self-return, indirect
> adoption through a wrapper, or an entirely unrelated, otherwise-successful
> return value with the reentrant call's own result simply discarded.
> Reentrancy itself is evidence of a dependency cycle at this durability
> boundary, never a benign duplicate to converge on.

This is a strictly *stricter* contract than focused GREEN #1's, and it
flips one previously-accepted assertion: the "synchronous-reentrancy safety
(blocker 1b)" test in `async-spawn-commit-reporter-synchronous-safety.test.ts`
exercised exactly the "reentrant call whose result is discarded, callback
otherwise returns a distinct successful value" shape and asserted the outer
call should *resolve* to that value. That assertion has been removed (the
test now only asserts the still-true "one invocation, reentrant caller
observes the same sentinel, no recursion" facts); the poisoning outcome for
that exact shape is now asserted by a new test in this commit,
"reentrancy-with-ignored-result", under the FIX #2 describe block.

## Focused RED #2 — three adversarial cases, all genuinely RED against ce0521e2a6

All three added to `src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts`,
run against **unmodified** focused-GREEN-#1 production code (no production
changes in this commit):

```
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts \
  src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts
```

```
Test Files  1 failed (1)
     Tests  3 failed | 8 passed (11)
```

1. **Direct self-return** -- callback returns `reporter()` verbatim.
   `outcome.hung === true` (never settled within the 200 ms deterministic
   hang-guard). RED.
2. **Indirect self-dependency** -- an `async` callback (`async () =>
   reporter()`) returns a *distinct* Promise object that adopts the
   reentrant call's settlement. `outcome.hung === true`. RED. (Proves an
   identity-only fix would be insufficient even if it happened to close
   case 1.)
3. **Reentrancy-with-ignored-result** -- callback reenters, discards the
   reentrant result, returns an unrelated `Promise.resolve(DUMMY_RESULT)`.
   Settles, but `outcome.settled === 'fulfilled'` where the tightened
   contract requires `'rejected'`. RED.

The remaining 8 tests in the file (sync-throw caching, "one invocation / same
sentinel observed" reentrancy facts, sync-throw-without-reentry, the
unhandled-rejection robustness check, and all pre-existing
pending/success/failure regression-guard tests) pass unchanged against
`ce0521e2a6` -- this RED is additive and narrowly targeted, no existing
passing invariant regressed by the test changes themselves.

## Deterministic hang-vs-settle harness

Per the rereview's explicit requirement not to rely on a long timeout as
the proof: `settleOrHang()` races the reporter's Promise against a **200 ms**
real timer used only as a circuit breaker so a genuinely hung Promise
cannot block the test process forever. The actual assertions are on the
returned `outcome.settled` discriminant (`'fulfilled' | 'rejected'`), never
on the timer "winning" -- `hung: true` is itself an immediate, explicit test
failure via `expect(outcome.hung).toBe(false)`, not treated as inconclusive.

## Scope

Files changed in this commit:

- `src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts` (test,
  modified: tightened blocker-1b assertion + 5 new tests under a new FIX #2
  describe block)
- `src/main/execution/slices/orca-delegated-cutover/FOCUSED-REVIEW-BLOCKER-FIX-2-REENTRANT-SELF-DEPENDENCY-EVIDENCE.md`
  (this file, additive)

No production code changed. No SPEC change. No `delegation_cutover`
persistence, fence acquisition, authority transfer, settlement, projection,
or M5 work in this commit.

## Focused GREEN #2 — implementation

`src/shared/async-spawn-commit-reporter.ts`: adds two closure-local flags,
`invokingCallback` and `reentryObserved`, alongside the existing sentinel:

- `invokingCallback` is `true` for exactly the synchronous duration of the
  first (and only) `callback?.()` invocation.
- Any call to the returned reporter function that observes an existing
  `promise` **while `invokingCallback` is true** sets `reentryObserved =
  true` before returning the existing sentinel unchanged (still zero
  additional callback invocations, still the same object returned).
- After `callback?.()` returns or throws, if `reentryObserved` is true, the
  operation is poisoned: the sentinel is rejected with `new
  Error('spawn_commit_reporter_synchronous_reentrancy')` regardless of
  whether the callback threw, returned normally, or returned a
  Promise -- and if the callback did return a Promise/thenable, a no-op
  `.then(undefined, () => {})` is attached to it first so its eventual
  settlement (which may well be this exact rejection, adopted through a
  wrapper) can never surface as an unhandled rejection.
- Absent reentry, all prior behavior (sync-throw caching, async
  pending/success/failure propagation, void-callback success) is
  unchanged.

This is a synchronous-reentry-observation design, not a
`callbackResult === sentinel` identity check -- required because an `async`
wrapper around a reentrant call produces a *distinct* Promise object that
still depends on the sentinel, which an identity check cannot see.

## Focused GREEN #2 — verification

All three RED #2 cases now pass, plus every pre-existing test in the file,
run 4 times back-to-back with no flakiness observed:

```
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts \
  src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts
```
```
Test Files  1 passed (1)
     Tests  11 passed (11)
```

Full focused seam suite (same 7 files as focused GREEN #1's evidence):
```
Test Files  7 passed (7)
     Tests  38 passed (38)
```
(33 from focused GREEN #1 + 5 new/updated in this fix: 3 new adversarial
cases, 1 new sync-throw-without-reentry regression guard, 1 new
unhandled-rejection robustness check. The pre-existing "synchronous-
reentrancy safety (blocker 1b)" test's assertion count is unchanged at 1
test, now asserting rejection instead of resolution.)

**Typecheck:** `node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json`
-- exits 0. Two categories of fix were required to reach this: (1) the
reporter's own `callbackResult` needed an explicit `= undefined`
initializer for TS's definite-assignment analysis across the try/catch
split: it could not otherwise prove the variable was assigned in every path
that reads it; (2) three test-file callbacks that return `reporter()`
directly (or through an `async` wrapper) needed an explicit
`as Promise<DelegationCutoverCommitResult>` cast, since a bare `reporter()`
call's return type (`Promise<DelegationCutoverCommitResult | void>`) does
not structurally match the callback parameter's declared type
(`Promise<DelegationCutoverCommitResult> | void`) -- an existing,
pre-fix-#2 type mismatch inherent to this adversarial shape, not a defect
introduced by the reporter fix. No `any`/`@ts-ignore`/disabled lint.

**Changed-code quality:** `node config/scripts/check-changed-code-quality.mjs`
-- 0 new findings (code quality, type-aware code quality, React Doctor)
across 22 changed files, gate passed since `7c1796e82c53`.

**Native-timing regression:** `local-pty-provider-spawn-session.test.ts` --
16/16 passed, unaffected (this fix only touches
`async-spawn-commit-reporter.ts`; `local-pty-spawn.ts` is untouched).

**S1-S4 execution-slice regression:** `src/main/execution/slices` --
19 passed + 2 skipped test files, 78 passed + 11 skipped tests, 0 failed --
byte-identical to the established baseline. (Run combined with the
native-timing file above: 20 passed + 2 skipped files / 94 passed + 11
skipped tests total, matching 19+1 files and 78+16 tests exactly.)

**A genuine test-authoring gap found and fixed during this work, not a
production defect:** while writing RED #2, the previously-accepted
"synchronous-reentrancy safety (blocker 1b)" test's final
`return expect(outer).resolves.toBe(DUMMY_RESULT)` line was removed (since
the tightened contract requires that shape to reject), but no replacement
assertion was added in the same edit -- leaving `outer`'s now-expected
rejection completely unobserved by that test. This surfaced as a real,
reproducible (non-flaky once isolated) `Vitest caught 1 unhandled error`
failure attributed to a *different*, later test in the same file (Node's
unhandled-rejection detection is not synchronous with the originating
test's completion, so the failure surfaced with a misleading "latest test"
attribution). Fixed by awaiting
`expect(outer).rejects.toThrow('spawn_commit_reporter_synchronous_reentrancy')`
in that test. A second, related timing note: the "indirect self-dependency"
test's async-wrapper-adopted Promise settles via a microtask job that is
not guaranteed to complete before the test function returns; a trailing
20 ms real-timer wait was added at the end of that test so its own
Promise-adoption chain cannot bleed into a subsequent test's
`unhandledRejection` listener window. Neither of these was a defect in
`async-spawn-commit-reporter.ts` itself -- both were test-file hygiene gaps
this session found and closed while proving the fix.

## Scope (final, GREEN #2 commit)

Production: `src/shared/async-spawn-commit-reporter.ts` only (as required --
no second production file needed). Tests:
`src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts`
(the type-error and unhandled-rejection fixes above landed in this commit,
on top of RED #2's already-committed new tests). Evidence: this file
(additive). No changes to `local-pty-spawn.ts`, SPEC.md, or any other file.
