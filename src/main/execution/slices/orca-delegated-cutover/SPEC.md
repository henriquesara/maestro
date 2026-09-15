# Slice B — `ORCA_DELEGATED` Cutover (provisionally ORCA-S5) — CORRECTED CANDIDATE SLICE SPEC

> SDD artifact. **Candidate — not frozen, not independently accepted, not
> published, authorizes no implementation.** Re-derived end-to-end against
> the real repository state of both Maestro and aiControlCenter. No code,
> schema, migration, test, dependency, or skill is changed by producing this
> document. No `data/app.db` byte is touched by this task. **No authority
> stage moves by virtue of this document existing.** `ORCA_DELEGATED` stays
> `NOT STARTED`. When frozen it becomes the functional authority for the
> slice; a real conflict is `CONTRACT_CONFLICT` → architecture decision →
> amendment, never a silent edit here.
>
> **This is a correction, not an amendment, of the rejected candidate**
> `f1d3396473908a869753b44b21caa35f105ada4c` (branch
> `orca-s5-delegated-cutover-architecture`). That candidate is
> `REJECTED / UNPUBLISHED` per aiControlCenter `docs/HANDOFF.md`
> (`AICONTROL_ORCA_DELEGATION_FENCE_CLOSED_PUBLISHED_READY_FOR_SLICE_B_ARCHITECTURE_CORRECTION`,
> published HEAD `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`) — it predates the
> real aiControl fence prerequisite and was built from a stale local
> aiControlCenter checkout that could not read the real handshake. This
> document is re-derived from canonical `origin/main` on a fresh worktree,
> never branched from the rejected commit, and stands alone: a fresh
> implementation session consumes it without reconstructing architecture from
> chat history or from the rejected text. Salvaged language is re-verified
> against real code before being kept; nothing is carried forward merely to
> minimize diff.

**State class:** `ARCHITECTURE_READY_FOR_FOCUSED_REREVIEW`.
**Display verdict:** `ORCA_S5_DELEGATED_CUTOVER_ASYNC_CALL_GRAPH_CORRECTED_READY_FOR_REREVIEW`.

> **Correction history — round 2.** A fresh, independent review of
> `ef699e9fc29f8a9950234d1460907b435b86c87e` (round 1) returned
> `ARCHITECTURE_CHANGES_REQUIRED`, finding one blocker and two lesser
> precision defects, all in the seam/ordering claims of the original §4/§5/§12
> — nowhere else. Round 2 (`28b664fe0689c30041ea9eb824dcc646a2689c7a`) was a
> focused correction locating the real nested `onPtySpawnCommitted` firing
> site inside `spawnLocalPty`.
>
> **Correction history — round 3 (this revision).** A second fresh,
> independent, focused review of round 2 returned `ARCHITECTURE_CHANGES_REQUIRED`
> again, finding round 2's own central safety claim **falsified by real
> code it had not traced**: the real default Windows local-PTY path can
> embed the delegated agent's startup command **directly in the spawned
> process's argv** (`createWindowsLocalPtyLaunchPlan` →
> `buildWindowsPowerShellSpawnAttempts`/`getCmdShellArgStartupCommand`/
> `getPowerShellEncodedCommand`), **before** the chosen seam
> (`local-pty-spawn.ts:89`) ever runs — round 2's §4.4 explicitly considered
> and incorrectly ruled this out. Round 3 independently re-traced this exact
> code path (§4.1a) and found the finding accurate. Round 2's independent
> review also found the proposed `await` would not actually await anything:
> the callback passes through **two** nested fire-once guard closures
> (`createPtySpawnCommitReporter` and a second, inline guard in
> `spawn-options.ts`), both currently `() => void`, both discarding whatever
> they call. This revision corrects both defects precisely (§4.1a's
> deferred-delivery contract; §4.5's full callback type-site table and
> async-aware guard semantics) and adds the missing provider-eligibility gate
> (§7.3) the round-2 rereview separately flagged as a secondary gap. Every
> conclusion round 2's independent review re-confirmed accurate — the real
> aiControl fence handshake, atomic-transaction structural soundness, the
> early-exit-race characterization, `assertPtyDidNotExitBeforeRegistration`'s
> post-cutover semantics, the corrected aiControl cancel-route description,
> R3/`DIVERGENCE` classification, one-instance/no-respawn discipline, and
> every area round 1's review had already accepted — is preserved unchanged
> below except where this round's two corrections directly touch it.
>
> **Correction history — round 4 (this revision).** A third fresh,
> independent, focused rereview of round 3 returned
> `ARCHITECTURE_CHANGES_REQUIRED` on exactly one new blocking class: §4.5.1's
> "every occurrence in the repository" inventory was itself incomplete. It
> was built by grepping the literal identifier `onPtySpawnCommitted`, which
> — by construction — cannot find a site that carries the same logical
> operation under a different name. Independent symbol/call-graph tracing
> (not grep) found four such sites, all real, all live, all reachable from
> the delegated path: `spawn-execute.ts:88`'s direct
> `ctx.reportPtySpawnCommitted()` call in the `agentSessionEnsure` branch;
> `spawn-execute.ts:148`'s `onFreshSpawn: ctx.reportPtySpawnCommitted`
> forwarding in the non-`agentSessionEnsure` branch; and the `onFreshSpawn`
> callback's own type declaration and invocation in `stable-owner.ts:169`
> and `stable-owner.ts:302`. Two further type/initializer sites for the same
> guard-layer-2 slot (`spawn-state.ts:80,183`) were also missing. This
> revision replaces §4.5.1's table with a nineteen-site inventory built by
> tracing the logical operation through its return type, its aliases, and
> every callback parameter and struct field carrying it — not by re-grepping
> one name — and freezes the propagation contract for every newly found
> site (§4.5.1a, §4.5.2, §4.7). Every conclusion round 3's independent
> review confirmed accurate — the Windows argv/bootstrap correction (§4.1a/
> §4.1b), the chosen nested seam (§4.3), the atomic transaction (§8.1), the
> authority-result contract (§4.5.3), the crash-window dispositions (§5.5-
> §5.9), the provider eligibility gate (§7.3), and every area rounds 1-3
> already accepted — is preserved unchanged below except where this round's
> single correction directly touches it.

---

## Artifact identity

| Field | Value |
| --- | --- |
| Proposed slice | **Slice B — `ORCA_DELEGATED` Cutover** (provisionally ORCA-S5), **corrected candidate** |
| Bounded context owner | **Execution** |
| Migration authority ladder stage (before) | `AICONTROL_NATIVE` |
| Migration authority ladder stage (after, per delegated run, on independent acceptance + explicit activation) | `ORCA_DELEGATED` — the only slice permitted to move this |
| Orca mode (before → after) | `ORCA_SHADOW_ADVISORY` → `ORCA_SHADOW_ADVISORY` for every run never explicitly admitted as delegated; a delegated run's mode becomes `ORCA_DELEGATED` at its own cutover instant only |
| Authority transfer scope | **Per-run, explicit, opt-in.** No global flip. |
| Maestro base / HEAD | `origin/main` = `66dab64373942f58a6ddfccf71a99c94ff719bae`, verified by fresh `git fetch` this session — **matches the mission's required canonical value exactly**; no drift |
| Candidate branch | `arch/orca-s5-delegated-cutover-correction`, fresh `git worktree add -b … origin/main` this session (never branched from `f1d339…`) |
| Predecessor slice | ORCA-S4 — Delegated Side-Effect Boundary Enumeration & Shadow Proof (`src/main/execution/slices/delegated-side-effect-boundary/`), `CLOSED / PUBLISHED`, frozen contract = `SPEC.md` (read in full this session) |
| Predecessor analysis | `GAP-ANALYSIS-ORCA-DELEGATED.md`, independently accepted, read in full this session |
| Rejected reference | `f1d3396473908a869753b44b21caa35f105ada4c` (910-line SPEC, read in full this session) — salvaged only where re-verified correct; its own §20 admits it never located the real integration seam (risk 1) and never read the real fence protocol (§0) |
| Candidate SPEC path | `src/main/execution/slices/orca-delegated-cutover/SPEC.md` (absent from canonical `main`; created fresh by this session) |
| aiControlCenter canonical read state | `origin/master` = `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`, verified by fresh `git fetch` this session — **matches the mission's required canonical value exactly**; read via `git show origin/master:<path>` throughout. **Correction (round 2, see header note):** the local aiControlCenter working-tree checkout was never used as a source of truth for any claim in this document — its own commit-distance from `origin/master` is a volatile fact with no architectural consequence, and the prior text's specific count was independently found inaccurate; this document no longer states one |
| aiControlCenter published fence technical HEAD | `d5a1512b2e965f4afb4794dbd082f58d906de01f` — confirmed a real ancestor of `origin/master` (`git merge-base --is-ancestor`, this session) |
| aiControlCenter operational DB guard | `data/app.db` SHA-256 `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`, no `-wal`/`-shm`/journal — verified **before** this session's work by direct hash (`certutil -hashfile`); re-verified identical at close, §22 |

**Normative source, re-read fresh this session (not secondhand-quoted):**

