# POST-CUTOVER LIFECYCLE & TERMINAL CONVERGENCE — GENUINE RED EVIDENCE (ORCA-S5)

RED-only. No production TypeScript, schema, migration, runtime wiring, process
port, network adapter, aiControl file, frozen-architecture file, or prior
Cutover-Core evidence file is added or modified by this commit. The commit adds
only: lifecycle RED tests, test-only fixtures/fakes, and this file.

```
state_class:     RED_BASELINE_READY_FOR_POST_CUTOVER_LIFECYCLE_IMPLEMENTATION
display_verdict: ORCA_S5_POST_CUTOVER_LIFECYCLE_GENUINE_RED_READY_FOR_GREEN
```

## 1. Baseline

| Item | Value |
| --- | --- |
| Canonical base (`origin/main`, fetched fresh) | `70e4a0743b0e8ffbfc980170fe288bcc209f81ff` |
| Accepted normative architecture HEAD | `627b00b0b71a345783dbc37f9ebff99033e8dc80` (verified ancestor of `origin/main`) |
| Published Cutover-Core production HEAD | `688d48a2eff1138bd37c7d42c5345234d095d530` |
| Branch / worktree | `impl/orca-s5-post-cutover-lifecycle-red` @ `C:/mw-orca-s5-post-cutover-red` |
| aiControl `origin/master` / `data/app.db` SHA-256 | `ab5967bd…f0eaf` / `2dc6f32a…45088`, no WAL/SHM/journal (guarded read-only, before and after) |
| Authority (operational) | `AICONTROL_NATIVE`; `ORCA_DELEGATED` NOT STARTED; fence acquisition DISABLED; R3 NOT STARTED; M5 NOT STARTED |

Disposable tests begin from a per-run committed `delegation_cutover` and therefore
classify THAT TEST RUN as `ORCA_DELEGATED`. That is not live activation.

## 2. Frozen scope, re-derived from `SPEC.md` (not from the mission text)

Where the SPEC differs from the mission wording, **the SPEC wins**. The differences
that change what is asserted:

1. **Terminal taxonomy is lowercase and closed** (§8.2, §9.2): `completed | failed |
   cancelled | timeout | NULL`. `NULL` only for `confirmed_dead_unknown_cause`.
   Mission upper-case names are display aliases only.
2. **Classification is a fixed, reviewable map, decided from durable facts** (§9.2):
   `self_exit` → `exit_code === 0 ? completed : failed` (a signal exit has
   `exit_code = NULL` → `failed`); `signalled` → `teardown_reason`
   (`user_cancel`→`cancelled`, `timeout`→`timeout`); `confirmed_dead_unknown_cause`
   → `NULL` + `dispatch_lifecycle_incident(kind='unclassifiable_terminal_status')`.
3. **Termination-reason precedence IS frozen** (§9.1 SQL, §14 X13): the single
   `UPDATE … SET teardown_requested_at=:now, teardown_reason=:reason WHERE … AND
   teardown_requested_at IS NULL` admits exactly ONE writer; the loser is a no-op and
   the durable reason is authoritative. Therefore mission stop-condition
   `FROZEN_ARCHITECTURE_CONTRADICTION_TERMINATION_REASON` is **not** triggered.
4. **Real-worktree finalization is a RECORD, never a deletion** (§13, §17, X14,
   gate 24): every delegated binding's `worktree_finalization.status` is
   `skipped_not_eligible` by policy; the S4 real-deletion arm never fires for a real
   dispatch worktree. The mission's "finalization failure" scenario is therefore
   expressed as the frozen S4 *retryable* store/fs failure (S4 §13), not a
   filesystem-deletion failure.
5. **Ordering is the unmodified S4 §11 sweep plus one new phase** (§15, §8.3, X8):
   termination → finalization → closure → event (`dispatch_lifecycle_event`, no new
   event table) → **Phase 6: outbox creation/delivery** (`aicontrol_terminal_projection`).
6. **Outbox creation rule** (§8.3): `pending` iff closure has `terminal_status_ref IS
   NOT NULL` and `post_closure_settlement_conflict_detected_at IS NULL`; otherwise
   created directly as `blocked_closure_contradicted`, never an aiControl call.
7. **`ALREADY_TERMINAL` is UNVERIFIABLE, not agreement**, until aiControl's projector
   fix ships (§10.2, X7). It maps to `blocked_closure_contradicted` + incident.
