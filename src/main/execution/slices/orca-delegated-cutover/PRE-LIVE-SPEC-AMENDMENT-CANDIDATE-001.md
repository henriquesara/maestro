# ORCA-S5 — PRE_LIVE SPEC AMENDMENT CANDIDATE 001 (`S5-PL-A1…A8`)

**Candidate. Not frozen, not reviewed, not accepted, authorizes no implementation.** It does **not** edit the
frozen `SPEC.md` (accepted architecture HEAD `627b00b0b71a345783dbc37f9ebff99033e8dc80`) or any S1–S4 SPEC. Each
item is the *smallest* change that closes a gap the GAP document proves against source; a real conflict with
frozen text is a `CONTRACT_CONFLICT` resolved only by an accepted amendment, never by editing the SPEC in place.
Namespace: `S5-PL-A<n>` ("S5 PRE_LIVE amendment n"), to be adopted as `SPEC-AMENDMENT-001.md` beside the SPEC
if accepted (mirroring the S1/S3 amendment convention).

Evidence for every "Problem" line is in `PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md` (GAP). Design intent is in
`PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md` (ARCH).

| ID | Subject | Blocks | Needs product input |
| --- | --- | --- | --- |
| A-1 | Delegated termination confirmation | P3 (and P5, P10 downstream) | `G`/`H` escalation values |
| A-2 | Delegated settlement is not applicable | P5 → P6 | no |
| A-3 | Delegated real-worktree provenance & run-identity binding | P4, P5 | no |
| A-4 | Real-process identity evidence (a: producer, b: recycled pid, c: macOS signal-grade) | P1 (a, b), macOS later (c) | no |
| A-5 | Exit evidence source | P2 | no |
| A-6 | aiControl delegation API & transport, ack gating | P8s, P8c | auth mechanism |
| A-7 | Timeout policy | P6b | value + owner sign-off |
| A-8 | Provider/host scope statement | P0/AD-1 | host choice |

---

## A-1 — Delegated termination confirmation (amends S4 §9.3 as reused by S5 §7.1/§12; supersedes one encoded RED assertion)

**Problem.** S4 §9.3 records `dispatch_termination(signalled, tree_verified=<returned boolean>)` when a signal
call returns, and states `tree_verified=0` "is not an incident" — justified only for a leaf shadow fixture and
flagged: *"If a future revision ever gives the shadow lifecycle process real descendants, `tree_verified=0` must
be revisited"*. S5 §7.1 reuses the behaviour "verbatim". Against a real PTY it can durably certify
`cancelled`/`timeout` for a workload that is still running (GAP B-3; `lifecycle-process-termination.ts:144,161,184`).

**Amendment.** For a delegated run (durable `delegation_cutover` exists):
1. `dispatch_termination` MUST be written only when the exact process identity/tree is **observed terminal**
   (`PROCESS_TERMINAL_OBSERVED`: pid absent, or start-marker mismatch proving the instance gone, or certified
   exit evidence per A-5). A returned signal call, `verified` true or false, MUST NOT write it.
2. `termination_method='signalled'` means *reached terminal state after a durably recorded Orca teardown
   request* (attribution). `tree_verified=1` only when the whole tree/session was observed gone.
3. The four facts are distinct: `TERMINATION_REQUESTED` (durable, existing `teardown_requested_at` +
   `teardown_reason`), `SIGNAL_ATTEMPTED` (non-durable diagnostic), `SIGNAL_CONFIRMED` (not a fact),
   `PROCESS_TERMINAL_OBSERVED` (durable `dispatch_termination`). No signal fact may create a terminal fact.
4. Escalation is driven by the durable request clock: graceful → (after `G` from `teardown_requested_at`)
   forceful → (after `H`) blocking incident `termination_unconfirmed`; `G`,`H` are policy inputs with **no
   production default**; absence ⇒ one graceful attempt then the incident. Identity is re-verified before
   every attempt (uncertain ⇒ no signal).
5. The delegated termination primitive is the repository's PTY-aware hardened primitive
   (`pty-descendant-termination.ts` and the Windows PTY job/identity helpers), not the root-only pid-group kill.
