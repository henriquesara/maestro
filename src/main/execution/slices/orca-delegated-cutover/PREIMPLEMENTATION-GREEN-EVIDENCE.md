# ORCA-S5 Pre-Implementation Seam — GREEN Implementation Evidence

> This document records the GREEN implementation session that closed the
> RED baseline in [`PREIMPLEMENTATION-RED-EVIDENCE.md`](./PREIMPLEMENTATION-RED-EVIDENCE.md).
> **That file is preserved unedited as the honest historical record of what
> was RED and why.** This document does not rewrite it; it records what
> changed and why every RED assertion now passes.
>
> Scope: only the frozen PRE_IMPLEMENTATION prerequisite —
> Part A (`DELEGATED_DEFERRED_COMMAND_DELIVERY`, §4.1a), Part B
> (`TRUE_ASYNC_SPAWN_COMMIT_PROPAGATION`, §4.5), the async fire-once
> guard (§4.5.2), and the provider capability gate (§7.3). No
> `delegation_cutover` table, no aiControl fence handshake, no real fence
> acquisition, no authority transfer, no settlement, no terminal
> projection, no aiControl R3, no automatic fallback, no M5. `SPEC.md` was
> not modified.

## 1. Commits

| Role | SHA |
| --- | --- |
| Frozen architecture HEAD | `7c1796e82c53de53f0a028123defbe53974eb652` |
| Initial genuine RED | `0a1bf4c2654ff9cb334c90b1f0ff7bd97e9d7492` |
| Completed RED baseline (gate 60 added) | `c75a76bd6510bb2dec8eff64425b9a8c10f8f4ca` |
| GREEN implementation | *(this session's commit — see final report)* |

Linear ancestry: `7c1796e82c` → `0a1bf4c265` → `c75a76bd65` → GREEN. No RED
commit was amended or rebased; the GREEN commit is additive, built on top.

## 2. Production files changed (exhaustive — matches the allowed scope only)

| File | What changed |
| --- | --- |
| `src/shared/delegation-cutover-commit-result.ts` (new) | `DelegationCutoverCommitResult` — the frozen §4.5.3 evidence-of-settlement type, authority-neutral: nothing in this codebase produces anything but `void` from it yet. |
| `src/shared/async-spawn-commit-reporter.ts` (new) | `createAsyncSpawnCommitReporter` — the shared async-aware fire-once guard (§4.5.2), used by both real guard layers. |
| `src/main/runtime/orca-runtime-report-pty-spawn-commit.ts` | Guard layer 1 (site #6): `createPtySpawnCommitReporter` now delegates to the shared factory. Signature widened. |
| `src/main/ipc/pty/runtime/spawn-options.ts` | Guard layer 2 (sites #10/#11): inline boolean guard replaced with the shared factory. Added the §7.3 provider-eligibility check and `deferDelegatedCommandDelivery` threading into `ctx.spawnOptions`. |
| `src/main/providers/pty-provider-contract.ts` | `PtySpawnOptions.onPtySpawnCommitted` widened (site #3); added `PtySpawnOptions.deferDelegatedCommandDelivery`; added `IPtyProvider.supportsDelegatedCutoverHold` (§7.3). |
| `src/main/runtime/runtime-terminal-contracts.ts` | `TerminalCreateOptions.onPtySpawnCommitted` widened (site #1). |
| `src/main/runtime/runtime-pty-controller-contract.ts` | `RuntimePtyController['spawn']`'s inline `onPtySpawnCommitted` option widened (site #2). |
| `src/main/ipc/pty/runtime/spawn-state.ts` | `RuntimePtySpawnArgs.onPtySpawnCommitted` widened (site #4); added `RuntimePtySpawnArgs.deferDelegatedCommandDelivery`; `RuntimePtySpawnState.reportPtySpawnCommitted` widened (site #14); default initializer changed from `() => {}` to `async () => {}` (site #15). |
| `src/main/ipc/pty/pane/stable-owner.ts` | `StablePaneSpawnContext.onFreshSpawn` widened (site #18); its invocation in `spawnForStablePane` now `await`ed (site #19). |
| `src/main/ipc/pty/runtime/spawn-execute.ts` | Site #16's direct `ctx.reportPtySpawnCommitted()` call now `await`ed. |
| `src/main/runtime/orca-runtime-create-terminal.ts` | Site #9's outer `reportPtySpawnCommitted()` call now `await`ed. |
| `src/main/providers/local-pty-spawn.ts` | Site #12's `args.onPtySpawnCommitted?.()` call now conditionally `await`ed (only when the callback is present — see §5 below for why unconditional awaiting was rejected). |
| `src/main/providers/local-pty-launch-plan.ts` | `createWindowsLocalPtyLaunchPlan`'s `finish` closure now withholds `args.command` from `buildWindowsPowerShellSpawnAttempts`/`resolveWindowsShellLaunchArgs` when `args.deferDelegatedCommandDelivery` is true (§4.1a). Two one-line changes; no new code path. |
| `src/main/providers/local-pty-provider.ts` | `LocalPtyProvider.supportsDelegatedCutoverHold()` added, returns `true`. |
| `src/main/execution/slices/orca-delegated-cutover/spawn-commit-type-conformance-red.ts` | Converted from RED (`@ts-expect-error` markers) to GREEN (positive conformance assertions) — see §6. |

**Every change is one of: delegated deferred command-delivery plumbing,
provider capability plumbing/gate, callback/result type propagation, async
guard behavior, or an awaited-invocation change.** No file under
`delegation_cutover`/settlement/projection/fence/authority scope was
created or touched. `git diff --stat` against `c75a76bd6510bb2dec8eff64425b9a8c10f8f4ca`
confirms this file list exactly (13 production files + 2 new shared files +
6 test files, listed in §7).

## 3. Part A — deferred local command delivery

`PtySpawnOptions.deferDelegatedCommandDelivery?: boolean` threads down to
`createWindowsLocalPtyLaunchPlan`'s `finish` closure
(`local-pty-launch-plan.ts`), which now passes `undefined` instead of
`args.command` to `buildWindowsPowerShellSpawnAttempts` and
`resolveWindowsShellLaunchArgs` whenever the flag is set. This forces the
codebase's own already-existing, already-tested "command not embeddable"
branches (`getCmdShellArgStartupCommand` returning `null`,
`getPowerShellEncodedCommand` omitting `startupCommand`) unconditionally —
**no new argv-construction logic was added.** `args.command` itself is left
completely unchanged everywhere else, so `writeStartupCommandWhenShellReady`
can still deliver it later exactly as it already does for any command the
existing fallback logic would have deferred anyway.

The WSL and POSIX branches of `createLocalPtyLaunchPlan` never embed a
command in argv in the first place (confirmed during the RED session's
re-derivation, §2 of the RED evidence doc) — no change was needed there.

No production caller sets this flag yet (the real caller, per SPEC §4.1a,
is the delegated admission decision in `createAgentSession` after
`acquireOrcaFence` succeeds — explicitly out of this session's scope). The
flag threads through `RuntimePtySpawnArgs` → `buildRuntimePtySpawnOptions`
→ `PtySpawnOptions`; it was deliberately **not** threaded further up into
`TerminalCreateOptions`/`orca-runtime-create-terminal.ts`'s
`resolveAgentTerminalCreateOptions` internals this session — no RED
evidence required it, and that deeper application-layer wiring has no test
coverage and no real caller yet, so extending it further would be
unverified surface, not the smallest additive seam.

## 4. Provider capability gate (§7.3)

`IPtyProvider.supportsDelegatedCutoverHold?: (options?) => boolean | Promise<boolean>`
added, same shape as the two existing capability precedents. Checked in
`buildRuntimePtySpawnOptions` with the **inverse** idiom from those two
precedents (`!== true` rather than `=== false`) — absence is treated as
unsupported, fail-closed, matching §7.3's explicit instruction that this
gate must default to rejection. Checked before any spawn is allowed to
proceed, before any future fence-acquisition boundary (this session has
none). `LocalPtyProvider` declares it `true`; no other provider declares it
— confirmed by symbol search, matching gate 53's static-audit requirement.

## 5. Async propagation — the full 19-site graph

Both guard layers now share `createAsyncSpawnCommitReporter`
(`src/shared/async-spawn-commit-reporter.ts`):

```ts
export function createAsyncSpawnCommitReporter(
  callback?: () => Promise<DelegationCutoverCommitResult> | void
): () => Promise<DelegationCutoverCommitResult | void> {
  let promise: Promise<DelegationCutoverCommitResult | void> | undefined
  return (): Promise<DelegationCutoverCommitResult | void> => {
    if (!promise) {
      promise = Promise.resolve(callback?.())
    }
    return promise
  }
}
```

**Design note found and corrected during implementation, worth recording:**
the frozen SPEC's own §4.5.2 reference shape returns an `async () => {...}`
closure with an explicit `phase` state machine
(`idle`/`in_flight`/`settled`/`failed`). Implementing that literally first,
gate 46's own RED test ("duplicate invocation while in-flight must return
the SAME in-flight Promise") kept failing — `expect(first).toBe(second)`
compared two *different* Promise objects that merely resolved to the same
value. The reason: an `async function` mints a brand-new Promise on
**every call**, even when its body's first line immediately returns an
already-cached value — two calls hitting the "return the cached promise"
branch each get their own wrapper Promise, never satisfying `===`. Caching
and returning the underlying Promise directly from a **plain, non-async**
function preserves true referential identity for its entire lifecycle
(pending → settled or rejected, all one object) — which is what's
implemented above, with no explicit phase enum needed at all: a native
Promise already *is* its own single, stable object through that whole
lifecycle. This satisfies gates 45-48 more simply than the literal
reference shape, and satisfies §9's own instruction to prefer exact
identity wherever the production boundary can expose it (here, it can).

**Second design note, also found and corrected during implementation:** the
mission's own instruction to `await args.onPtySpawnCommitted?.()`
*unconditionally* at site #12 (`local-pty-spawn.ts:89`) was tested against
the real, existing `local-pty-provider-spawn-session.test.ts` regression
suite and found to break a genuine, pre-existing race test
(`coalesces a concurrent same-session-id spawn before launching a redundant
shell (F3)`) — because `await` always yields at least one microtask tick
*even when its operand is `undefined`*, and that test's timing assumptions
depend on exact synchronous-vs-microtask ordering for the (overwhelmingly
common) case where no `onPtySpawnCommitted` callback is passed at all. The
implemented fix awaits only when the callback is actually present
(`if (args.onPtySpawnCommitted) { await args.onPtySpawnCommitted() }`),
which introduces **zero** timing change for every spawn that never sets
this callback, and still fully satisfies the frozen ordering contract when
it is set. Verified: the regression suite passes again with this fix (§8),
and every gate-60/47/48/61 RED assertion — which all use a real,
present callback — still passes (nothing about them depended on the
unconditional form).

Site-by-site:

| # | Site | Change |
| --- | --- | --- |
| 1 | `runtime-terminal-contracts.ts:55` | Type widened. |
| 2 | `runtime-pty-controller-contract.ts:71` | Type widened. |
| 3 | `pty-provider-contract.ts:109` | Type widened. |
| 4 | `spawn-state.ts:115` | Type widened. |
| 5 | `orca-runtime-create-agent-session.ts:225-227` | Unchanged — still `() => { retainReplayFence = true }`. The widened union type accommodates this sync-void callback unchanged, exactly as SPEC.md prescribes ("unchanged for a non-delegated spawn"); no delegated caller exists yet to exercise the async branch. |
| 6 | `orca-runtime-report-pty-spawn-commit.ts` | Guard layer 1 replaced. |
| 7 | `orca-runtime-create-terminal.ts:31` | Unchanged wiring; follows #6's new signature automatically. |
| 8 | `orca-runtime-create-terminal.ts:167-169` | Unchanged wiring. |
| 9 | `orca-runtime-create-terminal.ts:178-180` | `await reportPtySpawnCommitted()`. |
| 10 | `spawn-options.ts:60-66` (was 59-66) | Guard layer 2 replaced. |
| 11 | `spawn-options.ts` threading | Unchanged (already correct pre-GREEN); now threads an async-capable closure. |
| 12 | `local-pty-spawn.ts:89` (now ~98-100) | `if (args.onPtySpawnCommitted) { await args.onPtySpawnCommitted() }`. |
| 13 | `stable-owner.ts:233` (`attachStablePaneOwner`) | Unchanged — confirmed out of scope by the frozen SPEC. |
| 14 | `spawn-state.ts:80` | Type widened. |
| 15 | `spawn-state.ts:183` (now ~186) | Default initializer changed to `async () => {}`. |
| 16 | `spawn-execute.ts:88` | `await ctx.reportPtySpawnCommitted()`. |
| 17 | `spawn-execute.ts:148` | Unchanged forwarding; follows #18's new signature. |
| 18 | `stable-owner.ts:169` | Type widened. |
| 19 | `stable-owner.ts:302` | `await args.onFreshSpawn?.(result)`. |

Completeness re-derived the same way the RED session did (§2 of the RED
evidence doc): by tracing the logical operation through every alias,
wrapper, type slot, and invocation — not by re-grepping
`onPtySpawnCommitted`. No site was skipped for being untested; #5/#7/#8/#11/#13/#17
are documented above as **unchanged**, not overlooked.

## 6. Type-conformance evidence (gate 44 type-half, gate 56)

`spawn-commit-type-conformance-red.ts` was rewritten (not renamed — see the
file's own header for why) from six `@ts-expect-error` RED markers into six
positive conformance assertions. `pnpm tc:node` exits 0 for the whole
project. One correction made while converting: the raw-callback sites
(#1-#4, #18) are typed `Promise<X> | void` (not `Promise<X | void>`) by
design, so a caller cannot assume the return is *unconditionally*
awaitable — it might genuinely be `void` for every existing sync caller.
The file's positive assertions target that exact union, not a stronger one
that would misrepresent intentional backward-compatible design as a defect.

Sites #5/#7/#8/#9 (in `orca-runtime-create-terminal.ts`, `@ts-nocheck`) are
still not independently type-checkable — their evidence remains
runtime-only, as documented in the file itself.

## 7. Test files changed (all additive/converted, no assertion weakened)

| File | Change |
| --- | --- |
| `local-pty-provider-delegated-command-delivery.test.ts` | RED → GREEN titles/comments; assertions unchanged, now pass. |
| `orca-runtime-report-pty-spawn-commit-async.test.ts` | RED → GREEN titles/comments; assertions unchanged, now pass. |
| `spawn-options-commit-guard-async.test.ts` | RED → GREEN titles/comments; assertions unchanged, now pass. Fixture cast target updated from the stale `() => void` to the real widened type. |
| `spawn-execute-commit-propagation.test.ts` | RED → GREEN titles/comments; assertions unchanged, now pass. Fixture casts simplified (no longer need `as unknown as () => void` now that the real type accepts a Promise-returning callback directly). |
| `spawn-execute-cross-alias-promise-convergence.test.ts` | RED → GREEN titles/comments; assertions unchanged, now pass. Fixture casts updated to `typeof ctx.reportPtySpawnCommitted`/`typeof ctx.spawnOptions.onPtySpawnCommitted`. **Added** one assertion to the failure-case test (`observedReturns[1]).toBe(observedReturns[0])`, same-Promise-identity on the rejection path) — a strengthening, not a weakening, for symmetry with the success-case test; verified still passes. |
| `spawn-options-delegated-cutover-capability-gate.test.ts` | Rewritten: the RED-era positive control asserting `LocalPtyProvider` does *not* declare the capability was replaced with tests asserting it now does, plus new tests covering the explicit-`false` case and the non-delegated (capability never consulted) case. The original RED behavioral test (unsupported provider rejected) is unchanged and still passes. |

No test's assertion was removed or relaxed to make it pass; every RED
assertion that encoded the frozen contract now passes because production
satisfies it.

## 8. Test results

### New seam tests (all 6 files together)

```
pnpm vitest run --config config/vitest.config.ts \
  src/main/providers/local-pty-provider-delegated-command-delivery.test.ts \
  src/main/runtime/orca-runtime-report-pty-spawn-commit-async.test.ts \
  src/main/ipc/pty/runtime/spawn-options-commit-guard-async.test.ts \
  src/main/ipc/pty/runtime/spawn-execute-commit-propagation.test.ts \
  src/main/ipc/pty/runtime/spawn-options-delegated-cutover-capability-gate.test.ts \
  src/main/ipc/pty/runtime/spawn-execute-cross-alias-promise-convergence.test.ts
```
**Result: 6 test files, 24 tests, all passed.**

### Type check

`pnpm run tc:node` — **exits 0.**

### Broader regression, `src/main/providers src/main/ipc/pty src/main/runtime`

First pass (before the site-#12 conditional-await fix, §5): **17 files /
33 tests failed** — one genuine new regression
(`local-pty-provider-spawn-session.test.ts`'s coalescing race test) plus
the same 16 pre-existing files. After the fix: **16 files / 862 passed / 5
skipped (884 total); 32 tests failed / 8821 passed / 67 skipped (8926
total)** — file-for-file and test-count-for-test-count identical to the
RED session's own recorded pre-existing baseline.

**Independently verified, not just count-matched:** two of the sixteen
files whose failures are not obviously platform/path-separator noise
(`structured-agent-session-integration.test.ts`,
`agent-session-claim-identity.test.ts`) were run against a temporary
worktree pinned to `c75a76bd6510bb2dec8eff64425b9a8c10f8f4ca` (the RED
baseline, before any GREEN production change) and fail there with
byte-identical assertion output — proving they are pre-existing and
unrelated, not masked by this session's changes.

### S1-S4 execution-slice regressions

```
pnpm vitest run --config config/vitest.config.ts src/main/execution/slices
```
**Result: 21 test files, 19 passed + 2 skipped, 89 tests, 78 passed + 11
skipped, 0 failed.** No regression to ORCA-S1–S4.

### Code quality

`pnpm run check:code-quality:changed` — **0 new findings** across code
quality, type-aware code quality, and React Doctor, across all 21 changed
files.

## 9. Gates 41-63 matrix (final)

| Gate | Status |
| --- | --- |
| 41 | **GREEN** — `local-pty-provider-delegated-command-delivery.test.ts` |
| 42 | **GREEN** (PowerShell + cmd.exe covered; POSIX/WSL confirmed already-safe by construction, §3 above and RED evidence §2) |
| 43 | Unchanged from RED: proven by static trace (SPEC §4.1b), not a new executable gate this session |
| 44 | **GREEN** — type half (§6) and runtime half (all guard/propagation tests) |
| 45 | **GREEN** |
| 46 | **GREEN** |
| 47 | **GREEN** |
| 48 | **GREEN** |
| 49 | **GREEN** — workload delivery structurally impossible until argv-prevention + await ordering both hold |
| 50 | `LATER_SLICE_B` — unchanged, requires `delegation_cutover` (§8.1), not implemented |
| 51 | `LATER_SLICE_B` — unchanged, requires §5.8's authority model |
| 52 | **GREEN** — `spawn-options-delegated-cutover-capability-gate.test.ts` |
| 53 | Confirmed by static audit (unchanged from RED: no remote/SSH provider declares the capability) |
| 54 | `LATER_SLICE_B` — unchanged, requires a restart harness |
| 55 | **GREEN** — real default Windows PowerShell path |
| 56 | **GREEN** (type-checkable sites); `@ts-nocheck`'d sites proven at runtime only, documented |
| 57 | **GREEN** |
| 58 | **GREEN** (type half); runtime half is gate 59 |
| 59 | **GREEN** |
| 60 | **GREEN** — `spawn-execute-cross-alias-promise-convergence.test.ts` |
| 61 | **GREEN** — deterministic, no reliance on process-level unhandled-rejection timing |
| 62 | **GREEN** |
| 63 | Satisfied by process (RED session's own symbol/call-graph trace, re-used and re-verified this session against the same 19 sites) |

Gates 38, 50, 54 remain `LATER_SLICE_B`, unchanged, per the frozen SPEC's
own §18.1/§18.2 split — they require the `delegation_cutover` durable
transaction and a real restart harness, neither implemented in this
PRE_IMPLEMENTATION seam.

## 10. Proof of scope discipline

- **No `delegation_cutover` table, migration, or schema version bump.**
  `EXECUTION_SCHEMA_VERSION` untouched.
- **No aiControl code touched.** `aiControlCenter` `origin/master` verified
  unchanged (`ab5967bdde5115afe6673e8b520a73cfb29f0eaf`) before and after
  this session; `data/app.db` SHA-256 verified byte-identical
  (`2DC6F32A86E42B6CD42E93712AF73E33FC39053B3EC2B6265566AC0580A45088`); no
  `-wal`/`-shm`/journal.
- **No fence acquisition.** `isOrcaFenceAcquisitionEnabled()` and its env
  gate were not read or modified by any production file this session.
- **No authority-state change.** No code path in this diff writes, reads,
  or branches on `AICONTROL_NATIVE`/`ORCA_DELEGATED`/`ORCA_AUTHORITATIVE`.
- **No settlement or terminal projection.** No new table, no
  `AiControlDelegationProjectionWriter` change.
- **No automatic fallback behavior added or changed.**
- **`SPEC.md` byte-unchanged** — not opened for writing this session.

## 11. Authority / scope (before and after)

- Migration authority: `AICONTROL_NATIVE` — unchanged.
- `ORCA_DELEGATED`: `NOT STARTED` — unchanged.
- Fence acquisition: disabled — unchanged, not touched.
- M5 (Controlled Fallback): `NOT STARTED` — unchanged, not touched.

No production test in this diff claims, simulates, or exercises real
delegated authority.
