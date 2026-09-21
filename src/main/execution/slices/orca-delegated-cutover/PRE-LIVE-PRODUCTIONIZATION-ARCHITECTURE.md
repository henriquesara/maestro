# ORCA-S5 PRE_LIVE PRODUCTIONIZATION — ARCHITECTURE & SLICE PLAN (candidate)

Candidate architecture; **not frozen, not independently reviewed, authorizes no implementation.** It turns
B-1…B-9 (see `PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md`, "GAP") into an executable, dependency-ordered plan.
It does not amend the frozen S5 SPEC: every place it needs the SPEC to say something different is isolated in
`PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md` ("AMD", items A-1…A-8) for separate review. No production code,
test, schema, migration or aiControl file is changed by this document.

```
state_class:     PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_READY_FOR_REVIEW
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_READY_FOR_INDEPENDENT_REVIEW
base:            origin/main 1f70bdf4992ae920aed56de905edb0463faa8657
```

Operational state throughout: authority `AICONTROL_NATIVE`; `ORCA_DELEGATED` NOT STARTED; fence acquisition
DISABLED; R3 NOT STARTED; M5 NOT STARTED.

## 1. Discipline for every slice (binding on the plan)

- **RED integrity rule R-1 (no test-only evidence).** A RED/GREEN for a production gap must obtain its
  evidence *through the production composition*: a test may not write an identity sidecar, exit evidence,
  `dispatch_worktree` row, settlement row or provenance row that production is supposed to produce. Seeding
  upstream facts (`seedUpstreamTerminal`, test-written sidecars — the current shortcuts, acceptance §11) is
  permitted only for *negative controls* and must be labelled as such.
- **R-2 (supersession is explicit).** Where a slice changes a behaviour the accepted RED encodes (P3), the
  RED states the superseded assertion by name and the amendment that authorizes it; an independent reviewer
  accepts the spec change separately from the code.
- **R-3 (one review, one concern).** No slice mixes an architecture amendment, a schema change and a
  provider-layer change unless the coupling forces it (called out per slice).
- **R-4 (dormant until P12).** Every slice keeps fence acquisition disabled and the ingress (P10) absent or
  default-off; publication of any slice changes no live behaviour.
- **R-5 (standing regressions).** Gate 30 (S1–S4), Cutover-Core (10 files/46 tests) and Post-Cutover (9
  files/98 tests) suites must stay green and byte-unchanged except where R-2 names an assertion.

## 2. Architecture decisions

Each decision lists the recommendation, the consequence, and whether it needs a product/owner decision
before P0 can close. Rejected alternatives are stated so the review can challenge the choice.

### AD-1 — Which PTY host carries the first delegated workload (gates everything below) — **DECISION REQUIRED**

Facts (GAP D-1): the default production host is the daemon adapter, which is not delegated-eligible; only
`LocalPtyProvider` is, and only in degraded-fallback routing; there is no switch to force it.

| Option | What it is | Cost | Restart semantics |
| --- | --- | --- | --- |
| **H1** — controlled *local-host mode* | Add an explicit, default-off operator switch that skips daemon installation for one controlled Maestro instance, so `LocalPtyProvider` (already frozen, already eligible, gates 31-63 proven against it) hosts the run | small, but touches startup ordering `[UNVERIFIED — spike in P1]` | A live PTY is a child of the Electron main process; "survives Maestro restart" is **not** a property `[UNVERIFIED]`. Restart proof reduces to the *dead-host* branch (honest `NULL` + incident) and identity-recycle safety |
| **H2** — daemon-hosted delegation | Give the daemon adapter `supportsDelegatedCutoverHold` (held spawn, commit, then a release RPC that delivers the deferred command), pid/start-time and exit evidence supplied by the daemon (it already persists `endedAt`/`exitCode` in session history metadata; note `terminal-host.ts:132` coerces a missing code to `0`) | large: daemon protocol extension, version compatibility (`docs/reference/remote-wire-compatibility.md`), Windows daemon-host relocation | Real: the daemon outlives Maestro, so "re-identify the same live process" is meaningful and provable |
| H3 — non-PTY delegated runner (S4-style detached child with nonce argv, handle, exit code) | redesigns the frozen §4 seam | large + reopens frozen architecture | strongest identity/exit story |

**Recommendation.** Use **H1 for the first controlled workload** — it is the only host the frozen seam is
implemented and proven for — and register **H2 as a separate later track** (`LIVE_PROOF_REQUIRED` for gates
7/38/50 on a surviving process; broad activation is *not* claimed before it). Reject H3 (it redesigns the frozen
execution semantics the mission forbids redesigning). **Consequence:** the first-workload "restart" scenario is
defined for H1 (§10); B-1's sidecar is still required (recycled-pid safety, pre-commit orphan corroboration) and
B-4's signal-grade macOS proof is deferred because no live process needs re-identifying on H1.

### AD-2 — Identity evidence for a real PTY process (B-1, B-4) — resolution under the frozen SPEC, plus one refinement

- **Producer.** The runtime, at the two points S4 §9.2 already names: (1) *S2, before spawn* — mint
  `processNonce` (moved out of the callback), write the placeholder sidecar
  `{correlationId, orcaRunId, orcaDispatchId, processNonce, spawnedAt:null, pid:null, osStartMarker:null,
  osStartMarkerSource:null}` atomically (temp+rename) via the existing `writeProcessIdentitySidecarAtomically`;
  (2) *the S4 seam, in the site-#5 callback after the pid/marker are captured and **before** the commit
  transaction* — rewrite the sidecar in place with `spawnedAt, pid, osStartMarker, osStartMarkerSource`. The
  port's `spawn(adopt)` is called here so adoption is a real, exercised step (closes the B-7 half "port not
  wired").
- **Invariant.** Committed `dispatch_process_binding` ⇒ sidecar-with-pid existed before the commit. Legal
  durable states: (a) placeholder only (crash before spawn — harmless); (b) sidecar-with-pid, no binding
  (pre-commit orphan C2 — corroborable from the sidecar alone, S4 §10.3; disposition in P9); (c) both. "Binding
  without sidecar" must be unreachable and is asserted by the RED.
- **Root.** Resolved through `resolveDurableShadowLifecycleRoot` (persisted in `execution_meta`, drift/loss
  fail-closed) — not the raw `join` the composition uses today.