6. Every PTY stop/kill entry that can reach a delegated PTY is routed through `requestDelegatedCancellation`
   (records `user_cancel` first) or refused (closes gate 27's audit gap, GAP D-6).

**Affected clauses.** S4 §9.3 bullets "Live handle present, still running", "No live handle, teardown_requested_at
already set…", and its `tree_verified=0` paragraph (delegated runs only; the shadow arm is unchanged); S5 §7.1
(the "verbatim" sentence), §9.1 (adds the escalation clock; the two-entry reason map is unchanged), §14 X10/X12
(no change to PK semantics), §16 `RECONCILIATION_INCIDENT` (new kind `termination_unconfirmed`, permitted by
§21 item 3). New incident kind follows the same non-fabrication discipline.

**Superseded RED assertion (must be named in the RED).** `post-cutover-lifecycle-no-fallback.test.ts`:
*"a signal whose tree is only root-verified (verified=false) still yields the durable-reason classification"* —
replaced by: *no terminal fact is written until terminal is observed; `verified=false` with a live process yields
no termination row and, after `H`, `termination_unconfirmed`.* This is a specification change, not test weakening.

**Does not change:** first-writer-wins teardown reason (X13), `deriveDelegatedTerminalStatus`, the closure/outbox
pipeline, the no-fallback rule.

## A-2 — Delegated settlement is "not applicable" (amends S5 §9, §16 and the S4 §11 Phase 2/3 eligibility for delegated runs)

**Problem.** The sweep requires a `settlement_observation` before finalization/closure
(`converge-delegation-boundary-lifecycle.ts:158,163-166`). S2's only source is a shadow Orca task/dispatch that a
delegated PTY session never creates (`read-only-shadow-settlement-source.ts:105`), and deriving it from
aiControl would deadlock against the projection (GAP B-6).

**Amendment.** For a delegated run: (i) eligibility for finalization and closure does not require a
`settlement_observation`; (ii) the closure's `settlement_status_ref` is the token `not_applicable_delegated`
(the column is `TEXT NOT NULL` with no CHECK — no migration; the token participates in the five-field digest like
any string); (iii) Phase 5's contradiction check is unchanged (it already skips when no current settlement
exists); (iv) SPEC §16's "Settlement: Orca" cell reads: *no aiControl/S2 settlement exists for a delegated run;
Orca's terminal fact and closure are the settlement*.

**Affected clauses.** S5 §9.2 (five-field digest content, token only), §16 authority table (Settlement column),
S4 §11 Phase 2/3 (delegated arm). **Does not change:** shadow runs (still require S2 rows), S2/S3 code.

## A-3 — Delegated real-worktree provenance and run-identity binding (amends S5 §13 and §5.4; re-scopes gate 23)

**Problem (a).** S5 §13 states S3 capture is "reused unmodified, pointed at the real dispatch worktree". S3's
identity model requires a sidecar whose `worktreePath` canonicalizes inside the durable *shadow* root
(`read-only-worktree-provenance-source.ts:72`); a real Maestro worktree cannot satisfy it.

**Amendment (a).** A delegated variant of the capture, Execution-owned, invoked after `PROCESS_TERMINAL_OBSERVED`:
identity = (realpath of the bound `dispatch_worktree.worktree_path`, the `dispatch_worktree` row for the
dispatch) — no sidecar-in-root. It uses the existing read-only git argv whitelist (Git 2.25 baseline; no new git
subcommand) and writes the existing `worktree_provenance` columns (`base_commit` from the bound row,
`candidate_head`, `files_changed_json`, `worktree_path_ref`). Folder workspace ⇒ no capture and
`worktree_provenance_ref='not_applicable_folder_workspace'`. The real worktree is never mutated or deleted;
finalization stays `skipped_not_eligible` (§13, gate 24). The S3 shadow converge code is unmodified, so gate 23's
byte-diff still holds; its *premise* (S3 reused for a real worktree) is replaced by this variant.

**Problem (b).** `run_binding`/`dispatch_worktree` carry placeholders (`'unused'`, `'0'×40`, null `aicontrol_run_id`,
fabricated `orgTaskId`/`orcaRunId`/`governanceAgentRunId`); `run_binding.base_commit` is `NOT NULL`.

**Amendment (b).** The S5 transaction (§5.4) binds real values captured at S2 (path, `git rev-parse HEAD`,
`aicontrolRunId`, and defined identity refs: `governanceAgentRunId := aicontrolRunId`, `orgTaskId`/`orcaRunId`
:= `correlationId` — explicitly Execution-minted, documented as such); a folder workspace uses the constant
`NO_GIT_BASELINE` for `base_commit`; a same-identity retry whose captured values differ ⇒ `conflicting_identity`.

**Affected clauses.** S5 §5.4 (values only, transaction shape unchanged), §13, §19 gate 23 (re-scoped).

