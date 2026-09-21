# ORCA-S5 PRE_LIVE PRODUCTIONIZATION — GAP ANALYSIS (discovery, docs-only)

Architecture/discovery artifact. **No production code, test, schema, migration, aiControl file or
frozen document was modified.** Nothing was published. Fence acquisition was not enabled; R3, M5 and
live `ORCA_DELEGATED` were not started. Companion documents: `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md`
(decisions, DAG, slices, activation contract) and `PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md` (candidate
amendments — **not frozen, not accepted**).

```
state_class:     PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_READY_FOR_REVIEW
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_READY_FOR_INDEPENDENT_REVIEW
```

Every statement below is sourced to a file:line read in this session unless tagged `[UNVERIFIED]`
(a claim I could not prove from source on this Windows host; each is turned into a RED obligation in the
architecture document, never assumed).

## 1. Canonical state (verified)

| Item | Value | Verified |
| --- | --- | --- |
| Maestro `origin/main` | `1f70bdf4992ae920aed56de905edb0463faa8657` | `git fetch` + `rev-parse`, equal |
| Post-Cutover Lifecycle technical HEAD | `d6254d12f45ea97d6683ee14c265c7fdc5d1c151` | `merge-base --is-ancestor` of `origin/main` |
| Normative architecture HEAD | `627b00b0b71a345783dbc37f9ebff99033e8dc80` | ancestor of `origin/main` |
| Published chain | `70e4a074 → 377a856a (RED) → d6254d12 (GREEN) → 1f70bdf4 (acceptance)` | `git log` of the discovery worktree |
| Discovery worktree | `C:\mw-orca-s5-prelive-discovery`, branch `discovery/orca-s5-prelive-productionization` (from `1f70bdf499`) | new worktree only |
| aiControl `origin/master` | `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` | fetched read-only, equal |
| aiControl `data/app.db` SHA-256 | `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`, no `-wal`/`-shm`/journal | hashed read-only, equal (re-verified at close, §9) |
| Authority / `ORCA_DELEGATED` / fence acquisition / R3 / M5 | `AICONTROL_NATIVE` / NOT STARTED / DISABLED / NOT STARTED / NOT STARTED | unchanged |

## 2. Evidence read

Frozen S5 `SPEC.md` (sections 0, 1, 3, 4.1–4.8, 5, 6, 7, 8–19, 20, 21, 23 read in full; §4.2–4.7 type-site
tables read for the parts that touch B-1…B-9), S4 `SPEC.md` §9.1–9.3 and §18, the Post-Cutover Lifecycle
independent acceptance (read in full), the Cutover-Core final acceptance (first 150 lines) and the
ratification record (identity block). Production code read directly: `runtime/orca-runtime-delegated-*`
(coordinator, callback, lifecycle composition, real process port), `orca-runtime-create-agent-session.ts`,
`orca-runtime-create-terminal.ts`, `orca-runtime-on-pty-exit.ts`, `providers/local-pty-spawn.ts`,
`local-pty-session-activation.ts`, `local-pty-provider.ts`, `ipc/pty/runtime/spawn-options.ts`,
`daemon/daemon-provider-init.ts`/`-state.ts`, `runtime/rpc/methods/agent-session.ts`,
`pty-descendant-termination.ts`, and in `execution/`: `lifecycle-process-termination.ts`,
`converge-delegation-boundary-lifecycle.ts`, `converge-delegated-lifecycle-steps.ts`,
`delegated-cutover-{reservation,commit}-step.ts`, `shadow-lifecycle-process-adapter.ts`,
`process-instance-discriminator.ts`, `restart-recovered-identity-verification.ts`, identity/lifecycle
sidecar stores, `read-only-{shadow-settlement,worktree-provenance}-source.ts`, `execution-schema.ts`,
`aicontrol-fence-client-port.ts`, `process-tree-termination.ts`. aiControl, read-only via `git show
origin/master:`: `orca-fence-projection.ts` (full), `orca-fence.ts` references, the fence prerequisite
doc (§5, §6, §12, §16), `orphan-recovery.ts`, `runner.ts` (fence-relevant writers), `config/settings.ts`
(`getTimeoutMs`), and a tree-wide search of `src/app` for any fence/projection route.

## 3. Blocker reconstruction B-1 … B-9

Classification vocabulary: `ARCHITECTURE_DECISION` (AD), `MISSING_PRODUCTION_COMPOSITION` (MPC),
`MISSING_EXTERNAL_INTEGRATION` (MEI), `PRE_LIVE_OPERATIONAL_PROOF` (POP), `UNFROZEN_PRODUCT_POLICY` (UPP).

### B-1 — REAL PTY IDENTITY EVIDENCE — `MPC` (+ small `AD` clarification)

**Current behavior.** Two cooperating facts make every real delegated process unrecoverable:

1. The site-#5 callback (`runtime/orca-runtime-delegated-cutover-callback.ts:49-75`) reads the pid from
   the capture box (`providers/local-pty-spawn.ts:116`), captures the OS start marker with
   `captureOsStartMarkerSync` (`:54`), **mints `processNonce: randomUUID()` (`:64`)** and passes it to
   `commitDelegatedCutover`, which writes `dispatch_process_binding`. No identity sidecar is written by any
   production path: the only callers of `writeProcessIdentitySidecarAtomically` are the S4 shadow bind step
   and tests (acceptance §10, re-confirmed: the only `execution/` imports outside `execution/` are the four
   `runtime/orca-runtime-delegated-*` files).
2. The sweep resolves the sidecar at `processIdentitySidecarPath(<userData>/delegated-lifecycle/process, id)`
   (`application/lifecycle-process-termination.ts:81-84`; root built by a raw `join` at
   `runtime/orca-runtime-delegated-lifecycle-composition.ts:81`), and `liveHandles` is an empty map
   (`:77`). A live pid therefore ends `identity_unverifiable` → blocking `process_identity_mismatch`
   incident (`lifecycle-process-termination.ts:199-204`); `RealDelegatedProcessPort.spawn` (adoption) is
   never called.

**Exact code path.** `createAgentSession` (`orca-runtime-create-agent-session.ts:37`) → S2 reservation
(`:233`) → `createTerminal` (`:243`) → `ptyController.spawn` → `spawnLocalPty`: `spawnShellWithFallback`
returns synchronously (`local-pty-spawn.ts:81`) → pid captured into the box (`:116`) → `await
args.onPtySpawnCommitted()` (`:119`) → callback → `commitDelegatedCutover` → activation
(`local-pty-session-activation.ts`, exit listener at `:126`).