- **Capture box widening (mechanism-only).** `preparedDelegatedProcessIdentityCapture.current` gains
  `{ ptyId, incarnationId }` next to `pid` (both are locals of `spawnLocalPty`), so B-2 can map an exit event to
  the dispatch. These are OS/mechanism identities, not aiControl data (SPEC §4.8.3 boundary preserved).
- **Refinement (optional, AMD A-4b).** S4 §9.3 maps *sidecar valid ∧ pid exists ∧ marker readable ∧ marker ≠
  stored* to `identity_unverifiable` (blocked forever). That state is in fact **positive proof the original
  instance is gone** (a different instance owns the pid). Classifying it `confirmed_dead_unknown_cause`
  removes a permanent block without ever signalling. Safe on every platform (different `lstart` is decisive).
  Without A-4b the frozen behaviour stands and P1 still ships.
- **macOS (B-4).** Two grades. *Classification-grade* (is the original gone?): sidecar + `lstart`, same as above —
  in scope for P1. *Signal-grade* (is this live pid the original?): needs a second discriminator; propose a
  per-run nonce in the PTY spawn environment (`env` already flows through `createTerminal`; the handle
  `ORCA_TERMINAL_HANDLE` already rides there) read back with `ps eww`/`KERN_PROCARGS2` for the same user
  `[UNVERIFIED — macOS spike]`, plus pgid/session/tty as corroboration. Deferred (only load-bearing with AD-1/H2);
  **first workload excludes macOS**. Never weaken: uncertain ⇒ no signal.

### AD-3 — Exit evidence source (B-2) — **decision the frozen text delegated (S4 §18) and S5 never made**

`onExit` is an *evidence source*, never authority, never Promise state.

- **Same-instance tracker.** The runtime keeps a `DelegatedPtyRegistry` (`ptyId → {orcaDispatchId,
  processNonce, incarnationId, pid}`) populated from the widened capture box, and passes the port an exit
  tracker exposing the two fields the S4 same-instance path already reads (`exitCode`, `signalCode`) through
  the existing `liveHandles` slot. While the host is up, `observe` reports `self_exit` from it — no OS race
  between "pid vanished" and "exit event delivered" (the sweep must not conclude `confirmed_dead_unknown_cause`
  for a PTY the runtime still tracks as live).
- **Durable evidence.** The **first synchronous statement** of `onPtyExit` for a registered delegated PTY writes
  `<delegated root>/exit/<orcaDispatchId>.json` atomically: `{ orcaDispatchId, correlationId, processNonce,
  pid, incarnationId, cause: {kind:'exited', exitCode} | {kind:'signaled', signal}, observedAt }`. No schema
  change; it mirrors the identity sidecar.
- **Certification.** Evidence is written only when the cause is certified: `cause.kind ∈ {exited, signaled}`
  and `providerExitObserved`/`hostExitConfirmed` (node-pty's `-1` and the daemon's "0 for crashes" are *not*
  evidence — `onPtyExit` documents both). `unknown` ⇒ no evidence ⇒ honest `NULL` + incident. `operator_close`
  is not certified as `user_cancel`: it is attributable only if a durable teardown intent already exists (see
  AD-4/D-6).
- **Consumption.** `RealDelegatedProcessPort.observe` consults the evidence file (validating dispatch id,
  nonce, incarnation, pid against the durable binding) *before* any OS probe and returns `self_exit`. The sweep
  stays the **sole writer** of `dispatch_termination` (LIFE-11 single-writer preserved); exit evidence never
  writes a terminal fact by itself. `deriveDelegatedTerminalStatus` is unchanged (exit 0 ⇒ completed; nonzero
  or signal ⇒ failed).
