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

### Production delta (smallest correct fix, per blocker)

**Blocker 1** — `src/shared/async-spawn-commit-reporter.ts`: installs an
exposed-resolver `Promise` (the cached `promise` sentinel) *before*
invoking `callback`, instead of `promise = Promise.resolve(callback?.())`
(which evaluates `callback?.()` first). A synchronous throw from
`callback` is now caught and rejects the already-installed `promise`
instead of escaping uncached; a synchronous reentrant call into the same
reporter now observes `promise` already set and returns it without a
second invocation. Referential identity for duplicate calls (gate 46) and
all previously-correct async pending/success/failure semantics are
unchanged -- verified by the retained positive controls.

**Blocker 2** — `src/main/providers/local-pty-spawn.ts`: one new
construction-safety check as the first statement of `spawnLocalPty`
(before any side effect -- no id allocation, no launch-plan construction,
no process spawn):

```ts
if (args.deferDelegatedCommandDelivery === true && !args.onPtySpawnCommitted) {
  throw new Error('delegated_cutover_commit_callback_required')
}
```

**Location rationale (SPEC.md §4.1a/§7.3 both name `PtySpawnOptions` as
the shared, provider-facing contract carrying both fields):**
`buildRuntimePtySpawnOptions` was considered but rejected as the sole
enforcement point -- it is not the only real construction boundary.
`local-pty-provider-delegated-command-delivery.test.ts`'s own
`spawnWithDeferredDelivery()` helper calls `LocalPtyProvider.spawn()`
directly, bypassing `buildRuntimePtySpawnOptions` entirely, and (before
this fix) resolved successfully with `deferDelegatedCommandDelivery: true`
and no callback -- concrete proof the unsafe state is reachable at the
`PtySpawnOptions`/provider boundary, not merely a hypothetical future
`RuntimePtySpawnArgs` caller. `spawnLocalPty` is the true universal
entry -- both the real production path (via
`buildRuntimePtySpawnOptions` -> `ctx.provider.spawn(ctx.spawnOptions)`)
and any future direct `PtySpawnOptions` caller pass through it before any
side effect, and it is where the SPEC's own §4.1a argv-suppression
mechanism (`createLocalPtyLaunchPlan`, called immediately after) and the
§4.3-authoritative await (line ~101, unchanged) both already live. One
centralized invariant, not duplicated checks.

The existing `buildRuntimePtySpawnOptions` provider-eligibility gate
(`supportsDelegatedCutoverHold`, §7.3) is unrelated and unchanged --
confirmed by `spawn-options-delegated-cutover-capability-gate.test.ts`
passing unmodified (it stubs `provider.spawn` as a bare `vi.fn()`, so it
never reaches `spawnLocalPty` and was never coupled to this invariant).

Two existing tests needed their fixtures updated to supply the
now-required callback so they keep testing what they were designed to
test (argv suppression), not the new pairing invariant:
`local-pty-provider-delegated-command-delivery.test.ts`'s
`spawnWithDeferredDelivery()` helper now defaults `onPtySpawnCommitted` to
a harmless resolved callback; the new "REJECTS..." test explicitly
overrides it back to absent.

### SPEC.md fidelity

Byte-unchanged (`git diff` against
`src/main/execution/slices/orca-delegated-cutover/SPEC.md` across this
entire focused-fix branch is empty). No architecture amendment was
needed: §4.5.2's own illustrative pseudocode has the same evaluation-order
defect as blocker 1 (see above) but the SPEC's *prose* invariants do not
change and are what this fix satisfies. §4.1a/§7.3's provider/defer/
callback threading already names `PtySpawnOptions` as the shared
contract; blocker 2's fix adds a construction-time check at that existing
contract boundary, inventing no new mechanism.

### Verification

**Focused seam suite** (all 6 original PRE_IMPLEMENTATION test files +
the 2 new focused-fix files):

```
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts \
  src/main/ipc/pty/runtime/spawn-execute-commit-propagation.test.ts \
  src/main/ipc/pty/runtime/spawn-execute-cross-alias-promise-convergence.test.ts \
  src/main/ipc/pty/runtime/spawn-options-commit-guard-async.test.ts \
  src/main/ipc/pty/runtime/spawn-options-delegated-cutover-capability-gate.test.ts \
  src/main/providers/local-pty-provider-delegated-command-delivery.test.ts \
  src/main/runtime/orca-runtime-report-pty-spawn-commit-async.test.ts \
  src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts
```
**Result: 7 test files, 33 tests, all passed** (24 original + 9 new: 6
sync-safety + 3 pairing).

**Type check:** `node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json` -- exits 0, no `any`/`@ts-ignore`/unsafe-cast escapes added.

