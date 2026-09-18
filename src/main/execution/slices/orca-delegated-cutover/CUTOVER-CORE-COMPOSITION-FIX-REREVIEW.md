# ORCA-S5 Delegated Cutover Core — Composition-Fix Rereview (independent, fresh worktree)

Scope: **only** the previously identified composition blocker
(`ORCA_S5_DELEGATED_CUTOVER_CORE_COMPOSITION_BLOCKER_FOUND`) and its focused
fix. Full Cutover-Core acceptance was not repeated. No code, test, or
architecture file was edited by this review. Reviewed in a fresh detached
worktree (`C:/mw-orca-s5-rereview`) pinned to the focused GREEN commit; no
mutation to the primary Maestro working directory or its branch.

## 1. Lineage

Verified with `git log --format='%H %P'` on each commit individually (single
parent shown = no merge):

```
b8fe7cb94285bb3b7c13f052fc541de8883de4c3   (published architecture base)
  -> 7e03539e23e6eae9b0f5024a2a9eafdd1b7f4fe6   (genuine RED)
  -> 67a36218c548d38fd929d7003e728a7983462803  (original GREEN, isolated coordinator)
  -> 5c75a7db28190654834dd36f8894f3dac88c9bb9  (focused RED, Gate 31)
  -> 326b11e4fc973afa7e23d03a1f0d310933915cd1  (focused GREEN, Gate 31)
```

- No merge commits anywhere in this span (every commit has exactly one parent).
- Focused RED's parent == `67a36218...` — confirmed.
- Focused GREEN's parent == `5c75a7db...` — confirmed.
- `326b11e4...` is not contained in any local remote-tracking branch
  (`git branch -r --contains 326b11e4...` empty); no cached `origin/master`
  ref existed in this checkout to compare against. Treated as unpublished.

**Verdict: lineage clean.**

## 2. Exact focused diffs

**`67a36218` → `5c75a7db` (focused RED):** 1 file, tests only.
```
delegated-cutover-real-site5-composition.test.ts | 311 +++++++++++++++++++++
1 file changed, 311 insertions(+)
```

**`5c75a7db` → `326b11e4` (focused GREEN):** 12 files.
```
CUTOVER-CORE-SITE5-COMPOSITION-FIX-EVIDENCE.md (new, evidence)     | 251 ++
delegated-cutover-real-site5-composition.test.ts                   |  34 +-
spawn-options.ts                                                   |   4 +
spawn-state.ts                                                     |  10 +-
local-pty-spawn.ts                                                 |   7 +
pty-provider-contract.ts                                           |  14 +
providers/types.ts                                                 |   1 +
orca-runtime-create-agent-session.ts                                |  56 ++-
orca-runtime-create-terminal.ts                                    |   4 +
orca-runtime-delegated-cutover-callback.ts (new)                   |  76 ++
runtime-pty-controller-contract.ts                                 |   8 +-
runtime-terminal-contracts.ts                                      |   4 +
12 files changed, 460 insertions(+), 9 deletions(-)
```

No file under `execution/application/`, `execution/infrastructure/` (other
than importing, not editing, the pre-existing `process-instance-discriminator.ts`),
`execution/domain/`, or `orca-runtime-delegated-cutover-coordinator.ts` was
touched. Schema/store/coordinator authority semantics are byte-identical to
`67a36218`.

**Verdict: no `FOCUSED_FIX_SCOPE_EXPANSION`** — with one scope note the
mission's framing understates (see §5 below): the fix wires **both**
`establishReservation` and `commitDelegatedCutover` into production, not
`commitDelegatedCutover` alone, because `establishReservation` also had zero
production callers before this commit. This is necessary, not expansion —
see §5.

## 3. Focused RED reproduction

Checked out `5c75a7db` in the fresh worktree, ran the new test file directly
(`vitest run .../delegated-cutover-real-site5-composition.test.ts`):

```
✕ a real delegated request causes the real site #5 callback to invoke the
  real coordinator ... → expected "commitDelegatedCutover" to be called
  1 times, but got 0 times
✓ an ordinary (non-delegated) request never touches the coordinator
✕ a coordinator rejection through the real path holds the workload
  (createAgentSession rejects) → promise resolved "{ disposition: 'created', ...}"
  instead of rejecting
Test Files  1 failed (1)   Tests  2 failed | 1 passed (3)
```