- **Crash windows.** Host dies between the OS exit and the evidence write ⇒ evidence lost ⇒ `NULL` + incident
  (bounded to microseconds; honest, never guessed). Evidence durable, sweep not yet run ⇒ consumed next pass.
  Rejected alternative: have the exit hook insert `dispatch_termination` directly (a second writer whose loss
  of a race to the sweep's `confirmed_dead_unknown_cause` would permanently downgrade real evidence).
- **Daemon (H2).** The daemon's own history metadata becomes the evidence source; out of scope for the first
  workload.

### AD-4 — Signal confirmation semantics (B-3) — **amendment A-1 required**

Named durable facts (the mission asked they not be conflated):

| Fact | Meaning | Durable? | Authority effect |
| --- | --- | --- | --- |
| `TERMINATION_REQUESTED` | the decision to end the run with a reason | **yes** — `teardown_requested_at` + `teardown_reason` (exists; one statement, first writer wins) | none until a terminal observation; records *why* |
| `SIGNAL_ATTEMPTED` | a signal/kill was issued to the verified identity | **no** — non-durable diagnostic in the sweep report and an in-process rate limiter | **must not** be able to produce a terminal fact |
| `SIGNAL_CONFIRMED` | (a returned call, `verified` true) | **no** — subsumed | none; a returned/verified call is *not* death |
| `PROCESS_TERMINAL_OBSERVED` | the exact identity/tree is observed gone, or exit evidence exists | **yes** — `dispatch_termination` (exists) | the only thing that may create it |

Rules (A-1):
1. `dispatch_termination` for a delegated run is written **only** on `PROCESS_TERMINAL_OBSERVED`. After a
   signal returns, the sweep does not write it; the next pass re-observes.
2. `termination_method='signalled'` therefore means *"reached terminal state after a durably-recorded Orca
   teardown request"* (attribution), never *"a signal was sent"*. `tree_verified=1` only when the whole
   process tree/session was observed gone.
3. **Escalation clock is durable, not a new table:** graceful attempt → after grace `G` measured from
   `teardown_requested_at` → forceful → after hold `H` still alive ⇒ blocking incident
   `termination_unconfirmed` (no terminal fact, no closure, no fallback). `G`, `H` are **policy inputs with no
   production default** (a missing value ⇒ one graceful attempt then the incident; never a terminal fact).
   `SIGNAL_ATTEMPTED` is rate-limited in memory; a restart costs at most one extra idempotent signal.
4. **Primitive.** Delegated PTY termination uses the repository's PTY-aware hardened primitive
   (`pty-descendant-termination.ts`: snapshot descendants before the root; Windows job-object termination;
   `verifyWindowsTreeKillTarget`; delayed SIGKILL gated on an unambiguous capture second and matching pgid),
   not S4's root-only `signalProcessTreeByPid`. Identity is verified immediately before *each* attempt
   (uncertain ⇒ no signal). Fitness on POSIX/macOS is a P3 measurement `[UNVERIFIED]`.
5. A natural exit racing a pending request is classified by its own exit evidence (unchanged, acceptance §12);
   dead-with-intent and no evidence ⇒ `signalled` attribution with `tree_verified=0` (existing branch).
6. **Alternate kill paths (D-6).** Every PTY stop/kill entry that can reach a delegated PTY is either routed
   through `requestDelegatedCancellation` (records `user_cancel` *first*) or refused; app-quit policy is AD-9.
   P3 begins with an exhaustive inventory ratchet (a test that fails if a new kill entry is added without a
   declared delegated disposition).

Rejected: keep S4 semantics and add `tree_verified` alerting — it still durably certifies `cancelled` for a
live process. Rejected: durable `SIGNAL_ATTEMPTED` table — adds a schema change and a second fact that could
be mistaken for progress, for no correctness gain over the durable request clock.

### AD-5 — Real worktree/base binding (B-5)

Owner of the worktree: Maestro's existing worktree lifecycle (pre-existing to `createAgentSession`). At S2 the
closure captures `{ workspaceId, worktreePath (workspace.path/startupCwd), baseCommit (git rev-parse HEAD of
that path, or NO_GIT_BASELINE for a folder workspace), aicontrolRunId, real orca/gov refs }` and hands them to
`commitDelegatedCutover`, which writes them **inside the existing S5 transaction** (no earlier durable write,
no second authority). A retry whose captured values differ from the committed rows ⇒ `conflicting_identity`
(extends `commit-step:90-93`). Placeholder strings/zeros must not survive anywhere (static RED). Sentinel and
identity-ref semantics: AMD A-3(b).

### AD-6 — Settlement and provenance producers (B-6) — **amendments A-2, A-3 required**

- **Settlement (A-2).** For a delegated run the closure does not require an S2 `settlement_observation`;
  `settlement_status_ref = 'not_applicable_delegated'` (the column is `TEXT NOT NULL` with no enum CHECK; no
  migration). Rationale: S2's referent (a shadow Orca task/dispatch) does not exist for a PTY session, and an
  aiControl-derived value would deadlock against the projection. Phase 5's contradiction check is naturally a
  no-op (`!currentSettlement → continue`). Rejected: creating an Orca orchestration task/dispatch for every
  delegated PTY (a second integration for no correctness benefit).
- **Provenance (A-3).** A delegated variant of the S3 capture, Execution-owned, invoked by the sweep **after**
  `PROCESS_TERMINAL_OBSERVED` and before the closure: identity = (real path realpath, `dispatch_worktree` row
  for that dispatch), *not* a sidecar inside the shadow root; reads with the existing read-only git argv
  whitelist (Git ≥ 2.25 baseline — `rev-parse`, `diff --name-only`), recording `base_commit` (from the bound
  row), `candidate_head`, `files_changed_json`, `worktree_path_ref` into the existing `worktree_provenance`
  table; folder workspace ⇒ `worktree_provenance_ref = 'not_applicable_folder_workspace'`. Worktree is never
  mutated or deleted (finalization stays `skipped_not_eligible`, SPEC §13/gate 24). The S3 shadow converge
  code stays byte-unchanged (gate 23 re-scoped).

### AD-7 — Lifecycle caller (B-7) — implementable under the frozen SPEC

Owner: `OrcaRuntimeWithDelegatedCutoverCoordinator` (SPEC §4.8.1/§11), one startup registration after the PTY
provider is ready. Correctness = durable fixed point; cadence = liveness detail (not frozen).
- **Triggers:** (1) once at startup, *before* new delegated requests are admitted; (2) event kicks — after a
  successful cutover commit, on `onPtyExit` of a delegated PTY, after a cancel/timeout request, after an ack
  success/failure; (3) a periodic fallback timer whose interval is configuration, not architecture.
- **Concurrency:** in-process single-flight (overlapping requests coalesce into one follow-up pass); across
  processes/duplicates, convergence by PK/`insertOrConverge` (X12) and idempotent, identity-checked signals.
  Electron's single-instance lock (`startup/single-instance-lock.ts:44`) bounds this to one main process per
  user-data dir; a headless serve instance with its own data dir has its own store.
- **Startup with no delegated history:** no-op and **must not create `execution.db`** (the coordinator
  constructor opens/creates it; guard by existence/row check).
- **Shutdown/startup:** stop timers; never kill delegated processes as a side effect of shutdown; startup
  pass re-derives everything from durable facts (never a prior Promise).
- **Per-run isolation:** a failing run reports in `sweepErrors` without blocking siblings (S4 §13, unchanged).
- Ingress (D-2) is P10, not this slice.

### AD-8 — Timeout policy (B-9) — **product decision + amendment A-7**

- **Owner:** Orca/Maestro (Orca owns delegated authority; aiControl's global `execution.timeout_ms` is not
  visible to Orca and not stored on the run). Rejected: reading aiControl's setting (couples two DBs; changes
  under a running run) and making aiControl decide (violates single terminal authority).
- **Config source:** a Maestro setting with **no default** (absent ⇒ ingress refuses to start a delegated run —
  fail closed). The value is a product decision this document does not make.
- **Start reference:** `delegation_cutover.cutover_at` (durable, immutable). **Copy at cutover:** additive
  nullable column `delegation_cutover.timeout_ms` (schema v7; older binaries ignore it; there is no downgrade
  guard in `migrateExecutionStore`, and additive columns are safe for it).
- **Authority:** the lifecycle pass computes `now ≥ cutover_at + timeout_ms` from durable values and calls
  `requestDelegatedTimeout` (reason recorded **before** any signal, first writer wins vs cancel, X13). No
  in-memory timer is authoritative; a restart after the deadline decides on its first pass.
- **Durable handoff:** the durable `teardown_reason='timeout'` write itself.

### AD-9 — Host quit / crash of a live delegated run (D-9) — **product decision**