8. **Recovery cadence is NOT frozen** (§11, §21 item 7). Tests call reconciliation
   explicitly and assert correctness at the fixed point and under one-pass-per-restart.
   Correctness does not depend on any timing → `…_RECOVERY_CADENCE` not triggered.
9. **The sweep is owned by the accepted `DelegatedCutoverCoordinator`** (§4.8.1, §11) —
   no second composition root.

## 3. Gate mapping (SPEC §19; classifications per GREEN evidence §25 where already assigned)

| Gates | Classification | Notes |
| --- | --- | --- |
| 4, 5, 6, 7, 8, 9, 31, 38, 39, 40, 50, 51, 53, 54 | `ALREADY_GREEN_CUTOVER_CORE` | Unchanged; re-proven by Cutover-Core positive control (10/46). |
| 32–37, 41–49, 52, 55–63 | `ALREADY_GREEN_PREIMPLEMENTATION` | Unchanged; re-proven by PRE_IMPLEMENTATION control (7/38). |
| 29 | `ALREADY_GREEN_CUTOVER_CORE` + acceptance audit | Local-only via 52/53; a static "no remote identity claim" audit is repeated at GREEN acceptance. |
| **13, 14** | `POST_CUTOVER_LIFECYCLE_RED` | `completed` / `failed` (`post-cutover-lifecycle-outcomes`). |
| **15, 16** | `POST_CUTOVER_LIFECYCLE_RED` | `cancelled` / `timeout`, reason durable before the signal. |
| **17** | `POST_CUTOVER_LIFECYCLE_RED` | `cancelled ≠ timeout` across restart, plus digest coverage. |
| **18** | `POST_CUTOVER_LIFECYCLE_RED` (outbox + copy-never-decide at the port boundary) / `LATER_INTEGRATION` (the real `AiControlDelegationProjectionWriter` transport) | Real HTTP not built. |
| **23** | `POST_CUTOVER_LIFECYCLE_RED` | Provenance byte-unmodified through delegated finalization. The static "S3 converge byte-diff" half is a GREEN-acceptance audit. |
| **24** | `POST_CUTOVER_LIFECYCLE_RED` | The deletion arm must never fire — **today it does** (§5 finding F5b). |
| **25** | `POST_CUTOVER_LIFECYCLE_RED` | Exactly-once, idempotent terminal event against the delegated closure. |
| **27** | `POST_CUTOVER_LIFECYCLE_RED` (runtime/durable half) | The static call-site audit of every `signalProcessTree`/`kill` is a GREEN-acceptance audit. |
| **28** | `POST_CUTOVER_LIFECYCLE_RED` | `assertNoFallback` on every failure path. |
| **30** | Control | S1–S4 suites unchanged and green (see §9); GREEN must keep them byte-valid. |
| 19 | `PRE_LIVE_ACTIVATION` | Equal-duplicate projection. Local outbox idempotency tests are `IMPLEMENTATION_SUPPORTING_EVIDENCE`, **not** gate completion. |
| 20, 21, 22 | `PRE_LIVE_ACTIVATION` | Blocked on aiControl's projector fix / R3. Not claimed. |
| 26 | `PRE_LIVE_ACTIVATION` | Requires a **separate-child-process** restart harness. The crash-matrix tests here use in-process fault injection + reopen → `IMPLEMENTATION_SUPPORTING_EVIDENCE`, **not** `PRE_LIVE_COMPLETE`. |
| 1, 2, 3, 10 | `LATER_INTEGRATION` | Real `orca-fence.ts` handshake/idempotency/CAS-race; no real Maestro→aiControl adapter exists or is built here. |
| 11, 12 | `LATER_INTEGRATION` | Reused from aiControl's own prerequisite gates; not provable in Maestro CI. |

## 4. Existing lifecycle schema / API inventory (verified against `execution-schema.ts` v6 and the stores)

