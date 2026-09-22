# ORCA-S5 PRE_LIVE PRODUCTIONIZATION — INDEPENDENT ARCHITECTURE REVIEW

Fresh, adversarial, independent review of the PRE_LIVE productionization discovery
(`PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md` = GAP, `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md` = ARCH,
`PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md` = AMD). Architecture review only — no production code, test,
schema, or aiControl file was touched; fence acquisition, R3, `ORCA_DELEGATED` and M5 remain untouched
(`AICONTROL_NATIVE` / NOT STARTED / DISABLED / NOT STARTED / NOT STARTED throughout).

```
state_class:     ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_CHANGES_REQUIRED (see §0)
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_CHANGES_REQUIRED
```

**Note on provenance of this review.** A first attempt at this review was committed as `56a0a2ed79f3...`
on branch `orca-s2-durable-settlement-observation`. That commit is **not** an ancestor of the docs-only
discovery commit `dfb1235673cba63242d2bd15a347415a86e678c4` — the branch it was built on diverged from
`origin/main` before the entire `orca-delegated-cutover` slice (SPEC.md, all application/domain/infra code,
all tests) ever landed there, so "current production source" in that attempt was read from a tree that did
not contain the subject matter at all. That commit is superseded and must not be cited as evidence. This
review was redone from scratch in a worktree fast-forwarded to exactly `dfb1235673cba63242d2bd15a347415a86e678c4`
(`git merge-base --is-ancestor dfb1235... HEAD` succeeds from this commit onward), so "current production
source" below is the real tree the three candidate docs describe.

## 0. Verdict summary

The discovery is **directionally sound and unusually well evidenced** — every file:line citation I spot-checked
across both repos (see §4) reproduced exactly, including several I expected to find loosely worded. It does not
need to be redesigned. It needs three corrections before freeze, none of which touch the DAG, the slice plan, or
the amendment set's shape:

1. **B-1 / AD-2 two-phase sidecar has an unhandled crash window** (§6): pid captured → OS-marker capture throws
   → the process is live, unidentified, and un-torn-down, and nothing in AD-2 names who owns it. Real code,
   not hypothetical (§6.1).
2. **AD-1/H1 first-run restart acceptance is correctly scoped in substance but not stated as an unmistakable,
   standalone boundary** (§7). Add one explicit sentence; do not reopen the H1/H2 split, which is sound.
3. **D-7/P7b's terminal-writer audit is incomplete as scoped** (§9): the real count is 12 raw, unguarded
   `agentRuns.status` writers in aiControl's `runner.ts` (not the 1 the GAP doc conservatively cited), all of
   which I independently proved structurally unreachable for a fenced/cutover row via both production call
   chains. P7b's slice text must say "all 12 (or however many exist at implementation time), individually
   proven" rather than imply the audit starts from GAP's one citation.

No PRE_LIVE BLOCKER was found: no amendment moves or duplicates authority, no safety property is weakened for
liveness (A-4(b) is the one deliberate liveness refinement and it adds no signal path), and the aiControl
side already has two deliberate, well-commented fence choke points (`finalizeRunOnce`, `cancelOrphanRun`) that
the discovery did not even need to invoke to make its case. See §41 for the amendment-by-amendment table.

## 1. Independence

Fresh worktree (`C:\Users\henrique\Documents\maestro\.claude\worktrees\orca-s5-prelive-review`), fast-forwarded
to `dfb1235673cba63242d2bd15a347415a86e678c4` (true git ancestry, not a reconstruction — verified before and
after writing this file). All claims below are sourced to a `file:line` I read in this session or a command I
ran in this session; nothing is carried over from the superseded `56a0a2e` attempt or from ai-memory/handoff
content, which is treated as untrusted historical data only.

## 2. Lineage / scope

- `origin/main` == `1f70bdf4992ae920aed56de905edb0463faa8657` (`git rev-parse origin/main`, exact match).
- `dfb1235673cba63242d2bd15a347415a86e678c4` is a direct child of `1f70bdf499...` and is docs-only:
  `git diff --stat 1f70bdf499... dfb1235673...` = exactly 3 new files
  (`PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md`, `PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md`,
  `PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md`), 1236 insertions, 0 deletions, 0 other files. Zero
  production/test/schema/aiControl changes. **PROVEN.**
- `627b00b0b71a345783dbc37f9ebff99033e8dc80` (frozen ORCA-S5 architecture HEAD) resolves to a real commit and
  is an ancestor of `origin/main`.

## 3. Docs read in full

All three candidate docs were read start to end (not summaries), cross-checked against: the frozen S4 SPEC
(`src/main/execution/slices/delegated-side-effect-boundary/SPEC.md`, §9.1–9.3, §12, §18 read in full), the
frozen S5 `SPEC.md` (`orca-delegated-cutover/SPEC.md`, §4.1, §4.5, §4.8, §5.4, §5.6, §7.1, §7.3, §9, §11, §13,
§16, §19, §20, §21 read), `POST-CUTOVER-LIFECYCLE-INDEPENDENT-ACCEPTANCE.md`, and real source in both repos
(file list in §4). Classification for unsupported discovery claims: **none found** — every citation I checked
(≈20 file:line references across both repos, listed in §4) reproduced exactly as claimed. This is itself worth
recording: the discovery's evidentiary discipline is high.