Frozen text yields `NULL` + incident (honest). Recommendation: keep it for the first workload, forbid
graceful-quit termination of delegated PTYs without going through `requestDelegatedCancellation`, and defer any
new `teardown_reason` (a third reason breaks the frozen two-entry map) to a future amendment.

### AD-10 — aiControl transport and API (B-8, D-3, D-4) — **amendment A-6**

- **Boundary.** New authenticated aiControl routes wrapping the four existing functions unchanged: `acquire`,
  `acknowledge`, `release`, `project`. Routes add no semantics: each maps the function's outcome union 1:1 and is
  a no-op that reports `ACQUISITION_DISABLED` while the gate is false. Local-only by default; per-installation
  shared secret; bounded request timeout; **any transport failure, 404 or unknown outcome fails closed (never
  `ACQUIRED`, never `PROJECTED`)**.
- **Identity/idempotency.** `(operation, aicontrolRunId, fenceToken)`; projection adds `closureDigest`.
  aiControl already provides same-token idempotency for acquire/ack; `project` is idempotent by the P7 semantics.
- **Payload (project).** `{ runId, token, status ∈ {completed,failed,cancelled,timeout}, finishedAt (ISO-8601
  UTC ms, deterministic = `termination.observedAt`), closureDigest }`. `terminal_status_ref` is the `status`
  copied verbatim. `stdout`/`stderr` are **omitted** in v1 (the projector skips `undefined`; delegated rows keep
  them null) — flagged as a product question for aiControl consumers.
- **Ack.** Maestro acknowledges after the S5 commit (a lifecycle-pass task keyed on `ack_status='pending'`,
  retried until `ACKNOWLEDGED`, independent of projection). **The outbox gates on `ack_status='acknowledged'`**,
  and `FENCE_MISMATCH` while un-acked is *retriable*, not terminal (fixes the permanent-block race, GAP B-8B).
  `ack_status` gets its first writer here.
- **Retry/timeout/crash windows:** bounded per-request timeout; per-run isolation; X1, X4–X8 proven with the
  child-process restart harness. aiControl **copies/projects** Orca's terminal truth; it never decides it.
- **Rejected:** Maestro opening `data/app.db` for writes (bypasses the CAS library and the AiControlDbReader
  read-only invariant).

## 3. Dependency DAG (from code/SPEC evidence)

```
                         P0  decisions & amendments ratified (AD-1, A-1..A-8, product: ingress, timeout, quit)
                          |
        +-----------------+-----------------------------+
        |                                               |
   MAESTRO LANE                                    AIcontrol LANE (parallel from P0)
        |                                               |
   P1 identity  ----+                                P7 projector fix ---- P7b fence-guard audit
        |           |                                   |
   P2 exit evid.    +--> P4 worktree/run ids            P8s API routes (gate-off)
        |                    |                              |
   P3 signal sem. <- (needs P1,P2)                          |
        |                    |                              |
        |               P5 closure inputs (A-2,A-3)         |
        |                    | (needs P3 terminal,P4)       |
        +----------+---------+                              |
                   |                                        |
              P6 lifecycle caller ---- P6b timeout(v7)      |
                   |                          |             |
                   +-----------+--------------+             |
                               |                            |
                          P8c Maestro adapter  <------------+
                               |   (ack-gated outbox, ack task)
                          P9 pre-commit failure + fence release  (needs P1, P8c)
                               |
                          P10 ingress + operator surface  (needs P0 product decision, P3, P6b, P9)
                               |
                          P11 PRE_LIVE operational gate: R3 proof, config check, rehearsal (disposable aiControl env)
                               |
                          P12 controlled first delegated run (LIVE_PROOF)
```

Edges and their evidence:
- `AD-1 → P1/P2/P3`: which provider, hence what a "handle", "exit" and "signal" are.
- `P1 → P2`: the capture box (`ptyId`, `incarnationId`) and the nonce; exit evidence is keyed by them.
- `P1, P2 → P3`: signalling needs verified identity; classification of a natural-exit-vs-cancel race needs exit
  evidence (acceptance §12).
- `P4 → P5`: provenance reads the real path/base bound at S5.
- `P3 → P5`: provenance/finalization capture after `PROCESS_TERMINAL_OBSERVED`.
- `P5 → P6`: nothing closes without A-2 (settlement gate, `converge…:158`), so a caller that runs earlier
  produces only incidents.
- `P6 → P6b`: the timeout decision runs inside the lifecycle pass.
- `P7 → P8s`: the `project` route wraps the fixed projector; deploy the projector first.
- `P8s → P8c`: acquire/ack/release/project transport is needed before **fence acquisition itself** (not only
  terminal projection).
- `P1, P8c → P9`: pre-commit orphan disposition needs identity and fence release.
- `P0 (ingress decision), P3, P6b, P9 → P10`: the operator surface exposes cancel/timeout config and refuses to
  run without timeout policy and a defined failure path.
- `P7, P8s, P8c, R3 → P11 → P12`.

## 4. Critical path

**Shortest safe sequence to one controlled real workload** (two lanes joining at P8c):

`P0 → P1 → P2 → P3 → P4 → P5 → P6 → P6b → (join P8c) → P9 → P10 → P11 → P12`
with the aiControl lane `P0 → P7 → P7b → P8s` running in parallel and joining before `P8c`.

Every slice on it is necessary: P1-P3 (a real process is identifiable, its exit is classifiable, its
cancellation is truthful), P4-P5 (closure is reachable and real), P6/P6b (someone actually runs the sweep and
decides timeouts), P7/P8 (fence acquisition and projection can occur at all), P9 (the "fence acquired, Orca
cannot start" branch has an automated, evidence-based exit), P10 (a run can be requested), P11 (R3 and the
rehearsal), P12 (the run). Optimized for smallest independently reviewable correctness slices, not commit
count. P4 may run in parallel with P2/P3 after P1 (it edits the same callback/coordinator files — serialize
merges). P7b is small and may overlap P8s.

## 5. Slices

Legend: **Repos** M = Maestro, A = aiControl. **Arch review** = whether an independent architecture review of
new semantics is required before RED. Publication order is in §8.