## A-4 — Real-process identity evidence (clarifies S5 §5.6/§7.1/§11, S4 §9.1–9.3)

**(a) Producer — clarification, no semantic change.** For a delegated PTY process the runtime produces the S4
identity sidecar exactly per S4 §9.2 steps 3–4: placeholder before spawn (nonce minted at S2), rewritten with
`spawnedAt, pid, osStartMarker, osStartMarkerSource` in the site-#5 callback **before** the commit transaction;
the durable lifecycle root is resolved through `resolveDurableShadowLifecycleRoot`. The capture box may carry
`ptyId` and `incarnationId` (mechanism identities). Fills the gap that "no frozen text names a sidecar producer".

**(b) Recycled pid ⇒ original gone (optional; changes S4 §9.3 for delegated runs).** *Sidecar valid ∧ pid exists
∧ current marker readable ∧ current marker ≠ stored marker* ⇒ `confirmed_dead_unknown_cause` (never a signal),
not `identity_unverifiable`. A different readable marker is positive proof that a different instance owns the pid
on every platform. Any unreadable/ambiguous input remains `identity_unverifiable`. Rationale: the frozen mapping
leaves a run permanently blocked for a case in which the original is provably dead.

**(c) macOS signal-grade proof (deferred).** S4 §9.1.3's argv/nonce proof is unsatisfiable for a real shell. A
delegated variant may substitute a per-run nonce carried in the spawn **environment** (read back for the same
user) plus pgid/session/tty corroboration, all-or-nothing, still failing closed. Not implemented before a macOS
measurement spike; until then macOS live pids stay `identity_unverifiable` (no signal) and the first workload
excludes macOS.

**Affected clauses.** S5 §5.6, §7.1 ("verbatim" qualified by (b)/(c)), §11; S4 §9.1.3/§9.3 (delegated arm).

## A-5 — Exit evidence source (closes S4 §18's last bullet; qualifies S5 §5.6)

**Problem.** S4 §18 requires Slice B to "make and record the same decision for whatever real process-exit signal a
production executor eventually provides"; S5 never recorded it, so `completed`/`failed` are unreachable for a
PTY (GAP B-2).