## 4. D-1 … D-7 re-verification (own evidence, this session)

| # | Claim | Verdict | My evidence |
| --- | --- | --- | --- |
| D-1 | Default PTY host (daemon adapter) is not delegated-eligible; only `LocalPtyProvider` declares `supportsDelegatedCutoverHold`; no switch selects it | **CONFIRMED** | `git grep -n supportsDelegatedCutoverHold src/main/providers/` → only `local-pty-provider.ts:77` (contract field is optional at `pty-provider-contract.ts:169`). `git grep` for the same symbol in `daemon-pty-adapter.ts`/`degraded-daemon-pty-provider.ts` → zero hits. `main-process-pty-startup.ts:122-130` calls `initDaemonPtyProvider` unconditionally in `startTerminalRuntimeStartupServices`, no gate. |
| D-2 | Production ingress (`terminal.createAgentSession`) omits `delegatedCutover`; schema is `.strict()` | **CONFIRMED** | `runtime/rpc/methods/agent-session.ts:158-184`: `CreateAgentSessionParams` is `z.object({...}).strict()`, no `delegatedCutover` field. |
| D-3 | aiControl has no HTTP-facing routes for acquire/ack/release/project; they are in-process library functions | **CONFIRMED** | `git grep -i "orcaFence\|acknowledgeOrcaCutover\|safeReleaseOrcaFence\|projectDelegatedTerminalResult" <sha> -- src/app` → zero hits. The four functions live in `src/lib/agent-runner/orca-fence.ts` and `orca-fence-projection.ts` only. |
| D-4 | No Maestro ack/release implementation; `ack_status` never advances from `pending`; early `FENCE_MISMATCH` becomes a terminal block | **CONFIRMED** | `git grep -n "acknowledgeOrcaCutover\|safeReleaseOrcaFence" src/main/` → only comments/docs, no caller. Schema default `ack_status TEXT NOT NULL DEFAULT 'pending'` (`execution-schema.ts:318`); the sqlite store only reads it (`sqlite-delegation-cutover-store.ts:33`). aiControl's `orca-fence-release-breakglass-cutover.test.ts` header literally says "Targets not-yet-built `safeReleaseOrcaFence`... `acknowledgeOrcaCutover`" — the RED for that API is aiControl-side and unimplemented. |
| D-5 | `spawnLocalPty` awaits the cutover commit with no try/catch/teardown; `createTerminal`'s catch only releases a registration fence | **CONFIRMED** | `local-pty-spawn.ts:118-119`: `if (args.onPtySpawnCommitted) { await args.onPtySpawnCommitted() }` — bare, no try/catch, own comment says "a rejection here propagates out of spawnLocalPty." `orca-runtime-create-terminal.ts:132-171`: `try { result = await this.ptyController.spawn({...}) } finally { releaseStablePaneCreate?.() }` — the `finally` releases a pane-creation lock only; no process-teardown call anywhere in the function. The only other `catch` in the file (`:198-203`) is for `assertPtyDidNotExitBeforeRegistration`, an unrelated pre-registration exit check. |
| D-6 | Alternate PTY kill/stop entry points exist beyond `execution/`'s audited `signalProcessTree` sites | **CONFIRMED (non-exhaustively, as the discovery itself states)** | `git grep -ln stopAndWait -- src/main` and a parallel search for stop-terminal entry points found at least 6 distinct call sites (`ipc/pty/runtime/controller.ts`, `orca-runtime-stop-exact-terminals-for-worktree.ts`, `orca-runtime-stop-explicitly-closed-tab-ptys.ts`, `orca-runtime-stop-terminals-for-worktree.ts`, `orca-runtime-sleep-resolved-worktree-terminals.ts`, `orca-runtime-split-pty-backed-terminal.ts`), none of which reference a delegated disposition. The discovery's own "non-exhaustive here, first task of P3" framing is the right scope for a docs-only artifact — I do not require a fuller inventory before freeze (see §17). |
| D-7 | aiControl `runner.ts` `failRunNoEligibilityChange` writes `status='failed'` unguarded by `orca_fence_state`; reachability for a fenced/cutover row "not established" | **PARTIALLY_CONFIRMED — sharper than stated, and re-scoped upward** | See §9. The write is real and syntactically unguarded, and I found **11 more like it in the same file** (12 total), plus reasoned, independent proof that all 12 are structurally unreachable for a fenced row via both real production call chains. The GAP doc's own honesty ("not established here... PRE_LIVE audit obligation, not a claimed defect") was correct not to overclaim, but P7b as scoped in ARCH (starting from "`runner.ts:195-200`... the outcome per writer") undercounts the audit surface by an order of magnitude relative to what actually exists in `runner.ts` alone. |

## 5. AD-1 … AD-10 (architecture decisions) — soundness review

All ten are **sound as decisions**; two need the textual corrections in §6–§7. Notable points:

- **AD-1 (host choice).** H1 (LocalPtyProvider, controlled, default-off, Windows/Linux) vs H2 (daemon-hosted,
  deferred) vs H3 (rejected, redesigns frozen seam) is the right shape: H1 is the only host the frozen SPEC's
  gates 31–63 are already proven against, and rejecting H3 correctly avoids the "do not redesign" mission
  boundary. No accidental delegation through the daemon adapter is possible today (D-1, confirmed) because the
  daemon adapter declares no `supportsDelegatedCutoverHold` at all — there is no silent-fallback risk to guard
  against; the capability check itself is the boundary. **Sound; needs the §7 wording addition, not a redesign.**
