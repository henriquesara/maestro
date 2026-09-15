# Focused fix — ORCA-S5 PRE_IMPLEMENTATION seam independent-acceptance blockers

Additive evidence file. Does not amend or rewrite
`PREIMPLEMENTATION-RED-EVIDENCE.md` / `PREIMPLEMENTATION-GREEN-EVIDENCE.md`,
which remain the original RED→GREEN history for the seam itself
(architecture HEAD `7c1796e82c53de53f0a028123defbe53974eb652` →
`0a1bf4c2654ff9cb334c90b1f0ff7bd97e9d7492` →
`c75a76bd6510bb2dec8eff64425b9a8c10f8f4ca` →
`9b31fb6ac7ef70b3f5de23fc7913c9e6f1a3de6a`).

Starting GREEN candidate for this focused fix:
`9b31fb6ac7ef70b3f5de23fc7913c9e6f1a3de6a`.

Independent acceptance verdict on that candidate: `BLOCKERS_FOUND` (two
correctness blockers). This document evidences the focused RED → focused
GREEN loop that corrects exactly those two blockers, and only those two.

## Blocker 1 — `async-spawn-commit-reporter.ts` unsafe under synchronous throw / synchronous reentrancy

`createAsyncSpawnCommitReporter`'s guard was

```ts
if (!promise) {
  promise = Promise.resolve(callback?.())
}
```

`callback?.()` is evaluated (and, notably, this happens as a **plain,
non-async** function body -- see the file's own docstring on why it is
deliberately not `async`) before the assignment to `promise` completes.
Neither a synchronous throw nor a synchronous reentrant call observes any
cached state at that point.

**Note:** SPEC.md §4.5.2's own illustrative reference implementation has
this identical evaluation-order property (`const promise =
Promise.resolve(callback?.())` precedes `state = { phase: 'in_flight',
promise }`), even though it wraps the returned function in `async` --
which converts a synchronous throw into a *rejected Promise for that one
call* but still leaves `state` at `'idle'` forever, so a synchronous throw
is still not cached, and the async wrapper reintroduces the exact
Promise-identity divergence problem the real file's docstring explains it
avoids. This is a bug in the SPEC's illustrative pseudocode, not a
requirement of it: the SPEC's own **prose** invariants ("first invocation:
invokes the underlying callback exactly once"; "duplicate after failure:
cache and re-throw the same failure") are unconditional on sync vs. async
failure, and the fix below satisfies those prose invariants exactly, while
also preserving the real file's referential-identity requirement (gate 46)
the reference pseudocode's `async` wrapper would have broken. No SPEC.md
edit was made or is needed -- §4.5.2's frozen written contract does not
change; only the code's fidelity to it does.

### RED (test-only, no production changes)

New file: `src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts`

Run against GREEN candidate `9b31fb6ac7ef70b3f5de23fc7913c9e6f1a3de6a`:

```
❯ createAsyncSpawnCommitReporter: synchronous-throw safety (blocker 1a)
  × caches a synchronous throw as the permanent failure -- no retry on a duplicate call
    Error: sync_boom
     ❯ src/shared/async-spawn-commit-reporter.ts:30:33
     ❯ src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts:25:19
❯ createAsyncSpawnCommitReporter: synchronous-reentrancy safety (blocker 1b)
  × a synchronously reentrant call converges on the same in-flight operation -- exactly one underlying invocation
    AssertionError: expected 4 to be 1

Test Files  1 failed (1)
     Tests  2 failed | 4 passed (6)
```

The synchronous-throw case is notably worse than "the returned Promise
rejects": the raw `Error` escapes the call to `reporter()` itself (a
synchronous exception from calling the function), not a Promise the caller
merely forgot to catch -- confirmed directly in the failure trace above,
where the assertion never reaches `.rejects.toThrow(...)` because `const
first = reporter()` throws before that line runs.

The 4 already-passing tests in the same file (pending-duplicate
convergence, success caching, async-rejection caching, void-callback
resolution) are retained positive controls: this fix must not regress any
of them.

## Blocker 2 — `deferDelegatedCommandDelivery` constructible without a paired `onPtySpawnCommitted`

`spawn-options.ts`'s provider-capability gate and `local-pty-launch-plan.ts`'s
argv suppression both key off `args.deferDelegatedCommandDelivery` alone;
`spawn-options.ts`'s threading of `ctx.spawnOptions.onPtySpawnCommitted`
keys off `args.onPtySpawnCommitted` alone (plus a provider-instance check
unrelated to the defer flag); and `local-pty-spawn.ts`'s durable-commit
await is skipped whenever the callback is absent (`if
(args.onPtySpawnCommitted) { await args.onPtySpawnCommitted() }`). No
production code enforced that a caller setting the defer flag must also
supply the callback. Confirmed directly reachable at the
`PtySpawnOptions`/`LocalPtyProvider.spawn()` boundary -- not only a
hypothetical future `RuntimePtySpawnArgs` caller -- by the pre-existing
`local-pty-provider-delegated-command-delivery.test.ts`'s own
`spawnWithDeferredDelivery()` helper, which (before this fix) called
`provider.spawn()` with `deferDelegatedCommandDelivery: true` and no
callback at all, and resolved successfully.

### RED (test-only, no production changes)

New tests added to `src/main/providers/local-pty-provider-delegated-command-delivery.test.ts`
(same file the existing gate 41/42/49/55 evidence lives in, since this is
the same construction boundary):

Run against GREEN candidate `9b31fb6ac7ef70b3f5de23fc7913c9e6f1a3de6a`:

```
❯ LocalPtyProvider: delegated command delivery -- required commit-callback pairing (SPEC §4.1a construction safety, blocker 2 fix)
  × REJECTS a delegated spawn missing the required commit callback, before any process is spawned
    AssertionError: promise resolved { id: '5', ... } instead of rejecting

Test Files  1 failed (1)
     Tests  1 failed | 6 passed (7)
```

The two new positive controls in the same block (valid pair accepted;
ordinary spawn with a callback present, defer unset, unaffected) already
pass at the GREEN candidate and are retained as regression guards.

## Focused GREEN

See commit message of the focused GREEN commit (this file is updated in
that same commit with the post-fix verification results) for the smallest
production delta and its verification.