**Amendment.** (i) `onExit` is an **evidence source**, never authority and never Promise state. (ii) On a
certified exit (`cause.kind ∈ {exited, signaled}` with `providerExitObserved`/`hostExitConfirmed`) the runtime
synchronously writes a durable exit-evidence record (atomic temp+rename, keyed by `orcaDispatchId`,
`correlationId`, `processNonce`, `pid`, `incarnationId`) as the first statement of `onPtyExit` for a registered
delegated PTY. (iii) The port consults it (validating identity fields) before any OS probe and reports
`self_exit`; the sweep remains the **sole writer** of `dispatch_termination`. (iv) Uncertified causes (`unknown`,
node-pty's `-1`, a daemon-reported `0`-for-crash) produce no evidence ⇒ `NULL` classification + incident.
(v) `operator_close` is attributable to `user_cancel` only if a durable teardown intent already exists.

**Affected clauses.** S5 §5.6 (the sentence that the recovery path "does not depend on the provider's exit
listener" remains true for *liveness*, and is qualified for *classification*), §14 X10 (adds the evidence branch
before `confirmed_dead_unknown_cause`). **Does not change:** the closure derivation rules (§9.2).

## A-6 — aiControl delegation API, transport and ack gating (corrects S5 §4.8.5 and §6; extends §8.3/§10)

**Problem.** §4.8.5/§6 assume "real, published, HTTP-facing API routes". None exist; the four fence/projection
operations are in-process library functions of aiControl. Maestro has no acknowledge/release/project operation,
never advances `ack_status`, and its outbox resolves an early `FENCE_MISMATCH` to a **terminal** blocked state
(GAP B-8B, D-3, D-4).

**Amendment.** (i) aiControl exposes authenticated routes wrapping `acquireOrcaFence`, `acknowledgeOrcaCutover`,
`safeReleaseOrcaFence`, `projectDelegatedTerminalResult` with no added semantics: 1:1 outcome mapping;
`ACQUISITION_DISABLED` while the gate is false; local-only by default; per-installation secret. (ii) Any
transport failure, unknown route/outcome ⇒ Maestro fails closed (never `ACQUIRED`/`PROJECTED`). (iii) Idempotency
key `(operation, aicontrolRunId, fenceToken)` (+`closureDigest` for projection). (iv) Projection payload
`{runId, token, status∈{completed,failed,cancelled,timeout}, finishedAt (ISO-8601 UTC ms = termination
observedAt), closureDigest}`; `stdout`/`stderr` omitted (v1). (v) The acknowledge is performed by a lifecycle-pass
task keyed on `ack_status='pending'` and retried to `ACKNOWLEDGED`; `ack_status` gains its first writer.
(vi) The projection outbox creates/attempts a projection only when `ack_status='acknowledged'`; `FENCE_MISMATCH`
while un-acked is retriable; only a token/identity mismatch after acknowledge is the terminal
`blocked_fence_mismatch`. (vii) The Maestro↔aiControl boundary never opens `data/app.db` for write.

**Affected clauses.** S5 §4.8.5, §6 Phases 1/4, §8.3 (status semantics), §10, §14 X1/X4-X8, §15.

## A-7 — Timeout policy (closes S5 §12/§21 item 1)

**Problem.** The SLA source is unfrozen; aiControl's `execution.timeout_ms` is a global setting read at execution
time and not stored on the run (GAP B-9).

**Amendment.** (i) Owner: Maestro/Orca (the delegated authority). (ii) Config: an explicit Maestro setting with
**no default**; absent ⇒ ingress refuses to start a delegated run. (iii) Start reference: `delegation_cutover.
cutover_at`. (iv) Copy at cutover into additive nullable `delegation_cutover.timeout_ms` (schema v7); the column
is immutable after insert like every other except `ack_status`. (v) The lifecycle pass decides
`now ≥ cutover_at + timeout_ms` from durable values and records `teardown_reason='timeout'` (first writer wins,
X13) before any signal. (vi) No in-memory timer is authoritative. The numeric value and the sign-off owner are a
product decision **not made here**. (vii) **Clock-jump behavior (independent review §11/§26 — required
correction).** The deadline is computed fresh as `cutover_at + timeout_ms` on each lifecycle pass from durable
UTC timestamps; there is no persisted absolute deadline to desynchronize. A wall-clock jump (forward or
backward) can only move the *computed* comparison, never the durable inputs (`cutover_at`, `timeout_ms`): a
backward jump delays the decision by the jump amount, a forward jump advances it by the same amount, and
neither corrupts durable state or produces a spurious timeout write, because the comparison is re-derived on
every pass, not accumulated.

**Affected clauses.** S5 §8.1 (one added immutable column), §12 Timeout bullet, §21 item 1 (resolved).

## A-8 — Provider/host scope statement (corrects S5 §4.1, §7.3, §20 narrative)

**Problem.** The SPEC calls `LocalPtyProvider` "the load-bearing provider" and scopes to "local"; production's
default host is the daemon adapter, which is not delegated-eligible, so a delegated request is rejected
(`delegated_cutover_provider_unsupported`) unless `LocalPtyProvider` is active (GAP D-1).

**Amendment.** State that the delegated scope is **the eligible provider actually selected for the run**; record
the host decision (ARCH AD-1: H1 for the first controlled workload, H2 tracked separately); no change to the
capability contract or the eligibility gate (§7.3). Any future provider (including the daemon adapter) must
declare `supportsDelegatedCutoverHold` and clear gates 31-63 before delegating. In-process node-pty survival
across a host restart is **not** assumed. **Restart-scope boundary (independent review §7 — required
correction, packaged with this amendment):** the H1 first-controlled-activation restart acceptance (ARCH §10)
is scoped to `FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` only and must not be read as
`GENERAL_DELEGATED_RESTART_CONVERGENCE`; see ARCH §10 for the exact boundary sentence and the H2 milestone that
removes it.

---

## Not amended (deliberately)

The cutover transaction shape, the single-authority table, `teardown_reason` two-entry map, first-writer-wins
races, the no-fallback rule, S3/S4 shadow code, `EXECUTION_SCHEMA_VERSION` 6 semantics (only A-7 adds v7),
M5 (not started), remote/SSH (out of scope, §20).

## Review checklist for these amendments

1. Does each amendment change only what its "Problem" proves broken? 2. Is any authority moved or duplicated?
(none may be.) 3. Is any safety property weakened for liveness? (A-4(b) is the only liveness refinement; it adds
no signal path.) 4. Is the RED impact explicit (A-1 supersedes exactly one named assertion)? 5. Is each
`[UNVERIFIED]` claim converted to a measurement obligation rather than an assumption?