Both failures are caused by the missing production wiring (coordinator never
invoked), not by test setup: the first fails on invocation count == 0; the
second fails because a forced `mockRejectedValue` on `commitDelegatedCutover`
never has a chance to fire, since the real callback that would call it is
never reached — the operation instead resolves via the unrelated native
success path. The native positive control passes at RED, proving the harness
itself is sound.

**Verdict: genuine RED, confirmed independently.**

## 4. RED → GREEN test integrity

Diffed the test file across `5c75a7db` → `326b11e4` directly (not narrative).
RED had 3 tests; GREEN has 4. The only substantive change:

- **Test 3** ("a coordinator rejection ... holds the workload"): at RED the
  fence was deliberately left un-seeded, on the stated theory that
  `establishReservation` would fail closed for an ineligible run. In fact
  (confirmed by direct reproduction, §3) that theory was never realized: at
  RED, `establishReservation` was not wired into production *at all* — the
  scenario "passed" this test's actual failure only by accident, resolving
  successfully rather than reaching either the reservation or commit steps.
  GREEN seeds the fence eligible so the test reaches and exercises the real
  commit-rejection path it names. **The assertions themselves
  (`rejects.toThrow()`, `commitSpy` called once) are byte-unchanged** — only
  the fixture setup changed, to actually reach the code path the test's own
  name and prior comment already claimed to test.
  Classification: **`TEST_HARNESS_ADAPTATION`**.
- **Test 4** (new): "a fence rejection through the real path never reaches
  `commitDelegatedCutover`" — covers exactly the scenario Test 3's original
  (RED) setup *thought* it was covering (ineligible fence -> fail closed
  before commit), now as its own explicit assertion
  (`commitSpy` not called). Classification: **`ADDITIONAL_NON_LOAD_BEARING_COVERAGE`**
  in the review's required taxonomy, though it is the test that proves the
  frozen `eligibility -> fence -> reservation -> prepare` ordering survives
  in the real call graph, which is meaningfully load-bearing for Gate-31-
  adjacent claims even if not for the site-5-wiring claim itself.

**Zero `TEST_WEAKENING` found.**

## 5. Real site #5 — central blocker

**Wired: YES.** Confirmed by direct read of `orca-runtime-create-agent-session.ts`
at `326b11e4`, not narrative:

```ts
onPtySpawnCommitted: delegatedCutover
  ? buildDelegatedCutoverSpawnCommitCallback({
      getCoordinator: () => this.getDelegatedCutoverCoordinator(),
      aicontrolRunId: delegatedCutover.aicontrolRunId,
      fenceToken: delegatedCutover.fenceToken,
      correlationId: executionOperationId,
      orcaDispatchId: operationHandle,
      preparedProcessIdentityCapture,
      onCommitSucceeded: () => { retainReplayFence = true }
    })
  : () => { retainReplayFence = true }
```

Real call trace, confirmed by reading each hop (not assumed): `createAgentSession`
constructs this closure → passed as `onPtySpawnCommitted` through
`createTerminal` → `buildRuntimePtySpawnOptions`/`RuntimePtySpawnArgs` →
`LocalPtyProvider.spawn` → `spawnLocalPty` (`local-pty-spawn.ts:118-119`,
`await args.onPtySpawnCommitted()`) → the closure body in
`orca-runtime-delegated-cutover-callback.ts` → `getCoordinator().commitDelegatedCutover(...)`.
No test-harness-only hop in this chain; the same chain is exercised end-to-end
by the real (non-mocked, `LocalPtyProvider.spawn`-based) focused test (§9).

**Scope correction to the mission's framing:** the blocker was not closable
by wiring `commitDelegatedCutover` alone. `createAgentSession` now also calls
`this.getDelegatedCutoverCoordinator().establishReservation(...)` once,
before `createTerminal`, because `delegation_cutover.correlation_id`
references `run_reservation` by foreign key and `establishReservation` had
**zero** production callers before this commit either — the whole delegated
branch was previously dead code, not just its final step. This is a
necessary consequence of closing the named blocker correctly (the frozen
`eligibility -> fence -> reservation -> prepare` ordering requires it), not
an unrelated scope addition — `establishReservation`'s own body, ordering,
and idempotency are unmodified (confirmed: file not in the diff).

**Verdict: Gate 31's real-call-graph requirement is met.**

## 6. Helper extraction