- Maestro (round 1): `GAP-ANALYSIS-ORCA-DELEGATED.md` (full), `delegated-side-effect-boundary/SPEC.md` (full, all 20 sections), `orca-runtime-create-agent-session.ts` and `orca-runtime-create-terminal.ts`, `orca-runtime-report-pty-spawn-commit.ts`, `repo-worktrees.ts`.
- Maestro (round 2, the real provider call graph, §4): `src/main/ipc/pty/runtime/spawn-options.ts` (full, `buildRuntimePtySpawnOptions`), `src/main/providers/local-pty-spawn.ts` (full, `spawnLocalPty`), `src/main/providers/local-pty-session-activation.ts` (`activateLocalPtySession`'s exit-listener wiring and startup-command delivery, read for the specific call sites cited in §4), `src/main/runtime/orca-runtime-register-pty.ts` (`assertPtyDidNotExitBeforeRegistration`, full).
- Maestro (round 3, the Windows launch-plan/argv layer and full callback type-site inventory, §4.1a/§4.5): `src/main/providers/local-pty-launch-plan.ts` (full), `src/main/providers/windows-shell-fallback-chain.ts` (full), `src/main/providers/windows-shell-args.ts` (full — `getCmdShellArgStartupCommand`, `getPowerShellEncodedCommand`, `resolveWindowsShellLaunchArgs`), `src/main/providers/local-pty-provider.ts:67`'s own doc comment, `src/main/providers/pty-provider-contract.ts` (full — `PtySpawnOptions.onPtySpawnCommitted`, `supportsAgentSessionClaims`/`supportsAgentSessionCreateOperations` capability-probe precedent), `src/main/runtime/runtime-terminal-contracts.ts:55`, `src/main/runtime/runtime-pty-controller-contract.ts:71`, `src/main/ipc/pty/runtime/spawn-state.ts:115`, `src/main/ipc/pty/pane/stable-owner.ts:213-234` (`attachStablePaneOwner`, confirming the reattach-only path is out of scope).
- aiControlCenter (`origin/master`, read-only, via `git show`): `docs/HANDOFF.md`, `docs/architecture/orca-delegation-fence-prerequisite.md` (full, all 16 sections), `src/lib/agent-runner/orca-fence.ts` (full, 284 lines), `src/lib/agent-runner/orca-fence-projection.ts` (full, 96 lines), `src/app/api/agent-runs/[id]/cancel/route.ts` (full, 151 lines, round 2, §12).
- Maestro (round 4, complete logical spawn-commit call-graph tracing, §4.5.1): `src/main/ipc/pty/runtime/spawn-execute.ts` (full, `executeRuntimePtySpawn`), `src/main/ipc/pty/pane/stable-owner.ts` (full — `StablePaneSpawnContext`, `attachStablePaneOwner`, `spawnForStablePane`), `src/main/ipc/pty/runtime/spawn-state.ts` (full — `RuntimePtySpawnState`'s own `reportPtySpawnCommitted` field and its default initializer), `src/main/ipc/pty/runtime/spawn-options.ts` (full, re-read against the call graph rather than only the type table), `src/main/runtime/orca-runtime-create-agent-session.ts:210-228` (the real application callback's two call sites into `createTerminal`), a repository-wide symbol search for `reportPtySpawnCommitted`, `onFreshSpawn`, and `createPtySpawnCommitReporter` (not `onPtySpawnCommitted` alone).

Unlike the rejected candidate (whose §0 header stated its local aiControlCenter
checkout was stale and could not read the amendment fresh), **this session
independently re-read the real, published fence protocol and the real
projector code** rather than quoting it secondhand. Every claim about
aiControl behavior below is sourced to a specific function or SQL statement
in one of the two files above, not to a mission-brief paraphrase.

---

## 0. `CONTRACT_CONFLICT` check

**No conflict** against any frozen Maestro contract (ORCA-S1–S4) or the
published aiControl fence prerequisite. This SPEC:

- moves the authority ladder **only** for runs an explicit, aiControl-owned
  fence-acquisition-then-Maestro-cutover handshake names as delegated — never
  a global flip, never a queue/capacity/scheduler transfer;
- consumes ORCA-S4's `ShadowLifecycleProcessPort` shape, `dispatch_process_binding`,
  `dispatch_termination`, `dispatch_lifecycle_closure`, `dispatch_lifecycle_event`,
  and `convergeDelegationBoundaryLifecycle` as already-proven mechanism,
  extended (not rewritten) per §8;
- references the **real, published** aiControl fence protocol
  (`orca-fence.ts`, `orca-fence-projection.ts`,
  `docs/architecture/orca-delegation-fence-prerequisite.md`) instead of a
  hypothetical "admission grant" (correcting the rejected candidate's §4);
- is explicitly gated `NOT_YET_LIVE_ACTIVATABLE` (§18) because aiControl's
  own rollout (`R1 COMPLETE`, `R2 CODE PUBLISHED`, `R3 NOT STARTED`, fence
  acquisition structurally disabled — `docs/HANDOFF.md`, re-confirmed by
  reading `isOrcaFenceAcquisitionEnabled()` in `orca-fence.ts:49-51`) has not
  reached the state this SPEC's own entry criteria require, and because
  `orca-fence-projection.ts`'s declared `DIVERGENCE` outcome (line 24) is
  never actually returned by the function (§17) — both are pre-activation
  dependencies, not implementation gaps in this SPEC.

`docs/HANDOFF.md`'s own delegation-fence closeout entry names seven
correction items (A–G) required of the next Slice-B architecture session;
this document is organized to visibly close each one, cited by letter
throughout.

---

## 1. Name / purpose

**Slice B — `ORCA_DELEGATED` Cutover.** Give Orca correctness authority over
the mechanical running→terminal lifecycle of explicitly delegated, real
executions — using ORCA-S4's already-proven machinery, extended to a real
process — while aiControl keeps admission/capacity/queue authority and,
because no `execution_attempts` row is ever opened for a delegated run
(`GAP-ANALYSIS-ORCA-DELEGATED.md` §3; confirmed again by reading
`orca-fence-projection.ts`'s own doc comment, §9 below), Orca necessarily
becomes the terminal-status **classification** authority too — a correction
to the rejected candidate's framing, not a re-litigation of anything frozen.

### What changed from the rejected candidate, and why (map to mission items A–G)

| Item | Rejected candidate's defect | This correction |
| --- | --- | --- |
| **A** | §4 said the real process launches *after* the cutover commit; §6.3/§9.2 said the bind-time seam is invoked *from inside* the real launch path, i.e. the process already exists *before* the seam runs. Self-contradictory, and §20 risk 1/2 admits the real call site was never located. | §4/§5 below: the real call site is located and read (`orca-runtime-create-terminal.ts`); the real `ptyController.spawn()` primitive has no "prepare without spawning" mode, so process creation **necessarily** precedes any Maestro-side commit. The ordering is frozen as a fact about the real runtime, not a preference between two hypothetical paths. |
| **B** | Invented an "aiControl admission grant" with no cited implementation. | §6 below cites the real, published `acquireOrcaFence` / `safeReleaseOrcaFence` / `acknowledgeOrcaCutover` / `flagOrcaFenceBreakGlass` functions and their exact CAS predicates from `orca-fence.ts`. |
| **C** | Reused `ShadowLifecycleProcessPort` by asserting a real handle "can be substituted behind the same port" without checking whether the real launch call site's hook is even `await`-able. | §5.2 below reads `orca-runtime-report-pty-spawn-commit.ts` and finds `onPtySpawnCommitted` is a synchronous, unawaited, fire-and-forget callback today — too weak to host a durable multi-row transaction — and names the exact, minimal change required. |
| **D** | Collapsed cancellation and timeout into the identical `dispatch_termination.termination_method='signalled'` value with no distinguishing durable field. | §9 below adds a `teardown_reason` column, written **before** the signal is ever sent, and a `terminal_status_ref` closure column computed from durable facts only, never inferred later. |
| **E** | Asserted "delegate to Orca" without naming the real owning call boundary; §20 risk 1 admits the seam was never located. | §4 below names exact files and functions: `OrcaRuntimeWithCreateAgentSession.createAgentSession` → `OrcaRuntimeWithCreateTerminal.createTerminal` → `this.ptyController.spawn(...)`. |
| **F** | Cardinality was implied, never frozen against the real recovery primitives. | §11 below freezes 1:1:1:1 and names the **real, already-existing** reconciliation primitives (`ptyController.adoptStablePane`, `reconcileRemoteTerminalCreate`, the `agentSessionCreateOperations` idempotency ledger) as the recovery path — never a second spawn. |
| **G** | Not addressed at all (rejected candidate predates the published fence). | §17 below freezes the divergence-fix prerequisite by reading `orca-fence-projection.ts` directly and showing exactly which line never fires. |

### What this slice is not

Not a rewrite of ORCA-S1–S4. Not a queue/capacity/admission transfer. Not
`ORCA_AUTHORITATIVE`. Not a claim that the Execution bounded context and
Maestro's real agent-session runtime are already the same code path — they
are not; naming the seam between them precisely is this document's hardest
job (§4).

## 2. Bounded-context owner

**Execution** (unchanged). New Execution-owned aggregates: `delegation_cutover`
(§8.1), `aicontrol_terminal_projection` (§8.3). One extended ORCA-S4 table
(`dispatch_process_binding` gains `teardown_reason`, §8.2) and one extended
ORCA-S4 table (`dispatch_lifecycle_closure` gains `terminal_status_ref`,
§8.2). No new bounded context; no new Delivery/Governance read or write
surface over Execution's store.

## 3. Non-negotiable authority model (restated, unchanged)

```
AICONTROL_NATIVE → ORCA_SHADOW_ADVISORY → ORCA_DELEGATED → ORCA_AUTHORITATIVE
```

Slice B moves only the `AICONTROL_NATIVE`/`ORCA_SHADOW_ADVISORY` →
`ORCA_DELEGATED` edge, per run, never the `ORCA_DELEGATED → ORCA_AUTHORITATIVE`
edge. Exactly one correctness authority per action, per §12.

---

## 4. The real Orca runtime integration seam (closes item E; corrected round 2)

**Round 1 of this document named an accurate but incomplete call graph.** It
described `onPtySpawnCommitted` as firing once, at one clean outer point
around `createTerminal`/`ptyController.spawn()`. That is true only for
providers that never set a provider-level `onPtySpawnCommitted` — it is
**not** true for the load-bearing local-PTY path, which is the only path
Slice B's local-only scope (§20) needs. This section replaces round 1's §4
entirely with the traced, provider-specific call graph.

### 4.1 The real, full call graph (traced this session, file and line exact)

1. **`OrcaRuntimeWithCreateAgentSession.createAgentSession`**
   (`orca-runtime-create-agent-session.ts:36`) pre-mints `operationHandle`
   (line 202), records `reclaim.identity` (line 205), then calls
   **`this.createTerminal(...)`** (line 211) with `preAllocatedHandle:
   operationHandle` and `onPtySpawnCommitted: () => { retainReplayFence =
   true }` (lines 225-227) — a synchronous, cheap, in-memory-only callback
   today.
2. **`OrcaRuntimeWithCreateTerminal.createTerminal`**
   (`orca-runtime-create-terminal.ts:9`) builds `launchOpts`, then at line
   127 calls **`await this.ptyController.spawn({ …, preAllocatedHandle,
   onPtySpawnCommitted: reportPtySpawnCommitted, … })`**, where
   `reportPtySpawnCommitted = createPtySpawnCommitReporter(launchOpts.onPtySpawnCommitted)`
   (line 31) — an idempotent wrapper around the callback from step 1.
3. **`ptyController.spawn(...)`** resolves, per the current live routing
   rules, to one of several providers. **For this slice's local-only scope
   (§20), the load-bearing provider is `LocalPtyProvider`.** Its spawn path
   goes through **`buildRuntimePtySpawnOptions`**
   (`src/main/ipc/pty/runtime/spawn-options.ts:31`), which at
   **lines 176-182**:
   ```ts
   if (
     args.onPtySpawnCommitted &&
     (ctx.provider instanceof LocalPtyProvider || routesFreshSpawnsToLocalProvider(ctx.provider))
   ) {
     // Why: local fallback has no lower operation ledger, so commit must be reported at native spawn.
     ctx.spawnOptions.onPtySpawnCommitted = ctx.reportPtySpawnCommitted
   }
   ```
   — **conditionally, provider-dependently** — threads the callback **down
   into** the spawn options object the provider itself receives. The
   comment is the provider author's own admission that this is deliberate:
   the local provider has no lower operation ledger of its own, so the
   commit signal has to be reported from inside native spawn, not from the
   outer caller.
4. **`spawnLocalPty`** (`src/main/providers/local-pty-spawn.ts:21`) is the
   function that actually executes for the local provider. At **line 41**,
   `createLocalPtyLaunchPlan(args, getOptions)`
   (`src/main/providers/local-pty-launch-plan.ts:193`) resolves the launch
   plan — **this is a step round 2's call graph skipped, and it is
   load-bearing (§4.1a below)**. On `win32` with no WSL context it delegates
   to `createWindowsLocalPtyLaunchPlan` (line 238 there → line 107), which:
   - resolves the target shell family (`powershell.exe` by default,
     `cmd.exe`, or `wsl.exe`/Git Bash) (lines 113-131);
   - for a PowerShell family, calls `buildWindowsPowerShellSpawnAttempts({
     …, startupCommand: args.command })`
     (`windows-shell-fallback-chain.ts:55`, invoked at
     `local-pty-launch-plan.ts:154-160`) — **`args.command` is the real,
     full delegated agent CLI invocation, resolved upstream in
     `orca-runtime-create-agent-session.ts` and threaded through
     `createTerminal`'s `launchOpts.command` unchanged**;
   - `buildWindowsPowerShellSpawnAttempts` calls
     `resolveWindowsShellLaunchArgs(candidate, cwd, defaultCwd, wslContext,
     startupCommand)` (`windows-shell-fallback-chain.ts:26-32`, itself
     `windows-shell-args.ts:176`) for each shell in the fallback chain;
   - for `cmd.exe`: `getCmdShellArgStartupCommand(startupCommand)`
     (`windows-shell-args.ts:82-96`) embeds `startupCommand` verbatim into
     the `/K` argument (`shellArgs: ['/K', '<utf8-setup> & <command>']`) and
     sets `startupCommandDeliveredInShellArgs: true`, **unless** the
     command is absent, longer than 6000 chars, contains a literal `"`, or
     the assembled line exceeds `cmd.exe`'s 8191-char limit — any of which
     instead returns `null`, forcing the existing stdin-delivery fallback;
   - for PowerShell/`pwsh.exe`: `getPowerShellEncodedCommand(cwd,
     startupCommand)` (`windows-shell-args.ts:112-136`) appends
     `startupCommand` to the OSC-133 bootstrap script and base64-encodes the
     whole thing into a `-EncodedCommand` argument, setting
     `startupCommandDeliveredInShellArgs: true`, **unless** the command is
     absent or the encoded payload exceeds a 28,000-char budget, in which
     case only the bootstrap (no workload command) is encoded and the flag
     is left unset.
   - `finalizeLocalPtyLaunchPlan` (line 68) carries
     `startupCommandDeliveredInShellArgs` straight into the returned
     `LocalPtyLaunchPlan`.

   Then, back in `spawnLocalPty`, at **line 71**, `spawnShellWithFallback({
   …, ptySpawn: pty.spawn, … })` — this is the real, synchronous (not
   `await`ed — the call itself returns synchronously; `pty.spawn` from
   `node-pty` is synchronous) **OS process creation**, using exactly the
   `shellArgs` the launch plan resolved above. `spawnResult.process` (the
   real handle, `pid` included) exists the instant this call returns, at
   line 88.

   **Confirmed, code-verified: when `startupCommandDeliveredInShellArgs` is
   `true`, the delegated agent's actual command already exists inside the
   spawned process's own argv the instant it is created — strictly before
   step 5 below, strictly before any durable commit could possibly have
   started.** This is the exact defect an independent focused rereview of
   round 2 found and round 2's own §4.4 incorrectly ruled out. §4.1a
   specifies the correction.
5. **`args.onPtySpawnCommitted?.()`** fires at **line 89** — **immediately
   after the real OS process exists**, and **before** `activateLocalPtySession`
   is ever called (line 111). This is the callback threaded down from step
   3. It is invoked **synchronously**, **nested inside `spawnLocalPty`'s own
   call stack**, **before `spawnLocalPty`'s own returned promise resolves**,
   and therefore **before `ptyController.spawn()`'s `await` at
   `createTerminal.ts:127` returns**.
6. **`activateLocalPtySession`** (`local-pty-session-activation.ts`) runs
   only after step 5. It registers the exit listener —
   **`proc.onExit(...)` at line 126** — and, separately, checks
   `plan.startupCommandDeliveredInShellArgs` (line ~160): when **false**, it
   arranges startup command/prompt delivery via
   **`writeStartupCommandWhenShellReady`** (imported line 35, invoked
   ~line 174), gated on shell-ready detection; when **true** — the argv-embed
   case in step 4 above — this call is **skipped entirely**, because
   delivery already happened at process-creation time, before step 5 ever
   ran. **This is the round-2 finding that was incomplete: shell-ready
   gating is real and correctly analyzed for the case where it applies, but
   it does not apply whenever argv-embedding fires**, which is the common
   case for a short delegated command on the platform default shell.
7. Control returns up through `spawnLocalPty`'s promise, through
   `ptyController.spawn()`'s promise, back to `createTerminal.ts:127`'s
   `await`. At **lines 178-180**: `if (!result.stablePaneOwner) {
   reportPtySpawnCommitted() }` fires the **outer** call to the same
   idempotent wrapper from step 2 — **for a local-PTY spawn this is
   unconditionally a no-op**, because the wrapper's own `reported` flag was
   already flipped `true` at step 5 (`createPtySpawnCommitReporter`,
   `orca-runtime-report-pty-spawn-commit.ts`, confirmed idempotent-by-guard).
8. At **line 195**: `this.assertPtyDidNotExitBeforeRegistration(result.id,
   result.incarnationId)` — a real, ordinary (non-crash) control-flow check,
   detailed in §7 below.
9. Only after that: `registerPreAllocatedHandleForPty` (line 202),
   `registerPty` (line 206), then conditionally `revealTerminalSession`
   (line 257) — first external visibility.

### 4.1a `DELEGATED_DEFERRED_COMMAND_DELIVERY` — the corrected pre-cutover safety contract

**Correction to round 2's falsified §4.4 claim.** The invariant "no
delegated workload side effect before cutover" cannot be satisfied by
relying on `writeStartupCommandWhenShellReady`'s existing gating alone,
because that gating is **conditionally bypassed** by the argv-embed path
(§4.1 step 4/6). The corrected contract instead **forces** the safe branch
for every delegated spawn, rather than assuming it.

**Mechanism — the smallest additive seam, named exactly, not "disable the
optimization" left vague:**

- `PtySpawnOptions` (`pty-provider-contract.ts`) gains one new, additive,
  optional field: `deferDelegatedCommandDelivery?: boolean`.
- `createLocalPtyLaunchPlan` (`local-pty-launch-plan.ts:193`) reads it from
  `args.deferDelegatedCommandDelivery`. When `true`, it calls
  `createWindowsLocalPtyLaunchPlan` (and the POSIX/WSL branches, §4.1a
  below) with the **command withheld from argv construction specifically**
  — concretely, `createWindowsLocalPtyLaunchPlan`'s `finish` closure
  (line 138) passes `startupCommand: undefined` to
  `buildWindowsPowerShellSpawnAttempts` (instead of `args.command` at line
  159) and to the non-PowerShell `resolveWindowsShellLaunchArgs` fallback
  call (instead of `args.command` at line 177), **while `args.command`
  itself is left completely unchanged everywhere else** — it is still the
  real launch command, still available for `writeStartupCommandWhenShellReady`
  to deliver later exactly as it already does for any command the existing
  fallback logic would have deferred anyway (too long, contains `"`, etc.).
- This is **not a new code path** — it forces the codebase's own
  already-existing, already-tested "command not embeddable" branch
  (`getCmdShellArgStartupCommand` returning `null`;
  `getPowerShellEncodedCommand` omitting `startupCommand`) to be taken
  unconditionally for a delegated spawn, regardless of the real command's
  length or content. `startupCommandDeliveredInShellArgs` is therefore
  **always** `false`/absent for a delegated spawn, by construction, and
  `activateLocalPtySession`'s existing branch (§4.1 step 6) therefore
  **always** takes the shell-ready-gated `writeStartupCommandWhenShellReady`
  path — the exact mechanism round 2's §4.4 needed and incorrectly assumed
  was unconditional.
- **Who sets this flag:** the delegated call path only —
  `createAgentSession`'s admission decision (§6, after `acquireOrcaFence`
  succeeds) passes `deferDelegatedCommandDelivery: true` down through
  `createTerminal`'s options into `ptyController.spawn(...)`'s
  `PtySpawnOptions`. An ordinary, non-delegated terminal/agent-session
  creation never sets it, so its argv-embed optimization is completely
  unaffected — this is additive, not a behavior change for any existing
  code path.
- **Threading:** `TerminalCreateOptions` → `RuntimePtySpawnState`/
  `buildRuntimePtySpawnOptions`'s `ctx.spawnOptions` → `PtySpawnOptions` the
  provider receives — the **same** existing option-plumbing shape every
  other `PtySpawnOptions` field already uses (`worktreeId`, `command`,
  `commandDelivery`, etc.); no new plumbing mechanism is invented.

### 4.1b Shell bootstrap side-effect audit — inertness with respect to the delegated workload

Independently traced against the real `shellArgs` each branch of
`resolveWindowsShellLaunchArgs` actually produces (`windows-shell-args.ts:176-255`),
per the mission's explicit instruction not to assert inertness without
tracing actual launch arguments:

- **`cmd.exe`:** `shellArgs: ['/K', '<utf8-setup> & <preflight?> & <command?>']`
  (line 195). **No `/D` flag** — `cmd.exe`'s `AutoRun` registry value
  (`HKCU`/`HKLM\Software\Microsoft\Command Processor\AutoRun`) is processed
  on launch by default.
- **`powershell.exe`/`pwsh.exe`:** `shellArgs: ['-NoLogo', '-NoExit',
  '-EncodedCommand', <payload>]` (line 208). **No `-NoProfile` flag** — the
  host loads `$PROFILE.CurrentUserAllHosts`/`AllUsersAllHosts` etc. before
  executing the encoded script, exactly as the module's own doc comment
  states (line 171: *"dot-source `$PROFILE`... `-NoExit` alone would skip
  the profile"* — profile loading is deliberate, documented product
  behavior, not an oversight).
- **Git Bash:** `-c '<login-shell command>'` invoking `bash --login -i`
  (line 219, `getGitBashLaunchCommand`) — a login+interactive shell sources
  `.bash_profile`/`.bashrc` per normal bash semantics.
- **WSL:** `buildWslInteractiveLoginShellCommand()` (line 146) — an
  interactive login shell into the distro, sourcing the distro's own
  `.profile`/`.bashrc`/equivalent.

**Verdict: outcome A, PROVEN INERT BOOTSTRAP — precisely scoped, not
asserted by fiat.** Every one of these bootstrap phases (`AutoRun`,
`$PROFILE`, `.bash_profile`/`.bashrc`, the distro's login-shell rc files) is
**identical, pre-existing product behavior for every terminal Orca creates
today — delegated or not** (confirmed: none of these flags/behaviors is
conditioned on `args.command`, `deferDelegatedCommandDelivery`, or any
delegation-specific state anywhere in the traced code). Its content is the
**operator's own local shell-environment configuration** (prompt themes,
aliases, PATH tweaks) — never repository content, never agent/task content,
never anything `deferDelegatedCommandDelivery` controls or could control.
It is therefore **outside the scope of the invariant this SPEC exists to
enforce** ("no *delegated workload* side effect before cutover") by
definition, not by assumption: the delegated workload is the agent CLI
invocation this SPEC's §4.1a contract now provably withholds from every
launch surface until after cutover; the shell's own generic startup
behavior is orthogonal, unconditional, and was never part of what Slice B
delegates.

**Not required, but named as an available future hardening, not
prescribed here:** `-NoProfile` (PowerShell) and `/D` (`cmd.exe`) would
suppress this pre-existing, unconditional bootstrap phase entirely for a
delegated spawn specifically, at the cost of behaving differently from
every other terminal Orca creates (a real product-consistency trade-off,
not a free change). This SPEC does not require it, because the invariant it
must satisfy is about the delegated workload command, which §4.1a already
provably excludes from every pre-cutover surface — but flags the option
explicitly per the mission's instruction not to leave the question
implicit.

### 4.2 PTY spawn-commit firing sites

| Provider | Where `onPtySpawnCommitted` fires | Nested or outer | PID/process identity known? | PTY/process registration complete? | Workload may already have begun? | Caller awaits it today? | Outer (step 7) firing suppressed by idempotent guard? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`LocalPtyProvider`, ordinary (non-delegated) spawn** | `local-pty-spawn.ts:89`, inside `spawnLocalPty`, before `activateLocalPtySession` | **Nested** | Yes — `spawnResult.process.pid` already exists | **No** — exit listener and startup-command delivery are both wired up *after* this point | **May already have begun** if `startupCommandDeliveredInShellArgs` was set (§4.1 step 4/6) — irrelevant for a non-delegated spawn, which has no cutover invariant to violate | No — synchronous, fire-and-forget today | **Yes** — the outer call at `create-terminal.ts:179` is unconditionally a no-op |
| **`LocalPtyProvider`, delegated spawn (`deferDelegatedCommandDelivery: true`, §4.1a) — Slice B's load-bearing path, §20** | same line 89 | **Nested** | Yes | **No** — unchanged | **No, provably** (§4.1a) — argv-embedding is forced off; `startupCommandDeliveredInShellArgs` is always false; only a bare shell process (§4.1b) exists at the moment the callback fires | Not today — must become `true` (§4.5) | **Yes** — same guarantee |
| Any provider `spawn-options.ts:176-182`'s condition excludes (i.e. not `LocalPtyProvider` and not routed there by `routesFreshSpawnsToLocalProvider`) | `create-terminal.ts:179`, outer, after `ptyController.spawn()` resolves | **Outer** | Yes — `result.pid` from the resolved `spawn()` call | Depends on that provider's own internal sequencing — **not traced this session** (out of Slice B's local-only scope, §20) | Not traced this session (out of scope) | No — same fire-and-forget wrapper | N/A — this is the only firing for that provider |

**For Slice B's local-only scope, the delegated-spawn `LocalPtyProvider`
row is the only one that matters, and it is unambiguously the nested site
— now provably workload-inert given §4.1a's forced deferral.** Round 1's
claim of "one universal insertion point" does not hold; this table replaces
it with the provider-conditional truth. §7.3 freezes the explicit
eligibility gate that keeps the third row (unsupported providers) from ever
entering delegated authority.

### 4.3 Chosen authoritative durable commit seam — decision, not a hand-wave

Per the mission's three options:

- **(C) is the correct answer, and it collapses into (A) once traced
  precisely**, not (B). The nested site (`local-pty-spawn.ts:89`) is not
  merely "the callback that happens to exist" — independently tracing
  `activateLocalPtySession` (§4.1 step 6) shows it is **strictly earlier**
  than the point at which the agent's actual command is ever delivered
  (`writeStartupCommandWhenShellReady` runs only after `activateLocalPtySession`
  starts, gated on shell-ready). **Moving the durable orchestration to a new
  outer hook (option B) would be a strictly later, less safe seam for the
  local path** — it would require inventing a new hook alongside an
  already-idempotent-no-op outer call, purely to arrive *later* in the real
  timeline than the seam that already exists. That is not the narrowest
  safe design; it is a wider one that pays a real cost (a new hook to
  invent and thread through `spawn-options.ts`/`create-terminal.ts`) for no
  safety benefit.

**Decision: (A). The durable binding/cutover hook attaches to the nested
`onPtySpawnCommitted` invocation inside `spawnLocalPty`
(`local-pty-spawn.ts:89`), for the local provider.** This satisfies every
property the mission requires of the chosen seam:

- the authoritative production process identity (`spawnResult.process.pid`,
  plus the OS-observable discriminator captured the same way ORCA-S4 already
  does, §7.1) is available at this exact point;
- the same identity can be durably bound (§8.1's `delegation_cutover` +
  `dispatch_process_binding` transaction has everything it needs — `pid`,
  `correlationId`/`orcaRunId`/`orcaDispatchId` already resolved by
  `createAgentSession` before spawn, `operationHandle`/`terminalHandle`
  already minted);
- the durable transaction can complete before `spawnLocalPty` proceeds to
  `activateLocalPtySession`, i.e. before the exit listener and the
  shell-ready-gated command delivery are ever wired up — §5.3 restates the
  visibility invariant against this exact point;
- workload execution is still prevented until cutover commits — confirmed,
  not merely assumed (§4.4, resolving round 1's own §4.2 residual);
- failure of the durable protocol prevents workload release — §4.5 freezes
  exact semantics;
- retry/recovery cannot create a second authoritative execution instance —
  unchanged from round 1's §11, unaffected by this correction.

### 4.4 Workload does NOT begin before this seam fires — corrected, round 3

**Round 2's own version of this section was factually wrong and is
withdrawn, not merely refined.** It claimed startup-command delivery "is
not embedded in the initial `pty.spawn` argv the way a one-shot
command-as-argv launch would be" — independently re-checked this round and
falsified: for the platform-default shell family (PowerShell) or `cmd.exe`,
with no `deferDelegatedCommandDelivery` forcing, it **is** embedded in argv
whenever the command fits the budget (§4.1 step 4), and
`writeStartupCommandWhenShellReady` is then explicitly skipped (§4.1 step
6). Round 2 considered this exact scenario in the abstract and ruled it out
without tracing `local-pty-launch-plan.ts`/`windows-shell-args.ts` — the
files that actually decide it.

**The corrected, honest claim:** the invariant does not hold *by default*;
it holds **because §4.1a's `deferDelegatedCommandDelivery` contract forces
the codebase's own existing safe branch unconditionally for every delegated
spawn** — a `true` architectural correction (a new, additive input to
already-existing logic), not a restated assumption. With that flag set,
`startupCommandDeliveredInShellArgs` is provably always false
(`getCmdShellArgStartupCommand`/`getPowerShellEncodedCommand` never receive
a `startupCommand` to embed, §4.1a), so `writeStartupCommandWhenShellReady`
is provably always the delivery path taken, and it provably runs only from
inside `activateLocalPtySession`, which provably runs only after the chosen
seam (§4.1 steps 5-6). **At the instant the chosen seam fires for a
delegated spawn, a bare, argv-command-free shell process exists (§4.1b);
the agent's actual command has not yet been written to it anywhere.** This
satisfies the mission's invariant for the local delegated path, on
evidence traced this round specifically to falsify or confirm it — not
merely re-asserted.

### 4.5 True Promise propagation — corrected end-to-end, round 4

**Round 2's defect, confirmed by independent rereview:** round 2 widened
only `spawn-options.ts`'s `PtySpawnOptions.onPtySpawnCommitted` and
`local-pty-spawn.ts`'s consumption of it. It never named the two fire-once
guard closures the callback actually passes through, both of which are
`() => void` today and **discard** whatever the wrapped callback returns.
`await args.onPtySpawnCommitted?.()` at `local-pty-spawn.ts:89` would
therefore resolve to `undefined` **immediately**, regardless of how long
the real durable transaction takes — the await would exist syntactically
and do nothing semantically. Round 3 corrected that.

**Round 3's own defect, confirmed by independent rereview:** round 3's
§4.5.1 table was titled "every occurrence in the repository" but was built
by grepping the single literal identifier `onPtySpawnCommitted`. That
method cannot find a site that carries the identical logical operation
under a different name — and two such names exist in real, live code:
`ctx.reportPtySpawnCommitted` (guard layer 2's own bound closure, stored
and read back under that name, not `onPtySpawnCommitted`) and
`onFreshSpawn` (the parameter name `spawn-execute.ts` and `stable-owner.ts`
use for the exact same value). §4.5.1a below states the corrected discovery
method; §4.5.1 replaces round 3's table with the complete result.

#### 4.5.1 Complete callback type-site inventory (every occurrence in the repository, traced by symbol/call graph, not by name)

| # | Site | Current type/behavior | Classification | Required change |
| --- | --- | --- | --- | --- |
| 1 | `runtime-terminal-contracts.ts:55` — `TerminalCreateOptions.onPtySpawnCommitted` | `?: () => void` | Type-only declaration | Widen to `?: () => Promise<DelegationCutoverCommitResult> \| void` |
| 2 | `runtime-pty-controller-contract.ts:71` — the options type `ptyController.spawn(...)` accepts | `?: () => void` | Type-only declaration | Same widening |
| 3 | `pty-provider-contract.ts:109` — `PtySpawnOptions.onPtySpawnCommitted` | `?: () => void` | Type-only declaration | Same widening |
| 4 | `spawn-state.ts:115` — `RuntimePtySpawnState`'s `spawnOptions.onPtySpawnCommitted` | `?: () => void` | Type-only declaration | Same widening |
| 5 | `orca-runtime-create-agent-session.ts:225-227` — the real application callback (`onPtySpawnCommitted: () => { retainReplayFence = true }`) | synchronous, in-memory flag write | **The real logical operation's home** — this is where the durable transaction (§7's five-insert commit) must actually run for a delegated spawn | Becomes `async (): Promise<DelegationCutoverCommitResult> => { … }` for a delegated spawn (checked via a capability/mode flag, never by guessing); unchanged (`() => void`, still fires `retainReplayFence = true`) for a non-delegated spawn — the union type accommodates both without a breaking change |
| 6 | `orca-runtime-report-pty-spawn-commit.ts` — `createPtySpawnCommitReporter` (guard **layer 1**) | `(callback?: () => void) => () => void`; boolean `reported` flag; discards `callback?.()`'s return | **Fire-once wrapper — must become async-aware** | §4.5.2 |
| 7 | `orca-runtime-create-terminal.ts:31` — `reportPtySpawnCommitted = createPtySpawnCommitReporter(launchOpts.onPtySpawnCommitted)` | construction call | Wiring, unchanged shape | Return type follows #6's widened signature |
| 8 | `orca-runtime-create-terminal.ts:167-168` — threads `reportPtySpawnCommitted` into `ptyController.spawn(...)`'s options | passthrough | Wiring, unchanged | Follows #6's widened signature |
| 9 | `orca-runtime-create-terminal.ts:178-180` — **outer** invocation `if (!result.stablePaneOwner) { reportPtySpawnCommitted() }` | fire-and-forget call | **Outer duplicate invocation** | Must become `await reportPtySpawnCommitted()`, but per §4.5.2 this always resolves to the **cached** result from the nested firing for a local-PTY delegated spawn — it must never be treated as a fresh attempt, and its resolved value must never be reported as success independent of that cached result (closes the mission's explicit "outer callback cannot report success before durable transaction completes" concern, gate 47) |
| 10 | `spawn-options.ts:59-66` — the **second**, inline fire-once guard (`ctx.reportPtySpawnCommitted`, guard **layer 2**) | `(): void => { if (ptySpawnCommitReported) return; ptySpawnCommitReported = true; args.onPtySpawnCommitted?.() }` | **Fire-once wrapper — must become async-aware** | §4.5.2 — this is the layer read back by sites #12, #16, #17 below |
| 11 | `spawn-options.ts:176-182` — threads `ctx.reportPtySpawnCommitted` into `ctx.spawnOptions.onPtySpawnCommitted`, provider-conditionally (`LocalPtyProvider` / `routesFreshSpawnsToLocalProvider` only) | passthrough | Wiring, unchanged | Follows #10's widened signature |
| 12 | `local-pty-spawn.ts:89` — **the chosen seam**, `args.onPtySpawnCommitted?.()` | fire-and-forget call | **The actual nested invocation** | Becomes `const commitResult = await args.onPtySpawnCommitted?.()`, branching per §4.5.3/§7 |
| 13 | `stable-owner.ts:233` — `attachStablePaneOwner` explicitly sets `onPtySpawnCommitted: undefined` | reattach-only path (`attachOnly: true`, `command: undefined`) | **Out of scope, confirmed** | No change — this path never creates a new process and never carries a delegated command; it cannot originate a `delegation_cutover` and is excluded by §7.3's eligibility gate reasoning (a reattach is not a new authoritative execution instance) |
| 14 | `spawn-state.ts:80` — `RuntimePtySpawnState.reportPtySpawnCommitted` — guard layer 2's own slot on the shared spawn context, read back by sites #16/#17, not by name `onPtySpawnCommitted` | `() => void` | Type-only declaration, **missed by every name-grep of `onPtySpawnCommitted`** | Widen to `() => Promise<DelegationCutoverCommitResult \| void>`, matching #10's widened signature exactly (same closure) |
| 15 | `spawn-state.ts:183` — `createRuntimePtySpawnState`'s default initializer `reportPtySpawnCommitted: () => {}` | synchronous void no-op, overwritten by #10 before any real spawn logic runs | Wiring, unchanged in effect | Becomes `async () => {}` (or an equivalent already-resolved no-op) so the placeholder satisfies #14's widened type before `buildRuntimePtySpawnOptions` replaces it |
| 16 | `spawn-execute.ts:88` — `ctx.reportPtySpawnCommitted()`, called directly inside the `agentSessionEnsure.spawn` closure immediately after `providerResult = await ctx.provider.spawn(ctx.spawnOptions)` | fire-and-forget call, return discarded | **Second, outer-of-the-provider invocation of guard layer 2 — missed by round 3's table entirely** | Becomes `const commitResult = await ctx.reportPtySpawnCommitted()`. For an eligible (`LocalPtyProvider`) delegated spawn this is always a **duplicate-after-settled** read of the same cached result site #12 already produced inside `ctx.provider.spawn(...)` — never a second transaction attempt (§4.5.2's cache makes this true regardless of ordering). For any other provider (`spawn-options.ts:176-182`'s condition excludes it from #11's wiring, so site #12 never fires for it), this is the **first and only** real firing, and must observe the identical first-invocation/duplicate discipline §4.5.2 defines — it must never be a floating, unobserved Promise either way |
| 17 | `spawn-execute.ts:148` — `onFreshSpawn: ctx.reportPtySpawnCommitted`, passed by reference into `spawnForStablePane(...)` in the non-`agentSessionEnsure` branch | passthrough by reference | **Guard layer 2 forwarded under an alias — missed by round 3's table entirely** | Wiring, unchanged reference; the same closure as site #10, now typed per #18's widening; its invocation is site #19, not this line |
| 18 | `stable-owner.ts:169` — `StablePaneSpawnContext.onFreshSpawn?: (result: PtySpawnResult) => void` | `?: (result: PtySpawnResult) => void` | Type-only declaration, **the alias's own type — missed by every grep of `onPtySpawnCommitted`** | Widen to `?: (result: PtySpawnResult) => Promise<DelegationCutoverCommitResult \| void> \| void` — the union keeps every existing caller that never passes this option, or passes a void-returning one, valid unchanged |
| 19 | `stable-owner.ts:302` — `args.onFreshSpawn?.(result)`, inside `spawnForStablePane`, only on the fresh-spawn branch (`args.owner` absent, or `attachStablePaneOwner` returned `null`) | fire-and-forget call, return discarded | **The alias's own invocation — missed by round 3's table entirely** | Becomes `const commitResult = await args.onFreshSpawn?.(result)`. `await`ing a `void`/`undefined` return resolves immediately, so every existing non-delegated caller (which passes no `onFreshSpawn`, or a plain `() => void` one) is unaffected — the smallest additive change satisfying mission 5 |

#### 4.5.1a Discovery method — binding architecture rule, added round 4

**Round 3's inventory was produced by grepping one callback identifier
(`onPtySpawnCommitted`) and was, by construction, blind to every alias,
forwarded reference, and differently-named parameter carrying the same
logical value — which is exactly how sites #14-#19 were missed.** This
SPEC now states the binding method for this document and for the
implementation/acceptance work that follows it:

> **Async spawn-commit completeness must be verified by tracing the
> logical operation itself — its return type, its assignments, its
> parameter and struct-field names, and every function it is passed
> into or returned from — never by grepping a single callback
> identifier.** An implementation or review that re-derives this
> inventory must independently confirm the site count (nineteen, this
> round) rather than trusting the number carried forward from the prior
> document, and must specifically search for re-bound closures
> (`const x = ctx.foo`), differently-named parameters receiving the same
> value (`onFreshSpawn` here), and type-only declarations of the same
> slot (`spawn-state.ts:80/183` here) — not only direct invocations.

**Invocation-order clarification, extended for round 4's sites:** for a
`LocalPtyProvider` delegated spawn taking the `agentSessionEnsure` branch
(`spawn-execute.ts:64-127`), site #12 (nested, inside `spawnLocalPty`,
reached because #11 wired guard layer 2 into the provider's own spawn
options) fires **first**, before `ctx.provider.spawn(...)` at
`spawn-execute.ts:85` ever resolves; site #16 (`spawn-execute.ts:88`) runs
immediately after that same call resolves and therefore always observes
guard layer 2 already `in_flight` or `settled` — never `idle` — so it can
never start a second logical operation. For the non-`agentSessionEnsure`
branch (`spawn-execute.ts:128-161`, `spawnForStablePane`), site #12 fires
the same way (nested inside `args.provider.spawn(args.spawnOptions)` at
`stable-owner.ts:301`) and site #19 (`stable-owner.ts:302`) is the
directly-subsequent statement — the same before/after relationship as
#12/#16, just reached through the alternate branch. On its first, real
invocation, guard layer 2 (site #10, read back identically by sites #12,
#16, #17/#19) invokes guard layer 1 (site #6), which invokes the real
application callback (site #5). Guard layer 1's **own** cached Promise is
what site #9 (the outer call in `createTerminal`) later observes. **All
call sites that read guard layer 2 back — #12, #16, and #17/#19 — read the
literal same closure instance per spawn**, because sites #14/#15 declare
and default-initialize exactly one `reportPtySpawnCommitted` slot on the
shared `RuntimePtySpawnState`, and site #10 is the only assignment to it.
There is one guard-layer-2 instance and one guard-layer-1 instance per
spawn, no matter how many of #12/#16/#19 execute against it; every guard
layer must independently cache and re-return/re-await the **same**
underlying Promise chain — not merely "not error twice" — for every one of
those call sites to observe genuine completion or the same already-settled
result, never `undefined`.

#### 4.5.2 Async-aware fire-once guard semantics (both guard layers, identically specified)

Replacing the current `reported: boolean` shape with an explicit
in-flight-Promise cache, at **both** guard layers (site #6 and site #10),
identically:

```ts
type SpawnCommitState =
  | { phase: 'idle' }
  | { phase: 'in_flight'; promise: Promise<DelegationCutoverCommitResult | void> }
  | { phase: 'settled'; result: DelegationCutoverCommitResult | void }
  | { phase: 'failed'; error: unknown }

function createAsyncSpawnCommitReporter(
  callback?: () => Promise<DelegationCutoverCommitResult> | void
): () => Promise<DelegationCutoverCommitResult | void> {
  let state: SpawnCommitState = { phase: 'idle' }
  return async () => {
    if (state.phase === 'in_flight') return state.promise          // DUPLICATE WHILE IN FLIGHT
    if (state.phase === 'settled') return state.result              // DUPLICATE AFTER SUCCESS
    if (state.phase === 'failed') throw state.error                 // DUPLICATE AFTER FAILURE
    const promise = Promise.resolve(callback?.())                   // FIRST INVOCATION
    state = { phase: 'in_flight', promise }
    try {
      const result = await promise
      state = { phase: 'settled', result }
      return result
    } catch (error) {
      state = { phase: 'failed', error }
      throw error
    }
  }
}
```

Frozen semantics, matching the mission's exact required shape:

- **First invocation:** invokes the underlying callback exactly once;
  durably (for the duration of the in-process guard's lifetime — not
  across a restart, which is a durable-DB-state question, §7 below, never
  an in-memory-guard question) records the in-flight promise.
- **Duplicate while in flight:** returns/awaits the **same** promise object
  — never starts a second transaction attempt.
- **Duplicate after success:** returns the **same cached** successful
  result — never repeats the binding/cutover write; a hypothetical second
  physical write is additionally impossible regardless, by
  `delegation_cutover`'s own `PRIMARY KEY`/`UNIQUE` constraints (§8.1) — two
  independent layers of protection, not one.
- **Duplicate after failure — the mission's explicit "choose and justify"
  requirement:** **adopts the mission's own preferred safety shape exactly:
  cache and re-throw the same failure for that process identity.** A
  duplicate call (the outer, site #9) never gets a second chance to
  succeed where the nested, site #12 attempt already failed, and can never
  silently convert an already-failed, already-torn-down prepared process
  into an authorized one. Recovery from a genuine failure happens only
  through the durable reconciliation sweep re-reading actual DB state
  (§7.4), never through a duplicate callback delivery being treated as a
  fresh attempt.

Both `createPtySpawnCommitReporter` (site #6) and `spawn-options.ts`'s
inline guard (site #10) are replaced by this identical shape — two call
sites, one specified behavior, no divergence between them. **Round 4
addendum:** this shape does not change per caller — sites #12, #16, and
#17/#19 all read back the same site-#10 instance and therefore all observe
the identical `idle → in_flight → settled|failed` transitions from
whichever of them happens to run first for a given spawn; no new guard
instance and no new state machine is introduced by naming the additional
call sites in §4.5.1.

#### 4.5.3 `DelegationCutoverCommitResult` — evidence of durable state, never authority itself

Per the mission's explicit instruction ("the result itself does not become
authority, or is it only evidence that the durable DB fact exists? It must
be the latter") — restated as a hard rule, not left implicit:

```ts
type DelegationCutoverCommitResult =
  | { outcome: 'COMMITTED'; correlationId: string }
  | { outcome: 'ALREADY_COMMITTED_SAME_IDENTITY'; correlationId: string }  // idempotent retry / duplicate-after-success surfaced through a fresh re-read, not the in-memory cache
  | { outcome: 'REJECTED_PRE_COMMIT'; reason: 'fence_ineligible' | 'store_busy_retryable' | 'store_error' }
  | { outcome: 'DIVERGENCE'; detail: string }             // durable state disagrees with what this attempt expected — never silently trusted
  | { outcome: 'RECONCILIATION_REQUIRED' }                // an exception occurred after the transaction may have committed but before this Promise could observe it — see below
```

- **`COMMITTED`/`ALREADY_COMMITTED_SAME_IDENTITY` are reports of an
  already-durable fact, not the fact itself.** Authority transferred at the
  instant the real `BEGIN IMMEDIATE … COMMIT` transaction (§7) actually
  committed in SQLite — which may be *before* this Promise's resolution is
  observed by any caller, per the ordinary async-runtime gap between "the
  driver acknowledges commit" and "the awaiting code resumes." No caller
  may treat "the Promise has not yet resolved" as evidence authority has
  not transferred.
- **`RECONCILIATION_REQUIRED` is the honest answer to the mission's own
  posed scenario** — an exception (process crash excepted, §12; this is
  for an in-process exception, e.g. a driver error after the underlying
  commit but before the calling code observes success) fires between the
  commit and the Promise settling. The caller **must never infer authority
  from Promise rejection alone in this case** — it must re-read
  `delegation_cutover` for this `correlationId` from the Execution store
  before choosing any cleanup/release action (§7 below). This is not a
  hypothetical: it is the same class of gap ORCA-S1–S4's own `SQLITE_BUSY`
  retry discipline already treats as ordinary, not exceptional.
- **No other outcome values are invented** — five is sufficient and each
  has a distinct, necessary caller action; the mission's "do not invent
  unnecessary states" is honored by keeping this list closed.

### 4.6 Reentrancy / latency analysis (mandatory, not assumed)

**What is held open while the nested callback is awaited, corrected round
3:** the outer `claimStablePaneCreate`/pane-spawn reservation
(`create-terminal.ts:45-58`) is released in an **inner**
`finally { releaseStablePaneCreate() }` immediately wrapping the
`ptyController.spawn(...)` call (`orca-runtime-create-terminal.ts:175-177`)
— **not**, as round 2 imprecisely stated, "at the end of `createTerminal`."
(The function's outer end-of-body `finally`, lines 295-297, is a
now-idempotent no-op via the `stablePaneCreateReleased` guard — real, but
not where release actually happens.) The substantive conclusion is
unchanged and, if anything, tighter than round 2 described: the reservation
spans **exactly** the `ptyController.spawn(...)` call, including everything
inside `spawnLocalPty` — so awaiting the durable transaction at line 89
**does** hold that reservation open for the transaction's duration. **Concrete effect:** a *concurrent* spawn request
for the exact same `(worktreeId, connectionId, tabId, leafId)` pane would
block on `existingPaneSpawn.promise` (`spawn-options.ts:201`) until this
transaction completes — a real, named latency cost, not zero as an
unexamined "just await it" claim would imply. This is **not a new failure
mode**: the reservation already exists specifically to serialize concurrent
spawns for the same pane; this correction makes one already-serialized
window measurably longer. No deadlock is possible from this alone — nothing
in the durable transaction's own code path calls back into pane-reservation
or PTY-controller code.

**Does the durable transaction call back into PTY/runtime code?** No —
`delegation_cutover`'s transaction (§8.1) is pure Execution-store SQLite I/O,
independent of `ptyController`/provider internals. No reentrancy hazard was
found from the transaction's own side.

**Does delaying `activateLocalPtySession` (and therefore `proc.onExit`
registration) create a new failure mode?** **No — it widens an
already-existing window, it does not create one.** Independently confirmed:
the codebase already carries an early-exit detection mechanism
(`earlyExitedPtyIncarnations`, populated somewhere in the exit-handling path
this session did not fully trace, and consumed by
`assertPtyDidNotExitBeforeRegistration`, §7) specifically for the case where
a spawned process exits before its exit listener is attached — this race
already exists in the unmodified codebase between `spawnLocalPty`'s process
creation and `activateLocalPtySession`'s `proc.onExit(...)` registration.
Awaiting the durable commit at line 89 makes that pre-existing window
longer; it does not introduce a qualitatively new race, and the downstream
check (§7) composes correctly regardless of the window's length, since it
runs later regardless.

**Can cancellation arrive while the durable callback is awaited?**
`spawnLocalPty` checks `args.signal?.aborted` only before the OS process is
created (line 63-65) — there is no signal check between process creation and
return today, with or without this correction. Adding the awaited durable
commit does not introduce a *new* cancellation race; it does mean a
cancellation arriving during this window is handled the same way it already
is today — via the normal post-spawn teardown path once control returns,
never by aborting mid-callback.

**Can provider cleanup run concurrently?** No concurrent cleanup path for
the *same* `id`/`incarnationId` was found reachable before
`activateLocalPtySession` registers it — `allocatePtyId` (line 39) reserves
the id synchronously before any of this runs.

**Verdict:** the chosen seam is reentrancy-safe and introduces one
quantifiable, bounded, already-precedented latency cost (pane-spawn
reservation held for the transaction's duration) and widens one
already-existing, already-instrumented early-exit race rather than creating
a new one. Nothing here required moving durable orchestration out of the
provider.

### 4.7 Duplicate spawn-commit delivery — idempotence, both nested and outer, corrected round 3

Round 2's version of this section described the pre-correction boolean
`reported` guard; §4.5.2's async-aware guard (both layers) supersedes it.
Restated against the corrected mechanism, for the local-PTY delegated path
(§4.2's table):

- The **nested** call (site #12, `local-pty-spawn.ts:89`) is always the
  **first** delivery — it fires before the outer call site is ever
  reached, and is the one that actually starts the real logical operation
  (state transitions `idle → in_flight → settled|failed`, §4.5.2).
- The **outer** call (site #9, `create-terminal.ts:179`) now `await`s the
  same guard layer, and — because it always runs strictly after the nested
  call already started (§4.1 steps 5-7) — it always observes `in_flight`
  (and then awaits the same promise to `settled`/`failed`) or already
  `settled`/`failed`. **It can never observe `idle` and therefore can
  never start a second logical operation, and it can never report success
  before the durable transaction the nested call started has actually
  completed** — directly satisfying gate 47.
- **Exactly one logical spawn-commit protocol executes per authoritative
  production execution identity** — guaranteed by two independent
  mechanisms, not one: the async-aware guard (§4.5.2, prevents a second
  *callback invocation* and propagates the same result/failure to every
  duplicate caller) and, defensively, `delegation_cutover`'s own `PRIMARY
  KEY`/`UNIQUE` constraints (§8.1, prevents a second *durable commit* even
  in a hypothetical future where the JS guard were bypassed). Duplicate
  callback delivery is harmless by construction at both layers, including
  the duplicate-after-failure case (§4.5.2 — cached, re-thrown, never
  silently retried).

**Round 4 addendum — the two additional read-back sites named in §4.5.1
(#16 `spawn-execute.ts:88`, #19 `stable-owner.ts:302`, both reached via
`onFreshSpawn` at #17 for the latter):** these are not new firing paths,
they are additional **readers** of the same guard-layer-2 instance #10
already covers. For the eligible `LocalPtyProvider` delegated spawn, #16
and #19 each run strictly after the branch's own call into
`ctx.provider.spawn(...)`/`args.provider.spawn(...)` resolves — which is
exactly where #12 already fired guard layer 2 nested, inside that same
call — so both #16 and #19 always observe `in_flight` or `settled`, never
`idle`, and can never start a second logical operation for a delegated
spawn. For a provider outside #11's `LocalPtyProvider`/
`routesFreshSpawnsToLocalProvider` condition (out of Slice B's local-only
delegation scope, §20, but still real, shared infrastructure code), #16 or
#19 is the *only* firing — still safe, because it is still routed through
the identical async-aware guard (§4.5.2) with the identical
first-invocation/duplicate semantics; it simply plays the role site #12
plays for the local provider. **Exactly one logical spawn-commit protocol
executes per authoritative production execution identity remains true
across all five read-back sites (#9, #12, #16, #17/#19), not merely the
two round 3 named.**

---

## 5. The corrected cutover / process-bind ordering (closes item A) — frozen state machine (corrected round 2)

### 5.1 Why the ordering is not a choice, restated against the corrected seam

Process creation necessarily precedes the Maestro-side durable commit — this
conclusion from round 1 is unchanged, but its grounding is now precise: the
durable commit hooks the **nested** `onPtySpawnCommitted` invocation inside
`spawnLocalPty` (§4.3), which by construction cannot fire before
`spawnShellWithFallback` has already created the real OS process
(`local-pty-spawn.ts:71-89`, a single, uninterrupted synchronous sequence
with no `await` between process creation and the hook firing). The real
runtime still has no "prepared but not yet spawned" execution instance;
inventing one remains forbidden suspension semantics. **Process creation
necessarily precedes the Maestro-side durable commit, and both now happen
inside one provider function's call stack, not across two separate
top-level awaits as round 1's diagram implied.**

### 5.2 The frozen numbered state machine (corrected)

Renumbered and split to match the real call graph traced in §4.1 — every
state below is anchored to a specific line, not to an assumed outer
boundary:

```
S0   NATIVE_ELIGIBLE
       (aiControl: orca_fence_state='none'; authority AICONTROL_NATIVE)
S1   FENCE_ACQUIRED                    [aiControl commit — Phase 1, §6]
       (orca_fence_state='fenced'; authority still AICONTROL_NATIVE; native
        claim/dequeue/direct-claim/execute structurally impossible, §6.2)
S2   ORCA_PREPARING
       (createAgentSession/createTerminal resolve dispatch/worktree identity
        — the real dispatch worktree itself already durably exists on disk,
        via Maestro's existing, unrelated worktree infrastructure, §13; the
        new dispatch_worktree ROW is not yet written, that happens at S5 —
        preAllocatedHandle minted, and createTerminal sets
        deferDelegatedCommandDelivery: true on the PtySpawnOptions (§4.1a);
        §4.1 steps 1-2; nothing durable-to-this-slice yet)
S3   LOCAL_PROCESS_SPAWNED             [real side effect — local-pty-spawn.ts:71-88]
       (createLocalPtyLaunchPlan/createWindowsLocalPtyLaunchPlan resolve
        shellArgs FIRST, with the workload command WITHHELD from argv
        construction per S2's flag, §4.1a — the shell family's own
        bootstrap behavior is proven inert with respect to the delegated
        workload, §4.1b — THEN spawnShellWithFallback returns; the real OS
        process + pid exist; the delegated workload command is provably NOT
        in this process's argv or any input it has received, §4.1a/§4.1b;
        STILL nested inside spawnLocalPty, before activateLocalPtySession;
        no exit listener registered yet, §7)
S4   PROVIDER_HOOK_INVOKED             [local-pty-spawn.ts:89 — the chosen seam, §4.3]
       (the nested onPtySpawnCommitted call begins; the durable transaction
        attempt starts; still nested, still inside spawnLocalPty)
S5   ORCA_DELEGATION_CUTOVER_COMMITTED [Maestro durable commit — THE authority-transfer instant]
       (single atomic SQLite transaction, §5.4 — combines what a naive
        reading of the mission's ordering would separate into two steps,
        "durable process binding" and "durable delegation_cutover", into
        ONE transaction deliberately, so no window can ever exist where a
        process is durably bound but not yet delegated, or vice versa;
        authority is ORCA_DELEGATED for this correlation_id from this
        instant; aiControl does not yet know; still nested inside the
        awaited callback)
S6   EXECUTION_RELEASED                [spawnLocalPty's own control flow, §4.5]
       (the durable commit returned committed:true; spawnLocalPty proceeds
        PAST the point where §4.5's teardown branch would have fired, into
        activateLocalPtySession — this proceeding IS the release act; no
        separate durable fact marks it, because S5's own commit is what
        authorizes it, and nothing between S5 and S6 can legally diverge:
        the very next synchronous step after a successful await is this
        continuation)
S7   PROVIDER_ACTIVATION_COMPLETE      [activateLocalPtySession, §4.1 step 6]
       (exit listener registered — proc.onExit — closing the early-exit
        detection window described in §4.6; startup-command delivery is
        SCHEDULED, gated on shell-ready, not yet fired)
S8   OUTER_SPAWN_RESOLVED              [createTerminal.ts:127's await returns]
       (spawnLocalPty's promise resolves → ptyController.spawn() resolves;
        the OUTER onPtySpawnCommitted call at line 179 fires as a
        guaranteed no-op, §4.1 step 7/§10; assertPtyDidNotExitBeforeRegistration
        runs, §7; registerPreAllocatedHandleForPty/registerPty/reveal
        proceed — FIRST external visibility, restating §5.3's invariant)
S9   AICONTROL_CUTOVER_ACKNOWLEDGED    [aiControl commit — Phase 3, §6]
       (orca_fence_state='fenced'→'cutover'; acknowledgement only)
S10  ORCA_EXECUTING                    [writeStartupCommandWhenShellReady fires, §4.4]
       (shell-ready reached; the agent's actual command is written — THE
        ONLY point in this entire sequence the delegated workload command
        is ever delivered anywhere, §4.1a; this is the first point workload
        execution genuinely begins. NOTE: this can occur concurrently with,
        or even slightly before, S8/S9 completing in wall-clock time — it
        is gated on shell-readiness, not on the outer spawn promise — but
        it can NEVER occur before S5/S6, because activateLocalPtySession,
        which schedules it, is only reached from S6, and S6 only exists
        because S5's durable commit succeeded)
S11  ORCA_TERMINAL_CLOSED              [dispatch_lifecycle_closure written, §9]
S12  AICONTROL_TERMINAL_PROJECTED      [projectDelegatedTerminalResult, §10]
```

Two reconciliation/incident branches, entered from any of S1–S11 on a
genuine contradiction, never silently absorbed into the happy path:

```
S-INC   RECONCILIATION_INCIDENT   (a dispatch_lifecycle_incident row — never a fabricated fact)
S-REL   FENCE_RELEASED            (only from S1-S4, only via §6.4's positive-evidence path)
```

### 5.3 The critical invariant, restated precisely against the corrected S3-S8 sequence

**No externally visible authoritative workload side effect may occur before
S5's durable commit.** "Externally visible" is unchanged from round 1's
definition (`registerPty`, `revealTerminalSession`,
`publishPtyBackedMobileSessionTerminal`, IPC, SSE, mobile session publish —
all real, named calls, all confirmed to happen no earlier than S8) — what
changes is the precise location of S5 itself: it is now correctly placed
**nested inside `spawnLocalPty`, before `activateLocalPtySession` (S7)**,
not at an outer point after `ptyController.spawn()` resolves. The bare
existence of the spawned-but-not-yet-activated process at S3-S4 is not
itself externally visible — not to a renderer, not to aiControl, and, per
§4.1's finding, **not even to Maestro's own PTY exit-tracking or pty
registry yet**.

**Genuinely resolved now, not merely restated — and not by round 2's own
(falsified) reasoning (§4.4):** workload execution (S10) provably cannot
precede the durable commit (S5) for a delegated spawn, because §4.1a's
`deferDelegatedCommandDelivery` contract makes `writeStartupCommandWhenShellReady`
the **only** delivery path (never argv-embedding), and that mechanism is
only ever scheduled from S7, which is only reached from S6, which only
exists because S5 committed. Round 2 asserted this same conclusion without
having verified the premise; round 3 verified the premise and found it
needed correcting before the conclusion could actually hold (§4.4).

### 5.4 Transaction boundary at S5

```
BEGIN IMMEDIATE;
INSERT run_binding (ORCA-S1, unchanged schema);
INSERT dispatch_worktree (ORCA-S3, unchanged schema, pointed at the REAL
  dispatch worktree the real Orca runtime already governs — never a new
  worktree, never ORCA-S3's own durable *shadow* worktree root, §13);
INSERT dispatch_process_binding (ORCA-S4 schema + §8.2's new
  teardown_reason column, NOT NULL pid/os_start_marker — always known at
  this point, §5.1, so ORCA-S4's NOT NULL pid constraint needs NO amendment);
INSERT delegation_cutover (§8.1);
COMMIT;
```

One transaction, four inserts, the same `BEGIN IMMEDIATE` +
bounded-`SQLITE_BUSY`-retry discipline every prior slice uses. Deliberately
**one** transaction, not two — the mission's own numbered ordering lists
"durable process binding" and "durable delegation_cutover" as separate
steps (5, 6), and this SPEC deliberately collapses them into a single
atomic commit so that no crash window can ever land between them (§5.5
rows C4/C5 would otherwise be required and are structurally impossible
instead).

### 5.5 Crash windows at the ordering boundary (subset; full table §14, all rows re-derived for the corrected seam)

| Window | Point | Durable state | Authority | Process state | Recovery |
| --- | --- | --- | --- | --- | --- |
| **C0** | crash during S2 (before any spawn) | nothing durable, no process | `AICONTROL_NATIVE`; fence `fenced` at aiControl (S1 durable) | none exists | retry S2→S3 from scratch; §6 fence path (B) makes a same-token retry idempotent |
| **C1** | crash at S3-S4 boundary (process spawned, `onPtySpawnCommitted` not yet invoked — vanishingly narrow, no `await` between them, but a whole-host crash can land at any instruction) | nothing durable | `AICONTROL_NATIVE` | a real process exists, invisible to every Maestro/Execution-store mechanism | identical disposition to C2 below — §5.6 |
| **C2** | crash at S4, inside the awaited durable transaction, before it commits | nothing durable (transaction never committed) | `AICONTROL_NATIVE` | a real, unbound process exists | §5.6's fail-closed identity-recovery-then-release path |
| **C3** | crash exactly at S5 (durable commit lands, host dies before the `await` in `spawnLocalPty` even returns control) | `delegation_cutover` + `dispatch_process_binding` fully durable | `ORCA_DELEGATED` already (S5's own fact) | the real process is still alive (nothing tore it down — no failure occurred) | on restart: the sweep finds a committed binding with no corresponding provider-side activation ever confirmed; §5.6 extends its own recovery primitives to re-adopt it, never respawn |
| **C4** | crash at S6-S7 (commit succeeded, `spawnLocalPty` proceeding into/through `activateLocalPtySession`, before the exit listener registers) | same as C3 | `ORCA_DELEGATED` | real process alive, still not exit-tracked by the provider | same as C3 — the sweep's restart-recovered identity path (§7.1) does not depend on the provider's own exit listener ever having existed |
| **C5** | crash at S7-S8 (provider activation complete or in progress, `spawnLocalPty`'s own promise not yet resolved up to `createTerminal`) | same as C3 | `ORCA_DELEGATED` | real process alive, possibly exit-tracked, possibly already running the workload (S10 can race ahead of S8, §5.2) | same as C3; Maestro's own `registerPty`/reveal never ran, so a restart finds no in-memory bookkeeping either — the committed `dispatch_process_binding` is the only durable anchor, and it suffices |
| **C6** | `assertPtyDidNotExitBeforeRegistration` throws at S8, after S5 already committed | `delegation_cutover` durable, `ORCA_DELEGATED` already true; process is confirmed EXITED (that is what the throw means) | `ORCA_DELEGATED` | dead — not a crash, an ordinary control-flow branch | §7 — a full dedicated section, not folded into this table |
| **C7** | crash after S9 (aiControl ack), before S10 | same as C3 plus aiControl shows `'cutover'` | `ORCA_DELEGATED` | real process alive or already executing | resume normally; ack is already durable on both sides |

### 5.6 The honest disposition of C1/C2/C3/C4 (a real orphan or a real unconfirmed-activation instance, not a synthetic one)

Unlike ORCA-S4's synthetic shadow process, a process in windows C1-C4 is a
**real user-facing process**, and — per §4.1's corrected tracing — for C1-C2
it is not durably bound at all, while for C3-C4 it **is** durably bound
(`dispatch_process_binding` committed) but the provider's own activation
(exit tracking, command delivery scheduling) may not have completed. Two
real, already-existing primitives make every one of these recoverable
without inventing anything:

1. `createAgentSession`'s own `reclaim.identity` (worktreeId, connectionId,
   terminalHandle) was already recorded **before** any spawn was attempted
   (§4.1 step 1) — durable in the operation ledger for the lifetime of that
   ledger entry (bounded by `AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS`).
2. `reclaimFencedAgentSessionSpawn` (`orca-runtime-create-agent-session.ts:273`)
   already calls `reconcileRemoteTerminalCreate(worktreeId, terminalHandle,
   connectionId)` — read-only adoption, "never spawns and never kills" (its
   own doc comment) — to find whether the PTY the failed operation started
   is still alive, by handle, not by scanning.

**For C1-C2 (no durable binding exists):** on an operation-ledger timeout
with no S5 commit ever observed, Slice B's own sweep (§12) must attempt the
same `reconcileRemoteTerminalCreate`-by-`terminalHandle` lookup before
declaring the process unrecoverable. If found alive and
identity-corroborated: complete S5 late (a delayed commit is still correct —
nothing authoritative happened before it, §5.3) and proceed. If not found,
or ambiguous: **fail closed** — raise
`dispatch_lifecycle_incident(kind='pre_cutover_orphan_process')`, release
the fence via §6.4's positive-evidence path, and never guess.

**For C3-C4 (durable binding already exists, provider activation
unconfirmed):** the sweep's ORCA-S4-inherited restart-recovered identity
path (sidecar/nonce/OS-marker match, §7.1) is the primary recovery
mechanism — it does not depend on the provider's own `proc.onExit`
registration ever having happened, because it re-derives liveness from the
OS directly (`pid` existence + `os_start_marker` re-read), not from Node
event-listener state. **This is why the design deliberately does not
introduce a second, provider-specific recovery path for C3-C4**: ORCA-S4's
existing mechanism already covers "durably bound, no live in-memory
tracking" as its normal restart case (that is, in fact, its *only* case —
ORCA-S4's composition root never persists a cross-call handle registry
either, §9.1.2). No new mechanism is required; this is confirmed reuse, not
an assumption.

### 5.7 Cutover committed, command not yet delivered, then crash — frozen contract (new, round 3)

The exact scenario the mission names: S5 committed, S6 (release) happened,
S7 (`activateLocalPtySession`) may or may not have finished scheduling
delivery, S10 (actual command write via `writeStartupCommandWhenShellReady`)
has **not** yet fired — then Maestro/the host crashes.

**Does not require a durable "command delivered" fact of its own — outcome
(C), a terminal/reconciliation outcome for the same instance, is frozen,
not (A) or (B):**

- **(A) rejected:** "safely retryable/idempotent redelivery to the same
  process" cannot be proven — `writeStartupCommandWhenShellReady` writes to
  the PTY's stdin-equivalent input stream; nothing in the traced code gives
  a durable marker of whether bytes already in flight before the crash were
  received by the shell, so blindly re-writing risks a duplicated or
  garbled command line. This SPEC does not claim idempotent redelivery
  without evidence for it.
- **(B) rejected:** inventing a new durable "command delivery" fact and
  writer is exactly the kind of new mechanism §5.6 already argues against
  where an existing one suffices — and one already does (below).
- **(C) frozen:** on restart, the sweep (§12) finds a `dispatch_process_binding`
  with `delegation_cutover` already committed and no `dispatch_termination`
  yet. It applies **the same restart-recovered identity path §5.6 already
  uses for C3-C4** — re-derive liveness from the OS (`pid` +
  `os_start_marker`), never from in-memory delivery state (which the
  restart destroyed regardless). Two outcomes, both already-specified
  mechanism, no new fact:
  - **Process still alive, identity-verified:** command delivery status is
    genuinely unknown (it may have been written, partially written, or not
    written at all) — this SPEC does **not** attempt to guess or redeliver.
    The process is treated as a live, authoritative, already-delegated
    execution instance whose observable behavior (output, eventual exit)
    the sweep continues to track via the unmodified ORCA-S4 mechanism
    (§9.3) exactly as it would for any other live delegated process. If the
    agent never received its command, it will simply sit idle at a shell
    prompt — an operationally observable, not a silently-corrupted, state;
    a future implementation may add a liveness/output heartbeat check as
    an operational refinement, but this SPEC does not require one to be
    correct, only to be potentially slow to notice.
  - **Process confirmed gone:** `dispatch_termination(termination_method='confirmed_dead_unknown_cause')`
    (ORCA-S4 §8.2, unchanged), closure computes `terminal_status_ref = NULL`
    (§9.2, honestly unclassifiable — this SPEC does not invent "failed
    because command delivery was interrupted" as a fact it cannot prove),
    and a `dispatch_lifecycle_incident` is raised for operator
    adjudication.
- **Absolute in both branches:** **no second process is ever spawned.**
  The fence is **never** released (S5 already committed — §6.1's own CAS
  already refuses a release against a `'cutover'` row). Authority remains
  `ORCA_DELEGATED` regardless of whether the command was ever delivered.

### 5.8 Authority-aware callback-failure cleanup (new, round 3, supersedes §4.5's undifferentiated version)

§4.5's teardown-on-rejection branch is now split explicitly by **when** the
failure/uncertainty is discovered, per the mission's explicit instruction
not to let callback rejection alone decide which authority owns cleanup.
**Round 4 note:** this section is already site-agnostic by design — it
branches on durable re-read state, never on which of §4.5.1's read-back
sites (#9, #12, #16, #17/#19) happened to observe the rejection — so
naming the additional round 4 sites requires no change here; a rejection
observed at #16 or #19 is cleaned up by exactly the same two branches
below as one observed at #9 or #12.

**Failure discovered before S5 ever commits** (a `REJECTED_PRE_COMMIT` or a
thrown exception where a re-read of `delegation_cutover` for this
`correlationId` — required whenever the outcome is not already known with
certainty, §4.5.3 — confirms no row exists):

- `AICONTROL_NATIVE` remains authority — nothing transferred.
- the delegated workload is never released (S6 never reached).
- the prepared process (S3-S4) is safely terminated via §4.5's identity-verified
  teardown.
- Maestro may seek fence release **only** through §6.1's positive-evidence
  path (`safeReleaseOrcaFence`), and only because the re-read genuinely
  confirms no cutover ever committed — never merely because the callback
  rejected.

**Failure/uncertainty discovered after S5 has committed** (a
`RECONCILIATION_REQUIRED` outcome, or any re-read of `delegation_cutover`
for this `correlationId` that finds a row already exists — including a
`DIVERGENCE` outcome, where the durable row disagrees with what this
specific attempt expected, e.g. after a retried operation observes a row
committed by an earlier, already-completed attempt):

- `ORCA_DELEGATED` is already authority — permanently, for this
  `correlation_id` (§8.1, no un-delegation path).
- **the fence must never be released**, under any circumstance, for this
  identity — §6.1's own CAS already enforces this structurally (`'fenced'`
  only, never `'cutover'`).
- process cleanup/termination from this point on is **Orca's own delegated-
  authority action** (§9.3's ordinary termination path), never a
  pre-cutover teardown.
- the resulting outcome (whatever it turns out to be) is classified through
  the authoritative delegated terminal lifecycle (§9) — `completed`,
  `failed`, `cancelled`, `timeout`, or the honest
  `unclassifiable`/`NULL` case (§9.2) — never silently reinterpreted as "the
  delegation attempt itself failed."
- **there is no return to native authority from this branch, ever.**

**When the outcome is genuinely ambiguous at the moment of failure** (the
`RECONCILIATION_REQUIRED` case, §4.5.3): the caller **must** re-read
`delegation_cutover` before choosing which of the two branches above
applies — never infer from "the callback rejected" or "the callback never
resolved" alone, per the mission's explicit rule.

### 5.9 Early bootstrap death while the durable callback is in flight, under deferred delivery (new, round 3)

The scenario: the bootstrap shell process (S3/S4) dies **while** S4's
durable callback is still awaited (S4→S5, transaction in progress) — before
the transaction has committed either way.

- **Is `delegation_cutover` allowed to commit after observed early death?**
  **No new check is required to prevent this, because none is possible
  without one:** the durable transaction itself has no liveness check built
  in (it is pure SQLite I/O, §4.6) — it will commit or fail on its own
  terms regardless of the process's OS-level state at that instant. This
  SPEC does **not** add a synchronous liveness re-check inside the
  transaction (that would be a new, unjustified coupling between the
  Execution store and PTY-provider internals, contradicting §4.6's own
  finding that "the durable transaction ... independent of `ptyController`/
  provider internals" is a *safety* property, not an accident). Instead:
  **a commit that lands after the process has already died is not
  incorrect — it is simply a `delegation_cutover` for a process that turns
  out to already be dead**, discovered honestly at the very next sweep pass
  via the **same** `earlyExitedPtyIncarnations`/`assertPtyDidNotExitBeforeRegistration`
  mechanism (§4.6, §7.2) or, if that in-process signal was itself lost to
  the crash, via the sweep's own OS-liveness re-check (§9.3).
- **If cutover already committed:** treated identically to §5.7's "process
  confirmed gone" branch — `confirmed_dead_unknown_cause`, honest
  `NULL` terminal classification, incident raised, **no respawn, no fence
  release** (authority already transferred).
- **If cutover had not yet committed** (the transaction was still in
  flight or failed before landing): treated identically to §5.6's C1-C2 —
  fail-closed identity check, fence released only via positive evidence
  that the process is genuinely gone and no commit occurred.
- **Absolute, restated:** early shell death, whenever it happens relative
  to the durable commit, **never** resurrects native execution once cutover
  has genuinely committed, and **never** triggers an automatic respawn in
  either branch.

---

## 6. The real cross-repo aiControl fence handshake (closes item B)

Every phase below cites the exact function and CAS predicate from
`orca-fence.ts` / `orca-fence-projection.ts` (`origin/master`,
`ab5967bdde…`), not a paraphrase.

**Phase 0 — native eligible.** `agent_runs.orca_fence_state = 'none'`.
Authority `AICONTROL_NATIVE`.

**Phase 1 — acquire fence.** Maestro generates `token` (caller-supplied,
never minted by aiControl — `orca-fence.ts:14`) and calls
`acquireOrcaFence({ runId, token })`. Its CAS
(`orca-fence.ts:97-105`):

```sql
UPDATE agent_runs SET orca_fence_state='fenced', orca_fence_token=:token, orca_fenced_at=:now
WHERE id=:runId AND status IN ('pending','queued') AND orca_fence_state='none'
```

Five real outcomes, all already implemented: `ACQUIRED`,
`ALREADY_FENCED_SAME_TOKEN` (idempotent retry, same token),
`CONFLICT_DIFFERENT_TOKEN`, `ALREADY_CUTOVER`, `NOT_ELIGIBLE`. A sixth,
**`ACQUISITION_DISABLED`**, fires unconditionally while
`isOrcaFenceAcquisitionEnabled()` reads false (`orca-fence.ts:49-51`,
`process.env.ORCA_FENCE_ACQUISITION_ENABLED === 'true'`) — this is the R3
activation gate (§18), and it is **the current real state of the published
system**: this session confirmed no override makes it true. aiControl
remains authority; native claim/dequeue/direct-claim are now structurally
impossible for this row (the prerequisite's own §3 proof, not re-derived
here); Maestro is **not yet** authority.

**Phase 2 — prepare.** Maestro's own S2/S3 (§5.2 above), entirely internal,
no aiControl interaction, no durable Execution-store fact yet at S2, one real
side effect (process spawn) at S3.

**Phase 3 — Maestro cutover commit (§5.4).** The authority-transfer instant.
Entirely inside Maestro's database; aiControl cannot observe it directly —
this matches the prerequisite doc's own §5 Phase 2 language ("not built or
specified here... aiControl cannot observe it directly") verbatim.

**Phase 4 — aiControl acknowledgement.** Maestro calls
`acknowledgeOrcaCutover({ runId, token })`. Its CAS
(`orca-fence.ts:255-263`):

```sql
UPDATE agent_runs SET orca_fence_state='cutover', orca_cutover_at=:now
WHERE id=:runId AND orca_fence_state='fenced' AND orca_fence_token=:token
```

Idempotent (a retry with the same token that finds the row already
`'cutover'` with the same token is treated as `ACKNOWLEDGED`, not an error —
`orca-fence.ts:277-279`). A wrong/stale token is rejected
(`REJECTED_WRONG_TOKEN` / `REJECTED_STALE`). If acknowledgement is lost:
Maestro remains authority (Phase 3 already happened); retry is naturally
idempotent per the same CAS.

**Phase 5 — execution / closure / terminal projection.** §5.2 S9–S12, §9,
§10.

### 6.1 Release — the only path that clears a fence, and why break-glass never does

`safeReleaseOrcaFence({ runId, token, positiveNoCutoverEvidence })`
(`orca-fence.ts:162-186`) requires the caller to **assert** positive
evidence — the function has no way to verify it, only to refuse when the
caller admits it has none (`orca-fence.ts:150-158`'s own doc comment). Its
CAS matches only `orca_fence_state='fenced'` (never `'cutover'`), so a stale
release after cutover is rejected, not silently accepted. **Slice B's own
obligation:** never call this with `positiveNoCutoverEvidence: true` except
from §5.6's C1 fail-closed path (a confirmed-dead pre-commit process) or an
equivalent explicit, evidence-backed withdrawal before S5 ever commits — a
timeout, a lost response, or operator judgment are explicitly insufficient
per the prerequisite's own §6.1, and this SPEC does not weaken that.

`flagOrcaFenceBreakGlass` (`orca-fence.ts:215-232`) is **structurally
incapable of clearing a fence** — it performs zero `.update()` calls to the
three fence columns, by construction (its own doc comment). Slice B never
calls it to unblock anything; it is aiControl's own operator-facing
reconciliation marker, out of this SPEC's scope entirely.

---

## 7. Corrected process/execution-plane ownership contract (closes item C)

Answering the mission's eight questions directly, against real code:

1. **Who creates the production process/execution instance?** Maestro's
   already-shipping local PTY provider (`spawnLocalPty`, behind
   `ptyController.spawn()`), at S3 (§5.2) — never a new, second, competing
   spawn mechanism.
2. **Who owns its PID/handle?** Maestro's `orca-runtime` pty registry
   (`registerPty`), from S8 onward; the durable `dispatch_process_binding`
   row (Execution-owned) holds the `pid` + `os_start_marker` as a durable
   *copy*, written at S5 — nested, inside the provider, before S8 — not a
   second ownership claim.
3. **Who durably binds it to the delegated dispatch?** The S5 transaction
   itself (§5.4) — `dispatch_process_binding.orca_dispatch_id` is the
   binding key.
4. **What object crosses the ExecutionPlane port?** `ShadowLifecycleProcessPort`'s
   exact interface (`spawn`/`observe`/`requestTermination`, ORCA-S4 §9),
   **unmodified as a type**, with a new adapter (§7.1) whose `spawn(...)`
   does not call `spawnProcess` — it **adopts** the already-real
   `{ pid, killScope, osStartMarker, osStartMarkerSource }` the real runtime
   already produced at S3-S4, synchronously, never discovered later by
   scanning.
5. **Does the port create the process, adopt an externally-created process,
   or prepare an execution handle?** **Adopts.** Named explicitly — this is
   the one point where Slice B's adapter genuinely differs from ORCA-S4's
   `spawn`-creates-a-process adapter, and the port's own shape
   accommodates it without a type change (ORCA-S4 §5 pre-designed exactly
   this substitutability).
6. **How is execution prevented before authority cutover?** §5.3's
   visibility invariant, now grounded in the corrected seam location — not
   process non-existence (§5.1 shows that is not achievable), but zero
   external reachability, and (per §4.4) no workload-command delivery,
   until S5 commits.
7. **How is the same execution instance recovered after Maestro restart?**
   §11 — the real `ptyController.adoptStablePane` /
   `reconcileRemoteTerminalCreate` primitives, never a second spawn.
8. **Who is allowed to signal/terminate it after cutover?** Orca, exclusively,
   via ORCA-S4's unmodified `signalProcessTree`/pid-addressed termination
   path (§9.3 there), now protecting a real user process — never aiControl
   directly (§12).

### 7.1 `RealDelegatedProcessPort` — an adapter, not a new port shape

Implements ORCA-S4's exact `ShadowLifecycleProcessPort` (§9, that SPEC),
substituted behind the same port interface, exactly as ORCA-S4 §5
anticipated:

- `spawn(...)` does not call `spawnProcess`. It receives, synchronously at
  the S4 seam (§4.3, `local-pty-spawn.ts:89`, nested inside `spawnLocalPty`),
  the real `{ pid, incarnationId }` `spawnResult.process` already carries,
  and the real `osStartMarker`/`osStartMarkerSource` captured via the
  **same** local-host primitives ORCA-S4 already uses
  (`windows-process-table.ts` / `/proc/<pid>/stat` / `ps -o lstart=`) — never
  a fabricated value, and honestly `'unavailable'` if the host cannot supply
  one (ORCA-S4 §8.1's own fallback, unchanged).
- `observe(...)` / `requestTermination(...)` reuse ORCA-S4's existing
  `signalProcessTree` / pid-addressed sibling entry point **verbatim** — the
  same fail-closed sidecar/nonce/OS-marker discipline, including the macOS
  compound argv/nonce proof (ORCA-S4 §9.1.3), now protecting a real process.

### 7.2 `assertPtyDidNotExitBeforeRegistration` — the real non-crash throw path (reconciled with deferred delivery, round 3)

Independently traced (`orca-runtime-register-pty.ts:189-205`): this is an
**ordinary, deterministic control-flow check**, not a crash. It fires at S8
(`create-terminal.ts:195`), reading an in-memory map
(`earlyExitedPtyIncarnations`) populated somewhere in the exit-handling path
between S7 and S8, and throws `agent_session_exited_during_start` when the
just-spawned PTY has **already exited** before Maestro's own registration
step runs. Answering the mission's questions exactly:

- **Can a durable binding already exist when it throws?** **Yes, always** —
  by construction. S8 is strictly downstream of S5 (§5.2); the durable
  `dispatch_process_binding`/`delegation_cutover` transaction has already
  committed by the time this check can ever run. This is the corrected
  understanding round 1 lacked (round 1 never named this check at all).
- **Can `delegation_cutover` already exist?** Yes, same reasoning — it is
  the same transaction as the binding (§5.4), always committed before S8.
- **Can workload have executed?** **Necessarily not before S5/S6, provably
  (§4.1a/§4.1b, corrected round 3)** — the deferred-delivery contract makes
  argv-embedding impossible for a delegated spawn, so no workload content
  exists anywhere before the durable commit. **But it can have executed
  between S6 and S8** — per §5.2's S10 concurrency note,
  `writeStartupCommandWhenShellReady` is gated on shell-ready, not on S8, so
  a pathological fast exit could in principle race against an
  already-scheduled command write, entirely on the authorized (post-S5)
  side of the invariant. This does not change the classification below —
  authority already transferred at S5 regardless of whether S10 ever ran —
  and §5.7 already freezes the exact "command delivery status unknown"
  disposition for this case, reused here rather than re-derived. The
  precise interleaving is flagged (§21, carried from round 2) as an
  implementation-time proof obligation for gate 39, not an open
  correctness question this section leaves unresolved.
- **Who terminates/reaps the process?** No one needs to — the throw's own
  precondition (`earlyExitedPtyIncarnations.has(ptyId)`) **means the
  process has already exited on its own**; there is nothing live to
  terminate. This is exactly ORCA-S4's own `self_exit`/`confirmed_dead`
  classification shape (§9.2), not a new kind of failure.
- **May the fence be safely released?** **No — this is the critical
  correction this subsection freezes.** Unlike C1-C2 (§5.6), where release
  is legitimate because cutover never committed, here **cutover already
  committed (S5)** — Orca is already authority. Releasing the fence now
  would violate §6.1's own rule (release requires the fence to still be
  `'fenced'`, not `'cutover'` — the real `safeReleaseOrcaFence` CAS already
  refuses this by construction, §6.1) and would be substantively wrong
  regardless: authority already transferred; this is not an aborted
  cutover, it is a **post-cutover early-exit**, functionally identical to
  any other post-cutover process death.
- **What evidence proves cutover did or did not occur?** The durable
  `delegation_cutover` row's own existence — never inferred from whether
  this specific exception fired.
- **Authority and classification:** `ORCA_DELEGATED` (unchanged by the
  throw). `createTerminal`'s `catch` block
  (`orca-runtime-create-terminal.ts:196-201`) already calls
  `this.releaseRejectedPtyRegistrationFence(...)` for exactly this error —
  a **pre-existing, real cleanup path** this SPEC reuses rather than
  invents. Slice B's own sweep (§12) independently converges the same
  outcome via ORCA-S4's ordinary `dispatch_termination` classification
  (§9.2) on its next pass regardless of whether that in-process cleanup
  runs — restart-safe by the same mechanism as every other post-cutover
  termination, not a special case.

**This closes crash-matrix row C6 (§5.5) precisely**: C6 is not a crash at
all — it is this exact, ordinary, already-real control-flow branch,
occurring **after** authority has already transferred.

### 7.3 Provider eligibility gate — code-level, not scope discipline (new, round 3)

**Round 2's defect, per the independent rereview:** "local-only scope"
(§20) was a documented intent, never an enforced check. This section
freezes a real, code-level gate, reusing an **already-existing capability-probe
pattern** rather than inventing a new mechanism — `IPtyProvider` already
declares exactly this shape for two unrelated capabilities:

```ts
// pty-provider-contract.ts:134,138 — existing precedent, unmodified
supportsAgentSessionClaims?: (options?: PtyProbeOptions) => boolean | Promise<boolean>
supportsAgentSessionCreateOperations?: (options?: PtyProbeOptions) => boolean | Promise<boolean>
```

**New, symmetric capability, same shape:**

```ts
supportsDelegatedCutoverHold?: (options?: PtyProbeOptions) => boolean | Promise<boolean>
```

`LocalPtyProvider` declares it `true`. No other provider declares it at
all (absent ⇒ `undefined` ⇒ treated as `false`, per the existing
`?.() === false` idiom `spawn-options.ts:154-165` already uses for the two
precedent capabilities). **Checked before `ORCA_PREPARED_NOT_AUTHORIZED`
(S2) is ever entered** — mirroring exactly where the two existing
capability checks already run, in `buildRuntimePtySpawnOptions`:

```ts
// new, same location and idiom as spawn-options.ts:152-159/160-166
if (
  isDelegatedSpawn &&
  (await (ctx.provider as IPtyProvider).supportsDelegatedCutoverHold?.(...)) !== true
) {
  throw new Error('delegated_cutover_provider_unsupported')
}
```

**Supported, this slice:** the local PTY provider path proven throughout
§4 — `LocalPtyProvider` and any path `routesFreshSpawnsToLocalProvider`
routes there (the same condition §4.1 step 3 already uses to decide
firing-site threading — reused, not duplicated, so the eligibility gate and
the firing-site logic can never silently disagree about which spawns are
"local").

**Unsupported, explicitly, this slice — fail closed before cutover, never
silent native fallback:**

- remote/SSH execution (out of scope per §20, unchanged) — the daemon-routed
  provider does not declare the capability;
- any provider whose spawn-commit chain is not genuinely awaitable end-to-end
  per §4.5's corrected contract — a provider declaring the capability
  without actually implementing the async contract is a future
  implementation defect this gate cannot detect by construction (a
  capability declaration is a claim, not a proof) — the acceptance gates
  (§19, gate 41-class) must independently verify `LocalPtyProvider`'s own
  declaration is honest, not merely that the flag exists;
- any provider that can pre-deliver the workload (the exact defect §4.1a
  corrects for the local provider specifically) — a future provider must
  prove the same deferred-delivery property before it may declare this
  capability; this gate does not and cannot verify that property by itself,
  it only gates entry on the declaration existing.

**Failure mode:** `delegated_cutover_provider_unsupported` is thrown
**before** `acquireOrcaFence` is ever called (checked at the earliest point
`createAgentSession`/`createTerminal` know which provider a request would
route to) — no fence is acquired, no process is prepared, `AICONTROL_NATIVE`
is never disturbed. **Never** a silent fallback to native execution for a
request that asked for delegation — an explicit, typed rejection the caller
must handle, consistent with "fail closed, never silent" throughout this
document.

---

## 8. Durable model (Execution-owned, additive-only)

`EXECUTION_SCHEMA_VERSION` 5 → 6 — **two new tables, two additive nullable
columns on two ORCA-S4 tables, zero column added to any ORCA-S1–S3 table.**

### 8.1 `delegation_cutover` — the cutover fact (SOURCE, write-once, immutable)

```sql
CREATE TABLE IF NOT EXISTS delegation_cutover (
  correlation_id     TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id   TEXT NOT NULL REFERENCES dispatch_process_binding(orca_dispatch_id),
  orca_run_id        TEXT NOT NULL,
  aicontrol_run_id   TEXT NOT NULL,
  fence_token        TEXT NOT NULL,   -- the exact token supplied to acquireOrcaFence
  cutover_digest     TEXT NOT NULL,   -- SHA-256(fence_token || aicontrol_run_id || orca_dispatch_id)
  cutover_at         TEXT NOT NULL,
  ack_status         TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'acknowledged' — mutable bookkeeping, not a correctness fact
);
CREATE UNIQUE INDEX IF NOT EXISTS delegation_cutover_by_aicontrol_run
  ON delegation_cutover(aicontrol_run_id);
```

- Written once, at S5, in the same transaction as `run_binding` /
  `dispatch_worktree` / `dispatch_process_binding` (§5.4).
- **SOURCE. Never dropped or regenerated by a projection rebuild** — it *is*
  the authority-transfer fact; a rebuild that could not reproduce it would be
  indistinguishable from silently un-delegating a run.
- Every column except `ack_status` is immutable after insert. `ack_status`
  is the **one** permitted post-insert mutation, set by Phase 4 (§6) or the
  sweep's own retry of it — never touching `cutover_digest` or any `*_ref`.

### 8.2 Extensions to two existing ORCA-S4 tables (additive, nullable, backward-compatible)

```sql
ALTER TABLE dispatch_process_binding ADD COLUMN teardown_reason TEXT;
  -- 'user_cancel' | 'timeout' | NULL (NULL until a teardown is ever requested)
  -- written in the SAME UPDATE as teardown_requested_at (§9.1) — never a
  -- separate statement, so there is no window where intent exists without reason.

ALTER TABLE dispatch_lifecycle_closure ADD COLUMN terminal_status_ref TEXT;
  -- 'completed' | 'failed' | 'cancelled' | 'timeout' | NULL
  -- NULL only for a closure whose termination_method_ref = 'confirmed_dead_unknown_cause'
  -- (§9.2) — never guessed, never defaulted to 'failed'.
```

Both additions are nullable and default `NULL`, so every ORCA-S4 row ever
written (all synthetic, shadow-only) is unaffected and every ORCA-S4
acceptance test remains byte-valid. `EXECUTION_SCHEMA_VERSION` 5→6's ladder
step is "ensure these two tables + these two columns exist" — no data
migration, mirroring every prior slice's own additive discipline.

### 8.3 `aicontrol_terminal_projection` — the projection outbox

```sql
CREATE TABLE IF NOT EXISTS aicontrol_terminal_projection (
  correlation_id          TEXT PRIMARY KEY REFERENCES dispatch_lifecycle_closure(correlation_id),
  aicontrol_run_id        TEXT NOT NULL,
  fence_token_ref         TEXT NOT NULL,   -- copy of delegation_cutover.fence_token
  closure_digest_ref      TEXT NOT NULL,   -- copy of dispatch_lifecycle_closure.closure_digest at read time
  attempt_count           INTEGER NOT NULL DEFAULT 0,
  last_attempted_at       TEXT,
  projected_at            TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending'
    -- pending | projected | blocked_fence_mismatch | blocked_already_terminal_divergent | blocked_closure_contradicted
);
CREATE UNIQUE INDEX IF NOT EXISTS aicontrol_terminal_projection_by_run
  ON aicontrol_terminal_projection(aicontrol_run_id);
```

Created (`status='pending'`) once a `dispatch_lifecycle_closure` exists with
`terminal_status_ref IS NOT NULL` and
`post_closure_settlement_conflict_detected_at IS NULL` (ORCA-S4's own
prohibition, inherited verbatim, §14 LIFE-15 there). A closure with the
conflict marker set, or with `terminal_status_ref IS NULL` (the honest
"cannot classify" case, §9.2), is created directly as
`status='blocked_closure_contradicted'` — no aiControl call is ever
attempted for it.

---

## 9. Durable cancelled-vs-timeout contract (closes item D)

### 9.1 The reason is captured at the moment of decision, never inferred later

`convergeDelegationBoundaryLifecycle`'s Phase 1 (ORCA-S4 §9.3, unmodified
control flow), when it decides to request termination, now writes **both**
columns in the **same** statement:

```sql
UPDATE dispatch_process_binding
SET teardown_requested_at = :now, teardown_reason = :reason
WHERE orca_dispatch_id = ? AND teardown_requested_at IS NULL
```

`:reason` is `'user_cancel'` when the teardown originates from §12's
cancellation command handler, or `'timeout'` when it originates from the
sweep's own SLA check (§12) — decided **before** `signalProcessTree` is
ever called, never derived afterward from signal, exit code, or elapsed
time. This is the durable owner of the distinction: `dispatch_process_binding.teardown_reason`.

### 9.2 Closure computes `terminal_status_ref` from durable facts only

At Phase 3 (ORCA-S4 §11, unmodified control flow), alongside the four
existing `*_ref` copies, compute:

- `dispatch_termination.termination_method = 'self_exit'` → `terminal_status_ref
  = dispatch_termination.exit_code === 0 ? 'completed' : 'failed'`.
- `termination_method = 'signalled'` → `terminal_status_ref =
  dispatch_process_binding.teardown_reason` (`'user_cancel'` maps to
  `'cancelled'`, `'timeout'` maps to `'timeout'` — a fixed, reviewable
  two-entry map, never a heuristic).
- `termination_method = 'confirmed_dead_unknown_cause'` → `terminal_status_ref
  = NULL`. **Never guessed.** A closure with this shape is created directly
  as `blocked_closure_contradicted` in the projection outbox (§8.3) and a
  `dispatch_lifecycle_incident(kind='unclassifiable_terminal_status')` is
  raised for operator adjudication — honest under-determination, not a
  fabricated verdict.

`terminal_status_ref` is included in `closure_digest`'s input set (extending
ORCA-S4's four-field digest to five), so a retried closure computation is
byte-comparable exactly like every other `*_ref` field.

### 9.3 Why Orca, not aiControl, is the classification authority for delegated runs

Reading `orca-fence-projection.ts` directly (its own doc comment, lines
7-14): `projectDelegatedTerminalResult` is **deliberately not**
`finalizeRunOnce` — it never touches `execution_attempts`, "because none
exists for a delegated run (no native claim ever succeeded)." aiControl's
own `classifyAttemptOutcome` logic requires an `execution_attempts` row to
classify from; none is ever opened for a delegated run. **This means
aiControl's classification authority structurally cannot apply to a
delegated run's outcome — there is nothing for it to classify.** This
corrects the rejected candidate's §5 ownership-matrix claim ("aiControl's
own frozen outcome-classification logic remains sole authority for what
[the terminal result] means semantically") — that claim does not hold
against the real, published projector's actual contract, which trusts
`status` **verbatim** from its caller. Orca is therefore the sole
classification authority for a delegated run's `completed`/`failed`/
`cancelled`/`timeout` status; aiControl's role is COPY-NEVER-DECIDE storage
of an already-final verdict via CAS (§10), never semantic re-interpretation.
This is a correction beyond the mission's enumerated A–G, surfaced only by
reading the real code the rejected candidate's stale checkout could not.

---

## 10. Terminal projection — copy, CAS, and the real divergence gap (closes item G)

`AiControlDelegationProjectionWriter` (new, Execution-owned infrastructure —
**not** `AiControlDbReader`, whose I1 read-only invariant is untouched) calls
the **real, published** `projectDelegatedTerminalResult({ runId, token,
status, finishedAt, stdout, stderr })` — never a hand-rolled SQL statement
against `agent_runs`, so Slice B inherits the projector's own CAS exactly:

```sql
UPDATE agent_runs SET status=:status, finished_at=:finishedAt, ...
WHERE id=:runId AND orca_fence_state='cutover' AND orca_fence_token=:token
  AND status NOT IN ('completed','failed','timeout','cancelled')
```

Four real outcomes (`orca-fence-projection.ts:24,67-96`): `PROJECTED`,
`ALREADY_TERMINAL`, `FENCE_MISMATCH`, and a **declared-but-never-returned**
`DIVERGENCE`.

### 10.1 The real residual, read from the file, not paraphrased

Lines 90-95 of `orca-fence-projection.ts`:

```
// Identity matches; the row is simply already terminal — idempotent no-op,
// never a re-decision. (A future DIVERGENCE outcome is reserved for a
// caller that re-reads and finds its own supplied status/fields disagree
// with what was already projected — this prerequisite's RED contract does
// not exercise that path, so it is not fabricated here.)
return { outcome: 'ALREADY_TERMINAL' }
```

Confirmed by direct inspection: when the CAS's `status NOT IN (...)` guard
excludes an already-terminal row, the function returns `ALREADY_TERMINAL`
**unconditionally** — it never re-reads the row's `status`/`finishedAt`/
`stdout`/`stderr` and compares them against the caller's own supplied
`input`. A genuinely conflicting delegated result (Maestro says `'failed'`,
the row already says `'completed'`) is therefore silently treated as a
benign idempotent no-op today, exactly as `docs/HANDOFF.md`'s own residual
entry states.

### 10.2 Activation prerequisite, frozen here, not implemented here

**Before Maestro may send a single real `ORCA_DELEGATED` terminal
projection, aiControl must ship an accepted, published fix to
`projectDelegatedTerminalResult` that:** re-reads the already-terminal row's
`status`/`finished_at`/`stdout`/`stderr` when the CAS excludes it on the
"already terminal" branch; compares them field-for-field against the
caller's `input`; returns `ALREADY_TERMINAL` only on exact semantic
equality; returns the (currently-unreachable) `DIVERGENCE` outcome on any
mismatch; never overwrites the existing terminal row in either case; remains
COPY-NEVER-DECIDE (the comparison decides *sameness*, never a new value).
**This SPEC does not implement that fix — it is aiControlCenter's own file,
under its own amendment process — and does not mark it solved.**

Until that fix ships and is independently accepted: `AiControlDelegationProjectionWriter`
treats every `ALREADY_TERMINAL` outcome as **unverifiable**, not as
confirmed agreement — it records `status='blocked_closure_contradicted'`
locally and raises an incident rather than assuming the silent no-op was
benign. This is the honest, fail-closed stance available with today's
published code; §18 makes the real fix a hard, separate activation gate on
top of it.

---

## 11. Execution cardinality (closes item F)

```
1 aiControl AgentRun (agent_runs.id)
  ↔ 1 delegation_cutover row (PK correlation_id, UNIQUE aicontrol_run_id)
  ↔ 1 dispatch_process_binding row (PK orca_dispatch_id)
  ↔ 1 real OS process, addressed by (pid, os_start_marker) AND by
      Maestro's own pre-existing terminalHandle/operationHandle identity
      (the `preAllocatedHandle` minted before spawn, §4.1 step 1)
```

**Recovery reconnects to the same identity; it is never a second attempt.**
This slice does not invent a recovery mechanism — it reuses two real,
already-shipping primitives:

- `ptyController.adoptStablePane` — already used inside `createTerminal`
  (§4.1) to re-attach to a pane by `(worktreeId, connectionId, tabId,
  leafId)` before ever spawning.
- `reconcileRemoteTerminalCreate` (via `reclaimFencedAgentSessionSpawn`) —
  already used to find a possibly-still-alive PTY by `terminalHandle`
  without spawning or killing anything.

On a Maestro restart, the sweep (§12) finds a `dispatch_process_binding`
with no `dispatch_termination`: it first attempts the restart-recovered
identity path already defined by ORCA-S4 §9.1 (sidecar/nonce/OS-marker
match against the real pid), and, only if that is ambiguous, falls back to
the same `terminalHandle`-based adoption `reclaimFencedAgentSessionSpawn`
already performs. **If neither path can positively confirm the same process
instance, the binding is left `identity_unverifiable` and a
`dispatch_lifecycle_incident` is raised — no automatic second spawn is ever
attempted**, satisfying the mission's "uncertainty never auto-spawns a
second process" gate directly. A genuinely new production attempt (a
deliberate retry after confirmed failure) requires a new
`delegation_cutover` row under a fresh fence token — a distinct future
protocol this SPEC does not define, exactly as the mission requires.

---

## 12. Cancellation / timeout authority (cancel-route description corrected, round 2)

- **Before cutover (S0–S4):** aiControl owns administrative cancellation,
  unchanged, via the real `finalizeRunOnce` + `extraRunFields` path the
  prerequisite doc's §7 already describes (clears the fence in the same
  statement as the terminal write). Orca has committed nothing yet at
  S0–S2; at S3-S4 a real process may exist with no Execution-store row —
  §5.6 defines its fail-closed disposition, never a native cancel racing an
  uncommitted seam.
- **The aiControl-cancellation-vs-Maestro-cutover race, resolved without
  wall-clock ordering:** exactly one of two durable facts commits first —
  aiControl's `finalizeRunOnce` CAS (which also clears
  `orca_fence_state`/`orca_fence_token` in the same statement, per the
  prerequisite §7) or Maestro's S5 transaction. If aiControl's cancel commits
  first: the fence is cleared; Maestro's own Phase-1 precondition re-check
  (§6, `acquireOrcaFence`'s `status IN ('pending','queued')` predicate) finds
  the run no longer eligible and S2-S5 never proceed for this
  `aicontrol_run_id` — no race to resolve after the fact, because the fence
  CAS itself is the single serialization point. If Maestro's S5 commits
  first: `orca_fence_state='cutover'` is later acknowledged (§6 Phase 4).

  **Corrected description of aiControl's real current behavior in this
  case** (round 1 inaccurately implied the cancel route already returns a
  distinct, cutover-specific error — independently re-read this round,
  `src/app/api/agent-runs/[id]/cancel/route.ts`, full file, `origin/master`,
  contains **no reference to `orcaFenceState` anywhere**). What the real
  code actually does: `agent_runs.status` is untouched by fencing/cutover
  (only `orca_fence_state`/`orca_cutover_at` change), so a post-cutover
  cancel request still finds `status` `'pending'` or `'queued'` and falls
  into the route's existing Case A/A2, which calls `finalizeRunOnce(...)`.
  The **real safety property still holds** — verified independently —
  because `finalizeRunOnce`'s own CAS predicate already excludes
  `orca_fence_state = 'cutover'` (`src/lib/agent-runner/run-finalizer.ts:219`,
  `ne(agentRuns.orcaFenceState, 'cutover')`), so that call affects zero rows;
  Case A/A2's existing "lost the CAS, re-read, report the real state
  honestly" fallback then returns a **generic** `409` (`"Cannot cancel run
  in status: pending"` / `"...queued"`) — **misleading wording** (it does
  not say *why* the cancel actually failed) **but never a false success, and
  never a dual-authority write**. This SPEC does not claim, and must not be
  read as claiming, that aiControl's real cancel route already returns a
  distinct `DELEGATED_EXTERNALLY`-style error — it does not. The underlying
  correctness invariant (post-cutover aiControl cannot authoritatively
  cancel) holds today regardless; a **route-level distinct error is UX/API
  hardening**, not a correctness dependency of this SPEC, and is classified
  explicitly in §18 as `PRE_LIVE_ACTIVATION` — desirable before live
  cutover so operators are not shown a misleading message, but not a
  blocker to freezing this architecture. Exactly one legal winner is still
  decided by which durable write lands first — never by comparing
  timestamps, and never by trusting the cancel route's *error text* as a
  correctness signal.
- **After cutover (S5+):** Orca owns cancellation exclusively, via a new
  Orca-owned command handler that writes `dispatch_process_binding.teardown_reason='user_cancel'`
  + `teardown_requested_at` in one statement (§9.1) — aiControl never
  signals a delegated real process directly, and never writes into the
  Execution store (single-writer discipline, ORCA-S4 LIFE-11, unchanged).
- **Timeout:** unreachable before cutover, by the same structural argument
  the prerequisite doc's own §8 already proves for aiControl-native timeout
  ("`getTimeoutMs`... is only reachable from inside `executeClaimedRun`...
  for a `running` row" — and §3.3 there proves a fenced row can never become
  `running`). After cutover, Orca's own sweep enforces the SLA (the value
  itself may still be aiControl-authored and copied at cutover time — an
  assumption this SPEC states, not confirms, per §21) and writes
  `teardown_reason='timeout'` before signalling (§9.1) — never inferred
  from elapsed time after the fact.
- **Concurrent self-exit vs. cancellation/timeout race:** resolved by
  `dispatch_termination`'s existing `PRIMARY KEY (correlation_id)` — whichever
  path commits first wins; the loser is a PK-collision no-op (ORCA-S4
  LIFE-6/LIFE-7, unchanged, reused verbatim).

---

## 13. Worktree / Git ownership — reused, not transferred

ORCA-S3's `base_commit`/`candidate_head`/`files_changed` capture is reused
unmodified, pointed at the **real** dispatch worktree Maestro's existing
`repo-worktrees.ts` infrastructure already creates and lists (confirmed
this session: `listRepoWorktrees`, `listLocalRepoWorktreesStrict`, etc. —
listing/inspection only, **no deletion function in this file**, confirming
the rejected candidate's own conclusion that real-worktree deletion timing
is a separate, product-lifecycle concern this repo does not currently
centralize in one place either). ORCA-S4's `WorktreeFinalizer` real-deletion
arm is **never invoked** for a delegated run's real worktree — every such
binding's `worktree_finalization.status` is recorded `'skipped_not_eligible'`
by policy, exactly as the rejected candidate's §12 concluded (this
conclusion is re-verified sound against the real `repo-worktrees.ts`, not
merely carried forward). A future slice may join Maestro's existing
worktree-lifecycle policy with Orca's mechanism; that join is explicitly not
claimed here.

---

## 14. Cross-DB crash matrix (full)

No distributed transaction exists between `data/app.db` (aiControl) and
Maestro's Execution DB. Every window below states authority, durable truth,
retry behavior, and the forbidden action:

| # | Window | Authority | Durable truth | Retry / reconcile | Forbidden |
| --- | --- | --- | --- | --- | --- |
| X1 | Fence request sent, response lost | `AICONTROL_NATIVE` | aiControl: possibly `'fenced'` already (F2, prerequisite §9) | retry with the **same** token — path (B) returns the existing fence deterministically | generating a new token for what the caller believes is the same request |
| X2 | Fence acquired (S1), Maestro crashes before S2/S3 | `AICONTROL_NATIVE`, blocked | `'fenced'` | resume S2 with the same token | any native admission/claim (already structurally impossible per §3 of the prerequisite) |
| X3 | Process spawned (S3-S4), Maestro crashes before S5 commits | `AICONTROL_NATIVE` (S5 never committed) | a real, Execution-store-invisible process may exist | §5.5/§5.6's C1-C2 identity-recovery-then-fail-closed path | an unconditional second spawn |
| X4 | S5 commits, crash before S9 acknowledgement | `ORCA_DELEGATED` (already true — Maestro's own DB) | `delegation_cutover` durable | retry Phase 4 with the same token (idempotent) | any aiControl-side assumption that native execution is still legal (it never was, from Phase 1) |
| X5 | S5 commits, aiControl acknowledgement permanently lost | `ORCA_DELEGATED` | aiControl shows `'fenced'` forever unless retried | operator/monitoring must eventually retry Phase 4; Orca's own correctness does not depend on it (§6 Phase 4) | releasing the aiControl-side fence without §6.1's positive evidence (there is none — cutover genuinely happened) |
| X6 | Execution terminal (S11), projection outbox row not yet delivered | `ORCA_DELEGATED` (closure is source truth) | `dispatch_lifecycle_closure` durable; `aicontrol_terminal_projection.status='pending'` | next sweep pass retries §10's CAS | treating an undelivered projection as lost correctness — it is retriable local state |
| X7 | aiControl projection CAS succeeds, local `status='projected'` ack lost | Orca (mechanical fact already true) | remote row terminal; local row `'pending'` | retry: CAS affects 0 rows because the row is already terminal → today (§10.2) this must be treated as **unverifiable, not confirmed**, until the real divergence fix (§10.2) ships; post-fix, a genuine field-for-field re-read-and-compare resolves it | assuming a 0-row CAS result always means "already correctly projected" while the divergence fix is unshipped |
| X8 | Two conflicting terminal projections attempted for the same run | Orca (closure is write-once, PK-guarded) | `dispatch_lifecycle_closure` cannot itself duplicate (PK); the *projection* could still race two writers | `aicontrol_terminal_projection`'s own PK (`correlation_id`) prevents Orca-side duplication; the aiControl-side race is exactly §10's residual | any code path that writes `aicontrol_terminal_projection` from anywhere but Phase 6 of the sweep (§8.3) |
| X9 | Maestro restarts while the real process still lives | Orca (unchanged by restart — no in-memory state was ever authoritative for `delegation_cutover`, mirrors prerequisite F12's own reasoning for the aiControl side) | `dispatch_process_binding` durable | §11's restart-recovered identity path, then adoption fallback | a second spawn under uncertainty |
| X10 | The real process disappears unexpectedly (crash, OOM-kill, host reboot) | Orca | `dispatch_process_binding` durable, no `dispatch_termination` yet | sweep Phase 1 (ORCA-S4 §9.3, unmodified) resolves it — `confirmed_dead_unknown_cause` if no `teardown_requested_at`, honestly unclassifiable at closure (§9.2) | inventing a `terminal_status_ref` for an unclassifiable case |
| X11 | aiControl cancellation races Maestro's S5 cutover commit | resolved by §12 — whichever CAS/transaction commits first | either the fence-clearing `finalizeRunOnce` row or `delegation_cutover` | the loser's caller observes zero eligible rows / a stale precondition and stops, never retries into the other outcome | racing them by wall-clock comparison |
| X12 | Cancellation races execution (self-exit vs. signalled) | resolved by `dispatch_termination`'s PK | whichever commits first | PK-collision no-op for the loser | a second `dispatch_termination` row |
| X13 | Timeout races cancellation | same as X12 — both are `teardown_requested_at`/`teardown_reason` writes; the CAS `teardown_requested_at IS NULL` guard admits exactly one | whichever `UPDATE` lands first | the loser's caller observes zero rows affected and treats the durable `teardown_reason` as authoritative, never overwrites it | two teardown reasons recorded for one binding |
| X14 | Worktree finalization races terminal closure | moot for a delegated real worktree — finalization's real-deletion arm never fires (§13); no race exists | `worktree_finalization.status='skipped_not_eligible'` always, for a real binding | N/A | invoking the deletion arm for any real dispatch worktree |
| X15 *(new, round 2)* | Durable commit at S4-S5 rejects/fails; `spawnLocalPty` must tear down the just-spawned, not-yet-authoritative process (§4.5) before returning | still `AICONTROL_NATIVE` (S5 never committed) | nothing durable for this attempt | the caller (`createAgentSession`) observes the propagated rejection and may retry S2 from scratch with a fresh attempt; the fence itself is unaffected (still `'fenced'`, §6, same-token retry path (B) applies) | leaving the torn-down process's identity unrecorded anywhere — §4.5 requires the teardown to address it by the same `pid`/`os_start_marker` pair the transaction would have written, never a bare-pid guess |
| X16 *(new, round 2)* | `assertPtyDidNotExitBeforeRegistration` throws at S8, after S5 already committed (§7.2) | `ORCA_DELEGATED` (S5 already committed — this is emphatically not window X3/X15; cutover already happened) | `delegation_cutover` + `dispatch_process_binding` durable; process confirmed already exited | Orca's own sweep converges via ORCA-S4's ordinary `dispatch_termination` classification (§9.2) on its next pass, independent of whether `createTerminal`'s in-process cleanup (`releaseRejectedPtyRegistrationFence`) also ran | releasing the aiControl-side fence (§6.1 already refuses this — fence is `'cutover'`, not `'fenced'`) |

---

## 15. Terminal event semantics

`convergeDelegationBoundaryLifecycle`'s existing Phase 4 (ORCA-S4 §11,
unmodified) continues to record `dispatch_lifecycle_event` exactly once per
`(correlation_id, event_kind)` — durable, restart-safe, idempotent-by-PK,
same as under shadow. Slice B adds no new event table; it adds a real
consumer: once `dispatch_lifecycle_event` exists **and**
`aicontrol_terminal_projection.status='projected'`, a wake-up notification
(hint only, never a correctness source, extending ORCA-S4's own LIFE-8
precedent) informs the real Orca runtime the task reached a terminal state,
so any UI can update promptly without waiting for its own poll. A missed
notification is never a correctness gap — the next scheduled sweep pass
re-derives the same durable state. `dispatch_lifecycle_event` remains
**SOURCE** (ORCA-S4 §8.0.1, unchanged); `aicontrol_terminal_projection`'s
own row is **SOURCE for its terminal state**, ordinary mutable retry
bookkeeping (`attempt_count`, `last_attempted_at`) while `status='pending'`.

---

## 16. Authority table (state labels/numbers corrected round 2)

| State | Admission | Execution | Process signaling | Worktree | Settlement | Terminal classification | Cancellation | Recovery | Terminal projection |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `NATIVE_ELIGIBLE` (S0) | aiControl | aiControl | aiControl | aiControl (native) | aiControl | aiControl | aiControl | aiControl | N/A |
| `FENCED_PRE_CUTOVER` (S1) | aiControl (fence blocks native, §6) | N/A — none started | N/A | aiControl | aiControl | N/A | aiControl (§12) | aiControl | N/A |
| `ORCA_PREPARING` (S2) | — (in-flight, uncommitted) | N/A | N/A | N/A | N/A | N/A | aiControl (§12) | N/A (nothing durable) | N/A |
| `ORCA_PREPARED_NOT_AUTHORIZED` (S3–S4: real process spawned, then the nested durable-commit hook invoked and in flight — §4.1, §4.3) | — | real process exists, unowned by any Execution-store row (§5.5 C1-C2) | **nobody** — Orca cannot yet, aiControl never | N/A | N/A | N/A | aiControl (still legal — fence not yet cutover) | §5.6's identity-recovery path | N/A |
| `ORCA_DELEGATED_CUTOVER_COMMITTED` (S5) | frozen (no more admission decisions for this run) | **Orca** | **Orca**, exclusively | Orca reads only, never deletes (§13) | Orca (§9) | **Orca** (§9.3) | **Orca** (§12) | Orca | not yet — no closure |
| *(S6-S8: execution released, provider activation, outer spawn resolved — mechanical continuation, §5.2)* | frozen | **Orca** — same ownership as S5's row throughout; these are sub-steps of one already-delegated commit, not separate authority states | Orca | Orca (read-only) | Orca | Orca | Orca | Orca | not yet |
| `AICONTROL_CUTOVER_ACKNOWLEDGED` (S9) | frozen | Orca | Orca | Orca (read-only) | Orca | Orca | Orca | Orca | not yet |
| `ORCA_EXECUTING` (S10) | frozen | Orca | Orca | Orca (read-only) | Orca | Orca | Orca | Orca | not yet |
| `ORCA_TERMINAL_CLOSED` (S11) | frozen | closed | closed | Orca (read-only, `skipped_not_eligible`) | Orca (`dispatch_lifecycle_closure`) | **Orca**, final (§9) | closed | Orca | pending outbox row exists |
| `AICONTROL_TERMINAL_PROJECTED` (S12) | frozen | closed | closed | Orca (read-only) | Orca | Orca (historical) | closed | Orca (historical) | **done** — `agent_runs` copy, aiControl-owned storage, never re-decided |
| `RECONCILIATION_INCIDENT` | frozen for this row | whatever it was at incident time, frozen | blocked (§9.3 fail-closed) | Orca (read-only) | frozen | `NULL` / disputed, never fabricated (§9.2) | N/A | operator | blocked (`blocked_closure_contradicted`) |
| `FENCE_RELEASED` | aiControl (run re-enters native lifecycle) | aiControl | aiControl | aiControl | aiControl | aiControl | aiControl | aiControl | N/A |

No row has two independent decision owners for the same column at the same
state — re-checked against the corrected S0-S12 sequence, including the new
intermediate mechanical states S3-S4 and S6-S8, none of which introduce a
second authority anywhere. This is the zero-dual-write proof the mission
requires.

---

## 17. Source / Projection / Incident classification

| Fact | Classification | Why |
| --- | --- | --- |
| `delegation_cutover` | **SOURCE** | the authority-transfer instant itself; never rebuildable |
| `dispatch_process_binding` (+ `teardown_reason`) | **SOURCE** (ORCA-S4 §8.0, extended) | ephemeral spawn-time identity + the reason captured before any signal |
| `dispatch_termination` | **SOURCE** (ORCA-S4 §8.0, unchanged) | ephemeral OS exit event |
| `worktree_finalization` | **SOURCE** (ORCA-S4 §8.0, unchanged) — always `skipped_not_eligible` for a real delegated binding (§13) | no filesystem act ever performed for a real worktree, but the *record of that decision* is still the durable, non-rederivable fact |
| `dispatch_lifecycle_closure` (+ `terminal_status_ref`) | **SOURCE** (ORCA-S4 §8.0.1, extended) | frozen point-in-time reference over facts that may still legitimately diverge later (ORCA-S2's own `observed_conflicted` escape hatch) |
| `dispatch_lifecycle_event` | **SOURCE** (ORCA-S4 §8.0.1, unchanged) | idempotent emission proof |
| `dispatch_lifecycle_incident` | **PROJECTION** (ORCA-S4 §8.4, unchanged) | deterministic function of already-durable SOURCE facts; safely regenerable |
| `aicontrol_terminal_projection` | **SOURCE for its own terminal state** (once `status` leaves `'pending'`); ordinary mutable retry bookkeeping while `'pending'` | mirrors ORCA-S4's `dispatch_lifecycle_event` write-once discipline for the copy-attempt outcome itself |
| aiControl's `agent_runs` terminal columns, for a delegated run | **PROJECTION**, by aiControl's own published contract (`projectDelegatedTerminalResult`'s own doc comment: "every value... a value Maestro already decided") | never re-decided by aiControl once written; Orca's `dispatch_lifecycle_closure` remains the actual source of truth |
| aiControl `orca_fence_state`/`orca_fence_token`/`orca_fenced_at`/`orca_cutover_at` | **SOURCE**, aiControl-owned | the only durable fence fact; no lease, no expiry (prerequisite §4) |

`aicontrol_terminal_projection` is a genuinely new outbox table this slice
introduces — kept, unlike a table the rejected candidate merely proposed,
because it is re-verified here to have a precise durable retry
responsibility (§8.3, §14 X6/X7) against the real, published projector, not
a hypothetical one.

---

## 18. Prerequisite classification (`PRE_IMPLEMENTATION` vs. `PRE_LIVE_ACTIVATION`) — corrected round 3

Two genuinely different kinds of "not yet true" appear in this document.
Round 1 conflated them under one label; round 2 separated them but its own
`PRE_IMPLEMENTATION` part (§18.1) was itself underspecified in two ways an
independent rereview found (§4.1a's argv blocker; §4.5's fake-await gap).
Both are now closed. Per the mission's explicit instruction, the
`PRE_IMPLEMENTATION` prerequisite is now stated as **two named parts that
together form the first implementation sub-slice**, not one.

### 18.1 `PRE_IMPLEMENTATION_PREREQUISITE`

**Part A — `DELEGATED_DEFERRED_COMMAND_DELIVERY`** (§4.1a/§4.1b): the
`deferDelegatedCommandDelivery` flag threaded from the delegated call path
down through `createLocalPtyLaunchPlan`/`createWindowsLocalPtyLaunchPlan`,
forcing the codebase's own already-existing "command not embeddable" branch
unconditionally, so `startupCommandDeliveredInShellArgs` is provably always
false for a delegated spawn and the shell's own bootstrap behavior is
proven inert with respect to the delegated workload.

**Part B — `TRUE_ASYNC_SPAWN_COMMIT_PROPAGATION`** (§4.5): the full
callback type-site widening (nineteen sites named exactly, §4.5.1, derived
by logical call-graph/symbol tracing per §4.5.1a — not thirteen, and not
by re-grepping one identifier), the async-aware fire-once guard replacing
both existing boolean guards identically (§4.5.2, now explicitly read back
by every one of the nineteen sites, §4.7), and the
`DelegationCutoverCommitResult` evidence-not-authority contract (§4.5.3) —
plus the teardown-on-rejection branch (§5.8, site-agnostic by design) and
the provider eligibility gate (§7.3).

**Together, Parts A and B must be implemented and independently proven**
(RED/GREEN, restart-harness-proven for crash windows C0-C7/X15-X16, §14)
**before** the rest of Slice-B's cutover mechanism can be built on top of
them, because every later mechanism (the durable transaction, §5.4; the
full crash-window table, §5.5-§5.9; the authority table, §16) assumes both
already exist and behave as specified. **This SPEC states explicitly: an
implementer can now proceed on both parts without further architectural
decisions about:**

- **argv delivery** — §4.1a names the exact flag, the exact functions it
  threads through, and the exact existing branches it forces;
- **shell/bootstrap inertness** — §4.1b traces every supported shell's
  actual launch args and states the precise, scoped inertness claim;
- **callback Promise propagation** — §4.5.1's table names every one of the
  nineteen sites, with no "and similar callers" gap, derived by symbol/
  call-graph tracing (§4.5.1a) rather than by name-grep;
- **duplicate async guard semantics** — §4.5.2 gives a complete, literal
  reference implementation shape for both guard layers;
- **provider eligibility** — §7.3 names the exact capability, its shape,
  and where it is checked;
- **command-release recovery** — §5.7-§5.9 freeze the exact contract for
  every crash/uncertainty window this correction introduces.

Everything an implementation session needs is named: exact files, exact
lines, exact signatures, exact failure branches, exact new fields.

### 18.2 `PRE_LIVE_ACTIVATION` dependencies (implementation may proceed; live cutover may not)

1. **aiControl R3.** `docs/HANDOFF.md`: `R1 COMPLETE`, `R2 CODE PUBLISHED`,
   **`R3 NOT STARTED`**. `isOrcaFenceAcquisitionEnabled()` reads
   `process.env.ORCA_FENCE_ACQUISITION_ENABLED === 'true'` — confirmed this
   session to default false and to be the sole gate; no code path bypasses
   it. Full-fleet fence-awareness must be operationally verified, not
   merely inferred from `git log`.
2. **Projector divergence fix shipped and published.** §10.2's fix to
   `projectDelegatedTerminalResult` must be independently accepted and on
   `origin/master` before a real terminal projection is ever attempted.
3. **Cancel-route distinct-error UX hardening** (§12, corrected round 2) —
   optional, not correctness-critical (the underlying CAS guard already
   makes post-cutover native cancellation impossible), but recommended
   before live cutover so operators see an accurate error instead of the
   real route's current generic, misleading `409`.

Additionally, before first live delegation: compatible Maestro Slice-B code
(this SPEC's own eventual implementation, including §18.1's seam) must be
independently accepted and deployed, and every S1–S4 regression suite must
remain green (§19 gate 30).

**If any of §18.1 or §18.2's items does not hold, fail closed — no live
cutover.** §18.1 blocks *implementation from starting correctly*; §18.2
blocks *live activation* once implementation and independent acceptance are
otherwise complete. Git publication of code is never conflated with fleet
deployment or with the projector fix's own independent acceptance.

---

## 19. Acceptance gates (future, executable — not satisfied by this document)

1. Real aiControl fence acquisition handshake exercised against the real
   `orca-fence.ts` functions (not a mock), including `ACQUISITION_DISABLED`
   while the gate is off.
2. Same-token idempotency — a repeated `acquireOrcaFence`/`acknowledgeOrcaCutover`
   call with the identical token is a deterministic no-op, never a second
   state change.
3. Cancellation-vs-cutover: exactly one winner, proven under an injected
   race at the CAS level (§12), never by timestamp comparison.
4. Process-preparation/cutover ordering: a crash-injection harness proves no
   Execution-store row, no registration, and no external visibility exist
   before the S5 transaction commits (§5.3), exercised specifically against
   the nested `spawnLocalPty` seam (§4.3), not a simplified outer-only
   model.
5. No workload side effect (registration, reveal, IPC, SSE) before cutover —
   a static call-graph audit of `orca-runtime-create-terminal.ts`'s post-spawn
   sequence.
6. One cutover → one authoritative execution instance — §11's cardinality,
   audited against a fixed sample of delegated runs.
7. Restart recovers the same process identity via `adoptStablePane`/
   `reconcileRemoteTerminalCreate` — never a second spawn (§11).
8. Uncertainty never auto-spawns a second process — §11, §5.6's fail-closed
   path exercised directly.
9. Cutover-acknowledgement loss (X4/X5) resolves correctly on restart/retry.
10. aiControl acknowledgement idempotency (`ACKNOWLEDGED` on a same-token
    retry, never a second write) — §6 Phase 4.
11. Native execution structurally impossible post-fence — reused, not
    re-proven, from the prerequisite's own §3.3/§13 gates 2-4.
12. Native settlement impossible post-cutover — reused from the
    prerequisite's own §8/§13 gate 17 (`orca_fence_state != 'cutover'` guard).
13. Durable `completed` outcome — self-exit, exit code 0.
14. Durable `failed` outcome — self-exit, nonzero exit code.
15. Durable `cancelled` outcome — `teardown_reason='user_cancel'`.
16. Durable `timeout` outcome — `teardown_reason='timeout'`.
17. `cancelled` != `timeout` — both exercised in the same test run against
    the fixed `teardown_reason` map (§9.2), never inferred from signal alone.
18. COPY-NEVER-DECIDE projection — a call-site audit proves
    `AiControlDelegationProjectionWriter` never computes a value; every
    field is byte-traceable to `dispatch_lifecycle_closure`.
19. Equal duplicate projection is idempotent (`ALREADY_TERMINAL` today,
    treated as unverifiable per §10.2 until the real fix ships; `PROJECTED`
    exactly once otherwise).
20. Conflicting projection fails loudly — **blocked on §10.2's real fix
    shipping**; until then, gate 20 is unsatisfiable and this SPEC does not
    claim otherwise.
21. Projector-divergence prerequisite required before live activation — §18
    item 2, enforced as a hard release gate, not a test this repo's own CI
    can run (the fix lives in aiControlCenter).
22. R3 required before live fence acquisition — §18 item 1.
23. Worktree provenance reused unmodified — a byte-diff of ORCA-S3's
    converge logic before/after this slice's implementation.
24. Worktree finalization real-deletion arm never fires for a real
    dispatch — static + runtime audit (§13).
25. Terminal event exactly-once, idempotent delivery — reused from ORCA-S4
    gate 14/LIFE-7, now against the real signal (§15).
26. Cross-DB crash windows X1–X16 (§14) each proven via a separate-child-process
    restart harness, mirroring every prior slice's own pattern.
27. Process signaling only by the current authority — aiControl never
    signals a delegated real process directly (static audit of every
    `signalProcessTree`/`kill` call site).
28. No auto fallback to aiControl-native execution after cutover — a
    negative test: a failed delegated run never re-admits natively.
29. Local-only scope — no remote/SSH process-identity claim anywhere in this
    slice's implementation (mirrors ORCA-S4 §5.1's own boundary, unchanged).
30. S1–S4 regression suites remain green and byte-unchanged; the two new
    nullable columns (§8.2) never appear in any ORCA-S4 fixture's asserted
    row shape.

**New gates, round 2 — the corrected provider seam (§4), not present in
round 1:**

31. The local provider genuinely invokes the spawn-commit protocol at the
    documented site (`local-pty-spawn.ts:89`, nested, before
    `activateLocalPtySession`) — a call-site assertion test, not merely a
    behavioral inference from outcomes.
32. The durable callback is awaited exactly where §4.5 requires (inside
    `spawnLocalPty`, before proceeding to `activateLocalPtySession`) — proven
    by a test that injects transaction latency and asserts
    `activateLocalPtySession` (and therefore the exit listener and startup
    command scheduling) never starts before the awaited call resolves.
33. No workload command is ever written to the PTY before the durable commit
    resolves successfully — a test asserting `writeStartupCommandWhenShellReady`
    is never reachable on a path where the durable commit rejected.
34. Callback rejection prevents workload release — a test asserting
    `activateLocalPtySession` is never called when the durable commit
    returns `committed: false` or rejects.
35. Callback rejection cleans up the prepared process safely — a test
    asserting the just-spawned process is terminated via the identity-verified
    path (§4.5, §7.1), never left running unowned, on every rejection branch.
36. The nested invocation does not deadlock or re-enter incorrectly — a test
    exercising a concurrent spawn request for the same pane
    (`(worktreeId, connectionId, tabId, leafId)`) while the durable
    transaction is in flight, asserting it correctly serializes via the
    existing pane-spawn reservation (§4.6) rather than deadlocking or
    corrupting state.
37. Duplicate nested/outer callback delivery is idempotent — a test asserting
    the outer `create-terminal.ts:179` call is a guaranteed no-op for a
    local-PTY spawn, and that forcing a second nested invocation (test-only)
    cannot double-commit `delegation_cutover` (§4.7, PK-enforced).
38. Cutover committed but the outer `ptyController.spawn()` promise not yet
    resolved is restart-safe — crash windows C4/C5 (§5.5) each proven via a
    separate-child-process restart harness, asserting the sweep's
    restart-recovered identity path (§7.1) recovers the same process without
    depending on the provider's own in-memory exit-listener state.
39. `assertPtyDidNotExitBeforeRegistration`'s post-cutover throw path (§7.2,
    window C6/X16) is recoverable — a test asserting the sweep converges to
    the correct `dispatch_termination`/`dispatch_lifecycle_closure` outcome
    regardless of whether `createTerminal`'s own in-process cleanup ran.
40. No second execution instance is ever created after an uncertain/ambiguous
    identity-recovery outcome — reused from gate 8, re-exercised specifically
    against the corrected seam's own crash windows (C1-C7).

**New gates, round 3 — deferred command delivery + true await propagation
(§4.1a-§4.1b, §4.5, §7.3), not present in round 2:**

41. **Windows delegated local launch never embeds the delegated startup
    command in argv** — an integration test exercising the **real**
    `createWindowsLocalPtyLaunchPlan` → `buildWindowsPowerShellSpawnAttempts`
    path (not a mocked shim) with `deferDelegatedCommandDelivery: true` and
    a command short enough to have been embedded absent the flag, asserting
    the resulting `shellArgs` never contain the command text.
42. `startupCommandDeliveredInShellArgs` is `false`/absent for every
    delegated spawn, across all three shell families (`cmd.exe`,
    PowerShell/`pwsh.exe`, and the non-Windows POSIX branch), exercised as
    a parameterized test over the real launch-plan functions.
43. The delegated bootstrap shell is exercised against §4.1b's proven-inert
    claim directly — a test confirming no delegated-workload-controlled
    content reaches the process before `writeStartupCommandWhenShellReady`
    fires (distinct from gate 41: this proves inertness of the *bootstrap
    phase itself*, not just absence from argv).
44. Every one of §4.5.1's nineteen callback sites preserves the Promise —
    a type-level test (`tsc` conformance) plus a runtime test injecting a
    slow (artificially delayed) durable-transaction mock and asserting the
    delay is observable at every read-back site (`create-terminal.ts:179`,
    `spawn-execute.ts:88`, `stable-owner.ts:302`), proving no intermediate
    layer or alias silently discards it.
45. First callback invocation exposes exactly one in-flight Promise — a
    test asserting `state.phase transitions idle → in_flight` exactly once
    per underlying callback invocation, both guard layers (§4.5.2).
46. Duplicate invocation while in-flight awaits the **same** Promise object
    (referential/resolution equality, not merely equal outcome) — exercised
    concurrently at both guard layers.
47. **The outer callback cannot report success before the durable
    transaction completes** — a test that delays the nested (site #12)
    transaction and asserts the outer (site #9) `await` does not resolve
    until the delayed transaction actually settles, closing the exact gap
    an independent rereview found in round 2.
48. Callback rejection propagates through every guard — a test that makes
    the real application callback (site #5) reject, asserting both guard
    layers (site #6, site #10) and the nested invocation (site #12) all
    observe the rejection, and the outer invocation (site #9) observes the
    **same cached** rejection (duplicate-after-failure semantics, §4.5.2).
49. Workload command delivery is impossible until durable cutover commit —
    an integration test spanning the full local path (§4.1) with a durable
    commit that never resolves (hung transaction simulation), asserting
    `writeStartupCommandWhenShellReady` is never reached.
50. Cutover committed + command not yet delivered is restart-safe without a
    second process — §5.7's exact scenario, proven via a separate-child-process
    restart harness: kill the host between S6 and S10, restart, assert the
    sweep recovers the same process identity (or honestly terminally
    reconciles it if gone) and never calls `spawnShellWithFallback` again
    for this `correlation_id`.
51. Failure before commit vs. after commit uses the correct
    authority-specific cleanup — §5.8's two branches each independently
    proven: a pre-commit failure never leaves `orca_fence_state='cutover'`;
    a post-commit failure never calls `safeReleaseOrcaFence`.
52. Unsupported provider is rejected before cutover — §7.3's gate, proven
    against a stub provider that does not declare
    `supportsDelegatedCutoverHold`, asserting `acquireOrcaFence` is never
    called.
53. No remote/SSH provider can enter delegated authority in this slice — a
    static audit confirming the daemon-routed/remote provider path never
    declares `supportsDelegatedCutoverHold`.
54. Early bootstrap death cannot cause automatic respawn — §5.9's exact
    scenario, both the pre-commit and post-commit sub-cases, each proven
    via a restart harness asserting zero additional `spawnShellWithFallback`
    calls.
55. **The acceptance suite exercises the real default Windows local-PTY
    launch plan, not only a synthetic stdin-delivery path** — per the
    mission's own explicit instruction; every gate above that touches
    launch-plan behavior (41, 42, 43, 49) must run against
    `createWindowsLocalPtyLaunchPlan`'s real PowerShell-default branch at
    least once, not exclusively against a command already too long/quoted
    to embed (which would pass even without `deferDelegatedCommandDelivery`
    and prove nothing about the fix).

**New gates, round 4 — complete async spawn-commit call graph (§4.5.1,
§4.5.1a), not present in round 3:**

56. Full logical spawn-commit call graph contains no void-discarding
    alias — a repository-wide static check (a `tsc` conformance test plus a
    lint rule or code-search assertion) that every symbol reading back
    guard layer 2 (`RuntimePtySpawnState.reportPtySpawnCommitted`,
    `StablePaneSpawnContext.onFreshSpawn`) is typed to return
    `Promise<DelegationCutoverCommitResult | void> | void`, never a bare
    `void`, and that every invocation of one of those symbols is either
    awaited or its result is returned to an awaited caller.
57. `spawn-execute.ts`'s delegated `agentSessionEnsure` path (site #16)
    awaits and propagates the real commit Promise — a test that delays
    guard layer 2's underlying settlement and asserts
    `executeRuntimePtySpawn`'s own returned Promise does not resolve until
    that settlement completes, exercised specifically through the
    `agentSessionEnsure` branch (not only through `local-pty-spawn.ts:89`
    in isolation, which gate 44 already covers).
58. `onFreshSpawn` (`stable-owner.ts:169`) preserves the async result on
    the delegated path — a type-level test asserting the widened signature
    accepts an `async` callback without a cast, plus a runtime test
    asserting a rejection thrown by the underlying guard is observable at
    `onFreshSpawn`'s call site.
59. Every `stable-owner.ts` `onFreshSpawn` invocation (site #19) awaits or
    propagates according to contract — a test asserting
    `spawnForStablePane`'s own returned Promise does not resolve until a
    delayed `onFreshSpawn` settles, and that a rejection from `onFreshSpawn`
    propagates to `spawnForStablePane`'s caller rather than being swallowed.
60. All aliases (sites #10, #12, #16, #17/#19) resolve to the same single
    in-flight Promise per execution identity — a concurrency test that
    triggers two or more of these call sites for the same spawn (where the
    branch structure allows it) and asserts referential/resolution equality
    of the observed result, not merely equal outcome.
61. A rejected durable Promise cannot become an unhandled rejection — a
    test that makes the real application callback (site #5) reject and
    asserts zero `unhandledRejection` process events across every code path
    that reads back guard layer 2, including the `agentSessionEnsure` and
    `spawnForStablePane` branches added this round.
62. No alias can let spawn flow continue after commit failure — an
    integration test asserting that a rejection observed at site #16 or
    site #19 prevents `executeRuntimePtySpawn`/`spawnForStablePane` from
    returning a result that downstream code (PTY registration, reveal)
    would treat as a live, authoritative spawn.
63. Implementation acceptance performs a symbol/call-graph audit, not a
    literal-name grep only — a standing CI or review-checklist gate
    (§4.5.1a) requiring any future change to the spawn-commit protocol to
    re-derive and state the current site count from source, rather than
    copying the number from the prior SPEC revision.

---

## 20. Deferred scope, unchanged from ORCA-S1–S4's own boundaries

- **`ORCA_AUTHORITATIVE`** — queue/admission/capacity/scheduler/FIFO/`QUEUE_FULL`
  transfer. Not touched anywhere above.
- **M5 — Controlled Fallback.** Remains `NEXT / READY TO START`, `NOT
  STARTED`. No fallback policy imported into this slice; a failed delegated
  execution is Orca's own terminal outcome to settle (§9), never a silent
  re-admission to aiControl-native.
- **Real (non-`MockExecutor`) executor parity.** Orthogonal, unaffected,
  exactly as `GAP-ANALYSIS-ORCA-DELEGATED.md` §6.2 concluded and ORCA-S4 §18
  reaffirmed.
- **Remote/SSH execution.** Local-only scope, per ORCA-S4 §5.1's own
  reasoning, unchanged: local PID/OS-marker semantics do not transfer to a
  remote host, and this slice's admission-grant precondition must fail
  closed for any non-local target — this SPEC does not attempt a remote
  identity/verdict model.

---

## 21. Unresolved architecture risks, stated plainly (not concealed) — round 3

**Correction to round 2's own claim in this section:** round 2 asserted its
item 1 ("whether workload begins before the seam fires") was resolved by
its §4.4. **That assertion was itself wrong** — an independent focused
rereview found §4.4's reasoning false against the real Windows argv-embed
path, exactly the class of error this section exists to prevent by staying
honest about what is and is not proven. It is genuinely resolved **now**,
by round 3's §4.1a/§4.1b (a real, additive contract, not a restated
assumption) — see §4.4's own corrected text for the honest account of what
changed and why. Round 2's item 2 (the await-ability change's safety at its
call site) is also now resolved more completely than round 2 claimed:
round 2 named one call site; round 3's §4.5.1 named thirteen, built by
grepping one identifier — **itself an incomplete method, independently
found this round:** round 4's §4.5.1 names all nineteen, derived by
symbol/call-graph tracing (§4.5.1a), and §4.5.2 gives a literal,
implementable guard shape read back identically by every one of them.
Round 2's items 1-5 (renumbered 1-5 below) are otherwise carried forward
unchanged, plus one new item round 3's deeper tracing surfaced (item 6).

1. **§12:** whether aiControl authors the timeout SLA value (copied, never
   recomputed, at cutover) is stated as an assumption carried from the
   rejected candidate, not independently confirmed against
   `docs/architecture/orca-delegation-fence-prerequisite.md`, which does not
   specify it either way.
2. **§10.2:** the exact shape of the real projector fix (re-read-then-compare
   granularity; which fields participate in the equality check) is this
   SPEC's own proposal for what aiControl's fix must satisfy, not a
   preview of aiControl's actual forthcoming implementation — the real fix
   may differ in shape while still satisfying the same contract.
3. **§16, `RECONCILIATION_INCIDENT` row:** this SPEC does not enumerate every
   possible incident `kind` exhaustively (mirrors ORCA-S4's own explicit
   deferral of full incident taxonomy to implementation, §8.4 there) — only
   the ones named explicitly above (`pre_cutover_orphan_process`,
   `unclassifiable_terminal_status`) are frozen; an implementation session
   may need more, each requiring the same non-fabrication discipline.
4. **§7.2/§5.7, carried:** whether a pathologically fast process exit can
   race `writeStartupCommandWhenShellReady`'s own scheduling (both occur
   after S6, neither strictly ordered against the other by anything this
   SPEC traced) is flagged, not resolved — it does not change §7.2's or
   §5.7's classification (the process is confirmed dead either way, cleanup
   is the same), but the exact interleaving was not proven, only argued not
   to matter. Required as an implementation-time proof obligation (§19
   gates 39/50 cover its observable consequence; the interleaving itself is
   not separately gated).
5. **§4.2's third table row** (any provider `spawn-options.ts:176-182`
   excludes) was explicitly out of this correction's scope (Slice B is
   local-only, §20) and was not traced. §7.3's eligibility gate now
   structurally prevents such a provider from ever entering delegated
   authority regardless — but its own internal safety properties (whether
   it could pre-deliver a workload, whether its spawn-commit chain is
   awaitable) remain untraced, carried forward, not newly introduced.
6. **§7.3, new this round:** the eligibility gate verifies a **declared**
   capability (`supportsDelegatedCutoverHold`), not a **proven** one — a
   future provider could declare the capability without actually
   satisfying §4.1a/§4.5's contracts. This SPEC does not and cannot close
   that gap by architecture alone (§7.3 says so explicitly); it requires
   the acceptance gates (§19, especially the gate-41-class ones) to
   independently verify `LocalPtyProvider`'s own declaration is honest, and
   any future provider claiming the same capability must clear the same
   gates before its declaration can be trusted.

---

## 22. aiControl DB guard — session close

Re-verified read-only at the close of this session, same method as the
opening check (§ Artifact identity table): `data/app.db` SHA-256
`2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`, no
`-wal`/`-shm`/journal — **unchanged**. This session opened `data/app.db`
zero times for write; every aiControl fact above was read via `git show
origin/master:<path>` against tracked source files only.

**Round 4 re-verification:** this correction touched only Maestro's
`SPEC.md`; it made no aiControl claim and needed no new aiControl read.
Independently re-hashed `data/app.db` in the local aiControlCenter
checkout read-only (`sha256sum`) before committing this revision:
`2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` —
**unchanged**, no `-wal`/`-shm`/journal file present. `origin/master`
re-fetched and re-confirmed at `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`,
matching the mission's required canonical value exactly.

---

## 23. Predecessor facts consumed

**From ORCA-S1–S3 (unchanged):** `run_reservation`, `run_binding`,
`execution_meta`, `settlement_observation`, `worktree_provenance`,
`dispatch_worktree`, the bind-time composition seam, the versioned schema
ladder, the frozen-evidence-bundle pattern, the `data/app.db` guard pattern.

**From ORCA-S4 (consumed as already-proven mechanism, extended per §8.2):**
`ShadowLifecycleProcessPort`'s exact interface, `dispatch_process_binding`,
`dispatch_termination`, `worktree_finalization`, `dispatch_lifecycle_closure`,
`dispatch_lifecycle_event`, `convergeDelegationBoundaryLifecycle`'s Phases
1–5, the fail-closed identity discipline, "hooks are wake-up hints" (LIFE-8),
"closure copies never re-decides" (LIFE-5), and §18's explicit enumeration
of exactly what Slice B still owed.

**From `GAP-ANALYSIS-ORCA-DELEGATED.md`:** the full §4 gap enumeration and
the §5 decisions this SPEC formalizes.

**From the real, published aiControl fence prerequisite** (`orca-fence.ts`,
`orca-fence-projection.ts`, `docs/architecture/orca-delegation-fence-prerequisite.md`,
`docs/HANDOFF.md`, `origin/master` `ab5967bdde…`): the exact fence CAS
predicates, the R1/R2/R3 rollout discipline, the break-glass Category-A
safety proof, the cancellation/timeout dispositions (§7/§8 there), the
authority table, and the real, named divergence residual.

**From Maestro's real production runtime** (`orca-runtime-create-agent-session.ts`,
`orca-runtime-create-terminal.ts`, `orca-runtime-report-pty-spawn-commit.ts`,
`repo-worktrees.ts`): the exact integration seam, the existing
`preAllocatedHandle`/`onPtySpawnCommitted`/`agentSessionCreateOperations`
idempotency and reconciliation primitives this slice reuses rather than
reinvents.

**From `docs/reference/ssh-execution-boundary.md`:** the fixed `live` /
`unverifiable` / `exited` vocabulary, cited to justify the local-only scope
decision (§20).

**Explicitly NOT consumed:** `parity_observation`/`parity.ts`;
`settlement_incident`/`worktree_provenance_incident`;
`reconcile-shadow-execution-state.ts`/`converge-worktree-provenance*.ts`
(sibling sweeps, never modified); the rejected candidate's own §9.2 "path
(b)" (superseded by §5.1's evidence that it cannot occur).

---

_State class: `ARCHITECTURE_READY_FOR_FOCUSED_REREVIEW`._
_Display verdict: `ORCA_S5_DELEGATED_CUTOVER_ASYNC_CALL_GRAPH_CORRECTED_READY_FOR_REREVIEW`._