- **AD-3 (exit evidence).** Correctly keeps `onExit` as evidence, never authority; the "sole writer of
  `dispatch_termination` stays the sweep" invariant is stated three times across GAP/ARCH/AMD consistently.
  I verified `shadow-lifecycle-process-adapter.ts:142-149` today: `self_exit` requires a live `ChildProcess`-
  shaped handle, which a PTY never provides — confirms the AD-3 premise that this path is currently dead for a
  real PTY, matching B-2.
- **AD-4 (signal semantics, A-1).** The four-fact separation (`TERMINATION_REQUESTED` /
  `SIGNAL_ATTEMPTED` / `SIGNAL_CONFIRMED` / `PROCESS_TERMINAL_OBSERVED`) is exactly what §10 of the review
  mission asks for and does not conflate them. I independently read S4's actual §9.3 text (not just GAP's
  quote of it) — see §8 — and confirm AD-4/A-1's characterization is accurate, not a straw-man.
- **AD-6 (settlement/provenance, A-2/A-3).** See §14/§15 — sound, with one clarifying note.
- **AD-10 (transport, A-6).** Correct scope: wraps the four existing functions unchanged, adds no semantics,
  fails closed on any transport failure/404/unknown outcome. This is the right shape for an expand-compatible
  cross-repo rollout (§21 mission section) — old Maestro never calls new routes; old aiControl 404s a new
  Maestro's calls and that 404 is itself a fail-closed outcome by AD-10(ii). No mandatory protocol goes live
  before both sides support it.

## 6. B-1 marker-capture-failure disposition — REQUIRED CORRECTION (highest priority)

AD-2's legal durable states are: (a) placeholder only (crash before spawn), (b) sidecar-with-pid, no binding
(pre-commit orphan C2), (c) both. This enumeration is **incomplete**. I read the real site-#5 callback:

`orca-runtime-delegated-cutover-callback.ts:49-56` —
```
const capturedPid = args.preparedProcessIdentityCapture.current?.pid
if (typeof capturedPid !== 'number') { throw new Error('delegated_cutover_process_identity_unavailable') }
const marker = captureOsStartMarkerSync(capturedPid)   // <-- synchronous, no try/catch
const commitResult = await args.getCoordinator().commitDelegatedCutover({ ...osStartMarker: marker.osStartMarker... })
```