`orca-runtime-delegated-cutover-callback.ts` (new, 76 lines): calls
`args.getCoordinator().commitDelegatedCutover(...)` and
`captureOsStartMarkerSync(pid)`; does not touch a database, does not
implement fence/reservation/transaction logic, does not duplicate coordinator
logic. It exists to keep `orca-runtime-create-agent-session.ts` under the
project's 300-line `max-lines` ratchet (see §14 for a caveat: the sibling
file this same commit touched, `orca-runtime-create-terminal.ts`, was **not**
kept under that limit). Coordinator remains the sole authority for commit.

**Verdict: readability/composition helper only, not a second authority owner.**

## 7. Native path

Structural trace + test (§9 "ordinary request" case, passing both at RED and
GREEN): when `request.delegatedCutover` is absent, `preparedProcessIdentityCapture`
is `undefined`, the spread that adds `deferDelegatedCommandDelivery`/
`preparedDelegatedProcessIdentityCapture` to spawn options contributes
nothing, `establishReservation` is never called (guarded by
`if (delegatedCutover)`), and `onPtySpawnCommitted` falls back to the
byte-identical `() => { retainReplayFence = true }` that existed before this
fix. No new awaited boundary is introduced on this path.

**Verdict: native semantics preserved, coordinator call count 0.**

## 8/9. Delegated success and rejection paths

Confirmed directly in `local-pty-spawn.ts`: `preparedDelegatedProcessIdentityCapture.current`
is populated with the real `spawnResult.process.pid` immediately before
`await args.onPtySpawnCommitted()` (line ~111-119), and `activateLocalPtySession`
(the call that wires up the exit listener and shell-ready-gated command
delivery — i.e., workload release) is only reached **after** that await
resolves (line 142, later in the same function; a rejection there propagates
out of `spawnLocalPty` and is never reached). Combined with the real
end-to-end test run (§9 below): coordinator success -> `onCommitSucceeded()`
sets `retainReplayFence = true` -> release proceeds; coordinator rejection
-> the callback's `await` throws before `onCommitSucceeded()` runs ->
rejection propagates through `spawnLocalPty` -> `createAgentSession` itself
rejects, exactly as required.

Ran the real (non-mocked-coordinator-call-path) focused test file at
`326b11e4`:

```
✓ a real delegated request causes the real site #5 callback to invoke the
  real coordinator with the real spawned process identity
✓ an ordinary (non-delegated) request never touches the coordinator
✓ a coordinator rejection through the real path holds the workload
  (createAgentSession rejects)
✓ a fence rejection through the real path never reaches commitDelegatedCutover
Test Files  1 passed (1)   Tests  4 passed (4)
```

**Verdict: both paths hold; commit-before-release proven through the real
composition, not merely the isolated coordinator unit tests.**

## 10-13. Process identity

`processIdentity` sent to `commitDelegatedCutover` = `{ pid, killScope,
osStartMarker, osStartMarkerSource, ... }`, where `pid` is
`preparedProcessIdentityCapture.current.pid` — the exact value
`local-pty-spawn.ts` wrote from `spawnResult.process.pid` at the real spawn.
`captureOsStartMarkerSync(pid)` is called on that **same** pid variable,
immediately (same synchronous/microtask window `onPtySpawnCommitted` already
fired in pre-fix, for the native path) — no alternate pid source, no second
identity reconstructed elsewhere. `captureOsStartMarkerSync` itself is
verbatim reuse of the pre-existing, already-accepted ORCA-S4 primitive
(`process-instance-discriminator.ts`, not modified by this diff) — ORCA-S4's
own accepted semantics apply unchanged: on failure it degrades to
`{ osStartMarker: null, osStartMarkerSource: 'unavailable' }` rather than
throwing; it does not fail-closed by aborting the cutover itself. That is
inherited, pre-existing S4 behavior, not something this focused fix newly
introduced or altered.

`PreparedDelegatedProcessIdentityCapture = { current?: { pid: number } }`
(`pty-provider-contract.ts`) carries **only** a raw pid. Confirmed by reading
every file that imports the type (`providers/types.ts`, `local-pty-spawn.ts`,
`spawn-state.ts`, `spawn-options.ts`, `runtime-pty-controller-contract.ts`,
`runtime-terminal-contracts.ts`, `orca-runtime-create-terminal.ts`): none of
them import from `execution/*` or reference `aicontrolRunId`/`fenceToken`/
delegation or authority state. `local-pty-spawn.ts` writes to `.current` and
never reads it back.