| Fact | Table | Status at `70e4a07` |
| --- | --- | --- |
| Authority transfer | `delegation_cutover` (+ `SqliteDelegationCutoverStore.insert/get/getByAicontrolRun`) | Real, written by `commitDelegatedCutover` (Cutover-Core). |
| Process identity | `dispatch_process_binding` (+ `teardown_reason` column) | Column exists (v6); **no writer**: `markTeardownRequested(id, at)` has no reason parameter. |
| Terminal process fact | `dispatch_termination` | Real (S4), PK on `correlation_id`; plain `INSERT` → PK collision **throws**. |
| Finalization | `worktree_finalization` + `advanceWorktreeFinalization` | Real (S4) but **not delegated-aware** (§5 F5). |
| Closure | `dispatch_lifecycle_closure` (+ `terminal_status_ref` column) | Column exists; **no writer**, store `insert` has no field for it, digest still four-field. |
| Event | `dispatch_lifecycle_event` | Real, composite PK; kind is `shadow_delegated_boundary_closed`. |
| Incident | `dispatch_lifecycle_incident` | Real; kinds do **not** include `unclassifiable_terminal_status`. |
| Projection outbox | `aicontrol_terminal_projection` | **Inert schema; zero writers** (asserted by a static audit test). |
| Sweep | `convergeDelegationBoundaryLifecycle` | Real (S4); Phase 1–5 only; no Phase 6; no delegated discrimination. |
| Process port | `ShadowLifecycleProcessPort(Like)` | Only the synthetic `ShadowLifecycleProcessAdapter` (spawns a fixture child) exists. **No `RealDelegatedProcessPort`.** |
| Coordinator | `OrcaRuntimeWithDelegatedCutoverCoordinator` | Has `establishReservation`, `commitDelegatedCutover`, `recoverPendingDelegatedCutovers` (classification only). **No lifecycle reconcile, no cancellation handler.** |

## 5. Findings the GREEN and review sessions must see

None is a `FROZEN_ARCHITECTURE_CONTRADICTION`; each is either an existing-code hazard
(RED-asserted) or an unresolved implementation seam recorded honestly.

**F5 — Existing sweep is unsafe for a real delegated run (all demonstrated by running tests today):**
- **F5a** — Phase 1 tears down **any** verified-live process immediately (S4's synthetic-fixture
  policy). Against a real delegated workload this kills a healthy execution nobody with authority
  asked to stop. (`signals: 1`, expected 0.)
- **F5b** — Phase 2 with the real worktree **inside** the shadow root `rmSync`s the real
  dispatch worktree: observed `status='finalized'`, `outcome_detail_json={"deleted":true}`,
  sentinel file gone. This directly violates SPEC §13/gate 24. **Data-loss hazard.**
- **F5c** — Real worktree **outside** the shadow root: the sweep **throws**
  (`worktree finalization refused`), so no delegated run can ever close.
- **F5d** — A PK collision on `dispatch_termination` (two racing sweeps) makes the loser's
  sweep reject, contrary to SPEC X12 ("PK-collision no-op").

**Unresolved implementation seams (recorded, not decided by this RED):**
- **F1 — identity sidecar for a real process.** S4's restart verifier requires a matching sidecar
  file, and nothing in the accepted delegated path writes one (`processNonce` is a bare
  `randomUUID()`); SPEC §7.1 says "same sidecar/nonce/OS-marker discipline" without saying who
  writes it for a PTY-spawned process. The port tests pass a sidecar path and tolerate either
  design (writer at adoption, or a sidecar-free equivalent that still refuses PID-only control).
- **F2 — macOS compound proof.** §9.1.3 requires the nonce and a shadow-child argv shape in the live
  argv; a PTY-spawned shell cannot carry either. On macOS restart-recovery of a real delegated
  process would always be `identity_unverifiable` (fail-closed, safe, but not convergent). Not
  testable on this Windows host; **no test asserts macOS behavior.** Needs an explicit design
  answer before macOS live activation. Windows/Linux rules are unaffected.
