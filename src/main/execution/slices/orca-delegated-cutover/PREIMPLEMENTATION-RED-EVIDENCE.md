# ORCA-S5 Pre-Implementation Seam — Genuine RED Evidence

> Session scope: **PRE_IMPLEMENTATION RED baseline only** for the frozen
> first sub-slice of `src/main/execution/slices/orca-delegated-cutover/SPEC.md`
> — Part A (`DELEGATED_DEFERRED_COMMAND_DELIVERY`, §4.1a) and Part B
> (`TRUE_ASYNC_SPAWN_COMMIT_PROPAGATION`, §4.5), per §18.1. No production
> code is implemented by this session. `ORCA_DELEGATED` remains `NOT
> STARTED`; fence acquisition remains disabled; M5 is untouched.
>
> **Completion round 2** (commit after `0a1bf4c2654ff9cb334c90b1f0ff7bd97e9d7492`):
> gate 60 was corrected from `LATER_SLICE_B` to genuine `PRE_IMPLEMENTATION`
> RED — it does not require the `delegation_cutover` table; it is provable
> at the runtime seam with a controllable injected Promise, exactly like
> gates 44-48. §4 and §5 below reflect the correction; all other sections
> are unchanged from round 1.

## 1. Pre-flight

- Canonical `origin/main` (fetched fresh this session): `7c1796e82c53de53f0a028123defbe53974eb652`.
- Frozen architecture HEAD: same commit — `7c1796e82c53de53f0a028123defbe53974eb652` (`orca-s5(architecture): third focused correction — complete async spawn-commit call graph`).
- Linear ancestry confirmed (`git log --oneline --graph`) from `9ba6ea5456` (orca-s4 red) through the five `orca-s5(architecture)` correction commits to the frozen HEAD: zero merge commits in that span.
- Fresh worktree created via the harness's native `EnterWorktree` at `.claude/worktrees/orca-s5-preimplementation-seam`, branch `worktree-orca-s5-preimplementation-seam`, HEAD verified `== 7c1796e82c53de53f0a028123defbe53974eb652`, working tree clean.
- `node_modules` linked as a junction to the main checkout's install, per this repository's own documented worktree convention (`.gitignore`'s node_modules comment).

## 2. Runtime re-derivation — independently traced, not grepped

Every file and line SPEC.md §4/§4.1/§4.1a/§4.5.1/§7.3 cites was read in full
this session and compared against the frozen text. Result: **zero drift**.
Every cited line number matches the real, current file exactly:

| File | Confirmed exact match |
| --- | --- |
| `runtime/orca-runtime-create-agent-session.ts` | lines 225-227 (`onPtySpawnCommitted: () => { retainReplayFence = true }`) |
| `runtime/orca-runtime-create-terminal.ts` | line 31 (guard construction), line 127 (`ptyController.spawn(...)`), lines 167-169 (threading), lines 175-177 (inner `finally`), lines 178-180 (outer call) |
| `runtime/orca-runtime-report-pty-spawn-commit.ts` | full file — `createPtySpawnCommitReporter`, exactly as described |
| `runtime/runtime-terminal-contracts.ts` | line 55 |
| `runtime/runtime-pty-controller-contract.ts` | line 71 |
| `ipc/pty/runtime/spawn-options.ts` | lines 59-66 (guard layer 2), lines 176-182 (threading), lines 152-166 (existing capability-check precedent) |
| `ipc/pty/runtime/spawn-state.ts` | line 80 (`reportPtySpawnCommitted` slot), line 115 (`onPtySpawnCommitted` arg), line 183 (default initializer) |
| `ipc/pty/runtime/spawn-execute.ts` | line 88 (site #16 direct call), line 148 (site #17 forwarding) |
| `ipc/pty/pane/stable-owner.ts` | line 169 (site #18 type), line 213-234 (`attachStablePaneOwner`, site #13 at line 233), line 302 (site #19) |
| `providers/local-pty-spawn.ts` | line 89 (site #12), line 111 (`activateLocalPtySession`) |
| `providers/local-pty-launch-plan.ts` | line 107 (`createWindowsLocalPtyLaunchPlan`), line 138 (`finish` closure), lines 159/177 (`args.command` sites), line 193 (`createLocalPtyLaunchPlan`), line 238 (delegation to Windows plan) |
| `providers/windows-shell-args.ts` | lines 82-96 (`getCmdShellArgStartupCommand`), lines 112-136 (`getPowerShellEncodedCommand`), line 176 (`resolveWindowsShellLaunchArgs`) |
| `providers/windows-shell-fallback-chain.ts` | line 55 (`buildWindowsPowerShellSpawnAttempts`) |
| `providers/local-pty-session-activation.ts` | line 126 (`proc.onExit`), lines 161-165 (delivery-gate condition), line 174 (`writeStartupCommandWhenShellReady` invocation) |
| `providers/pty-provider-contract.ts` | line 109 (`onPtySpawnCommitted`), lines 134/138 (`supportsAgentSessionClaims`/`supportsAgentSessionCreateOperations` precedent) |
| `providers/local-pty-provider.ts` | confirmed: declares neither `supportsAgentSessionClaims`, `supportsAgentSessionCreateOperations`, nor `supportsDelegatedCutoverHold` |

**Verdict: `PREIMPLEMENTATION_RUNTIME_DRIFT` does NOT apply.** No STOP condition triggered. Completeness of this trace was derived by following the logical operation (`onPtySpawnCommitted` → its aliases `reportPtySpawnCommitted`/`onFreshSpawn` → every type slot, wrapper, forwarder, invocation, stored guard, and default initializer that carries it), per §4.5.1a's own binding method — not by re-grepping the literal identifier `onPtySpawnCommitted` alone. This independently reproduces the frozen document's own 19-site count.

Two duplicate-named-but-distinct modules were found and correctly excluded from this seam's scope: `src/main/ipc/pty/ipc/{spawn-execute,spawn-options,spawn-state}.ts` are a separate, older, non-agent-session IPC handler layer (`executePtyIpcSpawn`/`PtyIpcSpawnState`), not the `runtime/` layer SPEC.md cites (`executeRuntimePtySpawn`/`RuntimePtySpawnState`). Not touched, not tested here — out of scope.

## 3. Baseline (existing tests, before adding RED)

Targeted subset (matches the files this seam touches):

```
pnpm vitest run --config config/vitest.config.ts \
  src/main/providers/local-pty-provider-windows-shell-launch.test.ts \
  src/main/providers/windows-shell-args.test.ts \
  src/main/providers/windows-shell-fallback-chain.test.ts \
  src/main/ipc/pty/runtime \
  src/main/ipc/pty/pane/stable-owner.test.ts \
  src/main/runtime/orca-runtime-create-terminal.test.ts \
  src/main/runtime/orca-runtime-create-agent-session.test.ts \
  src/main/runtime/orca-runtime-report-pty-spawn-commit.test.ts
```

Result: **5 test files, 56 tests, all passed.** (`stable-owner.test.ts`,
`orca-runtime-create-terminal.test.ts`, `orca-runtime-create-agent-session.test.ts`,
and `orca-runtime-report-pty-spawn-commit.test.ts` do not exist — confirmed
by glob search — meaning **none of the 19-site load-bearing files
(`spawn-execute.ts`, `spawn-options.ts`, `spawn-state.ts`, `stable-owner.ts`,
`orca-runtime-create-terminal.ts`, `orca-runtime-create-agent-session.ts`,
`orca-runtime-report-pty-spawn-commit.ts`) had any prior unit-test coverage
before this session.** This session's new RED files are therefore purely
additive; nothing pre-existing was at risk of being broken.

Broader regression check, `src/main/providers src/main/ipc/pty src/main/runtime`
(883 files with the 5 new RED files included; 878 without):

- **With** the 5 new RED files: 21 test files failed, 857 passed, 5 skipped
  (883 total); 47 tests failed, 8801 passed, 67 skipped (8921 total).
- **Without** them (`--exclude` on each of the 5 new paths, otherwise
  identical scope): **16 test files failed, 857 passed, 5 skipped (878
  total); 32 tests failed, 8797 passed, 67 skipped (8902 total).**

21 − 16 = 5 files and 47 − 32 = 15 tests — exactly the new RED files and
their genuine RED count from §4 below, no more and no less. **The 16
files / 32 tests that fail either way are pre-existing baseline failures,
unrelated to this session** (e.g. `src/main/runtime/rpc/methods/ai-vault.test.ts`
fails on a POSIX-vs-Windows path-separator assertion — `toContain('/ctor/codex/home/sessions')`
against a value containing `\ctor\codex\home\sessions` on this Windows
worktree — nothing to do with PTY spawn, delegated cutover, or any file this
session touched). Per this task's own instruction, these are **not** counted
as PRE_IMPLEMENTATION RED evidence.

## 4. New RED test files (this session, additive only)

| File | Area(s) | Gates | RED | Preserved (GREEN) |
| --- | --- | --- | --- | --- |
| `src/main/providers/local-pty-provider-delegated-command-delivery.test.ts` | A, B, N, O | 41, 42, 49, 55 | 3 | 1 (positive control: ordinary spawn keeps embedding argv) |
| `src/main/runtime/orca-runtime-report-pty-spawn-commit-async.test.ts` | E (guard layer 1) | 44, 45, 46, 47, 48, 61 | 4 | 1 (fire-once invocation count already correct) |
| `src/main/ipc/pty/runtime/spawn-options-commit-guard-async.test.ts` | E (guard layer 2) | 11, 44, 46, 48, 61 | 4 | 1 (fire-once invocation count already correct) |
| `src/main/ipc/pty/runtime/spawn-execute-commit-propagation.test.ts` | G, H, K, L, M | 47, 48, 57, 59, 61, 62 | 3 | 0 |
| `src/main/ipc/pty/runtime/spawn-options-delegated-cutover-capability-gate.test.ts` | D, P | 52 | 1 | 1 (documents `LocalPtyProvider` doesn't declare the capability either, yet) |
| `src/main/ipc/pty/runtime/spawn-execute-cross-alias-promise-convergence.test.ts` | I, J | 60 | 2 | 0 (underlying-invocation-count-stays-1 and site-#11-referential-equality are asserted as real preconditions *within* each RED test, not as a separate passing test — see §4a) |
| `src/main/execution/slices/orca-delegated-cutover/spawn-commit-type-conformance-red.ts` (type-checked only, `pnpm tc:node`) | E (type-level, sites #1/#2/#3/#4/#14/#18) | 44 (type half), 56 | 6 `@ts-expect-error` markers, all currently load-bearing (`pnpm tc:node` exits 0) | — |

**Total runtime RED: 17 failing assertions across 21 vitest tests (4 passing
positive controls), plus 6 load-bearing `@ts-expect-error` type-level RED
markers.**

### RED Area A — Windows argv must not embed the delegated command

`local-pty-provider-delegated-command-delivery.test.ts` exercises the REAL
`LocalPtyProvider.spawn()` → `createLocalPtyLaunchPlan` →
`createWindowsLocalPtyLaunchPlan` → `buildWindowsPowerShellSpawnAttempts` /
`resolveWindowsShellLaunchArgs` path (only `node-pty`/`fs`/`electron`/the
PowerShell-executable resolver are mocked, matching this repo's own
established convention in `local-pty-provider-windows-shell-launch.test.ts`,
the file SPEC.md itself cites for the real default path). A
`deferDelegatedCommandDelivery: true` option (forced via cast — it does not
exist on `PtySpawnOptions`) has **zero effect**: the marker command still
appears in the decoded `-EncodedCommand` payload for the real default
PowerShell path and in the `/K` argument for `cmd.exe`. Gate 55's explicit
requirement (real default path, not only a synthetic stdin path) is met: the
PowerShell test uses the product's real default shell family.

### RED Area B — native (non-delegated) behavior preserved

Same file's positive control proves an ordinary spawn (no
`deferDelegatedCommandDelivery`) still embeds its short startup command in
argv exactly as today — confirming the additive nature required by §4.1a.

### RED Area E — true async Promise propagation (both guard layers + type sites)

Three files cover this:
- `orca-runtime-report-pty-spawn-commit.ts` (guard layer 1, site #6) directly.
- `buildRuntimePtySpawnOptions` (guard layer 2, sites #10/#11) via a minimal
  real `RuntimePtySpawnState`.
- The type-conformance file for the six checkable declaration sites
  (#1/#2/#3/#4/#14/#18).

All prove the same four-part defect: (1) no Promise is returned at all; (2)
duplicate-while-in-flight cannot return the same Promise because there is no
Promise; (3) a caller cannot observe genuine settlement timing; (4) a
rejection is silently discarded rather than surfaced. The fire-once
**invocation count** (not the async contract) is independently confirmed
already correct today at both guard layers — labeled honestly as GREEN, not
re-claimed as RED.

**Type-checking discovery worth recording:** a `() => void`-typed slot is
structurally permissive in TypeScript — assigning an async callback to it
type-checks today (over-returning callbacks are allowed). This means gate
44's "type-level test" cannot be built as "assigning an async callback is a
type error" (it isn't). The genuine, demonstrable type-level fact is the
reverse: the *call site's* return value is typed `void`, so no caller can
treat it as awaitable — that is what the six `@ts-expect-error` markers
prove. This also explains why the underlying bug is invisible to `tsc`
alone and is fundamentally a runtime propagation defect, matching gate 44's
own two-part structure (type-level *plus* runtime).

### RED Area G/H — direct and forwarded calls to guard layer 2

`spawn-execute-commit-propagation.test.ts` exercises the real
`executeRuntimePtySpawn` (site #16, `agentSessionEnsure` branch — only the
stateful `agentSessionOwners` registry singleton is mocked) and the real
`spawnForStablePane`/`attachStablePaneOwner` from `stable-owner.ts` (sites
#17/#19, non-`agentSessionEnsure` branch — no mocking beyond a stub
provider). Both prove `executeRuntimePtySpawn`'s own returned Promise
resolves **before** an injected, still-pending "durable commit" Promise
settles (detected via a macrotask-boundary flush, not a fixed microtask-tick
count, per this task's own instruction to avoid timing-dependent RED). A
third test proves a rejection from the guarded callback does not propagate
as a thrown error from `executeRuntimePtySpawn` at all — the flow completes
as if nothing failed.

### RED Area D/P — provider eligibility gate

`spawn-options-delegated-cutover-capability-gate.test.ts` proves
`buildRuntimePtySpawnOptions` never rejects a provider lacking
`supportsDelegatedCutoverHold` — the capability and the check are both
absent from the repository today (confirmed by symbol search during §2's
re-derivation). A positive-control test also documents that `LocalPtyProvider`
itself — this slice's only intended-eligible provider — does not declare the
capability yet either, so implementing §7.3 correctly requires adding the
declaration to `LocalPtyProvider`, not only the gate check.

### RED Area I/J (round 2) — cross-alias Promise convergence, gate 60

**Corrected this round.** Round 1 classified gate 60 `LATER_SLICE_B`,
reasoning that no site carries a Promise today so there was "nothing to
compare identity of." That reasoning conflated *"the current values happen
to both be `undefined`"* with *"there is no contract to violate."* The
frozen contract (§4.5.1a's closing paragraph) is precisely that every real
alias reading back guard layer 2 must observe the same in-flight
operation — and that is independently testable today with an injected
deferred Promise at the real `args.onPtySpawnCommitted` seam, exactly like
gates 44-48. No `delegation_cutover` storage is needed: the "durable
operation" gate 60 cares about is the *logical* commit operation guard
layer 2 wraps, not its eventual SQL persistence — persistence is a
downstream consumer of the same Promise, not a precondition for testing
that the Promise itself converges.

`spawn-execute-cross-alias-promise-convergence.test.ts` crosses **two
different real, unmocked production call sites for one execution
identity**, not two calls to the same wrapper (which the guard-layer files
already cover):

- **Site #12** (`local-pty-spawn.ts:89`) — simulated by a stub
  `IPtyProvider.spawn` that calls `ctx.spawnOptions.onPtySpawnCommitted?.()`
  **unawaited**, exactly as `spawnLocalPty` really does, before resolving.
  The rest of `LocalPtyProvider`'s real internals (node-pty, launch-plan
  resolution) are not re-exercised here — they are already covered end-to-end
  by `local-pty-provider-delegated-command-delivery.test.ts` for the Windows
  argv contract; this file's subject is guard convergence, not argv.
- **Site #16** (`spawn-execute.ts:88`) — the real, unmocked
  `executeRuntimePtySpawn`'s direct `ctx.reportPtySpawnCommitted()` call,
  fired immediately after `ctx.provider.spawn(...)` resolves.

Both sites are proven, structurally, to read back the **literal same guard
layer 2 closure instance** before being wrapped for observation
(`expect(ctx.spawnOptions.onPtySpawnCommitted).toBe(ctx.reportPtySpawnCommitted)`
— real, passes today, site #11's wiring). A thin recording wrapper is
installed around that real closure (delegating to it unchanged) so both
real call sites' return values can be observed without altering either
site's own logic.

**Test 1 (success path).** Injects a deferred Promise as the "durable
operation." Runs the real flow through both sites. Confirms, as real
preconditions reached *before* the RED assertion:
- `observedReturns.length === 2` — both real aliases fired.
- `underlyingInvocations === 1` — **GREEN, preserved**: the underlying
  operation is invoked exactly once across the two real aliases (guard
  layer 2's boolean flag already prevents a second real invocation).

Then the genuine RED: `observedReturns[0]` must be `instanceof Promise`
(fails — `undefined`, so the “same Promise” assertion that follows is
`undefined === undefined`, deliberately gated behind the `toBeInstanceOf`
check first so an accidental trivial pass can never masquerade as gate 60
being satisfied); `executeRuntimePtySpawn` must not resolve before the
injected Promise settles (fails — it resolves immediately, `executeSettled`
is `true` before `resolveDurable()` is ever called).

**Test 2 (failure path).** Same two-alias setup, underlying operation
rejects. Confirms `underlyingInvocations === 1` (GREEN — no alias retried)
and `observedReturns.length === 2`, then the genuine RED: neither call
site's return value is a Promise, and `executeRuntimePtySpawn` never
throws/rejects — the rejection is fully absorbed and lost. The rejected
promise is captured and explicitly `.catch()`-ed in the test itself so this
never depends on process-level `unhandledRejection` timing, per this task's
own instruction.

Both tests fail today at exactly `expect(observedReturns[0]).toBeInstanceOf(Promise)`
— the precise, single point where the frozen cross-alias contract is
violated, with every precondition up to that point (cross-alias invocation,
single underlying call, no retry) independently confirmed true first.

### Areas not covered by a dedicated new test file this session

- **Area C (nested seam location decision)** — a design decision already
  frozen and traced in §2 above (site #12, `local-pty-spawn.ts:89`); not an
  independent testable claim beyond what Area A/E's tests already exercise
  through that exact call site.
- **Area F (async callback type contract)** — folded into Area E above (the
  type-conformance file + the runtime guard tests together satisfy this).
- **Areas K/L/M/N (no floating rejection, no early continuation, commit
  failure blocks release, deferred command release)** — K and M are proven
  by `spawn-execute-commit-propagation.test.ts`'s rejection test (Area M is
  the direct consequence of Area K's defect: since nothing awaits the
  guard, a rejection cannot block anything downstream). L (no early
  continuation) is proven by the same file's two settlement-timing tests.
  N (deferred command release ordering) is proven by Area A's tests
  (`writeStartupCommandWhenShellReady`'s gating condition,
  `!plan.startupCommandDeliveredInShellArgs`, is never forced true for a
  delegated spawn today, so delivery ordering cannot yet be guarded).
- **Restart-harness gates (38, 50, 54)** — require a separate-child-process
  restart harness exercising crash windows C4/C5/C6, which depends on the
  durable `delegation_cutover` transaction (§8.1) existing. That table does
  not exist yet (schema work is explicitly out of this seam — §18.1 lists
  only Parts A/B). Classified `LATER_SLICE_B` below, not fabricated here.

## 5. Gates 41-63 matrix

| Gate | Text (abbreviated) | Status this session |
| --- | --- | --- |
| 41 | Windows delegated launch never embeds command in argv | **RED** — `local-pty-provider-delegated-command-delivery.test.ts` |
| 42 | `startupCommandDeliveredInShellArgs` false for every delegated spawn, all shell families | **RED** (PowerShell + cmd.exe covered; POSIX/WSL branch not separately exercised this session — `LATER_SLICE_B` follow-up, low risk since §4.1a's mechanism is shell-family-agnostic at the `args.command` level) |
| 43 | Bootstrap phase itself proven inert | Already proven **by static trace, not a new test** — SPEC §4.1b's own line-cited audit (reproduced independently in §2 above); no delegated-workload-controlled content exists in any bootstrap branch today because no delegated path exists yet. Not re-tested as a separate executable gate this session. |
| 44 | Every one of 19 sites preserves the Promise (type + runtime) | **RED** — type half: `spawn-commit-type-conformance-red.ts` (6 checkable sites); runtime half: all three guard/propagation test files |
| 45 | First invocation exposes exactly one in-flight Promise | **RED** — both guard-layer test files (`idle`/`in_flight` transition doesn't exist yet, there's no `state` at all) |
| 46 | Duplicate-while-in-flight awaits the same Promise object | **RED** — both guard-layer test files |
| 47 | Outer callback cannot report success before durable transaction completes | **RED** — `orca-runtime-report-pty-spawn-commit-async.test.ts`, `spawn-execute-commit-propagation.test.ts` |
| 48 | Rejection propagates through every guard | **RED** — all three propagation-focused test files |
| 49 | Workload delivery impossible until durable commit | **RED** — Area A's tests (command never withheld from argv at all today) |
| 50 | Cutover-committed-but-undelivered is restart-safe | `LATER_SLICE_B` — requires the `delegation_cutover` table (§8.1), not part of Parts A/B |
| 51 | Pre-commit vs post-commit cleanup uses correct authority | `LATER_SLICE_B` — requires §5.8's authority model, built on schema not yet implemented |
| 52 | Unsupported provider rejected before cutover | **RED** — `spawn-options-delegated-cutover-capability-gate.test.ts` |
| 53 | No remote/SSH provider can enter delegated authority | Confirmed **by static audit** this session (§2: `local-pty-provider.ts` is the only file declaring provider capabilities relevant to this gate; no remote/SSH provider file declares or could declare `supportsDelegatedCutoverHold` since the capability does not exist anywhere yet) — not a dedicated executable test |
| 54 | Early bootstrap death cannot cause auto-respawn | `LATER_SLICE_B` — requires a restart harness against real process lifecycle, out of this seam's scope |
| 55 | Acceptance suite exercises the real default Windows path | **RED** — Area A's PowerShell-family test is the real default, not a synthetic stdin-only path |
| 56 | No void-discarding alias in the full call graph | **RED** (partial) — type-conformance file proves the checkable declaration sites; the `@ts-nocheck`'d `orca-runtime-create-terminal.ts` sites (#5/#7/#8/#9) are proven only at runtime (Area E's tests), documented explicitly as a `tsc`-blind spot in the evidence file itself |
| 57 | `agentSessionEnsure` branch (site #16) awaits and propagates | **RED** — `spawn-execute-commit-propagation.test.ts` |
| 58 | `onFreshSpawn` type (site #18) preserves async result | **RED** (type half) — type-conformance file; runtime half folded into gate 59 |
| 59 | Every `onFreshSpawn` invocation (site #19) awaits/propagates | **RED** — `spawn-execute-commit-propagation.test.ts` |
| 60 | All aliases resolve to the same in-flight Promise per execution identity | **RED** (corrected round 2 from `LATER_SLICE_B`) — `spawn-execute-cross-alias-promise-convergence.test.ts`, crossing real sites #12 and #16 for one execution identity; see §4 "RED Area I/J (round 2)" above |
| 61 | Rejected durable Promise cannot become an unhandled rejection | **RED**, proven deterministically (captured-promise + explicit `.catch()` pattern, never relying on process-level `unhandledRejection` timing, per this task's own instruction) across all three propagation-focused test files |
| 62 | No alias lets spawn flow continue after commit failure | **RED** — `spawn-execute-commit-propagation.test.ts`'s rejection test |
| 63 | Implementation acceptance performs symbol/call-graph audit, not grep-only | Satisfied **by process**, this session: §2's trace was built by following the logical operation through aliases/wrappers/type slots, independently re-deriving the same 19-site count the frozen SPEC states, not by re-grepping `onPtySpawnCommitted`. Documented here as the standing discipline for any future session touching this seam. |

## 6. Existing invariants already GREEN (labeled honestly)

- Both guard layers' **fire-once invocation count** (not the async
  propagation contract) is already correct: `createPtySpawnCommitReporter`
  and `spawn-options.ts`'s inline guard both call the underlying callback
  exactly once regardless of duplicate invocations. Proven by the
  "invariant preserved (not RED)" test in each guard-layer file.
- Site #11's wiring (`ctx.spawnOptions.onPtySpawnCommitted = ctx.reportPtySpawnCommitted`)
  is real, unconditional, and correctly threads the same guard-layer-2
  closure instance into the provider's own spawn options — confirmed by
  `spawn-options-commit-guard-async.test.ts`'s referential-equality
  assertion.
- Site #13 (`attachStablePaneOwner` explicitly sets `onPtySpawnCommitted:
  undefined`) is confirmed unchanged and correctly out of scope — a
  reattach never originates a new process, so it cannot and should not
  carry a delegated commit.
- §4.1b's shell-bootstrap inertness claim (`AutoRun`, `$PROFILE`,
  `.bash_profile`/`.bashrc`, WSL login-shell rc files) is independently
  re-confirmed unconditional on `args.command`/any delegation state — this
  was true before this session and remains true; no code changed it.

## 7. Production code changed this session

**None.** `git diff --stat` against `7c1796e82c53de53f0a028123defbe53974eb652`
touches only new test files, this evidence file, and no file under `src`
outside a `*.test.ts` or `*-red.ts` (type-conformance evidence) suffix. No
`deferDelegatedCommandDelivery`, `supportsDelegatedCutoverHold`, async
guard widening, fire-once-guard rewrite, `spawn-execute`/`stable-owner`
await insertion, command-release gating, `delegation_cutover` table, or
aiControl fence code was implemented.

## 8. aiControl guard

- `aiControlCenter` `origin/master` (fetched fresh, read-only): `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` — matches canonical exactly.
- `data/app.db` SHA-256 (computed fresh via `Get-FileHash -Algorithm SHA256`): `2DC6F32A86E42B6CD42E93712AF73E33FC39053B3EC2B6265566AC0580A45088` — matches the canonical value cited in both the mission brief and SPEC.md's own Artifact Identity table, case-insensitively, exactly.
- No `-wal`, `-shm`, or journal file present alongside `data/app.db`.
- aiControlCenter's own local `HEAD` (`c2d404a541a1136e4471d00aa94b616e1eac3a0d`) differs from `origin/master` — this is the checkout's own volatile local state (uncommitted local commits/branch), explicitly not used as a source of truth anywhere in this session, per SPEC.md's own round-2 correction note.

## 9. Authority / scope (before and after this session)

- Migration authority: `AICONTROL_NATIVE` — unchanged.
- `ORCA_DELEGATED`: `NOT STARTED` — unchanged.
- Fence acquisition: disabled (`ORCA_FENCE_ACQUISITION_ENABLED` unset/false) — unchanged, not touched.
- M5 (Controlled Fallback): `NOT STARTED` — unchanged, not touched.