One field is worth flagging precisely rather than glossing: the callback also
sets `processIdentity.orcaRunId: args.correlationId` to satisfy the
coordinator's required input shape. Read the coordinator
(`orca-runtime-delegated-cutover-coordinator.ts`, unmodified by this diff):
it prefers `reservation?.orcaRunId ?? input.processIdentity?.orcaRunId` — the
authoritative value is read back from the durable `run_reservation` row
`establishReservation` wrote; `processIdentity.orcaRunId` is only a fallback
that is not exercised in the normal path. Not a new defect; pre-existing,
unmodified coordinator logic.

**Verdict: no `DELEGATED_PROCESS_IDENTITY_NOT_STABLY_BOUND`, no second
identity, provider boundary stays authority-neutral.**

## 14. Provider/PTy boundary

Read every changed file under `providers/` and the pty contract types
directly (not just names): `pty-provider-contract.ts`, `providers/types.ts`,
`local-pty-spawn.ts` import only the plain `{ current?: { pid } }` box type.
No import of aiControl/fence/`delegation_cutover`/Execution-store types
anywhere in `providers/`. Dependency direction preserved.

## 15-17. Callback signature, isolation, fire-once

`onPtySpawnCommitted`'s own type was not touched by this diff (absent from
the file's diff hunk in `pty-provider-contract.ts` — only the new sibling
field was added) — confirmed byte-unchanged. The identity-capture box
(`preparedProcessIdentityCapture`) is declared with `const` **inside**
`createAgentSession`'s method body, one instance per invocation, the same
scope `retainReplayFence` itself already uses (`let retainReplayFence = false`,
line 111, inside the method) — this is standard per-call JS closure scoping,
not a module-level or class-level singleton, so no cross-session
contamination is structurally possible. This was verified by direct code
reading; no new concurrent-session diagnostic test was written for this
review (writing new test code is out of this rereview's explicit scope).
`onPtySpawnCommitted`'s call site and calling convention in
`local-pty-spawn.ts` are otherwise unmodified around this addition, so
fire-once/reentry semantics are inherited unchanged.

## 18/19. `retainReplayFence` ordering / commit-before-release

Native path: unchanged, synchronous `() => { retainReplayFence = true }`.
Delegated path: `retainReplayFence = true` is set **only** inside
`onCommitSucceeded`, called only after `await ...commitDelegatedCutover(...)`
resolves. A rejection throws before that line executes, so
`retainReplayFence` stays `false` and the pre-existing (unmodified)
`isAgentSessionOperationOutcomeUnknown` catch block covers both paths
identically. No path exists where a failed cutover leaves
`retainReplayFence` set.

## 20. Existing coordinator/schema/store reuse

`git diff 5c75a7db 326b11e4 -- src/main/execution/application src/main/execution/infrastructure src/main/runtime/orca-runtime-delegated-cutover-coordinator.ts`
is empty. Zero semantic diff, confirmed by the diff tool itself, not by
narrative.

## 21. RealDelegatedProcessPort

`grep -rn RealDelegatedProcessPort src` finds it only in prose (`SPEC.md`,
evidence/discovery `.md` files, and one stale code *comment* in
`orca-runtime-delegated-cutover-coordinator.ts` that still describes real
identity as "deferred" — that file was not touched by this fix, so the
comment is now stale but is a pre-existing artifact, not something this
diff introduced or is required to fix). No `.ts` type, class, or interface
named `RealDelegatedProcessPort` exists anywhere in the tree.

**Classification: `NOT_REQUIRED_FOR_THIS_FIX`**, confirmed by source, not
absence-of-evidence. The chosen narrow transport
(`PreparedDelegatedProcessIdentityCapture`) does not accidentally grow into
a competing port: it has exactly one field, is written once, read once, and
carries no methods.

## 22. Gate 31

Real call-site assertion through local provider -> `local-pty-spawn.ts:89/118-119`
-> the real closure -> `commitDelegatedCutover` is now proven (§5, §9), not
merely structurally inspected. **Gate 31 composition blocker: CLOSED.** This
does not, by itself, mark every gate whose acceptance depended on Gate 31 as
fully and independently reproven end-to-end in this session — see §23.

## 23. Other composition-implicated gates (4-9, 38-40, 50, 51, 54)

This rereview did not re-derive full technical proof for each numbered gate
individually — that would repeat the full Cutover-Core acceptance the
mission explicitly says not to redo. What this session can state precisely:
the real production call graph these gates depend on (site #5 actually
reaching the coordinator, in both directions — success and rejection — with
the frozen ordering intact) is now real and independently exercised (§5, §9,
§18/19), where before it was unreachable. That closes the **composition**
precondition those gates share. Classify as
**`COMPOSITION_BLOCKER_CLOSED`** for all of them; none should be read as
**`FULL_GATE_TECHNICALLY_PROVEN`** (e.g. crash/restart recovery gates) purely
because site #5 is now wired — this session did not independently re-drive
crash/restart scenarios through the real graph.

## 24. Async-late residual

Read `orca-runtime-delegated-cutover-callback.ts` directly: it calls the
coordinator exactly once, does not capture or reference
`createAsyncSpawnCommitReporter`'s own reporter, and does not schedule any
reentry into itself. `delegated-cutover-async-residual-positive-control.test.ts`
(still passing, §25) continues to model this exact shape.

**`ASYNC_LATE_SELF_DEPENDENCY` remains
`UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL`**, now
confirmed against the real, wired closure rather than a proxy for one.

## 25. Cutover-Core tests

```
pnpm exec vitest run src/main/execution/slices/orca-delegated-cutover
Test Files  10 passed (10)
     Tests  46 passed (46)
```

The 4 focused-composition tests are exactly the 4 in
`delegated-cutover-real-site5-composition.test.ts` (§9).

## 26. PRE_IMPLEMENTATION-adjacent regression

No suite in this repository is literally named "PRE_IMPLEMENTATION" (grepped;
no match). Interpreting this as the pre-existing deferred-command-delivery /
capability-gate work this fix's `deferDelegatedCommandDelivery`/
`preparedDelegatedProcessIdentityCapture` threading runs through (the fields
this diff threads were already defined pre-fix; this diff is their first real
production caller):

```
pnpm exec vitest run src/main/providers/local-pty-provider-delegated-command-delivery.test.ts \
  src/main/ipc/pty/runtime/spawn-options-delegated-cutover-capability-gate.test.ts
Test Files  2 passed (2)   Tests  12 passed (12)
```

both fully green. Whether this matches the mission's specific "7 files, 38
tests" figure could not be independently confirmed — no artifact in this
tree names that exact set. This is reported as a gap, not papered over.

## 27. `src/main/execution` scope (candidate's claimed "82 files / 510 tests")

```
pnpm exec vitest run src/main/execution
Test Files  80 passed | 2 skipped (82)
     Tests  499 passed | 11 skipped (510)
```

Exact match to the candidate's claimed figures. Zero failures.

## 28. `src/main/runtime` + `src/main/providers` + `src/main/ipc/pty` scope

```
pnpm exec vitest run src/main/runtime src/main/providers src/main/ipc/pty
Test Files  15 failed | 864 passed | 5 skipped (884)
     Tests  30 failed | 8826 passed | 67 skipped (8929)
Duration  332.88s
```

Exact match to the candidate's claimed baseline figures (15/864/5 files,
30/8826/67 tests). Per this review's own instruction not to rely on count
equality alone, this was verified at the **failure-identity level, against
a real pre-fix baseline this session generated itself** (not against the
candidate's own narrative): the same suite was re-run at
`67a36218c548d38fd929d7003e728a7983462803` (the commit immediately before
this focused RED/GREEN pair even started). Result: **identical** — 15 failed
/ 864 passed / 5 skipped files, 30 failed / 8826 passed / 67 skipped tests,
and the individual failing-test list (extracted from both full logs) is
**the same 30 test names in the same 15 files** at both commits, byte-for-byte:
`pty-daemon-spawn-wsl-runtime.test.ts`, `pty-login-shell-startup-commands.test.ts`
(×2), `pty-wsl-cwd-validation.test.ts`, `local-pty-shell-ready-wrapper-generation.test.ts`,
`local-pty-shell-startup-command.node-pty.test.ts`,
`agent-session-claim-identity.test.ts`, `exit-provenance-audit.test.ts` (×9),
`orca-runtime-files-terminal-artifact-grants.test.ts` (×2),
`orca-runtime-files-terminal-artifact-io.test.ts` (×2),
`orca-runtime-files-terminal-link-host-translation.test.ts`,
`ai-vault.test.ts` (×2), `runtime-extraction-regressions.test.ts`,
`runtime-skill-install-queries.test.ts`,
`structured-agent-session-integration.test.ts`,
`structured-worker-child-identity-env.test.ts` (×3). None of these files are
in this fix's changed-file set (§2). **Zero new failures attributable to
this fix — confirmed by direct pre/post diff, not by trusting a cited
baseline number.**

Correction to the candidate's own evidence doc: its claim that "every
failure is the same known Windows path-separator... family issue in
`structured-worker-child-identity-env.test.ts` and `ai-vault.test.ts`" is
**inaccurate as a description of the failure set** — the real pre-existing
baseline spans 15 files across symlink-artifact handling, exit-provenance
audit, WSL/login-shell spawn, skill-config discovery, and structured-session
integration, not just two path-separator files. The evidence doc's
bottom-line conclusion ("zero new failures") is correct, but was
under-substantiated in the doc itself and is only now independently proven
by this rereview's own pre-fix/post-fix comparison.

## 29. 19-site propagation graph

`onPtySpawnCommitted`'s signature is unchanged (§15/16). The only new
plumbing is the additive, optional `preparedDelegatedProcessIdentityCapture`
field, threaded through the same object chain the callback field already
uses. Since the callback type itself did not change, this is **not** a
19-site rewrite — it is a 0-site signature change plus additive field
threading through the object types already in that chain. Stated precisely
per this review's own instruction not to mechanically claim a full rewrite.

## 30. Typecheck / lint

`tsc --noEmit -p config/tsconfig.node.json`: **clean**, zero output.

`oxlint` on the exact changed-file set: **one real, reproducible error**:

```
src/main/runtime/orca-runtime-create-terminal.ts:309:2: error eslint(max-lines):
File has too many lines (303). help: Maximum allowed is 300.
```

Checked whether this predates the fix: at `5c75a7db` (focused RED, i.e.
before this diff touched the file) the file was already 305 lines — already
over the 300-line ratchet. This diff adds 4 lines, taking it to 309. **This
is a pre-existing violation this fix makes marginally worse, not one it
introduces from a clean baseline** — but the fix's own evidence document
(`CUTOVER-CORE-SITE5-COMPOSITION-FIX-EVIDENCE.md` §11) explicitly claims
*"`oxlint`: clean, including the `max-lines` ratchet (no disable added — ...
`orca-runtime-create-terminal.ts`'s one-field threading addition was
compacted onto fewer lines for the same reason — no behavior change either
way)."* That specific claim is **false**, independently verified by running
oxlint directly. No `eslint-disable`/`oxlint-disable` comment was added
(confirmed by grep) — the ratchet was not defeated by suppression, only by
the file staying over its limit while the evidence record claims otherwise.