| # | Slice | Blockers | Repos | Arch review | Amendment | Schema |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Decisions & amendments ratification | all | M (docs) | **yes** | A-1…A-8 | — |
| P1 | Real process identity production | B-1, B-4a, B-7(port) | M | light (A-4) | A-4 | none |
| P2 | Real exit evidence | B-2 | M | light (A-5) | A-5 | none |
| P3 | Termination confirmation semantics | B-3, D-6 | M | **yes** | A-1 | none |
| P4 | Real worktree & run-identity binding | B-5, D-8 | M | no | A-3(b) | none |
| P5 | Delegated closure inputs (settlement + provenance) | B-6 | M | **yes** | A-2, A-3 | none |
| P6 | Lifecycle runtime composition | B-7 | M | no | — | none |
| P6b | Timeout policy | B-9 | M | light | A-7 | **v7 additive** |
| P7 | Projector divergence fix | B-8A | A | no (SPEC §10.2 frozen) | — | none |
| P7b | aiControl fence-guard audit | D-7 | A | no | — | none |
| P8s | aiControl delegation API (server) | B-8B, D-3 | A | **yes** | A-6 | none |
| P8c | Maestro transport adapter + ack-gated outbox | B-8B, D-4 | M | (with P8s) | A-6 | none |
| P9 | Pre-commit failure path & fence release | D-4, D-5 | M | light | — | none |
| P10 | Ingress & operator control surface | D-2 | M | **yes** (product) | — | none |
| P11 | PRE_LIVE operational gate | B-9 | M+A | no | — | none |
| P12 | Controlled first delegated run | all | M+A | no | — | none |

### P0 — Decisions & amendments ratification
Docs only. Inputs: this document, the gap analysis, AMD candidate. Outputs: ratified AD-1 (host), AD-4 (A-1),
AD-6 (A-2/A-3), AD-8 (timeout owner), AD-9 (quit), ingress/product decisions; the list of RED assertions
superseded (R-2). No RED. Acceptance: independent architecture review verdict
`ARCHITECTURE_ACCEPTED_READY_TO_FREEZE` on the amendment document. **Blocks every other slice.**

### P1 — Real Process Identity Production
- **Owner:** Runtime composition (writer/adoption) + Execution infrastructure (sidecar store, root resolver).
- **Inputs:** pid/`ptyId`/`incarnationId` (widened capture box), OS marker (`captureOsStartMarkerSync`),
  `correlationId`, `orcaDispatchId`, minted nonce. **Outputs:** placeholder→final identity sidecar at the S4
  path under the resolved root; adopted port; nonce moved to S2; `resolveDurableShadowLifecycleRoot` used.
- **Touches:** files only (no tables); `PtySpawnOptions.preparedDelegatedProcessIdentityCapture` type (mechanism
  data only); callback, coordinator, composition.
- **Genuine RED:** through the real callback/coordinator with a real child process (no test-written sidecar):
  sidecar-with-pid exists before the `delegation_cutover` row; fresh-process `observe` returns verified
  `still_running`; crash windows (after placeholder, after pid rewrite, after commit); binding-without-sidecar
  unreachable; root drift fails closed; recycled pid (per A-4b) ⇒ `confirmed_dead_unknown_cause`, else the
  frozen `identity_unverifiable`; macOS live pid still `identity_unverifiable` (negative control);
  static: no second sidecar writer.
- **Gates moved:** 7, 38, 50 → `IMPLEMENTATION_PROVEN` (Windows/Linux); new `PL-4`.
- **Prereq:** P0. **Repos:** M.

### P2 — Real Exit Evidence
- **Owner:** Runtime (registry, hook) + Execution infra (evidence store/parse) + port.
- **Inputs:** `onPtyExit` cause; registry from P1. **Outputs:** exit-evidence record; port `observe` consults
  it and the same-instance tracker.
- **Genuine RED (drives the real `onPtyExit`, no test-written evidence):** exit 0 ⇒ `completed`; nonzero and
  signal ⇒ `failed`; `unknown`/`-1` ⇒ `NULL` + incident; evidence for another dispatch/nonce/incarnation
  ignored; crash after evidence before the sweep ⇒ same terminal on restart; crash before the write ⇒ `NULL`
  (honest); exit racing a pending cancel; the sweep never writes from the evidence directly (single-writer
  static check).
- **Gates:** 13, 14, 39 → `IMPLEMENTATION_PROVEN` (+`LIVE_PROOF_REQUIRED`). **Prereq:** P1. **Repos:** M.

### P3 — Termination Confirmation Semantics
- **Owner:** Execution application (`resolveProcessTermination`) + runtime PTY kill inventory.
- **Inputs:** durable teardown request, verified identity, policy `G`/`H` (no production default).
  **Outputs:** terminal fact only on `PROCESS_TERMINAL_OBSERVED`; `termination_unconfirmed` incident;
  PTY-aware primitive behind the port; every alternate kill path routed or refused.
- **Genuine RED:** `verified=false` + process alive ⇒ **no** termination row (supersedes the `no-fallback`
  assertion — R-2); a `SIGTERM`-ignoring real child escalates and only then terminal; a real grandchild
  survivor blocks confirmation; natural exit vs cancel race by evidence; closing a delegated terminal via any
  runtime stop path records `user_cancel` first or is refused; inventory ratchet fails on an undeclared new kill
  entry; missing `G`/`H` ⇒ one attempt then incident, never a terminal fact.
- **Gates:** 15, 16, 27 → `IMPLEMENTATION_PROVEN`; new `PL-6`. **Prereq:** P0(A-1), P1, P2.
  **Arch review:** yes (semantic change to an accepted RED). **Repos:** M.

### P4 — Real Worktree & Run-Identity Binding
- **Owner:** Runtime composition → Execution commit step. **Inputs:** S2-captured path/base/ids (AD-5).
  **Outputs:** real `dispatch_worktree`/`run_binding` rows written in the existing S5 transaction.
- **Genuine RED:** real `createAgentSession` on a real temp git worktree ⇒ rows carry the real path, HEAD and
  `aicontrol_run_id`; folder workspace ⇒ `NO_GIT_BASELINE`; no placeholder string/zero anywhere (static);
  same-identity retry with a different worktree ⇒ `conflicting_identity`; second delegated run for the same
  aiControl run ⇒ `duplicate_aicontrol_run`. **Gates:** new `PL-7`. **Prereq:** P1. **Repos:** M.

