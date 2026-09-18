# ORCA-S5 Delegated Cutover Core — Site #5 Composition Fix Evidence

> Focused fix only, addressing the sole blocker an independent acceptance
> review of `67a36218c548d38fd929d7003e728a7983462803` found
> (`BLOCKERS_FOUND` / `ORCA_S5_DELEGATED_CUTOVER_CORE_COMPOSITION_BLOCKER_FOUND`).
> Does not modify `CUTOVER-CORE-RED-EVIDENCE.md`, `CUTOVER-CORE-GREEN-EVIDENCE.md`,
> or any frozen architecture/review/ratification artifact — this is a new,
> separate evidence record, not a rewrite of prior history. No real fence
> acquisition, no `ORCA_DELEGATED` operational entry, no R3, no M5.

## 1. The blocker, restated

The independent review confirmed the real production site #5 closure in
`orca-runtime-create-agent-session.ts` was byte-identical to before RED/GREEN
— never conditioned on `request.delegatedCutover`, never calling
`this.getDelegatedCutoverCoordinator().commitDelegatedCutover(...)` — and
that `getDelegatedCutoverCoordinator` had **zero** production callers
anywhere in the repository. SPEC.md §4.8.4 and Gate 31 both require the real
call graph, not merely an isolated coordinator unit test.

## 2. Focused RED

Commit `5c75a7db28190654834dd36f8894f3dac88c9bb9` — one new test file,
`delegated-cutover-real-site5-composition.test.ts`. Drives the real
production path: `runtime.createAgentSession` (real, unmodified site #5
closure construction) → `LocalPtyProvider.spawn` (real) → `spawnLocalPty`
(real) → `onPtySpawnCommitted` (real invocation, at the real call site,
`local-pty-spawn.ts:89`) → site #5 closure body. Never constructs or calls
`DelegatedCutoverCoordinator` directly — spies on the same instance the real
closure would reach through `this`. `createTerminal` is stubbed to isolate
`createAgentSession`'s own real logic from the unrelated Electron-bound
`PtyRuntimeControllerDeps`/`BrowserWindow` IPC bootstrap
(`ipc/pty/register-handlers.ts`) — infrastructure this composition question
does not concern; the stub itself calls the real `LocalPtyProvider.spawn()`
with the real closure, unmodified.

**RED result (independently reproduced against `67a36218`):** 3 tests, 2
genuinely failed (`commitDelegatedCutover` called 0 times instead of 1; a
forced-rejection probe resolved instead of rejecting) — both solely because
production never wired the call. The third test (native, no
`delegatedCutover`) already passed against the same harness, proving the
harness itself was sound, not merely broken in a way that faked RED.

## 3. Minimal identity-threading design (mission §8/§9)

**Decision: widen a data field on `PtySpawnOptions`, not the
`onPtySpawnCommitted` callback's own signature.**

Rejected: widening the callback's arity (`() => T` → `(identity) => T`)
across all 19 accepted PRE_IMPLEMENTATION propagation sites. The two guard
layers (`createAsyncSpawnCommitReporter`, `createPtySpawnCommitReporter`)
and their fire-once/reentry-poisoning semantics are the most delicate,
heavily-proven part of the already-accepted seam (gates 44-49, 52, 55-63);
`stable-owner.ts`'s `onFreshSpawn` already aliases the SAME reporter
function with a *different* argument shape (`PtySpawnResult`), so widening
`onPtySpawnCommitted` itself risks either a real type-safety hole at that
alias or destabilizing the proven guard machinery for no necessary reason.

**Chosen instead:** `PreparedDelegatedProcessIdentityCapture = { current?:
{ pid: number } }` (`pty-provider-contract.ts`) — a plain, writable box,
threaded as an ordinary additive field alongside `onPtySpawnCommitted`
through the exact same real object chain that field already uses
(`RuntimeCreateAgentSessionRequest`'s closure scope → `TerminalCreateOptions`
→ `RuntimePtySpawnArgs` → `ctx.spawnOptions` → `PtySpawnOptions`). The real
spawn-commit site (`local-pty-spawn.ts:89`) populates `.current = { pid:
spawnResult.process.pid }` **immediately before** invoking
`onPtySpawnCommitted` — the exact real moment Gate 31/§4.8.6 name. The
callback's own signature, every guard layer, and all 19 accepted
propagation sites are **completely unmodified** — confirmed by the
PRE_IMPLEMENTATION regression (§7 below) and by `tsc --noEmit` finding zero
new errors anywhere in that call graph.

**Provider-boundary legality (mission §8):** the box carries only a raw
`pid` (`number`) — no aiControl run ID, no fence token, no Execution-domain
object. `local-pty-spawn.ts` (a `providers/` file) never imports from
`execution/*`; it writes a plain number into a box it never reads back.