- **F3 — timeout decision input is unfrozen** (§12 / §21 item 1: the SLA value is "an assumption,
  not confirmed"). Tests therefore specify the *durable effect* of a timeout teardown
  (`teardown_reason='timeout'` + `teardown_requested_at`, one statement, before signal, classified
  `timeout`) and never the SLA plumbing. The SLA-check writer is left to GREEN, sharing the one
  reason-writing seam.
- **F4 — Cutover-Core coordinator binds placeholders** (`worktreePath: 'unused'`,
  `baseCommit: '0'×40`), documented there as deferred. Finalization/provenance RED therefore uses
  the accepted lower-level `commitDelegatedCutover` step with a REAL directory; the coordinator
  end-to-end tests exercise the `'unused'` path and require finalization not to touch it.
- **F6 — sweep error policy**: S4 §13 says a per-binding exception is caught and reported; the code
  rethrows non-retryable errors. Tests do not depend on either (crash rows assert durable state,
  not the surfaced error).
- **F7 — event kind for a delegated closure** is unspecified (`shadow_delegated_boundary_closed`
  name says "shadow"). Tests assert "exactly one event, carrying the closure digest", never the kind.

## 6. RED-imposed interfaces (SPEC freezes the durable EFFECT; these are the symbols the tests use)

A GREEN session may change any of these only by editing the named test import/argument in a
documented RED-contract note — never by weakening an assertion.

| # | Interface | SPEC anchor for the effect it stands for |
| --- | --- | --- |
| 1 | `SqliteDispatchProcessBindingStore.markTeardownRequested(orcaDispatchId, at, reason)` — reason is a third positional arg; one statement writes both columns; CAS `teardown_requested_at IS NULL`; loser is a silent no-op | §9.1, §12, X13 |
| 2 | `src/main/runtime/orca-runtime-real-delegated-process-port.ts` exporting class `RealDelegatedProcessPort` (no-arg ctor) with the exact S4 surface; adoption is `spawn({...ShadowLifecycleSpawnInput, adoptedProcess:{pid, incarnationId}})` | §7.1, §4.8.6 |
| 3 | Sweep deps `delegationCutovers` (delegated discrimination) and `projectionWriter.projectDelegatedTerminalResult({runId, token, status, …})` returning `PROJECTED \| ALREADY_TERMINAL \| FENCE_MISMATCH \| DIVERGENCE` — the real published function's name and enum | §8.1, §10 |
| 4 | Closure record field `terminalStatusRef` on `closures.insert(...)`; `computeLifecycleClosureDigest({…, terminalStatusRef})` (five-field digest) | §8.2, §9.2 |
| 5 | Incident kind `unclassifiable_terminal_status` (SPEC-named) | §9.2, §21 item 3 |
| 6 | Coordinator methods `reconcileDelegatedLifecycles()` and `requestDelegatedCancellation({correlationId})`; coordinator dep `processPort` | §4.8.1, §11, §12 |

No timer, cadence, scheduler, HTTP client, or new table/column is required by any test.

## 7. RED tests (7 files, 86 tests)

Cause codes: **C1** finalizer not delegated-aware · **C2** no `teardown_reason` writer ·
**C3** no `terminal_status_ref` computation/persistence/digest · **C4** sweep signals a healthy
running delegated process · **C5** no `unclassifiable_terminal_status` incident · **C6** outbox
inert · **C7** no `RealDelegatedProcessPort` · **C8** no coordinator lifecycle API / composition
root · **C9** PK-collision loser throws.

`expect.soft` is used throughout the RED blocks and sweep errors are *returned*, so each failing
test reports **every** unmet requirement, not just the first blocker.

| File | Tests | RED | CONTROL (passes today) | Causes |
| --- | ---: | ---: | ---: | --- |
| `post-cutover-lifecycle-outcomes.test.ts` | 15 | 15 | 0 | C1 C2 C3 C4 C5 |
| `post-cutover-lifecycle-authority-and-identity.test.ts` | 9 | 5 | 4 | C1 C2 C3 C4 |
| `post-cutover-lifecycle-finalization-closure-event.test.ts` | 14 | 12 | 2 | C1 C3 (isolated: digest, store) |
| `post-cutover-lifecycle-projection-outbox.test.ts` | 16 | 15 | 1 | C1 C3 C6 |
| `post-cutover-lifecycle-no-fallback.test.ts` | 6 | 6 | 0 | C1 C2 C3 C5 C6 |
| `post-cutover-lifecycle-crash-recovery-concurrency.test.ts` | 17 | 17 | 0 | C1 C2 C3 C4 C5 C6 C8 C9 |
| `post-cutover-lifecycle-real-process-port.test.ts` | 9 | 8 | 1 | C7 (missing module) |
| **Total** | **86** | **78** | **8** | |

Test-only support (no production semantics): `post-cutover-lifecycle-fixture.ts` (real migrated
file DB + a run with a durably committed cutover through the accepted `establishDelegatedCutoverReservation`
+ `commitDelegatedCutover`), `…-os-and-transport-fakes.ts` (scripted OS responses; scripted
aiControl transport), `…-sweep-driver.ts` (sweep drivers, raw durable readers, SQLite-trigger
crash injection, `assertNoFallback`), `…-test-harness.ts` (barrel). Each is under the repo's
300-line ceiling.

**The 8 CONTROLS** are deliberately separated (`CONTROL —` describe/test names). They prove the
harness is sound and record S4 mechanisms that already protect a delegated binding and must not
regress: authority derivation from the durable row (+ across restart); PID-reuse ⇒ no signal +
`orphan_process_unverifiable`; `unavailable` OS-marker ⇒ never PID-only; closure PK write-once;
"no event/outbox before a closure"; "no outbox row while blocked before closure"; and a real-process
fixture-soundness control using only existing S4 primitives.

### 7.1 Requirement → test map

| Mission item | Where |
| --- | --- |
| §3 start from durable cutover | every test; `authority-and-identity` CONTROL 1–2 |
| §5 `RealDelegatedProcessPort` | `real-process-port` (8 RED, real OS processes, no faked identity) |
| §6 same identity / no PID-only | `real-process-port`, `authority-and-identity` (signal targets exactly `{pid, killScope}` bound at cutover) |
| §7–§11 outcomes; cancelled≠timeout across reopen | `outcomes` (reasons deliberately assigned against run order) |
| §12 idempotency / conflict | `outcomes` (same reason twice; both conflict orders; single `UPDATE`) |
| §13 current authority only | `authority-and-identity` (native-cancel flag; healthy run untouched), coordinator cancellation (unknown correlation rejected, nothing written) |
| §14 no fallback | `no-fallback` + `assertNoFallback` inside crash/identity tests |
| §15 `terminal_status_ref` | `outcomes`, isolated store + digest tests in `finalization-closure-event` |
| §16–§17 finalization + failure | `finalization-closure-event` (real worktree never deleted, in **and** out of the shadow root; same worktree; provenance immutable; retryable failure → no fabricated closure/event, retry converges) |
| §18–§20 closure/event | `finalization-closure-event` |
| §21 settlement convergence | Every closure test seeds a REAL `settlement_observation` (S2 output) and `worktree_provenance` (S3 output) through the real stores; closure copies `settlement_status_ref`; the post-closure-conflict test drives S2's one legal `observed→observed_conflicted` transition and asserts blocked-from-copy. S2 semantics are not broadened. |
| §22–§25, §37 crash windows | `crash-recovery-concurrency` (§8 below) |
| §26–§28 signal failure / already-dead / unverifiable | `no-fallback`, `authority-and-identity` |
| §29–§31 outbox | `projection-outbox` |
| §33–§34 recovery source / composition | reference-equivalence tests; `reconcileDelegatedLifecycles` end-to-end on the coordinator; static "exactly one composition root outside `execution/`, under `runtime/`" audit |
| §35 cadence | one-pass-per-restart ≡ uninterrupted fixed point |
| §36 concurrency | barrier-gated racing sweeps (same and incompatible terminal observations); no sleeps |

## 8. Post-cutover crash matrix (SPEC §5.5–§5.9, §14; single-DB windows only)

Authority is `ORCA_DELEGATED` in **every** row (S5 already committed). Nothing here invents a state.
"Forbidden" is asserted by `assertNoFallback` (no spawn, no fence release/re-acquire, no
replacement reservation/binding/cutover, no cleared delegation).

| # | Boundary | Durable facts | Process | Legal next action | Forbidden | Test |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | cutover committed, running (C3–C5, X9) | cutover + binding | alive, identity-verified | **nothing** (leave running) | signal, terminate, respawn | crash-recovery row 1 |
| 2 | teardown requested, terminal unproven (L6, X13) | intent + reason durable | alive **or** dead | alive → signal once; dead → attribute to intent | signal a dead/recycled pid; re-decide reason | row 2 (×2) |
| 3 | exit observed, durable write absent | none terminal | gone, exit code lost | record `confirmed_dead_unknown_cause`; closure `terminal_status_ref NULL`; incident | infer `completed`/`failed`; respawn | row 3 |
| 4 | terminal durable, not finalized (L2) | + termination | any | finalize as `skipped_not_eligible` (record only) | re-observe / re-signal; delete worktree | row 4 |
| 5 | finalized, closure absent | + finalization | any | close, computing `terminal_status_ref` from durable facts | rewrite finalization; re-observe | row 5 |
| 6 | closure durable, event absent | + closure | any | emit event once | rewrite closure; second classification | row 6 |
| 7 | event durable, outbox absent (X6 precursor) | + event | any | create `pending` outbox row | rewrite closure/event | row 7 |
| 8 | outbox pending (X6) | + outbox `pending` | any | deliver via transport; retry on failure | treat undelivered as lost correctness; change authority | `projection-outbox` (transport failure, restart) |
| 9 | response/ack uncertain (X7) | outbox `pending`, remote maybe terminal | any | `ALREADY_TERMINAL` ⇒ `blocked_closure_contradicted` + incident | assume benign; roll back; second closure | `projection-outbox` X7 |

Rows 4–7 are one parameterized test that (a) injects a real SQLite trigger aborting exactly that
table's INSERT, (b) asserts the durable state at the boundary, (c) reopens with fresh store objects
and an **unscripted** OS port (any re-observation throws), and (d) requires the recovered durable
state to equal an uninterrupted reference run's.

## 9. Positive controls and execution baseline

| Control | Before RED authoring | After RED authoring |
| --- | --- | --- |
| Cutover-Core (the 10 accepted files, run by explicit path) | 10 files / 46 tests, all pass | 10 files / 46 tests, all pass |
| PRE_IMPLEMENTATION (the 7 named files) | 7 files / 38 tests, all pass | 7 files / 38 tests, all pass |
| `src/main/execution` | 82 files (80 passed \| 2 skipped) — 499 passed, 11 skipped, 0 failed | 89 files: **7 failed** \| 80 passed \| 2 skipped; 596 tests: **78 failed** \| 507 passed \| 11 skipped. The 82 original files are unchanged (499 passed / 11 skipped / 0 failed); the ONLY failing files are the 7 new RED files; passed rose 499 → 507 = exactly the 8 CONTROLs |
| Runtime + providers + pty | **not run** — no runtime/provider/pty file is touched or needed for this RED; the accepted baseline (15 failed files / 30 failed tests / 8826 passed / 67 skipped) is neither reproduced nor claimed here |
| Lint (`oxlint`, new files) | — | clean (exit 0) |
| Format (`oxfmt --check`, new files) | — | clean |
| Typecheck (`pnpm run typecheck:node`) | — | exactly **one** error: TS2307, the intentionally missing `orca-runtime-real-delegated-process-port` module |

Repository-wide lint is not claimed clean (two untouched S4 `max-lines` errors remain from the
accepted baseline).

## 10. Valid RED failure classes (no bogus RED)

- **Missing production boundary, one import**: `RealDelegatedProcessPort` (one module, dynamically
  imported per test so each fails individually; one TS2307).
- **Behavioral assertion failures against real, existing production code** (no invented import):
  sweep signals a healthy process; sweep deletes / refuses a real worktree; no `teardown_reason` /
  `terminal_status_ref` writer; four-field digest; inert outbox; PK-collision loser throws; missing
  incident kind; missing coordinator methods; no composition root.
- **Not used**: arbitrary false assertions; a lifecycle reimplemented in the harness; real aiControl;
  live fence acquisition; sleeps.

## 11. Exclusions (unchanged)

No production TS, schema/migration, runtime wiring, `RealDelegatedProcessPort`, HTTP adapter,
aiControl projector fix (`DIVERGENCE` remains `EXTERNAL_PRE_LIVE_BLOCKER` / `LATER_INTEGRATION_PREREQUISITE`),
fence acquisition, R3, live `ORCA_DELEGATED`, fallback/M5, frozen-architecture edit, scheduler/cadence.

## 12. Environment notes (recorded for reproducibility, not architecture)

- The worktree's `node_modules` is a junction to the primary checkout's install (same practice as
  prior slices). `pnpm test` runs `ensure-native-runtime.mjs --runtime=node`, which on first use
  installed 11 missing packages and rebuilt `node-pty` **inside that shared install**. The junction
  was left in place until cleanup; the primary checkout's `node_modules` therefore carries those
  additive changes.
- Running `src/main/execution` rewrites the tracked, nondeterministic
  `durable-settlement-observation/__evidence__/settlement-evidence-bundle.json` (random ids/digests).
  It was restored with `git checkout` and is **not** part of this commit.