No `any` escape, `@ts-ignore`, or `@ts-expect-error` found in the two new/
changed runtime files inspected directly
(`orca-runtime-delegated-cutover-callback.ts`,
`orca-runtime-create-agent-session.ts`'s changed hunk). All new async calls
in the diff (`establishReservation`, `commitDelegatedCutover`) are awaited;
no floating promise found in the changed hunks.

## 31. Frozen artifacts

```
git diff --stat 67a36218 326b11e4 -- '**/SPEC.md' '**/SPEC-STATUS-RATIFICATION-001.md' \
  '**/CUTOVER-CORE-RED-EVIDENCE.md' '**/CUTOVER-CORE-GREEN-EVIDENCE.md' '**/ARCHITECTURE*.md'
```
empty. Zero changes across the entire RED-to-GREEN span. The only new
Markdown is `CUTOVER-CORE-SITE5-COMPOSITION-FIX-EVIDENCE.md`, a new/separate
evidence record.

## 32. Scope audit

Changed-file set (§2) contains no terminal-projection, terminal-lifecycle,
real-aiControl-HTTP-adapter, R3, fallback, or M5 code. Fence port default
remains `createFailClosedAiControlFenceClientPort()`
(`orca-runtime-delegated-cutover-coordinator.ts`, unmodified) — wiring this
coordinator into the real call graph does not, by itself, enable live
delegation for any real session.

## 33. aiControl guard

**Not independently verifiable from this workspace.** This Maestro checkout
has no `data/app.db` file at all, and no cached `origin/master`
remote-tracking ref (`git rev-parse origin/master` fails: "unknown
revision"). The `origin` remote here is `henriquesara/maestro`; `upstream` is
`stablyai/orca`. Whatever SHA/DB-hash pair the mission names appears to
belong to a separate "aiControl" repository/checkout not present in this
worktree or its reachable remotes. This review performed zero writes to any
`.db`/`-wal`/`-shm`/journal file in the Maestro repository at any point
(confirmed: only the two test-run-generated side effects noted below, both
reverted). **Classification: `UNABLE_TO_VERIFY_FROM_THIS_WORKTREE`** — not
a pass, not a fail, a genuine scope gap that should not be silently
converted into a pass.

Two incidental worktree mutations were produced by running the broader
`src/main/execution` suite (test-generated evidence-bundle/snapshot
regeneration, unrelated to Cutover-Core): both were reverted with
`git checkout --` before finishing; the worktree is clean at HEAD =
`326b11e4fc973afa7e23d03a1f0d310933915cd1` with zero net changes.

## 34. Authority / operational state

Unchanged by this review, before and after: Authority `AICONTROL_NATIVE`;
`ORCA_DELEGATED` NOT STARTED; fence acquisition DISABLED; R3 NOT STARTED; M5
NOT STARTED. This review made no code changes and performed no live fence
acquisition.

---

## Summary of findings

1. **Composition blocker: CLOSED.** Real site #5 now branches on
   `request.delegatedCutover` and reaches `commitDelegatedCutover` through
   the unmodified real provider chain, proven by a real (non-isolated) test
   and by direct code trace (§5, §9, §22).
2. **Scope note (not a blocker):** closing the blocker required also wiring
   `establishReservation` (previously also zero production callers), not
   `commitDelegatedCutover` alone. Necessary, not expansion (§5).
3. **Test integrity: clean.** Zero `TEST_WEAKENING`; the one changed
   assertion setup is a legitimate `TEST_HARNESS_ADAPTATION`, and the
   original ambiguity it fixed is now split into two explicit tests (§4).
4. **Process identity: stably bound, single source, authority-neutral
   transport, no new blocker** (§10-14).
5. **Regression: zero new failures**, independently reproduced, including
   failure-identity-level (not just count-level) comparison for the large
   runtime/providers/pty suite (§27-29).
6. **One independently confirmed, real defect**: `orca-runtime-create-terminal.ts`
   exceeds the project's `max-lines` ratchet (309 vs. 300; pre-existing at
   305 before this diff, worsened by +4 lines here), and this fix's own
   evidence document falsely claims `oxlint` is clean for that exact file
   (§30). This is real and reproducible, not a nitpick, but it is (a) a
   pre-existing violation this diff did not create from a clean baseline,
   and (b) purely mechanical (delete/compact ~9 non-comment/blank lines),
   not a correctness or composition defect.
7. **One unverifiable section**, not converted to a pass: the aiControl
   guard (origin SHA / `app.db` hash) names artifacts this Maestro worktree
   does not contain (§33).

Correction to item 6's fix-size estimate: oxlint's `max-lines` rule counts
non-blank/non-comment lines only and reports the file at 303 against a
limit of 300 — i.e. at least 4 non-comment/blank lines need to come out
(not ~9; the file's raw `wc -l` of 309 includes blank/comment lines the
rule itself already excludes).

## Verdict

```
state_class: BLOCKERS_FOUND
display_verdict: ORCA_S5_DELEGATED_CUTOVER_CORE_FOCUSED_FIX_BLOCKERS_FOUND
```

Reasoning: the composition blocker itself is genuinely closed and the
identity/ordering/regression story is sound — this is **not** a
`COMPOSITION_BLOCKER_REMAINS` or `PROCESS_IDENTITY_BLOCKER` verdict. But
mission §30's bar ("no lint findings" in the touched/adjacent code) is not
met: `oxlint` errors on `orca-runtime-create-terminal.ts` as this diff left
it, and the fix's own evidence record asserts the opposite. The fix is a
mechanical `max-lines` cleanup away (no logic change) from a clean accept;
this review does not perform that edit (out of scope — "do NOT edit code").

```
accepted_technical_head: NOT SET (blocker outstanding)
Previous composition blocker: CLOSED
Original isolated GREEN: SUPERSEDED AS TECHNICAL HEAD BY FOCUSED GREEN (pending lint fix)
Cutover-Core: COMPOSITION-COMPLETE, NOT YET TECHNICALLY ACCEPTED (lint gate outstanding)
Live ORCA_DELEGATED activation: NOT AUTHORIZED
Authority: AICONTROL_NATIVE
Fence acquisition: DISABLED
R3: NOT STARTED
M5: NOT STARTED
```