## 4. RealDelegatedProcessPort non-requirement (mission §5/§9)

Confirmed by direct inspection this session: `spawnResult.process.pid` (real
`node-pty` `IPty.pid`) is synchronously available at
`local-pty-spawn.ts:89`, before any port abstraction is needed. The
production closure (`orca-runtime-delegated-cutover-callback.ts`) resolves
the *rest* of the real, stable identity —
`osStartMarker`/`osStartMarkerSource` — via
`captureOsStartMarkerSync(pid)`, the exact same real, already-shipping,
already-tested primitive ORCA-S4 uses (`execution/infrastructure/process-instance-discriminator.ts`)
— called from the `runtime/` layer, which already legally imports from
`execution/*` (unlike `providers/`). No `RealDelegatedProcessPort`
adapter/interface was created; no `ShadowLifecycleProcessPort` conformance
work was attempted — this fix needed only to *transport* identity, and the
real primitive that resolves the rest of it already existed. No
`FROZEN_ARCHITECTURE_IMPLEMENTATION_CONTRADICTION` was encountered.

## 5. Reservation-step wiring (scope note)

Making the site #5 commit call **actually succeed** for any real caller
required also wiring the coordinator's *already-existing, unmodified*
`establishReservation` (SPEC §5.2 S1→S2) into `createAgentSession`, called
once, strictly before `createTerminal` (before any process is prepared) —
confirmed necessary by a genuine `FOREIGN KEY constraint failed` the first
GREEN attempt hit (`delegation_cutover.correlation_id REFERENCES
run_reservation`, no prior write). This is not a coordinator semantics
change (mission §16) — `establishReservation`'s own ordering, idempotency,
and fence logic are untouched; only one new, legitimate production caller
was added. `providerEligible` reuses `isRemote` (`Boolean(workspace.connectionId)`),
a value `createAgentSession` already computes — local-only per this slice's
frozen scope (Gate 53); the authoritative `supportsDelegatedCutoverHold`
capability gate still independently enforces this downstream, unchanged, in
`buildRuntimePtySpawnOptions`.

## 6. `retainReplayFence` (mission §12)

Derived from the real code, not guessed: `retainReplayFence`'s sole purpose
(per its own existing comment) is "the first PTY may still be alive; replay
the same failure until expiry instead of interpreting a lost outcome as a
fresh spawn grant" — i.e., protect against double-spawn once a real process
exists. **Classification C** applies: for the delegated path, it is set
**after** `commitDelegatedCutover` succeeds (a real, durably-bound process
now exists — same reasoning as the native path's own `onPtySpawnCommitted`
firing). The pre-existing `catch` block (`isAgentSessionOperationOutcomeUnknown`,
unmodified) already covers both paths identically. No normative ambiguity
found; no `FROZEN_ARCHITECTURE_CONTRADICTION`.

## 7. GREEN result

```
pnpm test src/main/execution/slices/orca-delegated-cutover/delegated-cutover-real-site5-composition.test.ts
```

**4 tests, all pass** (one test-authoring correction made per mission §29 —
see §9 below; one new test added, §5's rejection-vs-fail-closed distinction
made two independently-meaningful tests instead of one conflated one).

**Native positive control** (no `delegatedCutover`): `commitDelegatedCutover`
never called, `disposition: 'created'`, unaffected.

**Coordinator-rejection-holds-workload probe:** `commitDelegatedCutover`
mocked to reject → `createAgentSession` itself rejects (the real deferred
await in `spawnLocalPty` propagates it) — workload never released.

**Fence-rejection-fails-closed-before-prepare probe:** an ineligible fence
→ `establishReservation` rejects → `createAgentSession` rejects →
`commitDelegatedCutover` **never called** — proves the frozen ordering
(eligibility → fence → reservation → prepare) holds in the real path, not
merely in isolation.

**Exact process identity:** the committed `processIdentity.pid` is the real
`spawnMock`-produced `12345`, threaded end-to-end through the capture box —
confirmed by direct assertion in the first (primary) test.

## 8. Existing coordinator reuse proof (mission §16)

`git diff` of this fix touches zero files under
`src/main/execution/application/`, `src/main/execution/infrastructure/`
(other than the pre-existing, unmodified `process-instance-discriminator.ts`
being *imported*, not edited), or `src/main/runtime/orca-runtime-delegated-cutover-coordinator.ts`.
`establishReservation` and `commitDelegatedCutover`'s own bodies are
byte-identical to `67a36218`.

## 9. Test-authoring correction (mission §29)