**Frozen text.** S5 §5.6 ("confirmed reuse, not an assumption" of S4's restart-recovered path), §7.1
(verbatim S4 §9.1 discipline), §11, §14 X9; S4 §9.2 steps 3–4 (sidecar written **before** the DB commit;
pre-commit orphan class identity-corroborable from the sidecar alone) and §10.3. Gates 7, 8, 38, 50.
**No frozen text assigns the producer for a real process** (Post-Cutover acceptance §10).

**Answers to the mission's questions.**
- *Where pid becomes known:* synchronously at `local-pty-spawn.ts:81-116`, immediately before the awaited commit.
- *Where the incarnation/start marker is observable:* `incarnationId = randomUUID()` is minted before spawn
  in the same function; the OS start marker is readable synchronously right after spawn returns
  (`captureOsStartMarkerSync`). On Windows that is a synchronous PowerShell/CIM spawn with a 3 s timeout
  (`process-instance-discriminator.ts:52-64`) executed on the main-process event loop inside the awaited
  window — an existing S4 precedent, but a latency cost the slice must measure.
- *Reuse of S3/S4 sidecar concepts:* yes — S4's `ProcessIdentitySidecar` shape, atomic temp+rename writer
  (`durable-shadow-lifecycle-root.ts:81-92`) and the `verifyRestartRecoveredIdentity` consumer already exist.
  No new identity scheme is needed.
- *Before cutover commit?* Yes: S4 §9.2's invariant "committed binding ⇒ sidecar written before the commit"
  applies verbatim. It cannot be inside the SQLite transaction (filesystem), so the correlation is
  ordering + the shared `orcaDispatchId`/`processNonce`.
- *Transactionally correlated?* Not transactional; three durable states are legal and enumerated in the
  architecture doc (placeholder-only, sidecar+pid without binding = pre-commit orphan C2, sidecar+binding).
  "Binding without sidecar" must become unreachable.
- *Process exits between spawn and evidence persistence:* pid absent ⇒ `confirmed_dead_unknown_cause`
  (`shadow-lifecycle-process-adapter.ts:151`, needs no sidecar) ⇒ honest `NULL` classification + incident.
  If the pid was recycled, S4 §9.3 currently yields `identity_unverifiable` (blocked forever); see A-4(b).
- *How restart discovers the evidence:* by `(root, orcaDispatchId)`; the root must be resolved through
  `resolveDurableShadowLifecycleRoot` (drift/loss fail-closed, S4 §9.2) — the delegated composition bypasses
  it (`composition:80-81`). That is part of the slice.

**Depends on:** D-1 (which PTY host — §4). **Feeds:** B-2 (capture of `ptyId`/`incarnationId`), B-3, B-7.
**Smallest slice:** P1 (architecture doc §5).

### B-2 — REAL PTY EXIT EVIDENCE — `AD` + `MPC`

**Current behavior.** The port can produce `self_exit` only from a live `ChildProcess`-shaped handle
(`shadow-lifecycle-process-adapter.ts:142-149`); a PTY never provides one and `liveHandles` is empty. A
natural exit is therefore `confirmed_dead_unknown_cause` → closure `terminal_status_ref = NULL` →
`unclassifiable_terminal_status` incident → outbox `blocked_closure_contradicted`. Gates 13/14 are
unreachable in production for a real PTY.

**Where the truth exists today, and only in memory.** `proc.onExit(({ exitCode, signal }) …)`
(`local-pty-session-activation.ts:126`) → `resolveProcessExitCause` → `getOptions().onExit(id, exitCode,
incarnationId, cause)` → runtime `onPtyExit(ptyId, exitCode, incarnationId, { cause, hostExitConfirmed,
providerExitObserved })` (`runtime/orca-runtime-on-pty-exit.ts:16`). The shared `TerminalExitCause`
(`shared/terminal-exit-cause.ts`) is `operator_close | signaled{signal} | exited{exitCode} |
unknown{reason}`. `onPtyExit` documents that **node-pty reports real exits as `-1`** and that older daemons
report `0` for crashes — the numeric code alone is not evidence. Nothing is durable; `onPtyExit` is
delegated-unaware.

**Frozen text.** S5 §5.6 deliberately does not depend on `proc.onExit`; §9.2/§14 X10 accept `NULL` for an
unobserved death. **S4 §18 last bullet explicitly delegates this decision to Slice B** ("must make and
record the same decision for whatever real process-exit signal a production executor eventually provides")
and S5 never recorded it — hence `AD`.

**Earliest durable write point.** The first synchronous statement of `onPtyExit` for a PTY known to be
delegated (needs the `ptyId ↔ orcaDispatchId` map, which requires the capture-box extension of P1).
**Crash windows:** (a) host dies after the OS exit but before that write ⇒ evidence lost ⇒ honest `NULL`;
(b) evidence durable, no `dispatch_termination` yet ⇒ next sweep consumes it; (c) torn write ⇒ prevented by
atomic temp+rename. With deferred command delivery (SPEC §4.1a) the shell is idle until after the commit, so
a natural exit inside the commit window is not a credible case (SPEC §7.2/§21 item 4 residual).
**Authority:** exit evidence is an observation, never authority; the sweep stays the sole writer of
`dispatch_termination`; Promise resolution is never used.

**Depends on:** B-1 (capture box, nonce), D-1. **Smallest slice:** P2.

### B-3 — SIGNAL CONFIRMATION SEMANTICS — `AD` (amendment required)

**Current behavior.** `resolveProcessTermination` records a terminal `dispatch_termination(termination_method
='signalled', tree_verified=<returned boolean>)` at all three signal sites
(`lifecycle-process-termination.ts:144,161,184`) as soon as `requestTermination*` **returns** — `verified`
true **or false**, process alive or not. Because a termination row now exists, the sweep never observes or
signals that run again (acceptance §8 F-01 probe: 1 observe, 1 signal across 3 sweeps). The run then closes
`cancelled`/`timeout` from the durable reason.

**What "signalled" means today.** *A signal call returned without throwing (or a fallback probe found the
group absent)* — weaker than "OS accepted", far weaker than "process observed dead":
- POSIX pid-addressed path: `process.kill(-pid, SIGTERM)` returning is `true`
  (`process-tree-termination.ts:135-143`). Interactive shells ignore `SIGTERM`; `-pid` addresses only the
  shell's own process group, not job-control child groups `[UNVERIFIED — POSIX semantics, to be measured in
  the P3 RED]`. A throw with the group still present returns `false` and is *still recorded* as `signalled`.
- Windows: `taskkill /pid … /t /f` exit 0 ⇒ `true` (forceful; the strong case); non-zero (access denied,
  refusal by `admitProcessTreeKill`) ⇒ `false`, **still recorded**, process possibly alive.
- The pid-addressed primitive has no root-kill fallback by its own comment (`process-tree-termination.ts:77`).

**Frozen text.** S4 §9.3 ("`tree_verified=0` is **not** an incident"; justified only because the shadow
lifecycle process is a leaf) with the explicit clause *"If a future revision ever gives the shadow lifecycle
process real descendants, `tree_verified=0` must be revisited before it can still be treated as sufficient"*;
S5 §7.1 reuses it "verbatim" without revisiting; the RED encodes it (`no-fallback`: *"a signal whose tree is
only root-verified (verified=false) still yields the durable-reason classification"*).

**Is the inherited semantic safe for real delegated descendants? No.** It can durably certify
`cancelled`/`timeout` for a workload that is still running (dual truth: Orca terminal, process alive,
aiControl later projected terminal). This is a safety defect for real workloads, not a liveness gap.

**Repository already contains the correct primitive.** `pty-descendant-termination.ts`
(`killWithDescendantSweep`, snapshot descendants before signalling the root; Windows job-object termination
that is immune to pid recycling; identity probe `verifyWindowsTreeKillTarget`; delayed SIGKILL gated on an
unambiguous capture-second boundary and matching pgid). It is PTY-aware and hardened against #9045/#10475.
S4's generic `signalProcessTreeByPid` is not. **Depends on:** B-1, B-2, D-6. **Smallest slice:** P3 +
amendment A-1.

### B-4 — MACOS PROCESS IDENTITY — `AD`

**Current behavior.** `RealDelegatedProcessPort.observe` special-cases `posix_ps_lstart` with no handle: live
pid ⇒ `identity_unverifiable`, dead pid ⇒ `confirmed_dead_unknown_cause`
(`orca-runtime-real-delegated-process-port.ts:85-91`). S4 §9.1.3's compound proof requires the live argv to
match `shadow-lifecycle-child.mjs` and to contain the nonce (`restart-recovered-identity-verification.ts:106-116`,
`lifecycle-process-termination.ts:111-113`) — unsatisfiable for a real shell, whose argv the Orca runtime
does not author.

**Attributes macOS can expose** (`ps` and `/proc`-free): pid, ppid, pgid, session id, tty, `lstart`
(1-second resolution — the reason the compound proof exists), `command`; for same-user processes also the
environment via `ps eww`/`KERN_PROCARGS2` `[UNVERIFIED on macOS — no macOS host here; SIP/hardened-runtime
behaviour for `/bin/zsh` must be measured]`. Sidecar + OS observation is sufficient for **classification-grade**
identity ("is the original instance gone?") because a *different readable* `lstart` is decisive proof of a
different instance on every platform. It is **not** sufficient for **signal-grade** identity ("this live pid is
the original") on macOS: equal `lstart` within one second is ambiguous, so a second discriminator is required.
The repository already exports the PTY handle into the shell environment (`ORCA_TERMINAL_HANDLE`, comment at
`create-agent-session.ts:204`); a per-run nonce in the spawn env is the argv-independent carrier that does not
redesign execution semantics (`startup.env` already flows through `createTerminal`). This needs an
adapter/amendment (A-4(c)); it is only load-bearing when a live process can survive a restart (D-1).

**Invariant preserved:** uncertain identity ⇒ **no signal**. **Depends on:** D-1, B-1. **Smallest slice:** P1
(classification-grade, all platforms) and a deferred P1-macOS spike (signal-grade). The first controlled
workload is scoped to Windows/Linux, where S4 checks 1-3 are already accepted as sufficient.

### B-5 — REAL WORKTREE / BASE IDENTITY — `MPC`

**Current behavior.** The coordinator writes `worktreePath: 'unused'`, `baseCommit: '0'.repeat(40)`,
`aicontrolRunId: null`, `governanceAgentRunId: 'delegated-<corr>'`, `orgTaskId`/`orcaRunId = correlationId`
(`orca-runtime-delegated-cutover-coordinator.ts:164-181`; callback `:63`). Lifecycle correctness does not read
them (acceptance §13), but the durable `dispatch_worktree`/`run_binding` rows are permanently fictional for a
real run, and the unique index `run_binding_aicontrol_run_unique` is never exercised.

**Where the real worktree exists.** Created by Maestro's existing worktree lifecycle **before**
`createAgentSession`; `resolveTerminalWorkspaceLaunchScope(request.worktree)` (`create-agent-session.ts:116`)
returns `{ id, path, connectionId, repo | null, folderWorkspace | null }` and `resolveWorkspaceTerminalStartupCwd`
gives the cwd (`:127`). The path is therefore known at S2; the base commit is a `git rev-parse HEAD` of that
path at S2 (git repositories only — a **folder workspace** has no commit, and `run_binding.base_commit` is
`NOT NULL`, so an explicit no-baseline token is required; AGENTS.md "Folder Workspace Use Case").

**Binding point.** The S5 transaction only (`delegated-cutover-commit-step.ts:107-120`), by threading the S2
values through the callback closure into `commitDelegatedCutover`'s input. No pre-S5 durable write ⇒ no second
worktree authority (SPEC §13 "reused, not transferred"). **Mismatch/conflict:** the same-identity retry path
compares only run/token/dispatch (`commit-step:90-93`); a retry carrying a different path/base must be
`conflicting_identity`/`DIVERGENCE`. **Restart:** durable rows are authoritative. **Relationship to S3:** S3's
identity model (sidecar inside `durableShadowWorktreeRoot`, `read-only-worktree-provenance-source.ts:72`)
cannot describe a real worktree — see B-6.

**Smallest slice:** P4 (no external dependencies).

### B-6 — S2 / S3 PRODUCTION FACT PRODUCERS — `AD` + `MPC` (amendments required)

Inventory (classification vocabulary from the mission):

| Fact | Frozen owner | Production status | Evidence |
| --- | --- | --- | --- |
| `settlement_observation` (S2) | S2 | **PRODUCED_ONLY_BY_SHADOW_FLOW** | Source reads the shadow Orca orchestration DB (`tasks`/`dispatch_contexts`) matched by an `orcaS1CorrelationId` marker (`read-only-shadow-settlement-source.ts:105-125`). A delegated PTY session creates no Orca task/dispatch ⇒ `no_task` forever. `executeShadowIdentityObservationSlice` has **no production caller**. |
| `worktree_provenance` (`base_commit`, `candidate_head`, `files_changed`) (S3) | S3 | **PRODUCED_ONLY_BY_SHADOW_FLOW** | Same flow; identity confined to a durable *shadow* root (`:72`) |
| `run_binding.base_commit` | S1/S5 | PRODUCED_REALTIME as placeholder (`0…0`) ⇒ effectively NOT_PRODUCED | coordinator `:170` |
| `run_binding.candidate_head` | S5 | NOT_PRODUCED (NULL) | |
| `dispatch_worktree` | S3/S5 | PRODUCED_REALTIME as placeholder (`'unused'`) | `:179` |
| `dispatch_process_binding` | S4/S5 | PRODUCED_REALTIME (real pid/marker; random nonce with no sidecar) | callback `:60-71` |
| `delegation_cutover` | S5 | PRODUCED_REALTIME by the callback — but **no production ingress supplies `delegatedCutover`** (D-2) | |
| identity sidecar | S4 | NOT_PRODUCED | B-1 |
| exit evidence | S5 | NOT_PRODUCED | B-2 |
| `dispatch_termination`, `worktree_finalization`, closure, event | S4/S5 | produced only by the sweep, which has no production caller (B-7) and is unreachable to closure without a settlement row | `converge-delegation-boundary-lifecycle.ts:158` |
| `aicontrol_terminal_projection` | S5 | produced only by sweep Phase 6; no transport | B-8 |

**The gap is architectural, not compositional.** Two frozen premises do not hold against source:
1. *Closure requires a `settlement_observation`* (`:158`, `:163-166`) whose only defined referent is a shadow
   Orca task/dispatch a delegated PTY never has. Deriving it from aiControl's `agent_runs` would deadlock:
   aiControl's terminal status is written only by the projection, which requires the closure, which requires
   the settlement.
2. *"S3 capture is reused unmodified, pointed at the real dispatch worktree"* (S5 §13). S3 verifies a sidecar
   whose `worktreePath` must canonicalize inside the durable shadow root; a real Maestro worktree does not.
   Provenance *absence* is tolerated (`legacy_not_convergeable`, `:165,220`), settlement absence is not.

Resolution requires amendments A-2 and A-3. **Smallest slices:** P4 → P5.

### B-7 — REAL LIFECYCLE CALLER / RECONCILIATION TRIGGER — `MPC`

`reconcileDelegatedLifecycles` (coordinator `:198`) and `requestDelegatedCancellation/Timeout` (`:199-202`)
have **no production caller**. Worse, there is nothing to reconcile: `terminal.createAgentSession`'s params are
`z.object(...).strict()` (`runtime/rpc/methods/agent-session.ts:159-184`) and omit `delegatedCutover`, and the
field is referenced by no production code other than `createAgentSession` itself — **there is no production
ingress for a delegated run at all** (D-2). Owner: the same mixin
(`OrcaRuntimeWithDelegatedCutoverCoordinator`, SPEC §4.8.1/§11) plus one startup registration. Triggers,
concurrency, shutdown behaviour and duplicate convergence are specified in the architecture doc §4 (AD-7);
the invariant is durable fixed-point reconciliation with cadence as a liveness detail (SPEC §11, §21 item 7).
Electron enforces a single instance per user data dir (`startup/single-instance-lock.ts:44`); concurrent
passes converge by PK/`insertOrConverge` (X12). **Smallest slice:** P6.

### B-8 — AICONTROL TERMINAL PROJECTION — `MEI` (A: aiControl code; B: both repos)

**A. Projector correctness.** `orca-fence-projection.ts:90-95` returns `ALREADY_TERMINAL` unconditionally on
the CAS miss; `DIVERGENCE` is declared (`:24`) and unreachable. Input is `{runId, token, status, finishedAt:
Date, stdout?, stderr?}`; `stdout`/`stderr` are skipped when `undefined`. Smallest correction (SPEC §10.2, no
architecture change): on the identity-matching branch re-read `status`/`finished_at`/(supplied) `stdout`/`stderr`;
equal ⇒ `ALREADY_TERMINAL`; any difference ⇒ `DIVERGENCE`; never write in either case. Maestro's retries carry
a deterministic `finishedAt` (`termination.observedAt`, durable), so strict equality is well-defined.

**B. Transport — larger than the SPEC states.** SPEC §4.8.5/§6 describe "the real, published … HTTP-facing API
routes". **There are none.** A search of `origin/master:src/app` for any fence/projection reference returns
nothing; `acquireOrcaFence`, `acknowledgeOrcaCutover`, `safeReleaseOrcaFence` and
`projectDelegatedTerminalResult` are in-process library functions of the Next.js app. Maestro's port has only
`acquireOrcaFence` and a fail-closed default (`aicontrol-fence-client-port.ts:20-41`); there is **no
acknowledge, release or project operation** and nothing advances `delegation_cutover.ack_status` from
`pending`. Consequently fence acquisition itself (not only terminal projection) has no transport, and the
transport needs new **aiControl production code** (authenticated routes) — a cross-repo slice.

Two Maestro-side defects to fix with it: (i) the outbox does not gate on `ack_status`; a projection attempted
before the acknowledge yields `FENCE_MISMATCH`, which the outbox resolves to the **terminal**
`blocked_fence_mismatch` (`converge-delegated-lifecycle-steps.ts:224-233`, `PROJECTION_OUTCOME_TO_STATUS`) —
a benign ordering race becomes a permanent block; (ii) the projection payload has no `stdout`/`stderr` and no
defined encoding of `finishedAt` (string in Maestro, `Date` in aiControl).

**Smallest slices:** P7 (projector, aiControl-only) and P8 (API + adapter, both repos).

### B-9 — R3 / TIMEOUT POLICY / REMAINING PRE_LIVE GATES — `POP` + `UPP`

- **R3** (fence prerequisite §12): R1 schema and R2 fence-aware code are published; R3 = *prove every
  process capable of a native CAS is fence-aware, then* set `ORCA_FENCE_ACQUISITION_ENABLED=true`
  (`isOrcaFenceAcquisitionEnabled()` reads `process.env`, default false). The verification method is
  explicitly unprescribed (prerequisite §16 item 5). New aiControl code (P7, P8) enlarges the definition of
  "fence-aware".
- **aiControl-side audit item (unverified reachability).** `runner.ts:195-200` `failRunNoEligibilityChange`
  writes `status='failed'` with `WHERE id = runId` only — no `orca_fence_state` guard (called at `:227,319,392,414`
  inside `runAgent`). The prerequisite classifies `runAgent` as "MUST CHECK FENCE" at the claim, but this
  pre-claim failure write is unguarded. Whether a fenced/cutover row can reach it is **not established
  here**; it is a PRE_LIVE audit obligation (P7/P11), not a claimed defect.
- **Timeout.** aiControl's timeout is `getTimeoutMs()` → setting `execution.timeout_ms` (default 120 s, clamp
  ≥1 s and ≤600 s), read at execution time (`runner.ts:673`); `agent_runs` has no timeout column. So the SLA
  is a global aiControl setting Orca cannot see and that is not stored per run. S5 §12/§21 item 1 froze the
  durable outcome only. Needed before live: a policy owner, a config source, a start reference, a deciding
  authority, a durable handoff — proposed in AD-8/A-7. No SLA value is chosen here.
- **Remaining PRE_LIVE gates:** 19–22, 26 (SPEC §19) plus everything in §5 below and the activation contract.

## 4. Additional gaps found (not in B-1…B-9)

These were found while tracing; several dominate the plan.

| ID | Finding | Class | Evidence |
| --- | --- | --- | --- |
| **D-1** | **The production default PTY host is not delegated-eligible.** `supportsDelegatedCutoverHold` is declared only by `LocalPtyProvider` (`providers/local-pty-provider.ts:77`); the daemon adapter declares nothing. At startup `initDaemonPtyProvider` runs (`startup/main-process-pty-startup.ts:130`) and installs the daemon adapter as the local provider (`daemon/daemon-provider-init.ts:156`, `daemon-provider-state.ts:121`); `LocalPtyProvider` is used only by the degraded-fallback path. No switch disables the daemon. A delegated request today therefore throws `delegated_cutover_provider_unsupported` (`spawn-options.ts:161-170`). SPEC §4.1/§7.3/§20's "the load-bearing provider is `LocalPtyProvider`" is true of the frozen seam, false of default routing. Also: a `LocalPtyProvider` PTY lives in the Electron main process, so "the process survives a Maestro restart and is re-identified" (gates 7/38/50) is a daemon-hosted property `[UNVERIFIED for in-process node-pty; measure]`. | AD | above |
| **D-2** | **No production ingress.** `terminal.createAgentSession` is `.strict()` without `delegatedCutover`; no code path supplies it; aiControl does not advertise delegatable runs (prerequisite §16 item 4 "undecided, DEFERRED_TO_SLICE_B"); fence-token generation owner and the "which aiControl run" decision are unfrozen. | UPP + MPC | `agent-session.ts:159-184` |
| **D-3** | aiControl exposes **no API** for acquire/ack/release/project (see B-8B). SPEC §4.8.5 is factually wrong on this point. | MEI | tree-wide search |
| **D-4** | Phase 4 acknowledgement (S9) and fence release (§6.1) have no Maestro implementation; `ack_status` is never written; `pre_cutover_orphan_process` and `safeReleaseOrcaFence` appear in **no** production file. "Fence acquired but Orca cannot start" leaves the run `fenced` with no automated path. | MPC | greps |
| **D-5** | **Pre-commit rejection cleanup is not implemented.** `spawnLocalPty` awaits the commit with no `try/catch` or teardown (`local-pty-spawn.ts:119`); `createTerminal`'s catch only releases the registration fence. SPEC §4.5/§5.8/X15 (gates 35, 51) require the just-spawned process to be terminated via the identity-verified path. Prior artifacts classify gate 35 `ALREADY_GREEN_PREIMPLEMENTATION`; I could not locate an implementation or a test asserting it. `[UNVERIFIED — treat as open; P9 RED decides]` | MPC | source |
| **D-6** | **Alternate kill paths.** Gate 27's static audit covered `signalProcessTree` sites in `execution/`. The PTY layer has many other stop/kill entry points (runtime controller `stopAndWait`, `stop-terminals-for-worktree`, terminal-close CLI, app shutdown). Any of them can terminate a delegated PTY without a durable `teardown_reason`, yielding `NULL`/incident at best. Non-exhaustive here; an exhaustive inventory is the first task of P3. | AD | |
| **D-7** | aiControl `failRunNoEligibilityChange` unguarded write (B-9). | POP | `runner.ts:195` |
| **D-8** | The site-#5 callback fabricates `orcaRunId`, `orgTaskId`, `governanceAgentRunId` and leaves `aicontrolRunId` null; `run_binding` identity refs are placeholders beyond path/base. | MPC | coordinator `:164-168` |
| **D-9** | Host quit/crash policy for a live delegated run (graceful quit kills local PTYs) is unfrozen; SPEC §9.2's reason map has only `user_cancel`/`timeout`. Under the frozen text it degrades to `NULL` + incident (honest, safe). | UPP | |

## 5. SPEC claims that do not hold against source (evidence for amendments)

| SPEC claim | Reality | Amendment |
| --- | --- | --- |
| S5 §7.1 / §5.6: reuse S4 identity discipline "verbatim", sidecar path is "confirmed reuse" | no production sidecar writer; macOS proof unsatisfiable for a real shell | A-4 |
| S5 §5.6: restart path "does not depend on `proc.onExit`" (and S4 §18 delegates the real exit-signal decision) | decision never recorded; without it `completed`/`failed` are unreachable | A-5 |
| S4 §9.3 `tree_verified=0` is not an incident | valid only for a leaf shadow process; S4 itself says revisit for descendants | A-1 |
| S5 §13: S3 capture "reused unmodified, pointed at the real worktree" | S3 confinement/sidecar model cannot describe a real worktree | A-3 |
| S5 §16/§9: settlement is Orca-owned via the closure | closure needs an S2 row that has no delegated referent | A-2 |
| S5 §4.8.5 / §6: aiControl HTTP-facing routes exist | none exist | A-6 |
| S5 §4.1/§7.3/§20: `LocalPtyProvider` is the provider | default host is the daemon adapter | A-8 |
| S5 §12/§21.1: timeout SLA "may be aiControl-authored and copied" | it is a global aiControl setting, not on the run | A-7 |

## 6. Dependency and criticality summary

`D-1` gates B-1/B-2/B-3 design; `B-1 → B-2 → B-3`; `B-4a` rides on B-1; `B-5 → B-6`; `B-6 (settlement)` is
the single hard blocker for *any* closure; `B-8` (transport) is on the path of **every** live run because
fence acquisition itself needs it; `B-9` (R3, timeout config) gates activation. Full DAG and critical path:
architecture doc §3.

## 7. Gate reclassification (truthful)

Statuses: `NOT_STARTED`, `DORMANT_IMPLEMENTATION` (code exists, proven only against fakes/seeded facts, not
reachable in production), `IMPLEMENTATION_PROVEN` (frozen-text conformant and tested; does not imply
production-ready), `PRE_LIVE_REQUIRED`, `LIVE_PROOF_REQUIRED`, `COMPLETE`. **No gate is `COMPLETE`.** A
status is the *strongest true* label; `IMPLEMENTATION_PROVEN` gates that touch a real process additionally
carry `LIVE_PROOF_REQUIRED`.

| Gate | Subject | Status | Why / next |
| --- | --- | --- | --- |
| 1 | real fence handshake vs real `orca-fence.ts` | `NOT_STARTED` | Cutover-Core used a fake port; no transport, no aiControl API (D-3) → P8 |
| 2 | same-token idempotency | `DORMANT_IMPLEMENTATION` | Maestro logic proven via fake only → P8 |
| 3 | cancel-vs-cutover exactly one winner (CAS-level) | `NOT_STARTED` | needs real cross-DB harness → P8/P11 |
| 4–6 | cutover ordering, no pre-commit visibility, cardinality | `IMPLEMENTATION_PROVEN` | per Cutover-Core acceptance (not re-derived); + `LIVE_PROOF_REQUIRED` |
| 7 | restart recovers same process identity | `DORMANT_IMPLEMENTATION` | fail-closed only until B-1 (acceptance §16) → P1 |
| 8 | uncertainty never auto-spawns | `IMPLEMENTATION_PROVEN` | no spawn path exists in the sweep |
| 9 | ack-loss resolves on restart/retry | `NOT_STARTED` | no ack implementation (D-4) → P8 |
| 10 | aiControl ack idempotency | `NOT_STARTED` | aiControl fn proven; no caller → P8 |
| 11, 12 | native exec/settlement impossible post-fence | `PRE_LIVE_REQUIRED` | proven by aiControl prerequisite; residual D-7 audit → P7/P11 |
| 13, 14 | `completed` / `failed` | `DORMANT_IMPLEMENTATION` | classification proven for observed `self_exit`; real PTY unreachable (B-2) → P2 |
| 15, 16 | `cancelled` / `timeout` | `DORMANT_IMPLEMENTATION` | classification proven; signal semantics unsafe (B-3), timeout decision path NOT_STARTED (B-9) → P3, P6b |
| 17 | `cancelled ≠ timeout` | `IMPLEMENTATION_PROVEN` | durable, restart-stable; `LIVE_PROOF_REQUIRED` |
| 18 | copy-never-decide | `DORMANT_IMPLEMENTATION` | outbox + fake transport only; ack gating/payload gaps (B-8) → P8 |
| 19 | equal duplicate projection idempotent | `PRE_LIVE_REQUIRED` | needs projector fix → P7 |
| 20 | conflicting projection fails loudly | `NOT_STARTED` | unsatisfiable until P7 ships |
| 21 | projector-divergence prerequisite | `PRE_LIVE_REQUIRED` | P7 |
| 22 | R3 before live acquisition | `PRE_LIVE_REQUIRED` | R3 NOT STARTED → P11 |
| 23 | provenance reused unmodified | `PRE_LIVE_REQUIRED` | true as worded, but its premise (reuse for a real worktree) is void (B-6) → A-3/P5 |
| 24 | real-deletion arm never fires | `IMPLEMENTATION_PROVEN` | static + runtime |
| 25 | terminal event exactly-once | `IMPLEMENTATION_PROVEN` | |
| 26 | cross-DB crash windows X1–X16 each restart-proven | `PRE_LIVE_REQUIRED` | only lifecycle-local windows proven; X1–X5, X7–X9, X11, X14–X16 need transport/real host |
| 27 | signalling only by current authority | `PRE_LIVE_REQUIRED` | audit did not cover PTY-layer kill paths (D-6) → P3 |
| 28 | no automatic fallback | `IMPLEMENTATION_PROVEN` | + `LIVE_PROOF_REQUIRED` |
| 29 | local-only scope | `IMPLEMENTATION_PROVEN` | |
| 30 | S1–S4 regression | `IMPLEMENTATION_PROVEN` | standing gate; re-run by every slice |
| 31–34, 36, 37, 41–49, 52, 53, 55–63 | provider seam, deferral, async propagation, eligibility | `IMPLEMENTATION_PROVEN` | Cutover-Core/pre-implementation; not re-derived |
| 35, 51 | rejected-commit cleanup; pre-vs-post-commit authority cleanup | `PRE_LIVE_REQUIRED` | D-5 → P9 |
| 38, 39, 50, 54 | crash windows C4/C5, early-exit recovery, command-not-delivered, early death | `DORMANT_IMPLEMENTATION` | recovery half fail-closed until B-1/B-2 → P1/P2 |
| 40 | no second instance after ambiguity | `IMPLEMENTATION_PROVEN` | |

## 8. Reviewer disclosures

- Discovery only: no test suite, typecheck or lint was run (docs-only). Statements about behaviour are from
  source reading; each `[UNVERIFIED]` tag marks a claim that needs a measurement.
- The Bash tool's RTK hook rewrites `grep`/`rg` output into an unreliable summary; behavioural claims about
  absence were re-checked with the Grep tool or `awk`/`git grep` on blobs. The Windows checkout is CRLF
  (`autocrlf=true`); `oxfmt --check` on new `.md` files would fail like earlier evidence docs and is not a
  content signal.
- Gate 35's prior `ALREADY_GREEN_PREIMPLEMENTATION` classification was **not** reproduced; it is reported as
  unverified, not as a defect.
- The primary Maestro checkout's own dirty state (`M AGENTS.md`, `?? .claude/`) and the aiControl checkout's
  (`AGENTS.md`, `.agents/`, `AGENTS.md.bak-*`) were not touched.

## 9. aiControl guard (close)

Read-only re-verification at close is recorded in the architecture document §14 and the final report.