### P5 — Delegated Closure Inputs (S2/S3 producers)
- **Owner:** Execution application (eligibility, delegated provenance capture). **Inputs:** terminal fact, real
  worktree rows. **Outputs:** closure reachable without seeded settlement (`not_applicable_delegated`);
  `worktree_provenance` real for a git worktree; `not_applicable_folder_workspace` otherwise.
- **Genuine RED:** a delegated run reaches closure→event→outbox from a *real* terminal fact with **no**
  seeded `settlement_observation`; provenance base/candidate/files real and read-only (worktree hash
  unchanged); capture only after terminal; conflicting provenance ⇒ incident; S3 shadow files byte-identical;
  finalization stays `skipped_not_eligible` and the worktree survives.
- **Gates:** 23, 24 (re-scoped) → `IMPLEMENTATION_PROVEN`; `PL-8`. **Prereq:** P3, P4, P0(A-2/A-3).
  **Arch review:** yes. **Repos:** M.

### P6 — Lifecycle Runtime Composition
- **Owner:** Runtime mixin (AD-7). **Inputs:** startup readiness, event kicks. **Outputs:** running sweep with
  single-flight and periodic fallback; no-op without history.
- **Genuine RED:** startup pass before admission; no `execution.db` created when unused; coalescing;
  concurrent passes (two handles) converge to one row per fact; restart mid-pass; shutdown leaves processes
  alone; kicks on commit/exit/cancel. **Gates:** new `PL-9`. **Prereq:** P5. **Repos:** M.

### P6b — Timeout Policy
- **Owner:** Execution (`delegation_cutover.timeout_ms`, additive v7) + runtime decision in the pass.
  **Genuine RED:** migration idempotent and old-binary compatible; no policy ⇒ ingress refuses; deadline from
  `cutover_at + timeout_ms`; setting change after cutover does not move it; restart after deadline decides on
  first pass; timeout-vs-cancel race (X13); reason written before signal. **Gates:** 16 (decision path),
  `PL-10`. **Prereq:** P6, P0(A-7, product value owner). **Repos:** M.

### P7 — aiControl Projector Divergence Fix (aiControl repo only)
- **Change:** on the identity-matching CAS miss, re-read `status`/`finished_at`/(supplied) `stdout`/`stderr`;
  equal ⇒ `ALREADY_TERMINAL`; different ⇒ `DIVERGENCE`; never write either way. **Genuine RED:** same input ⇒
  `ALREADY_TERMINAL`; different status/`finishedAt` ⇒ `DIVERGENCE` and the row is byte-unchanged; `undefined`
  stdout/stderr neither compared nor written; `FENCE_MISMATCH` unchanged; cross-process race.
  **Gates:** 19, 20, 21. **Prereq:** none (parallel). **Publication:** first (behaviour is unreachable while
  acquisition is disabled).

### P7b — aiControl Fence-Guard Audit
Audit every `agent_runs` status writer for reachability on `fenced`/`cutover` rows, starting with
`runner.ts:195-200` (`failRunNoEligibilityChange`, unguarded, called at `:227,319,392,414`). Outcome per writer:
proven unreachable (with a test) or guarded like `orphan-recovery.ts:433`. **Gates:** 11, 12 → `PRE_LIVE` closed.

### P8s / P8c — aiControl Delegation API + Maestro Adapter
See AD-10. **P8s (A):** four routes, auth, gate-off ⇒ `ACQUISITION_DISABLED`, 1:1 outcome mapping; contract
tests; an aiControl process-identity/build-SHA surface usable for R3 verification. **P8c (M):** HTTP adapter
implementing `acquire/acknowledge/release/project` behind `AiControlFenceClientPort` and
`AiControlDelegationProjectionPort`; ack task; ack-gated outbox; `FENCE_MISMATCH`-before-ack retriable.
**Genuine RED:** unknown/404/timeout ⇒ fail closed; lost-ack retry; crash windows X1, X4–X8 via the
child-process harness against a *disposable aiControl environment* (`execution/infrastructure/aicontrol-native/
disposable-aicontrol-env.ts` exists); no route can write without the CAS. **Gates:** 1, 2, 3, 9, 10, 18.
**Prereq:** P7 (project route), P0(A-6). Publication: P8s before P8c.

### P9 — Pre-commit Failure Path & Fence Release
- **Owner:** provider seam (teardown on rejected commit, SPEC §4.5) + Execution sweep (pre-cutover orphan).
  **Genuine RED:** a rejected commit terminates the prepared process via the identity-verified path, no
  unowned survivor; fence remains `fenced`; `pre_cutover_orphan_process` sweep with sidecar-with-pid and no
  binding: identity-verified ⇒ terminate + `release` **only** with positive no-cutover evidence; ambiguous ⇒
  incident, no release; a post-commit failure never calls release (spy). **Gates:** 35, 51, 26 (part).
  **Prereq:** P1, P8c. Touches the provider layer (R-3: review separately from P8c).

### P10 — Ingress & Operator Control Surface — **product decision required**
Explicit, local-operator-authorized single-run ingress (no queue, no auto-selection of runs, aiControl remains
admission authority); token generation owner; refuses remote/SSH, non-git-eligible workspaces per AD-5, and any
request without timeout policy; idempotent by `clientOperationId`; cancel command surface exposing
`requestDelegatedCancellation`; the **operator adjudication command** (§11) that records Orca-side terminal
facts only. **Genuine RED:** requests without `delegatedCutover` are byte-unaffected; ingress default-off;
cancel/adjudication never touch aiControl or the fence; no path un-delegates. **Prereq:** P0, P3, P6b, P9.

### P11 — PRE_LIVE Operational Gate
Read-only `prelive-check` (Maestro) evaluating §9's checklist; R3 procedure and fleet-awareness evidence
(both repos, operational); config completeness; rollback/break-glass rehearsal in a **disposable aiControl
environment**; observability (incident/outbox/ack dashboards). No behaviour change beyond the read-only
checker. **Acceptance:** every §9 item `TRUE` with evidence.

### P12 — Controlled First Delegated Run
Executed only against §10's boundary, manually supervised. Evidence-only slice; produces `LIVE_PROOF`.

## 6. Which gaps proceed under the frozen SPEC and which need amendment