**Native-timing regression** (the coalescing race test the original
conditional-await fix was written to protect):
`local-pty-provider-spawn-session.test.ts` -- **16/16 passed**, unaffected
(blocker 2's new check is a synchronous, non-awaiting guard at the very
top of `spawnLocalPty`, before the conditional-await site; it adds no
microtask on any existing call path).

**Changed-code quality:** `node config/scripts/check-changed-code-quality.mjs`
-- 0 new findings across code quality, type-aware code quality, and React
Doctor, across all 25 changed files (after fixing one `eslint(curly)`
finding on the reporter's early-return guard).

**S1-S4 execution-slice regression** (identical scope/command to the
original GREEN evidence):
```
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/execution/slices
```
**Result: 19 passed + 2 skipped test files, 78 passed + 11 skipped tests,
0 failed** -- byte-identical to the recorded PREIMPLEMENTATION-GREEN-EVIDENCE.md
baseline (19/2/78/11). No regression to ORCA-S1-S4.

**Broader regression** (identical scope to
PREIMPLEMENTATION-GREEN-EVIDENCE.md's own precedent):
```
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/providers src/main/ipc/pty src/main/runtime
```
**Result: 15 files failed / 864 passed / 5 skipped (884); 30 tests failed
/ 8826 passed / 67 skipped (8929).** The recorded baseline in
PREIMPLEMENTATION-GREEN-EVIDENCE.md is 16 files / 32 tests failed (884 /
8926 total) -- this run has **one fewer failing file and two fewer
failing tests**, not more; every failing file in this run
(`local-pty-shell-startup-command.node-pty.test.ts`,
`pty-daemon-spawn-wsl-runtime.test.ts`,
`pty-login-shell-startup-commands.test.ts`,
`pty-wsl-cwd-validation.test.ts`,
`local-pty-shell-ready-wrapper-generation.test.ts`,
`agent-session-claim-identity.test.ts`, `exit-provenance-audit.test.ts`,
`orca-runtime-files-terminal-artifact-grants.test.ts`,
`orca-runtime-files-terminal-artifact-io.test.ts`,
`orca-runtime-files-terminal-link-host-translation.test.ts`,
`runtime-extraction-regressions.test.ts`,
`runtime-skill-install-queries.test.ts`,
`structured-agent-session-integration.test.ts`,
`structured-worker-child-identity-env.test.ts`, `ai-vault.test.ts`) is
shell/WSL/path/timing/codex-home flavored -- none imports or exercises
`async-spawn-commit-reporter.ts`, `local-pty-spawn.ts`, or the defer/
callback pairing. `structured-agent-session-integration.test.ts` and
`agent-session-claim-identity.test.ts` are the same two files
PREIMPLEMENTATION-GREEN-EVIDENCE.md independently verified pre-existing
against the RED baseline (`c75a76bd6510bb2dec8eff64425b9a8c10f8f4ca`);
they still fail identically here. The 2-fewer-failures delta was not
independently bisected to a specific cause (most likely pre-existing
flakiness in timing-sensitive files such as `exit-provenance-audit.test.ts`)
but is a strict improvement, not a regression, and no new file appears in
this run's failure list that was absent from the recorded baseline's own
16.

Two of the exact failures observed in this run
(`local-pty-shell-startup-command.node-pty.test.ts`'s "No test found in
suite" and `local-pty-shell-ready-wrapper-generation.test.ts`'s
`ZDOTDIR`/`ORCA_USER_DATA_PATH` assertion) were independently reproduced
byte-identical against the unmodified GREEN candidate
(`9b31fb6ac7ef70b3f5de23fc7913c9e6f1a3de6a`, via a temporary
`git stash` of this fix's changes in the same worktree, then restored) --
confirmed pre-existing/environmental, not caused by this fix.

### Scope audit

`git diff --stat` for this focused-fix branch (RED + GREEN commits, on
top of `9b31fb6ac7ef70b3f5de23fc7913c9e6f1a3de6a`): 5 files -- 2
production (`src/shared/async-spawn-commit-reporter.ts`,
`src/main/providers/local-pty-spawn.ts`), 2 test (1 new:
`src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts`; 1
modified: `src/main/providers/local-pty-provider-delegated-command-delivery.test.ts`),
1 evidence (this file). No `delegation_cutover` persistence, no aiControl
fence calls, no authority transfer, no settlement, no projection, no
fallback, no M5 -- confirmed by `grep -rn
"delegation_cutover|acquireFence|ORCA_DELEGATED|fence.*acqui"` across both
touched production files: zero matches.

### Authority (before/after, unchanged)

```
AICONTROL_NATIVE
ORCA_DELEGATED: NOT STARTED
Fence acquisition: DISABLED
M5: NOT STARTED
```