`captureOsStartMarkerSync` is a synchronous Windows PowerShell/CIM call with a 3-second timeout
(`process-instance-discriminator.ts:52-64`, cited accurately by GAP §3 B-1) — a real, plausible failure mode
(timeout, access denial, process already gone by the time it's probed). If it throws:

1. The process **has already spawned** (pid was captured into the box by `local-pty-spawn.ts:116` before this
   callback ever ran) and is live.
2. Under AD-2's own proposed ordering ("captured **before** the commit transaction"), the sidecar rewrite step
   (writing `pid`, `osStartMarker`) is supposed to happen using the very value this call was about to produce —
   so a throw here means the rewrite **never executes**. The durable sidecar stays at state (a), placeholder-only,
   even though a live process with a captured pid exists in memory.
3. The throw propagates through this callback → `spawnLocalPty` (D-5: no catch) → `createTerminal`'s `finally`
   (D-5: releases a pane lock only) → the caller. **No code path terminates this process, records its pid
   anywhere durable, or defines what a restart should do with it.**

This is not "placeholder only, crash before spawn — harmless" (AD-2's label for state (a)): it is placeholder
sidecar **with a live, durably-untracked process** — a strictly worse state than (b), because (b) at least has
the pid in the sidecar for a future adoption/kill decision. AD-2 needs a fourth legal state and an owner for it.

**Required correction.** Add to AD-2's crash matrix: *(a′) placeholder sidecar, live process, marker capture
failed before rewrite* → the process must be torn down through the identity-verified path **using the
in-memory pid the callback already holds** (it does not need the sidecar to do this — the pid is a local
variable in scope at the throw site) before the exception is allowed to propagate, and only then rethrown so
the existing D-5/P9 pre-commit-failure path takes over. This is a P1-scope fix (same slice that owns this
callback), not a new slice — do not let it balloon into a P9 dependency, since P9 (§20/P9 in ARCH) is about
the commit rejecting, and this is about the step *before* the commit is even attempted.

**Full crash matrix, corrected** (superset of ARCH's four legal states):

| State | Sidecar | Process | Binding | Legal next action | Forbidden |
| --- | --- | --- | --- | --- | --- |
| (a) placeholder only, no spawn | placeholder | none | none | retry spawn | — |
| (a′) placeholder, live process, marker capture failed *(new — §6)* | placeholder | **live, untracked** | none | **P1 must terminate via identity-verified path using the in-scope pid before rethrow** | leaving the process running; writing a sidecar after the fact without re-verifying identity |
| (b) sidecar-with-pid, no binding | pid+marker | live or dead | none | pre-commit orphan C2 disposition (P9) | signal without identity verification |
| (c) both | pid+marker | live or dead | committed | normal lifecycle | — |
| stale sidecar / path reuse | pid+marker (old) | different process may now own the pid | any | root drift / marker mismatch fails closed (A-4a) | ever signal on marker mismatch |

## 7. AD-1/H1 restart scope boundary — REQUIRED CORRECTION (textual, small)

ARCH §10 already states the right *content*: "kill Maestro mid-run — expected honest outcome is
`confirmed_dead_unknown_cause` → `NULL` + incident (no reclassification, no respawn, no fallback)," and AD-1
already separates H1 (no live-process restart story) from H2 ("`LIVE_PROOF_REQUIRED` for gates 7/38/50 on a
surviving process; broad activation is *not* claimed before it"). This is **substantively correct** — I found
no place where the doc implies H1's restart story generalizes.

What is missing is a single, unmistakable, *standalone* sentence — the way AD-9 and the §7 authority table each
get one — rather than the acceptance being reconstructable only by reading AD-1 and §10 together. Classification
(per the mission's §35 test): the content is **`SAFE_FIRST_RUN_SCOPE`**, not a `LIVE_ACTIVATION_BLOCKER` — a
disposable, deterministic, manually-supervised first workload that treats an unrecoverable restart as an honest
incident is an acceptable bar for a *single controlled run*, and nothing downstream (PL-1…PL-20, §11 break-glass)
treats it as though restart recovery were proven.

**Required correction.** Add one clause to ARCH §10 (or a new short subsection), verbatim-testable:
*"This restart acceptance is scoped to `FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` only. It does not establish, and
must not be cited as establishing, `GENERAL_DELEGATED_RESTART_CONVERGENCE`. The milestone that removes this
boundary is H2 (daemon-hosted delegation) reaching `LIVE_PROOF_REQUIRED` closure on gates 7/38/50 for a process
that survives a Maestro restart."* This is a one-paragraph addition to AMD A-8 or ARCH §10 — not a new amendment.

## 8. A-1 termination semantics — frozen-text accuracy check

I read S4 `SPEC.md` §9.3 directly (`delegated-side-effect-boundary/SPEC.md:997-1034`), not just GAP's quote of
it. AD-4/A-1's characterization is accurate: the frozen text does say `tree_verified=0` "is not an incident,"
justified *only* because "S4's shadow lifecycle process is, by construction, a single leaf process with no
descendants," and it does contain, verbatim, the self-flagged boundary: *"If a future revision ever gives the
shadow lifecycle process real descendants, `tree_verified=0` must be revisited before it can still be treated
as sufficient — flagged explicitly as a scope boundary, not silently assumed safe."* A-1 is not inventing a
conflict; it is exercising a boundary the frozen text names as its own limit. **A-1: REQUIRED_AS_WRITTEN.**

## 9. D-7 / P7b terminal-writer audit — REQUIRED CORRECTION (scope, not direction)

Exhaustive search, this session: `git grep -n "update(agentRuns)" <sha> -- 'src/**/*.ts'` (excluding tests)
across the whole aiControl tree returns writers in 9 files. Classifying each by whether its `.set()` touches
`status`, and by reachability for `orca_fence_state != 'none'`:

| File | Raw `status` writers | Classification | Evidence |
| --- | --- | --- | --- |
| `run-claim.ts:39` (`claimRunForExecution`) | 1 (`'running'`) | **FENCE_GUARDED** | `WHERE status='pending' AND orca_fence_state='none'` (`run-claim.ts:40-44`) |
| `scheduler.ts:127` (dequeue CAS) | 1 (`'running'`) | **FENCE_GUARDED** | Candidate SELECT *and* the UPDATE both carry `eq(orcaFenceState,'none')` (`scheduler.ts:112,126-131`), explicitly commented as intentional defense-in-depth |
| `orphan-recovery.ts:400` (`cancelOrphanRun`) | 1 (`'cancelled'`) | **FENCE_GUARDED** | `eq(orcaFenceState,'none')`, with a comment explaining *why* `='none'` not `!='cutover'` (a merely-fenced row must not be terminalized here either) |
| `run-finalizer.ts:209` (`finalizeRunOnce`) | 1 (any terminal status, via `extraRunFields`) | **FENCE_GUARDED — canonical chokepoint** | `ne(orcaFenceState,'cutover')`, commented as the deliberate single-terminal-path defense-in-depth guard the whole codebase routes through |
| `orca-fence-projection.ts:52` (`projectDelegatedTerminalResult`) | 1 | **ROUTED_THROUGH_CANONICAL_PROJECTION** | CAS requires `orcaFenceState='cutover' AND orcaFenceToken=token` — this is the *intended* fenced-run writer |
| `queue-admission.ts:74` | 1 (`'queued'`, not terminal) | **out of scope** | not a terminal status |
| `prepare-and-admit-run.ts` (5 `status:'failed'` sites at 167,177,231,241,329) | via `finalizeRunOnce` calls | **FENCE_GUARDED (inherited)** | all route through `finalizeRunOnce`, not a raw update; the one raw `update(agentRuns)` in this file (`:265`) only touches `eligibilityStatus`, never `status` |
| **`runner.ts` — 12 raw sites: 198, 253, 272, 343, 358, 371, 554, 568, 619, 638, 665, 817** | 12 | **PROVEN_UNREACHABLE_FOR_FENCED_RUN (structural)** | See derivation below |

**Structural proof for the 12 `runner.ts` sites.** All 12 are lexically inside either `runAgent` (lines
123–452) or `executeClaimedRun` (453+). Both functions are reachable in production from exactly two call
chains: `runAgent` is called directly (and itself tail-calls `executeClaimedRun` at `:426`), and `scheduler.ts:222`
calls `executeClaimedRun` directly after its own dequeue CAS. `runAgent`'s *first* statement is
`claimRunForExecution(runId)` (`:129`) — fence-guarded as above — and `if (!claimed) return` (`:137`) precedes
every one of the 12 sites; `scheduler.ts`'s dequeue CAS is fence-guarded the same way and precedes its call to
`executeClaimedRun`. Because both gating writes are single-statement SQLite `UPDATE...WHERE` CAS operations,
SQLite's single-writer serialization means there is no window in which a row can be simultaneously visible as
fence-acquirable (`status IN (pending,queued)`) to `acquireOrcaFence` and already past the claim: either the
claim wins first (fence acquisition then fails `NOT_ELIGIBLE` on that row, per `orca-fence.ts:132-134`), or the
fence wins first (the claim's own `AND orca_fence_state='none'` then fails, `claimed=false`, and every one of
the 12 sites is unreached — `runAgent` returns at `:137`, `executeClaimedRun` is never invoked by that request).
I did not find a third writer of `agentRuns.status='running'` anywhere in the tree (exhaustive grep above), so
there is no unaccounted path into either function. **CONFIRMED unreachable for `orca_fence_state != 'none'` at
claim time, and no code between the claim and any of the 12 writes can change `orca_fence_state` back — it is
never written to `'fenced'` from inside either function.**

**Correction required to ARCH §5/P7b and GAP D-7.** P7b's text ("starting with `runner.ts:195-200`... Outcome
per writer") undersells the audit surface by roughly 12x within a single file the discovery already opened.
Rewrite P7b's acceptance criterion from "classify each writer" (singular framing) to: *"Enumerate every
`agentRuns.status` writer in the aiControl tree (a static grep-based ratchet, not a one-time list, so a new
writer added later fails CI until classified) and prove each one of: `FENCE_GUARDED` (has its own
`orca_fence_state` predicate), `PROVEN_UNREACHABLE_FOR_FENCED_RUN` (structural proof via its unique call chain,
as demonstrated in this review for all 12 `runner.ts` sites), or `ROUTED_THROUGH_CANONICAL_PROJECTION`. Zero
tolerance for a writer that is merely `[UNVERIFIED]` at PRE_LIVE freeze time."* This is materially the same
slice, same repo, same "no code change" scope ARCH already declared for P7b — only the acceptance bar moves.
Gates 11/12 should read `PRE_LIVE_REQUIRED` (as GAP already has them), not `PRE_LIVE` closed, until the ratchet
exists — GAP's own gate table already says this correctly; ARCH's P7b prose is what undersells it.

## 10. D-7 wording correction (mission §10)

The distinction the mission asks for — *unguarded syntactic write* vs *reachable authority violation* — is
exactly what §9 above establishes with proof, not assertion. GAP's own text ("not established here... PRE_LIVE
audit obligation, not a claimed defect") already avoids overstating; ARCH's P7b slice description is the one
that needs the §9 correction folded in so a reader doesn't come away thinking one writer is the whole obligation.

## 11–19. Remaining review corrections (mission's "six other" — folded together, each closed)

- **B-3/A-1 signal semantics (§10/§11 of the mission).** Sound as written (§8 above); no further correction.
  `verified=false`/`verified=true`/pid-recycled/SIGTERM-ignored/escalation are each given a distinct durable-fact
  disposition in AD-4's table and none of them can produce a terminal fact — matches the mission's requirement
  exactly.
- **Escalation G/H (mission §12).** AD-4 rule 3 correctly separates mechanism (durable request clock, no new
  table) from policy (`G`,`H` values, explicitly "no production default"). This is the right mechanism/policy
  split; **the policy values themselves must be frozen before P3's RED, not before P0** — ARCH's own P3 row
  already says "policy `G`/`H` (no production default)" as an input, which is consistent. No correction needed.
- **B-5/AD-5 worktree+base (mission §13).** Answered precisely: worktree is pre-existing to `createAgentSession`
  (not allocated by this slice), base is `git rev-parse HEAD` of the resolved workspace path at S2, folder
  workspaces get `NO_GIT_BASELINE`, binding happens once inside the existing S5 transaction (no earlier durable
  write, so no second authority), and a same-identity retry with different captured values is `conflicting_identity`.
  One owner (the S5 transaction). **Sound.**
- **B-6/A-2 settlement `not_applicable_delegated` (mission §14).** I traced what "settlement" meant before this
  amendment: `converge-delegation-boundary-lifecycle.ts:158,163-166` requires an S2 `settlement_observation` row
  before closure, sourced only from a shadow Orca task/dispatch (`read-only-shadow-settlement-source.ts:105-125`)
  — i.e., today settlement is a **mandatory terminal-evidence gate**, not an optional shadow-comparison
  abstraction. A-2's `not_applicable_delegated` does not erase evidence (there was never a delegated-path
  settlement row to erase — a delegated PTY creates no shadow task), does not bypass convergence (Phase 5's
  contradiction check already no-ops when there is no current settlement, per AMD's own citation), and does not
  fake a gate (the closure's real terminal evidence for a delegated run is the process-observed terminal fact
  from A-1, not settlement — settlement was never that evidence for this class of run). **A-2: REQUIRED_AS_WRITTEN.**
- **B-6/A-3 provenance (mission §15).** Confirmed real capture points (worktree realpath, `dispatch_worktree`
  row, `base_commit` from the bound row, `candidate_head`, `files_changed_json`) and confirmed the read-only git
  argv whitelist claim is unchanged (no new subcommand). Test-only/shadow provenance is explicitly kept separate
  (S3 shadow code stays byte-unchanged; gate 23 is re-scoped, not silently reused). **A-3: REQUIRED_AS_WRITTEN.**
- **A-5 exit evidence (mission §16, §8/§9 of the original mission).** AD-3 is explicit that this closes only the
  *live-callback* subset: "Host dies between the OS exit and the evidence write ⇒ evidence lost ⇒ `NULL` +
  incident." I re-derive the mission's own required answer independently: **can a natural real PTY exit be
  classified `completed`/`failed` after restart if `onPtyExit` never durably ran? No** — and AD-3/A-5 say so in
  the same breath they propose the fix, rather than claiming completeness. This is exactly the honesty the
  mission's §8 demands (do not accept callback durability as equivalent to process durability). **No correction
  needed; A-5 already states its own limitation.**
- **A-6 transport (mission §17/§21–23).** AD-10's four routes wrap the four existing functions 1:1, add no new
  endpoints, and every failure mode (unknown route, 404, timeout) fails closed. I found no invented endpoint
  beyond acquire/ack/release/project — matches the mission's "do not invent unnecessary endpoints." **A-6:
  REQUIRED_AS_WRITTEN.**
- **A-7 timeout (mission §18/§26).** Correctly refuses to pick a numeric SLA or owner; `cutover_at` is the
  correct clock origin (durable, immutable, already exists); the additive nullable v7 column is the safer choice
  the mission's §26 flags over pure recomputation, because it survives a `timeout_ms` setting change after
  cutover without moving the deadline (AD-8 rule (iv) says the column is immutable after insert). **REQUIRED
  BUT NEEDS ONE CORRECTION**: AD-8/A-7 do not say what happens on a clock jump (mission §26 explicitly asks).
  Given the deadline is `cutover_at + timeout_ms` computed fresh on each lifecycle pass from durable UTC
  timestamps, a wall-clock jump can only move the *computed* deadline, never the durable inputs — record this
  reasoning as one sentence in A-7 rather than leaving it silently unaddressed (a genuine question the mission
  raised that the text doesn't currently answer, even though the answer is a straightforward consequence of the
  existing design).
- **A-8 host scope (mission §19/§27).** Correctly distinguishes first-activation scope from final product
  hosts ("Any future provider... must declare `supportsDelegatedCutoverHold`"). **REQUIRED_AS_WRITTEN**, folded
  into the §7 correction (the restart-boundary sentence belongs next to this amendment).

## 20–21. Dependency DAG / critical path

Re-derived independently from the actual code dependencies (not copied from ARCH §3): P1 must precede P2 (exit
evidence needs the capture-box widening P1 adds) and P3 (signalling needs verified identity — confirmed by
reading `resolveProcessTermination`'s call sites, which take a `handle`/`identity` argument sourced from the
same capture path P1 produces). P4→P5 (provenance reads the S5-bound path/base) and P3→P5 (finalization capture
happens after `PROCESS_TERMINAL_OBSERVED`) both check out against `converge-delegation-boundary-lifecycle.ts`'s
actual phase ordering (Phase 1 observe → ... → Phase 5 settlement/provenance, `:158` gates on settlement which
A-2 changes, not phase order itself). P7→P8s (the route wraps the fixed projector) and P8s→P8c (transport must
exist before fence acquisition, not only before terminal projection — confirmed: `acquireOrcaFence` itself has
no route today per D-3, so P8c cannot function pre-P8s) both hold. I could not find a code dependency that
would move P9 earlier than P8c (pre-commit orphan release genuinely needs `safeReleaseOrcaFence` transport,
D-4) or P10 earlier than P3/P6b/P9 (the ingress refusing without timeout policy needs P6b to exist). **The DAG
in ARCH §3 is correct; no correction required.** One addition: the §6 fix (marker-capture-failure teardown)
belongs inside P1, not as a new node — it does not change any edge.

## 22. Slice decomposition

Each of P0–P12 has one coherent correctness boundary and an independently statable RED, with the R-1..R-5
discipline (ARCH §1) correctly forbidding test-only evidence for production gaps. P8s/P8c is the one pair that
legitimately couples two repos — ARCH already isolates it with its own "Arch review: yes" flag and documents
why (transport exists in neither repo). No slice mixes an unrelated authority decision with a schema change
except P6b, which ARCH itself flags with "Arch review: light" and ties the schema bump (v7, additive-only) to
the single decision it's inseparable from (timeout column). **No split or merge required.**

## 23. Cross-repo deployment / expand-compatibility

AD-10's ordering (§8 of ARCH) — aiControl P7→P7b→P8s first (additive, gate-off, old Maestro never calls the new
routes since it has no caller for them yet — confirmed D-2/D-4), then Maestro P1…P6b+P9 (dormant, fence port
already fail-closed by default per `aicontrol-fence-client-port.ts:20-41`, confirmed), then P8c (fails closed
against either an old aiControl with no routes, 404, or a new one) — is a genuinely safe expand order: nothing
requires the old side of either repo to understand a new mandatory contract before both sides are ready, and no
step's rollback requires deleting a durable fact (P7's fix only tightens the projector's own logic; P8s/P8c add
routes and an adapter, neither deletes state). **Sound as written.**

## 24. R3 definition

GAP/ARCH's definition (R1 schema + R2 fence-aware code published; R3 = prove every process capable of a native
CAS is fence-aware, method unprescribed by the frozen prerequisite doc) is the correct frozen-text reading — I
confirmed the fence prerequisite doc's §16 item 5 genuinely leaves the verification method open (this is not the
discovery inventing vagueness). Per the mission's §32 requirement for "exact evidence, not fleet awareness":
R3 must now explicitly include the §9 terminal-writer ratchet's pass/fail (not just P7/P7b "published") as one
of its proof obligations, since a fence-aware *process* is not the same claim as a fence-aware *every status
writer in that process* — the two are related but R3 as scoped in ARCH §9/PL-1 conflates them. **Correction
folded into PL-1** (§25 below), not a new R3 clause.

## 25. Activation checklist PL-1…PL-20

Classification spot-check (not all 20 re-derived, since none depend on unverified premises beyond what's already
covered): PL-1 (R3 proof) is `TECHNICAL_PROOF`+`DEPLOYMENT_PROOF` combined and should explicitly reference the
§9 ratchet, not just "P7/P7b code" — see §24. PL-15 ("no automatic fallback... no code path releases a `cutover`
fence, deletes `delegation_cutover`, respawns, or re-admits natively") is independently checkable today: I
confirmed `safeReleaseOrcaFence`'s CAS matches only `orcaFenceState='fenced'` (`orca-fence.ts:175-180`), never
`'cutover'` — a released fence cannot exist once cutover has committed, by construction, exactly as PL-15
requires. No PL item relies on an unmeasured premise without a stated obligation (PL-4/PL-5/PL-14 all correctly
point at the `[UNVERIFIED]` measurements in §27 below rather than assuming them). **Sound, with the PL-1 wording
note above.**

## 26. First controlled workload

Meets every property the mission's §34 lists: repository-local, no network/credentials, deterministic
scripted-stub command, bounded runtime, cancellation-safe (S10 explicitly exercises a SIGTERM-ignoring variant),
observable, disposable, Windows/Linux-only, manually supervised one-at-a-time. All ten mission-required
scenario classes (completed/failed/cancelled/timeout/restart/tampered-identity/recycled-pid/signal-ignored/
projection-retry-divergence/worktree-provenance) are present as S1–S10. **Sound; no correction.**

## 27. `[UNVERIFIED]` claim dispositions

I found 5 tags across GAP/ARCH/AMD. Disposition:

| Tag (location) | Category |
| --- | --- |
| POSIX `-pid` job-control group semantics (GAP B-3) | `MUST_MEASURE_BEFORE_FREEZE` of P3's RED — cannot write the RED without knowing this |
| In-process node-pty survival across host exit, Win/Linux (GAP D-1, ARCH §13.5) | `PRELIVE_PLATFORM_MEASUREMENT` — gates PL-4/PL-14, not P0 |
| macOS env-token readability / SIP behavior (GAP B-4) | `IMPLEMENTATION_RED_OBLIGATION` for the deferred macOS spike (A-4c) — correctly excluded from the first workload |
| Windows sync marker-capture latency (GAP B-1) | `PRELIVE_PLATFORM_MEASUREMENT`, folds into the §6 correction's P1 RED |
| Gate 35 prior "ALREADY_GREEN" classification (GAP §8) | `REMOVED_AS_FALSE` — I independently confirm D-5 (§4 above): no try/catch exists around the awaited commit, so the prior GREEN classification cannot be reproduced and should be struck, not merely "unverified" |

None of these are load-bearing for P0 (amendment ratification) itself — all gate later slices' REDs, which is
the correct place for them per the mission's §40 ("must not freeze a factual premise known only as assumption
if it is load-bearing" — none of these are load-bearing for the *architecture decision*, only for its
implementation).

## 28. Authority invariant

Checked against real code, not just prose: pre-cutover, `acquireOrcaFence`'s CAS only ever sets
`orcaFenceState='fenced'`, never touches `agentRuns.status` (`orca-fence.ts:96-105`) — native execution
authority is untouched by fencing alone. Post-cutover, the only writer with a `orcaFenceState='cutover'`
predicate is `projectDelegatedTerminalResult` (§9 table) — copy-only, never a decision (it writes exactly the
`status` it was handed). `finalizeRunOnce`'s `ne(orcaFenceState,'cutover')` guard is the system-wide enforcement
mechanism that makes "aiControl never decides post-cutover" a property of the code, not a convention. **No dual
authority path found anywhere I checked.**

## 29. Break-glass (mission §36)

ARCH §11's table gives every situation a MAY/MUST NOT pair; I checked the two highest-risk rows against code:
"fence acquired, Orca cannot start" → retry-with-same-token is idempotent by aiControl's own token-match branch
(`orca-fence.ts:124-127`, `ALREADY_FENCED_SAME_TOKEN`); the evidence-gated release requires
`positiveNoCutoverEvidence: true` and the CAS still requires `orcaFenceState='fenced'` (not `'cutover'`), so a
break-glass release genuinely cannot fire post-cutover. **Sound; no dual authority possible via any break-glass
row.**

## 30. Gate matrix

GAP §7's matrix already obeys the mission's §37 vocabulary strictly (`NOT_STARTED`/`DORMANT_IMPLEMENTATION`/
`IMPLEMENTATION_PROVEN`/`PRE_LIVE_REQUIRED`/`LIVE_PROOF_REQUIRED`, never `COMPLETE`) — I re-checked gates 11/12
(D-7-adjacent) and gate 35 (D-5-adjacent) specifically per the mission's §37 instruction to inspect them:
gate 35 is correctly `PRE_LIVE_REQUIRED` (not the disputed prior `ALREADY_GREEN`, which GAP already struck —
see §27); gates 11/12 are `PRE_LIVE_REQUIRED` pending the P7/P7b projector+audit fix, consistent with §9's
finding that the audit is real work, not already done. **No overclaim found.**

## 31. M5

`NOT STARTED` throughout every document; no proposed slice introduces an automatic-fallback path (checked
AD-9's host-quit policy specifically, since that's the one place a "just restart it natively" impulse would
most plausibly leak in — it does not; it yields `NULL` + incident like every other unrecoverable case).

## 32. aiControl guard (before/after, this session)

`origin/master` == `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` (`git -C aiControlCenter rev-parse origin/master`,
confirmed before and after this review's work). All aiControl reads in this session used
`git show ab5967bdde...:<path>` — the local working-tree checkout of aiControlCenter is 13 commits behind
`origin/master` with local uncommitted changes and was never read from directly, and nothing under that repo
was modified. `data/app.db` SHA-256 was not independently re-hashed in this session (no local `data/app.db`
was touched or needed — all reads were `git show` against the pinned SHA); GAP's own claimed hash
(`2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`) is carried forward as GAP's claim, not
independently re-verified here, since this review's aiControl work was entirely read-only against git blobs
and never touched that file.

## 41. Amendment-by-amendment verdict

| Amendment | Verdict | Note |
| --- | --- | --- |
| A-1 (termination confirmation) | **REQUIRED_AS_WRITTEN** | §8 — frozen-text characterization confirmed accurate |
| A-2 (settlement not-applicable) | **REQUIRED_AS_WRITTEN** | §11 — semantics precisely bounded, does not bypass convergence |
| A-3 (provenance) | **REQUIRED_AS_WRITTEN** | §11 |
| A-4(a) (identity producer clarification) | **REQUIRED_AS_WRITTEN**, with the §6 crash-window addition folded into its P1 implementation scope, not the amendment text itself (A-4a is a clarification of *who*, not *what happens on marker-capture failure* — that's an architecture/slice-scope fix) | §6 |
| A-4(b) (recycled pid ⇒ gone) | **NOT_REQUIRED for the first workload; correctly optional** | pure liveness refinement, adds no signal path, P1 ships without it |
| A-4(c) (macOS signal-grade) | **DEFERRED, correctly** | first workload explicitly excludes macOS |
| A-5 (exit evidence source) | **REQUIRED_AS_WRITTEN** | §11 — honestly states its own live-callback-only limitation |
| A-6 (transport) | **REQUIRED_AS_WRITTEN** | §11 |
| A-7 (timeout) | **REQUIRED_BUT_NEEDS_CORRECTION** | §11 — add one sentence on clock-jump behavior |
| A-8 (host scope) | **REQUIRED_AS_WRITTEN**, packaged with the §7 restart-boundary sentence | §7, §11 |

Tally: **7 REQUIRED_AS_WRITTEN, 1 REQUIRED_BUT_NEEDS_CORRECTION (A-7), 1 NOT_REQUIRED-for-first-workload (A-4b,
correctly optional per the candidate's own framing), 1 DEFERRED (A-4c)** — i.e. A-1..A-8 as a top-level list is
8 items where AMD's own table already marks A-4(b)/(c) as optional/deferred sub-items of A-4(a), consistent with
the operational-state block's "with A-4(b/c) optional/deferred" framing given at the top of the review mission.

## 42. Measurement obligations (non-blocking, do not gate P0)

POSIX job-control group kill semantics (P3 RED); in-process node-pty host-exit survival, Windows sync
marker-capture latency (P1 RED, includes the §6 crash window); macOS env-token readability (deferred A-4c
spike). None block ratifying the architecture; all block the *slice* they belong to reaching GREEN.

## Final

```
state_class:     ARCHITECTURE_CHANGES_REQUIRED
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_CHANGES_REQUIRED
```

Three corrections required before freeze (§6 B-1 crash-window disposition, §7 AD-1/H1 boundary sentence, §9
P7b audit-scope rewrite), one amendment needs one added sentence (A-7 clock-jump), zero PRE_LIVE BLOCKERs,
zero authority-safety defects found, DAG/slice-plan/cross-repo-ordering/R3/PL-checklist/first-workload/
break-glass/gate-matrix all sound as written. Do not freeze until §6/§7/§9/A-7 are corrected; do not enable
fence acquisition, start R3, or activate `ORCA_DELEGATED` regardless of this verdict — those remain separate,
later authorizations. `ORCA_DELEGATED` NOT STARTED. Fence acquisition DISABLED. R3 NOT STARTED. M5 NOT STARTED.

STOP.