| Gap | Under frozen SPEC? | Amendment |
| --- | --- | --- |
| B-1 identity writer/ordering/root | **Yes** — S4 §9.2 applies verbatim; SPEC is silent only on *who* (an implementation-level composition choice) | none required; A-4(a) is a clarifying note |
| B-1 recycled-pid ⇒ gone | No (S4 §9.3 says incident) | A-4(b), optional |
| B-4 macOS signal-grade | No (S4 §9.1.3 unsatisfiable) | A-4(c), deferred |
| B-2 exit evidence | No — S4 §18 delegated the decision, S5 never made it | A-5 |
| B-3 signal semantics | **No** — S4 §9.3 must be revisited (its own clause) | **A-1** |
| B-5 real path/base | Yes (S5 §5.4, §13) | A-3(b) only for the sentinel |
| B-6 settlement | No — closure gate has no delegated referent | **A-2** |
| B-6 provenance | No — S5 §13 premise false against S3 | **A-3** |
| B-7 caller/cadence | **Yes** (S5 §11, §21.7) | none |
| B-8A projector | Yes (S5 §10.2 frozen contract; aiControl repo) | none |
| B-8B transport | No — §4.8.5 assumes routes that do not exist | **A-6** |
| B-9 timeout | No (§21.1 unfrozen) | A-7 (+ product value) |
| B-9 R3 | Yes (S5 §18.2, prerequisite §12) | none |
| D-1 host | scope statement inaccurate | A-8 |

## 7. Single-authority invariant — per slice

Invariant: **before per-run cutover `AICONTROL_NATIVE`; after `delegation_cutover` COMMIT `ORCA_DELEGATED`;
terminal projection: aiControl is a copy/convergence target only; no dual execution authority, no dual
terminal authority, no fallback (M5 not started).**

| Slice | Authority statement |
| --- | --- |
| P0 | docs; moves nothing |
| P1 | writes evidence files only; the sidecar is not authority; the binding/cutover commit remains the sole transfer instant |
| P2 | evidence is an observation; sole writer of the terminal fact stays the sweep; no authority moves |
| P3 | strengthens single terminal authority: a terminal fact can no longer be written for a live process; only the current authority (Orca, post-cutover) signals; aiControl never signals |
| P4 | binds facts inside the existing S5 transaction; no earlier durable write ⇒ no second worktree/authority claim |
| P5 | Orca-side derived facts only; `not_applicable_delegated` asserts no aiControl settlement authority exists for a delegated run; worktree never mutated |
| P6/P6b | the sweep derives authority from `delegation_cutover` only; the timeout decision is an Orca-side recorded cause, never an aiControl one |
| P7 | aiControl becomes *stricter* about copying: never overwrites, never decides |
| P7b | can only remove native write paths onto fenced/cutover rows |
| P8s/P8c | routes add no semantics beyond the existing CAS functions; ack is bookkeeping (Maestro authority is already true at S5); projection is copy-only |
| P9 | release only with positive no-cutover evidence and only from `fenced`; never after `cutover` (the CAS already refuses) |
| P10 | the surface can record Orca-side intent/facts only; it cannot un-delegate, release a `cutover` fence, or re-admit natively |
| P11/P12 | observation and supervised execution; no authority change |

## 8. Cross-repo ordering (expand-compatible)

1. **A: P7** (projector) then **P7b** — behaviour unreachable while acquisition is disabled; no Maestro change needed.
2. **A: P8s** (routes, gate-off, additive) — old Maestro never calls them; old aiControl processes do not serve them.
3. **M: P1…P6b, P9** — dormant: default fence port is fail-closed, ingress absent/default-off. Order among these
   follows §4; publication of any is behaviour-neutral (R-4).
4. **M: P8c** — adapter defaults to fail-closed unless an endpoint+secret is configured; a Maestro built before
   P8s gets 404 and fails closed; a Maestro built after against an aiControl before P8s is likewise closed.
5. **Operational R3** (fleet-awareness proof) — after (1)(2)(4) are deployed, because P7/P8s enlarge "fence-aware".
6. **Enable** `ORCA_FENCE_ACQUISITION_ENABLED=true` on the controlled aiControl instance, then the Maestro
   ingress switch on the controlled instance (two independent keys; either alone changes nothing).
No step requires old fleet code to understand a new mandatory contract before every node is ready; no
step's rollback requires deleting durable facts.

## 9. Live activation contract — authoritative PRE_LIVE checklist

`ORCA_FENCE_ACQUISITION_ENABLED = true` may be set **only when every item below is TRUE with recorded evidence.**
(Item IDs are the PRE_LIVE gate namespace `PL-n`; SPEC gates 1-63 remain and are mapped in the GAP §7.)

**A. aiControl fleet and API**
- PL-1 Every aiControl process capable of a native CAS runs fence-aware code (R2), **proven** by the R3 method
  (recorded process/build-SHA inventory), *including* P7/P7b/P8s code.
- PL-2 P7 (projector divergence) published and independently accepted; P7b audit closed (unreachable/guarded).
- PL-3 The delegation API is deployed gate-off and its contract tests pass; auth secret provisioned on both sides.
**B. Identity, exit, signal**
- PL-4 P1 accepted: real identity evidence produced by production; recycled-pid and crash windows proven (Windows/Linux).
- PL-5 P2 accepted: natural exit 0/nonzero/signal classified from production evidence; unknown ⇒ `NULL` + incident.
- PL-6 P3 accepted: no terminal fact for a live process; escalation policy `G`/`H` configured; alternate kill
  paths inventoried and routed/refused.
**C. Worktree, closure**
- PL-7 P4 accepted: no placeholder in `dispatch_worktree`/`run_binding`.
- PL-8 P5 accepted: closure reachable with no seeded facts; provenance real; worktree never deleted.
**D. Lifecycle, timeout, transport**
- PL-9 P6 accepted: startup pass + triggers; no DB created when unused.
- PL-10 P6b accepted: timeout policy configured (non-default, explicit), deadline durable.
- PL-11 P8c accepted: real transport; ack-gated outbox; every transport failure closed; X1, X4-X8 proven.
- PL-12 P9 accepted: rejected-commit teardown and evidence-based fence release proven.
**E. Ingress, scope, safety**
- PL-13 P10 accepted; ingress default-off; local-only; no remote/SSH; provider host per AD-1 recorded.
- PL-14 Platform scope recorded (Windows/Linux only until A-4c); no macOS run.
- PL-15 Static/runtime proof of **no automatic fallback**: no code path releases a `cutover` fence, deletes
  `delegation_cutover`, respawns, or re-admits natively.