The rejection-probe test's first draft left the fence unseeded (expecting
rejection to surface at the commit step) — once the reservation step was
wired (§5), that scenario correctly fails closed **earlier**, at
`establishReservation`, before any process is ever prepared, so
`commitDelegatedCutover` is never reached. This is the **correct** behavior
per the frozen ordering, not a test bug in the old sense. Classified
`TEST_HARNESS_CORRECTION`: the original test was split into two — one
seeding the fence eligible and rejecting at the commit step specifically
(exercising §5/§6 of the mission), one deliberately leaving the fence
ineligible and asserting `commitDelegatedCutover` is never reached
(exercising the ordering claim itself). Neither assertion was weakened;
both are load-bearing and independently meaningful.

## 10. Async-late residual (mission §20)

The real delegated closure (`orca-runtime-delegated-cutover-callback.ts`)
calls the coordinator exactly once, does not capture its own spawn-commit
reporter, and does not re-enter it — confirmed by direct code inspection
(no reference to `reportPtySpawnCommitted`/the guard's own return value
anywhere in the new closure) and by the unaffected
`delegated-cutover-async-residual-positive-control.test.ts` (still passing,
§11 below) continuing to model this exact real shape.
`ASYNC_LATE_SELF_DEPENDENCY` remains
`UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL`, now
genuinely proven against the real, wired production closure, not merely a
proxy for one.

## 11. Regression

- **Existing 46 Cutover-Core tests** (10 files, includes the two prior RED
  and GREEN sessions' work, unmodified): all pass.
- **New focused-fix tests:** 4/4 pass (§7).
- **PRE_IMPLEMENTATION baseline:** 7 files, 38 tests, unchanged, all pass —
  independently rerun after both the identity-capture-box threading and the
  `orca-runtime-create-agent-session.ts`/`orca-runtime-create-terminal.ts`
  max-lines refactor (§12).
- **`src/main/execution` scoped suite:** 82 files, 510 tests, all pass.
- **`src/main/runtime` + `src/main/providers` + `src/main/ipc/pty` scoped
  suite:** 15 failed / 864 passed / 5 skipped files, 30 failed / 8826
  passed / 67 skipped tests — **byte-identical** to the pre-existing
  historical baseline (re-verified failure identities, not counts alone:
  every failure is the same known Windows path-separator (`;` vs `:`, `\`
  vs `/`) family issue in `structured-worker-child-identity-env.test.ts`
  and `ai-vault.test.ts`, none referencing `delegated-cutover`, this
  session's changed files, or any code this fix touched). **Zero new
  failures.**
- **`tsc --noEmit -p config/tsconfig.node.json`:** clean.
- **`oxlint`:** clean, including the `max-lines` ratchet (no disable added
  — `orca-runtime-create-agent-session.ts`'s delegated closure was
  extracted into a new, focused helper file,
  `orca-runtime-delegated-cutover-callback.ts`, to stay under the limit;
  `orca-runtime-create-terminal.ts`'s one-field threading addition was
  compacted onto fewer lines for the same reason — no behavior change
  either way).

## 12. Changed files

New: `orca-runtime-delegated-cutover-callback.ts` (the real site #5
delegated closure body, extracted for the max-lines ratchet),
`delegated-cutover-real-site5-composition.test.ts` (focused RED/GREEN,
committed RED-first).

Modified (all additive, all confirmed non-breaking by §11):
`pty-provider-contract.ts`, `providers/types.ts` (barrel re-export),
`local-pty-spawn.ts`, `ipc/pty/runtime/spawn-state.ts`,
`ipc/pty/runtime/spawn-options.ts`, `runtime-pty-controller-contract.ts`,
`runtime-terminal-contracts.ts`, `orca-runtime-create-terminal.ts`,
`orca-runtime-create-agent-session.ts`.

## 13. Scope audit

No terminal projection, no terminal lifecycle redesign, no real aiControl
HTTP adapter, no R3, no fallback, no M5 — confirmed via the changed-file
list above (§12) and via `git diff --stat` containing none of those paths.

## 14. aiControl guard

`origin/master` = `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` (fresh
`git fetch`, matches). `data/app.db` SHA-256 =
`2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` (matches).
No `-wal`/`-shm`/journal. Zero writes at any point this session — every
touch was against the `mw-orca-s5-cutover-core-red` Maestro worktree only.

## 15. Authority / operational state

Before/after this fix: `AICONTROL_NATIVE`. `ORCA_DELEGATED`: NOT STARTED
operationally (disposable tests prove only a per-run durable classification
inside temp SQLite files, never a live authority switch). Fence
acquisition: DISABLED. R3: NOT STARTED. M5: NOT STARTED.