**F. Operations**
- PL-16 Rollback/break-glass rehearsed in a disposable aiControl environment (§11) with evidence.
- PL-17 `prelive-check` reports every item TRUE; results archived.
- PL-18 Restart/crash proof for the controlled scenarios (§10) recorded; SPEC §19 gate 26 windows applicable
  to the controlled scope proven.
- PL-19 Operator runbook and named supervisor; single-run-at-a-time limit configured.
- PL-20 A dated, independent acceptance verdict covers PL-1…PL-19.

## 10. First controlled workload — boundary (defined, not activated)

Required properties: repository-local (a disposable git worktree of a scratch repository, or a folder workspace
for the folder case); **no irreversible external effects** (no network, no writes outside the worktree, no
credentials); deterministic, simple command (a scripted stub agent CLI that prints, sleeps a configured time,
and exits with a configured code — not a general LLM agent); bounded runtime (≤ a small configured maximum);
cancellation-safe (a variant that ignores `SIGTERM` exercises P3 escalation); observable exit; manually
supervised, one run at a time; **Windows or Linux only**; local provider host per AD-1; disposable branch and
worktree; run first against a **disposable aiControl environment**, and against the canonical operational DB
only after PL-16/PL-17.

Acceptance scenarios (each recorded with durable-fact evidence): (S1) dispatch → cutover → `completed` (exit
0); (S2) `failed` (nonzero exit); (S3) `cancelled` via the operator surface; (S4) `timeout` from the configured
policy; (S5) *restart*: on H1, kill Maestro mid-run — expected honest outcome is `confirmed_dead_unknown_cause`
→ `NULL` + incident (no reclassification, no respawn, no fallback); a second restart after the process exited
with durable evidence converges to the recorded terminal; recycled-pid safety exercised; live-process
re-identification is `LIVE_PROOF_REQUIRED` for H2; (S6) terminal projection to aiControl: `PROJECTED`, then a
duplicate ⇒ `ALREADY_TERMINAL`, and a forced conflict ⇒ `DIVERGENCE` with the aiControl row unchanged; (S7)
worktree provenance recorded and worktree preserved (`skipped_not_eligible`); (S8) no fallback: kill the
aiControl API mid-run and mid-projection — the run stays Orca-terminal/pending-projection, native never
re-admits; (S9) tampered sidecar ⇒ **no signal**; (S10) `SIGTERM`-ignoring workload cancelled only after
observed death.

## 11. Failure and rollback model (defined before first activation)

Two independent kill switches: aiControl `ORCA_FENCE_ACQUISITION_ENABLED` (stops *new* fences; existing fences
and cutovers are unaffected) and Maestro's ingress switch (default off). **No path returns a run to native
execution after cutover** (the release CAS matches only `fenced`, the projector only `cutover`).

| Situation | State | Operators MAY | Operators MUST NOT |
| --- | --- | --- | --- |
| Fence acquired, Orca cannot start (pre-commit) | `AICONTROL_NATIVE`, run `fenced`, native impossible | retry with the **same** token (idempotent); run the evidence-checked release (P9) which calls `release` only with positive no-cutover evidence (process confirmed absent/terminated, no `delegation_cutover` row) | mint a new token for the same run; edit `orca_fence_*`; run the task natively; release on timeout/lost-response/judgement alone |
| After cutover the process identity becomes unverifiable | `ORCA_DELEGATED`, blocking incident, **no signal** | verify externally; record an Orca-side adjudication via the operator command (writes an Orca terminal fact with the evidence and operator id; never touches aiControl or the fence) | signal by pid; delete `delegation_cutover`/binding rows; reclassify from an aiControl status |
| Projection transport unavailable | Orca terminal; outbox `pending`; aiControl `fenced→cutover` unchanged | wait/retry; restore transport | write aiControl status directly (SQL or any native finalize path — both are structurally excluded); release the fence |
| aiControl rejects projection | outbox `blocked_*` + incident | compare rows; use aiControl's `flagOrcaFenceBreakGlass` **marker** (structurally cannot clear a fence) and the documented aiControl-side reconciliation | overwrite the aiControl row; force `PROJECTED`; un-delegate |
| Lifecycle blocked (any incident) | run frozen for that binding; siblings unaffected | fix the cause; rerun the pass; adjudicate via the operator command | "unblock" by editing incident/closure rows |
| `termination_unconfirmed` (escalation exhausted) | blocking incident, no terminal fact | terminate the process out-of-band **then** adjudicate with evidence | mark the run terminal without process evidence |
| Host quit/crash mid-run | AD-9: `NULL` + incident (honest) | adjudicate; restart | spawn a replacement process for the same `correlation_id` |

**Break-glass never creates dual authority:** it is either an aiControl marker (no state effect) or an
Orca-side fact written through the single owner; neither can release a `cutover` fence, re-admit natively, or
write an aiControl terminal row.

## 12. M5

M5 (controlled fallback) remains **NOT STARTED** and is not used to solve any of B-1…B-9. "No automatic return
to native execution after cutover" is preserved structurally; any fallback is a separate future architecture
track that must be authorized explicitly.

## 13. Open items for the independent reviewer (not decided here)

1. AD-1 host choice (H1 recommended for the first run; H2 as a separate track).
2. Product values: timeout policy owner/value, `G`/`H`, host-quit policy (AD-9), stdout/stderr projection.
3. Ingress shape and who generates the fence token (P10).
4. Whether A-4(b) (recycled-pid ⇒ gone) is accepted.
5. `[UNVERIFIED]` measurements to schedule: in-process node-pty survival across host exit (Win/Linux); POSIX
   session kill semantics; macOS env-token readability; Windows sync marker capture latency; gate 35.

## 14. aiControl guard

Verified read-only at the start of this discovery: `origin/master == ab5967bdde5115afe6673e8b520a73cfb29f0eaf`,
`data/app.db` SHA-256 `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`, no `-wal`/`-shm`/journal.
Re-verified at the close of this work (values recorded in the final report). Nothing under aiControl was
modified; the checkout's own dirty files (`AGENTS.md`, `.agents/`, `AGENTS.md.bak-*`) were not touched.
