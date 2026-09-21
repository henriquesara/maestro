# POST-CUTOVER LIFECYCLE & TERMINAL CONVERGENCE — INDEPENDENT ACCEPTANCE (ORCA-S5)

Fresh, adversarial, read-only acceptance of the Post-Cutover Lifecycle GREEN. No code, test, doc,
architecture or aiControl file was edited; nothing was published; fence acquisition was not enabled;
R3, M5 and live `ORCA_DELEGATED` were not started. The only committed artifact of this review is this file.

```
state_class:             ACCEPTED_READY_FOR_PUBLICATION
display_verdict:         ORCA_S5_POST_CUTOVER_LIFECYCLE_ACCEPTED_READY_FOR_PUBLICATION
accepted_technical_head: d6254d12f45ea97d6683ee14c265c7fdc5d1c151
```

**Scope of this acceptance — read this first.** It accepts *dormant, frozen-contract-conformant code*.
It does **not** accept the slice as ready to drive a real PTY workload. Section 17 lists nine named
remaining blockers. The candidate disclosed the identity-evidence gap but understated it, and did not
disclose the real-PTY exit-evidence gap or the signal-confirmation gap; the latter is a behavior the frozen
S4 text and the RED itself encode. Gates 13–17 are re-classified below to what is actually proven; they are
not "GREEN" in the production-reachability sense.

| Item | Value |
| --- | --- |
| Canonical public base (`origin/main`) | `70e4a0743b0e8ffbfc980170fe288bcc209f81ff` |
| Genuine RED | `377a856a83165c1cf6da98f671011585644552b7` |
| GREEN candidate (resolved full SHA) | `d6254d12f45ea97d6683ee14c265c7fdc5d1c151` |
| Accepted architecture HEAD | `627b00b0b71a345783dbc37f9ebff99033e8dc80` |
| Review worktree / branch | `C:\mw-orca-s5-post-cutover-review` / `review/orca-s5-post-cutover-lifecycle-acceptance` (from the GREEN) |
| Operational state | `AICONTROL_NATIVE`; `ORCA_DELEGATED` NOT STARTED; fence acquisition DISABLED; R3 NOT STARTED; M5 NOT STARTED |

## 1. Lineage / TDD integrity

`70e4a074… → 377a856a… → d6254d12…`, verified from the commit objects: GREEN's only parent is the RED;
RED's only parent is the public base; single-parent, linear, no merge. The RED commit is intact (GREEN's
diff does not touch `POST-CUTOVER-LIFECYCLE-RED-EVIDENCE.md`). `origin/main == 70e4a074…` and no remote
branch contains `d6254d12…`: the candidate is unpublished.

## 2. Exact diff (RED → GREEN)

`27 files changed, 2543 insertions(+), 277 deletions(-)`.

| Class | Files | +/- |
| --- | --- | --- |
| Production | 16 | +1294 / −272 |
| Tests + harness | 10 | +949 / −5 |
| Evidence doc | 1 (`POST-CUTOVER-LIFECYCLE-GREEN-EVIDENCE.md`) | +300 / −0 |

Production: new `converge-delegated-lifecycle-steps.ts`, `lifecycle-process-termination.ts`,
`delegation-boundary-lifecycle-contract.ts`, `domain/delegated-terminal-status.ts`,
`domain/aicontrol-terminal-projection.ts`, `infrastructure/sqlite-aicontrol-terminal-projection-store.ts`,
`runtime/orca-runtime-real-delegated-process-port.ts`, `runtime/orca-runtime-delegated-lifecycle-composition.ts`;
modified `converge-delegation-boundary-lifecycle.ts` (−241/+197), `worktree-finalizer.ts`,
`dispatch-lifecycle-closure.ts`, `dispatch-lifecycle-incident.ts`, `dispatch-process-binding.ts`,
`sqlite-dispatch-lifecycle-closure-store.ts`, `sqlite-dispatch-process-binding-store.ts`,
`orca-runtime-delegated-cutover-coordinator.ts`. RED commit itself (`base → RED`): 12 files, +3483, all
tests/harness/doc, **zero production**. No unrelated functional scope was found in the diff.

## 3. RED reproduction (genuine RED proven independently)

Ran the lifecycle files at `377a856a…` in a detached worktree: **7 files / 86 tests → 78 failed, 8 passed**
(exactly the 78 + 8 controls claimed). Representative failures reproduced with their real causes:

| Bug | RED failure observed |
| --- | --- |
| Healthy delegated process signalled | `expected 1 to be +0` (signal count) + `worktree finalization refused: C:\…` |
| Real worktree deleted (inside shadow root) | `a real dispatch worktree must survive delegated finalization: expected false to be true`; `expected 'finalized' to be 'skipped_not_eligible'` |
| Real worktree outside root throws | `Error: worktree finalization refused: C:\…`; finalization stuck at `intent_recorded` |
| PK race | `second racer must not fail on a PK collision: … UNIQUE constraint failed: dispatch…` |
| Missing module/API | `Cannot find module '/src/main/runtime/orca-runtime-real-delegated-process-port'` |

## 4. RED test integrity (item 3) — zero `TEST_WEAKENING` of any safety assertion; one disclosed precondition change

Only three RED-authored files were edited by the GREEN (`…-fixture.ts`, `…-sweep-driver.ts`,
`…-real-process-port.test.ts`); the other six RED test files are byte-identical.

Independent proof experiment: I ran the **unmodified RED test files + unmodified RED harness** against the
GREEN production tree (61/86 pass). Adding *only* the projection-store plumbing to the RED harness gives
**80/86**. The 6 remaining failures are exactly two groups, each resolved by one GREEN edit:

| # | GREEN edit | Classification | Evidence |
| --- | --- | --- | --- |
| 1 | Harness adds the `projections` store to fixture stores and sweep deps | `TEST_HARNESS_ADAPTATION` | Plumbing only; RED never had a way to carry the outbox store. |
| 2 | Optional `process` override on `commitDelegatedRun` (bind a real OS process) | `TEST_HARNESS_ADAPTATION` / `ADDITIONAL_COVERAGE` | Additive; no existing call changes. |
| 3 | `stripVolatile` also drops `*path` / `*path_ref` keys | `PLATFORM_NORMALIZATION` | The pattern matches exactly two columns in the snapshot tables: `dispatch_worktree.worktree_path` and `worktree_provenance.worktree_path_ref` — per-fixture `mkdtemp` paths. I re-ran the 17 crash/concurrency tests with the RED normalizer plus *only* `^worktree_path$` and `^worktree_path_ref$`: **17/17 pass**, so the regex is equivalent to the two-column form and hides no other identity (worktree identity is asserted separately: sentinel survival, same-worktree/provenance-immutable test). Note the broad suffix pattern would silently ignore any future column ending in `path`. |
| 4 | `real-process-port.test.ts`: the test *"a live process whose durable identity matches is reported still_running"* now writes identity-sidecar evidence first; +3 tests | `TEST_HARNESS_ADAPTATION` — **material, disclosed, see caveat** | The assertion (`still_running`) is unchanged. Un-adapted, it **fails on GREEN** (`expected 'identity_unverifiable' to be 'still_running'`). The RED premise (pid + OS marker with *no* sidecar suffices) contradicts the frozen S4 §9.1.2 check 1 that S5 §7.1 mandates "verbatim", and no frozen text names a sidecar producer. The GREEN added the negative branch (no evidence ⇒ `identity_unverifiable`, never signalled). Caveat: the RED file's own header allowed only "imports / one input field", so this exceeds its stated allowance (it is documented in GREEN evidence §2), and it converts a RED-proven production gap into a named blocker (B-1). If the acceptance rule treats *any* precondition change to a RED assertion as weakening, this is the only edit that could be so labelled; it is the sole RED assertion GREEN production cannot satisfy unmodified. |

The added tests (3 in the port file, 6 coordinator-teardown, 3 real-port-sweep = 12) are new coverage.

## 5. Initial authority fact (item 4)

Every lifecycle test begins from `commitDelegatedRun`, which calls the real Cutover-Core
`establishDelegatedCutoverReservation` + `commitDelegatedCutover` (real SQLite, real `delegation_cutover`
row). `authorityOf(fx, id)` returns `ORCA_DELEGATED` iff `delegationCutovers.get(id)` exists — derived
from the durable row, never a flag. In production the sweep decides `delegated` from
`deps.delegationCutovers?.get(correlationId) !== undefined` and cancellation/timeout are rejected without a
durable cutover (`no_durable_cutover`, nothing written). Live authority stays `AICONTROL_NATIVE`.

## 6. The four S4 bugs (items 5, 7, 8, 9, 10)

| Bug | Verdict |
| --- | --- |
| **F5a healthy process signalled** (item 5) | **FIXED.** `resolveProcessTermination`: `mayTerminate = !delegated || teardownRequestedAt !== null`. All five observation branches were audited (`__raw_os_observation__`, `still_running`, `self_exit`, `confirmed_dead_unknown_cause`, `identity_unverifiable`): the two signal-capable ones are gated by `mayTerminate` (otherwise `left_running`); the other three never signal. The shadow-intent writer `requestTeardown()` is unreachable for a delegated run. Sweeps, restarts, the cutover row and the binding row never authorise a signal. Real-process test: 3 sweeps, child alive, no incident. |
| **F5b real worktree deleted** (item 7) | **FIXED.** `advanceWorktreeFinalization` never reaches `rmSync` when `realDelegatedWorktree`; decision recorded `skipped_not_eligible`. Sentinel survives, finalization durable, repeated sweeps converge. |
| **F5c outside-root throw** (item 8) | **FIXED, no broadening.** The path is not consulted for a delegated binding; the shadow arm (`isInside` guard + `rmSync`) is untouched and still only reachable for `!realDelegatedWorktree`. |
| **F5d PK race** (items 10, 11) | **FIXED** — see §7. |
| Per-binding isolation (item 9) | Matches S4 §13 ("Any exception for one binding — Caught; `sweepError` in the report; sweep continues"). Failure is reported in `sweepErrors` (not durable, as S4 §13 specifies); nothing is written as converged. Probe: an injected event-write failure lands the run in `sweepErrors`; its sibling converges. Observation F-08: `closed` still lists a run whose event write failed (closure exists; S4 pre-existing `closed.push` order), so `closed` means "closure durable", not "converged". |

## 7. Races (items 10, 11, 42)

**Compatible (item 10).** `insertOrConverge` catches only SQLite result codes 1555/2067 (PK/UNIQUE), re-reads
the canonical row and compares it (`orcaDispatchId` for termination/finalization/event-digest; closure
additionally `terminal_status_ref`). A collision with no readable row, and every non-race error (busy,
trigger `ABORT`, disk), propagates untouched (unit-tested; SyncDatabase wraps `node:sqlite`, so `errcode` is
the real runtime shape). Two racing sweeps ⇒ exactly one termination/closure/event/outbox row.

**Incompatible (item 11) — what the test means and why it is not swallowed.** The RED test races two
*observations of the same physical process* (`self_exit` code 0 vs code 7 via a scripted fake). A process has
one exit; `dispatch_termination` is the *first durable observation* of that event, and SPEC §12 / X12 says
"whichever path commits first wins; the loser is a PK-collision no-op" (forbidden: "a second
`dispatch_termination` row"). That is case **A** (canonical durable truth legitimately wins), not **B**. The
loser then adopts the canonical row (`termination = getByCorrelationId` after `insertOrConverge`), so the
closure follows the winner — the RED asserts `terminal_status_ref` equals the winner's. Case **B**
(genuinely conflicting authoritative facts) lives at the closure: my probe made a competing writer commit a
closure with a *different* `terminal_status_ref`; the loser threw `lifecycle_race_conflict:
dispatch_lifecycle_closure`, landed in `sweepErrors`, the canonical row was unchanged and no event was
emitted that pass. `INCOMPATIBLE_TERMINAL_RACE_SWALLOWED` is **not** triggered. (Residual: that conflict is
reported once, not durable; a later pass accepts the canonical closure. It cannot arise from two correct
derivations because both read the same canonical termination and the same first-writer reason.)

## 8. Teardown reason and signal ordering (items 12, 13)

- **First writer wins, one statement.** `UPDATE dispatch_process_binding SET teardown_requested_at=?, teardown_reason=? WHERE orca_dispatch_id=? AND teardown_requested_at IS NULL`; returns `{applied}`. Both conflict orders, repeat, reason-less request, unknown id are unit-tested; cancel/timeout in both orders through the coordinator. No read-then-write. A reason-less (S4) request blocks a later reasoned one — irrelevant to delegated runs (the sweep never writes intent for them).
- **Ordering.** For a delegated run the intent + reason are written by the coordinator (`requestDelegatedCancellation` / `requestDelegatedTimeout`, never signal) *before* the sweep can signal; a test reads the durable reason at signal time. A *throwing* signal writes no termination, no closure, keeps the intent (probe: `EPERM boom` → one `sweepErrors` entry, intent retained).
- **Finding F-01 (see §17 B-3).** A signal call that *returns* — `verified` true **or false** — is recorded as `termination_method='signalled'` (`tree_verified` = the boolean) and the run then closes as `cancelled`/`timeout`. Probe: `verified=false` with the process still "running" ⇒ termination `signalled/tree_verified=0`, closure `cancelled`, and the process is never observed or signalled again (1 observe, 1 signal across 3 sweeps). This is exactly S4 SPEC §9.3 ("`tree_verified=0` is not an incident") and is asserted by the RED (`no-fallback` test *"a signal whose tree is only root-verified (verified=false) still yields the durable-reason classification"*). But S4 justified it only for a leaf shadow fixture whose root is killed *through its handle* and explicitly flagged: *"If a future revision ever gives the shadow lifecycle process real descendants, `tree_verified=0` must be revisited"*. The pid-addressed primitive has **no** root-kill fallback (its own comment), `false` can mean "no signal delivered" (admission refusal, `taskkill` non-zero, `EPERM`), and on POSIX `SIGTERM` delivery does not prove death (interactive shells ignore it). S5 §7.1 reuses this "verbatim" without revisiting. The candidate conforms to the frozen text and the RED; this is an architecture-level omission for real workloads, recorded as a PRE_LIVE blocker — not invented away here.

## 9. `RealDelegatedProcessPort` (items 14, 15, 16)

Mechanism only: `spawn(adopt)` adopts `{pid}` and captures the marker with S4's `captureOsStartMarkerSync`
(rejects a non-live pid); `observe`/`requestTermination*` delegate verbatim to the S4 adapter. It owns no
policy, no DB, no authority, no aiControl semantics, no fallback (audited: no `fetch`/`http`/`net`, no fence
call). It acts on exactly the `pid`/marker/nonce/`killScope` read from `dispatch_process_binding` (the sweep
passes `processBinding.pid`); there is no independent process selection. Identity is not PID-only:
sidecar ∧ pid-exists ∧ marker equality; `unavailable` marker ⇒ unverifiable (tested); stale marker ⇒ never
signalled, child stays alive, blocked `process_identity_mismatch`, intent retained (real-process test).
Note: the adopted `incarnationId` is accepted but unused, and `spawn` is not called by any production path
today (B-7). The check-then-signal window (observe → kill by pid) is the S4 window; unchanged.

## 10. Identity sidecar — safety vs liveness (item 17) and macOS (item 18)

Independently verified, all four statements true: (1) sidecar evidence is consumed when present
(`readIdentitySidecar`); (2) **no production writer** — the only callers of
`writeProcessIdentitySidecarAtomically` are the S4 shadow bind step; none in the coordinator/commit path or the
new runtime files; (3) absent evidence ⇒ `identity_unverifiable` ⇒ no signal; (4) the tests write the JSON
sidecar themselves (`writeIdentityEvidence`, `real-port-sweep` fixture).
**Understated by the candidate:** it says "post-restart". The composition builds `liveHandles: new Map()` and a
PTY process is not a `ChildProcess`, so *every* pass is the pid-addressed path. Probe (real child, real port,
no sidecar): first sweep ⇒ blocking `process_identity_mismatch`; a later cancel never signals (child stays
alive); after the child is killed externally the run stays blocked — no termination, no closure. That is the
fail-closed outcome S4 §13 and S5 §11 describe ("left `identity_unverifiable` and an incident raised"), but it
means cancel/timeout of a real PTY run cannot complete today.

**Classification: `A. ACCEPTABLE_PRE_LIVE_LIVENESS_GAP`** for this slice's gates — none of 13–18, 23–25, 27, 28,
30 requires real-PTY recovery, S5 §11 explicitly permits the blocked outcome and names a second, integration-side
recovery tier (`reclaimFencedAgentSessionSpawn` / terminalHandle adoption) that this slice does not implement.
Not `B` (no newly-GREEN gate text needs real-PTY restart convergence). Not `C` in the strict sense (§11 does define
an alternative path), **but** no frozen text assigns the sidecar producer, so an architecture answer is required
before live: named blocker **B-1**. An injected test sidecar is not treated as proof that production can recover.

**macOS.** Source verified: `posix_ps_lstart` with no handle ⇒ live pid `identity_unverifiable`, dead pid
`confirmed_dead_unknown_cause`; the S4 compound argv/nonce proof expects a `shadow-lifecycle-child.mjs` argv
shape a real shell never has, so it is unsatisfiable for a real shell by construction. Fail-closed is
acceptable and no argv/nonce protocol was invented. The newly-GREEN gates do not require macOS liveness;
cross-platform restart convergence is **not** claimed and is not delivered. Exercised here only by a unit
assertion on Windows. Named blocker **B-4** (needs an architecture decision).

## 11. Real-process integration test (item 19)

`post-cutover-lifecycle-real-port-sweep.test.ts` genuinely uses a real detached `node -e setInterval` child, the
real S4 marker primitive, real `commitDelegatedCutover` persistence, the real sweep and the real port
(`liveHandles` empty ⇒ pid-addressed path). Proven: 3 sweeps leave the child alive with no row/incident;
durable cancel ⇒ child dies, termination `signalled`, closure `cancelled`, restart-stable; stale marker ⇒ not
signalled. My probe added a bystander: target died, **bystander alive** (signals exactly the bound process).
**Artificial:** the identity sidecar (test-written); `seedUpstreamTerminal` (settlement + provenance rows are
seeded, no production producer is composed); the teardown intent is written by `requestTeardown` on the store
(the coordinator path is tested separately with a fake port); no natural-exit case with a real process (see B-2).

## 12. Outcomes, `terminal_status_ref`, digest, incident (items 20–29)

- **Classification** (`deriveDelegatedTerminalStatus`, pure): `self_exit` ⇒ exit 0 ? `completed` : `failed` (signal exit ⇒ `failed`); `signalled` ⇒ fixed two-entry map on the durable `teardown_reason`; `confirmed_dead_unknown_cause` or reasonless `signalled` ⇒ `NULL` (never guessed). Identical to SPEC §9.2. A self-exit racing a pending cancel is `completed`/`failed` by its own exit (intent stays history); a normal failure never becomes cancelled/timeout because an intent exists.
- **Restart-stable** (items 20–24): probe — for each reason, crash at the closure insert, reopen, empty fake port (any OS access throws): `user_cancel ⇒ cancelled`, `timeout ⇒ timeout`, zero re-observations, zero re-signals. Completed via the four RED boundary rows (crash at finalization / closure / event / outbox, reopen, unscripted port). `cancelled ≠ timeout` is decided from the durable reason only (the RED test assigns reasons against run order with identical scripted OS state).
- **Timeout SLA** (item 25): none invented — no timer, duration, config or scheduler; `requestDelegatedTimeout` records an already-decided cause. Correct scope (SPEC §21 item 1).
- **`terminal_status_ref`** (item 26): independently derived from raw rows for all five shapes (completed, failed, cancelled, timeout, NULL): matches the closure.
- **Five-field digest** (item 27): recomputed independently from raw closure columns with SHA-256 over `settlement, provenance, termination, finalization, terminal_status` joined by `EVIDENCE_JOINER` (= NUL): **equal for all five cases**. Field order is S4's four fields then the fifth; `null` encodes as the empty fifth field (distinct from the four-field form); boundary ambiguity is impossible (NUL cannot occur in the enum tokens); the S4 four-field digest is byte-identical when `terminalStatusRef === undefined` (tested). SPEC §9.2 fixes "four → five" but not the NULL encoding; the empty-field choice is an implementation decision.
- **Unclassifiable** (item 28): closure created with `terminal_status_ref NULL`; the SPEC-named `unclassifiable_terminal_status` incident raised from Phase 6 (idempotent, blocked); outbox row created directly `blocked_closure_contradicted`, no transport call; recovers/converges on restart; no fallback.
- **`terminal_projection_blocked`** (item 29): **`ALLOWED_EXTENSION`.** SPEC §21 item 3: "This SPEC does not enumerate every possible incident `kind` … an implementation session may need more, each requiring the same non-fabrication discipline." SPEC §10.2 itself requires "raises an incident" for `ALREADY_TERMINAL` without naming a kind. It is a plain blocked diagnostic row; it changes no state-machine transition (it is raised after closure + event + outbox resolution). Note: a blocked incident makes Phases 1–4 skip that run, harmless once closed.

## 13. Finalization, placeholders, closure, event, outbox (items 30–38)

- **Finalization** (30): same run (`orca_dispatch_id`), `dispatch_worktree`/`worktree_provenance` byte-unmodified, idempotent; a retryable store failure keeps the terminal fact, writes no closure/event, keeps authority, converges on retry. Delegated finalization never consults the path or base/candidate — by SPEC §13 it records `skipped_not_eligible`.
- **Placeholders** (31): the production coordinator still binds `worktreePath: 'unused'` and `baseCommit: '0'×40`. Lifecycle correctness does **not** depend on them (finalization, closure, event, outbox never read them) ⇒ **`A. ACCEPTABLE_LATER_INTEGRATION_GAP`** (B-5). Consequence to carry forward: for a production-composed run the S3 provenance ref will read `legacy_not_convergeable`.
- **Failure** (32): terminal truth retained, no false finalization, no closure/event, retry converges (RED tests pass; probe with event failure).
- **Closure** (33): one per lifecycle, write-once PK; same retry converges; a conflicting derivation fails closed (`lifecycle_race_conflict`); a late contradicting OS report cannot reclassify (tested). A non-NULL classification is one atomic `INSERT` including `terminal_status_ref`.
- **Event** (34): exactly-once per closure, digest copies the canonical closure; a race compares the digest.
- **Outbox order** (35): candidate gates outbox creation on the event existing (closure → event → outbox). SPEC §8.3 says the row is "created once a `dispatch_lifecycle_closure` exists with `terminal_status_ref IS NOT NULL` and no conflict marker" and §16's S11 row lists "pending outbox row exists"; §15 only makes the event a *consumer* input. The SPEC requires neither atomicity with the closure nor an event→outbox order, so no different ordering is *required* — the candidate is **stricter/later than §8.3's literal text**, and the RED's boundary table encodes it. Probe: event write failing ⇒ closure durable, **no** outbox row; after recovery the event is emitted, then the outbox row created and (with a writer) projected. Verdict: **conforming, non-blocking, F-06** (an event-write failure defers outbox creation; recommend the SPEC state the intended order).
- **Durability** (36): no network transport exists (only the port shape); pending survives reopen; the row copies run id/token/digest at creation; `pending → status` is one-way in SQL (`WHERE status='pending'`), so a resolved row is never rewritten; transport/ack state never touches lifecycle truth (X6/X7 tested).
- **`ALREADY_TERMINAL`** (37): maps to `blocked_closure_contradicted` + incident, never `projected` (tested, incl. X7 lost-ack). SPEC §10.2 stance held.
- **Projector divergence** (38): zero aiControl change (`git diff` is Maestro-only). Residual stays `EXTERNAL_PRE_LIVE_BLOCKER` (SPEC §10.2 / §18.2 item 2); live activation on the Maestro outbox alone is not accepted.

## 14. Settlement, recovery, fixed point, no fallback, authority, schema (items 39–46)

- **Settlement** (39): the sweep reads S2's `settlement_observation` only to gate eligibility and copy its status into the closure; terminal truth originates from `dispatch_termination`/`teardown_reason`. No alternate authority. Not composed: no production producer of settlement/provenance rows for delegated runs (B-6).
- **Recovery** (40, 41): every RED crash row reopens with fresh store objects and an *unscripted* OS port (any observation would throw) and equals an uninterrupted reference; probed rows: teardown requested/process running, terminal observed but unclassified, terminal durable/no finalization, finalization/no closure, closure/no event, event/no outbox, outbox pending. One-pass-per-restart reaches the same fixed point; repeated sweeps make no destructive repeat (signals at most once).
- **No fallback** (43): static audit — no `release*Fence`, `acquireOrcaFence`, `DELETE FROM delegation_cutover`, respawn or native re-admission in any new/changed production line; six no-fallback tests pass; projection failure never becomes fallback permission.
- **Authority only from durable facts** (44): no mutable flag; `sawDelegated` only selects the report disclaimer.
- **Schema** (45): `EXECUTION_SCHEMA_VERSION` stays 6; `execution-schema.ts` untouched. Every written field/table exists at v6 (`teardown_reason`, `terminal_status_ref`, `aicontrol_terminal_projection`). The only DDL added is `db.exec(DELEGATED_CUTOVER_SQL)` in the new store's `ensureSchema` — the existing `CREATE TABLE IF NOT EXISTS` pattern of `SqliteDelegationCutoverStore`; no runtime `ALTER`. The coordinator migrates its DB (`migrateExecutionStore`) before use.
- **Projection store** (46): exactly the frozen table; PK `correlation_id`, `UNIQUE(aicontrol_run_id)`; `INSERT OR IGNORE`; no alternate outbox table; the sweep is the only writer (static test + my grep).

## 15. S4 sweep refactor audit and re-exports (items 6, 47, 48)

| Change | Class |
| --- | --- |
| `resolvePhase1` → `resolveProcessTermination`; `evidenceDigest`/`RETRYABLE_CODES`/sanitize helpers; contract types split out | `MECHANICAL_EXTRACTION` |
| `mayTerminate`/`left_running`; `realDelegatedWorktree`; five-field digest; Phase 6 outbox; delegated disclaimer | `REQUIRED_BUG_FIX` (delegated only) |
| `insertOrConverge` on termination/finalization/closure/event and per-binding catch — **also applied to shadow bindings** | `REQUIRED_BUG_FIX` (S4 SPEC §13 "caught and reported", LIFE-6/7 PK no-op) |
| Any unexplained third category | **none found** |

Shadow semantics (item 6): the shadow arm is unchanged in effect (`mayTerminate` is true when not delegated;
`requestTeardown` unchanged; rmSync arm unchanged). The candidate's "S4 shadow bindings are byte-identical" is
imprecise: shadow bindings now also get PK-convergence and per-binding isolation — S4-spec-conformant
improvements, not regressions. The S4/shadow test files (none touched by the candidate: sweep, late-conflict,
process-identity-safety, worktree-finalizer, delegated-side-effect-boundary acceptance/crash-windows/schema/
composition-root, shadow-observation-service, adapters) all pass. `shadow-observation-service` calls the sweep
without `delegationCutovers`, but `listBindings` filters `WHERE slice_ref = ?` and the delegated slice uses a
distinct `sliceRef`, so it cannot visit a delegated binding (defence-in-depth note: any sweep composed without
the dep would apply shadow policy to a delegated binding).
Re-exports (item 48): the old module exported 7 *types* and one runtime function; the new one re-exports the same
7 types (+`LifecycleSweepErrorRef`) type-only and the same single runtime export. Runtime surface identical;
every importing site (S4 tests, the harness, `shadow-observation-service`, the new composition) resolves.

## 16. Gate mapping — re-derived (item 49)

| Gates | Candidate | Re-derived |
| --- | --- | --- |
| **13, 14** completed / failed | GREEN | **GREEN at the durable-classification layer only** (proven for an observed `self_exit` with exit code). Production real-PTY reachability **not proven**: the port can only produce `self_exit` from a live `ChildProcess` handle, which a PTY never has; a natural exit is `confirmed_dead_unknown_cause` ⇒ NULL + incident (B-2). |
| **15, 16** cancelled / timeout | GREEN | **GREEN at the durable-classification layer**; real-process signalled path proven only with a test-supplied sidecar (B-1) and subject to B-3. |
| **17** cancelled ≠ timeout | GREEN | **GREEN** (durable, restart-stable). |
| **18** copy-never-decide | GREEN | **GREEN for the Maestro-side outbox with a fake transport**; real transport and projector fix are not delivered. |
| **23** provenance unmodified | GREEN | **GREEN** — static: no diff to any S3 converge/provenance file across base→GREEN; runtime: provenance rows immutable. |
| **24** no real deletion | GREEN | **GREEN** — runtime (inside/outside root) + static: `rmSync` is reachable only when `!realDelegatedWorktree`. |
| **25** event exactly-once | GREEN | **GREEN.** |
| **27** signalling only by current authority | GREEN | **GREEN** — static audit: every signal is inside the S4 adapter behind `resolveProcessTermination`'s `mayTerminate`; the new runtime files only call `process.kill(pid,0)` (existence). |
| **28** no fallback | GREEN | **GREEN.** |
| **30** S1–S4 regression | GREEN | **GREEN** — S4/S1 test files byte-unchanged and passing; new record keys appear only when non-NULL. |
| 19–22, 26 | PRE_LIVE | Concur — unchanged, not claimed. |
| 1–3, 10–12 | LATER_INTEGRATION | Concur. |
| 7, 38, 50 ("recovers the same process identity") | already-green (Cutover-Core) | Out of scope of this review, but their *recovery* half is fail-closed only until B-1. |

## 17. Findings register and remaining blockers (named; none implemented)

**Verdict-relevant classification of each finding**

| ID | Finding | Class |
| --- | --- | --- |
| **B-1** `PRE_LIVE_BLOCKER_REAL_PTY_IDENTITY_EVIDENCE_WRITER` | No production writer of the S4 identity sidecar for an adopted real process; every pass is pid-addressed ⇒ unverifiable ⇒ blocking incident; cancel cannot complete; the run stays blocked even after the process dies. Needs an architecture decision (who writes it / the §11 second recovery tier). | PRE_LIVE (arch answer needed) |
| **B-2** `PRE_LIVE_BLOCKER_REAL_PTY_EXIT_EVIDENCE_SOURCE` | The frozen design derives liveness from the OS and rejects dependence on `proc.onExit`; with no live handle a natural exit is unclassifiable. Gates 13/14 are unreachable in production for a real PTY. | PRE_LIVE (arch answer needed) |
| **B-3** `PRE_LIVE_BLOCKER_SIGNAL_CONFIRMATION_AND_ESCALATION` | F-01 above: a returned signal (even `verified=false`) becomes a terminal `signalled` fact; POSIX `SIGTERM` delivery is not death; S4's flagged "revisit for real descendants" boundary was never revisited. RED-encoded; not a GREEN defect. | PRE_LIVE (arch decision + RED change needed) |
| **B-4** `PRE_LIVE_BLOCKER_MACOS_REAL_SHELL_IDENTITY` | S4 §9.1.3 proof unsatisfiable for a real shell; fail-closed only. | PRE_LIVE (arch answer needed) |
| **B-5** `LATER_INTEGRATION_REAL_WORKTREE_BASE_IDENTITY` | Coordinator commit binds `'unused'` / `'0'×40`. | LATER_INTEGRATION |
| **B-6** `LATER_INTEGRATION_UPSTREAM_OBSERVATION_PRODUCERS` | `reconcile()` composes only the S4 sweep; nothing produces `settlement_observation`/`worktree_provenance` for delegated runs, so closure is unreachable without seeding. | LATER_INTEGRATION |
| **B-7** `LATER_INTEGRATION_PORT_AND_CADENCE_NOT_WIRED` | `RealDelegatedProcessPort.spawn` and `reconcileDelegatedLifecycles` have no production caller (no cadence by design, SPEC §21 item 7). | LATER_INTEGRATION |
| **B-8** `EXTERNAL_PRE_LIVE_BLOCKER_AICONTROL_PROJECTOR_DIVERGENCE` + `LATER_INTEGRATION_REAL_TRANSPORT` | Unchanged. | EXTERNAL / LATER |
| **B-9** R3; timeout SLA source | R3 NOT STARTED; SLA unfrozen (§21 item 1). | PRE_LIVE / unfrozen |
| F-06 | Outbox creation gated on the event (narrower than §8.3 literal). | Non-blocking |
| F-08 | `report.closed` lists a run whose event write failed. | Non-blocking (S4 pre-existing) |
| F-09 | "Byte-identical S4 shadow" claim imprecise (shadow also gets convergence/isolation). | Non-blocking |
| F-10 | Candidate's "post-restart" framing of the sidecar gap understates it (every pass). | Disclosure correction |

`INCOMPATIBLE_TERMINAL_RACE_SWALLOWED`, `TEST_WEAKENING` of a safety assertion, `CANDIDATE_REGRESSION`,
`UNFROZEN_INCIDENT_SEMANTIC` and a fallback path: **none found.**

## 18. Regression and quality evidence

| Check | Result |
| --- | --- |
| Lifecycle suite (`post-cutover-lifecycle-*`) | **9 files / 98 tests, all pass**, 0 skipped. Breakdown: 86 RED-authored (78 formerly RED + 8 controls, reproduced at RED as 78 failed / 8 passed) + 12 GREEN additions (6 coordinator-teardown, 3 real-port-sweep, 3 real-process-port). |
| 5 focused unit files | 9 + 10 + 11 + 6 + 8 = **44 tests, all pass** |
| Cutover-Core (10 files by path) | **10 files / 46 tests, all pass** |
| PRE_IMPLEMENTATION (the exact accepted 7-file set) | **7 files / 38 tests, all pass** |
| `src/main/execution` | **96 files, 652 tests: 641 passed, 11 skipped, 0 failed.** The two skipped files are `shadow-crash-isolation.test.ts` (1) and `shadow-identity-observation.acceptance.test.ts` (10): ORCA-S1 tests guarded by `describe.skipIf(!CAN_RUN)` (need the canonical aiControl `data/app.db`), untouched by the candidate — not lifecycle tests. |
| `tsc --noEmit -p config/tsconfig.node.json` | **0 errors** |
| `oxlint` on the 34 changed `.ts` files | 0 findings |
| `check-changed-code-quality` (since `70e4a0743b`) | 0 new findings (code / type-aware / React Doctor), 34 files |
| `check-max-lines-ratchet`, `check-ts-nocheck-ratchet` | OK — no new bypasses; no suppression comments added (diff-grepped) |
| `oxfmt --check` | The Windows checkout is CRLF (`core.autocrlf=true`; blobs are LF, 0 CR) so the working tree fails for *every* file including untouched ones. On the LF blobs all 34 changed `.ts` files pass; the two evidence `.md` files fail like previously accepted evidence docs. Not candidate-caused. |

**Runtime / provider / pty (items 50) — the 30-vs-31 discrepancy.** Identical command
(`vitest run src/main/runtime src/main/providers src/main/ipc/pty`, JSON reporter), run sequentially on
**A. base `70e4a074`, B. RED `377a856a`, C. GREEN `d6254d12`**: each 884 files, **15 failed files, 31 failed
identities, 8826 passed, 67 pending**; the sorted failing-identity lists of A, B and C are **byte-identical**.
The 31 = 30 assertion failures (`numFailedTests`, the figure the Cutover-Core acceptance recorded) + 1
file-level `No test found` in `local-pty-shell-startup-command.node-pty.test.ts`. Classification:
**`PRE_EXISTING_BUT_PREVIOUSLY_MISCOUNTED`** (count method, not a regression); zero GREEN-unique failure
identities. The failures are POSIX/WSL/symlink assumptions on this Windows host, deterministic across all
three trees.

**Tracked side effects (item 57).** `src/main/execution` rewrites the tracked
`durable-settlement-observation/__evidence__/settlement-evidence-bundle.json`; it was restored with
`git checkout` and is not in the artifact. The review worktree was clean before committing.

**Frozen artifacts (item 58).** `SPEC.md`, all ratification/review docs and every prior evidence doc:
zero diff across base→GREEN (the only markdown added anywhere is the RED and GREEN evidence docs).

**aiControl guard (item 59).** Read-only, both before and after the review: `origin/master ==
ab5967bdde5115afe6673e8b520a73cfb29f0eaf`; `data/app.db` SHA-256 `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`
(unchanged); no `-wal`/`-shm`/journal. The aiControl checkout's own pre-existing dirty files
(`AGENTS.md`, `.agents/`, `AGENTS.md.bak-*`) and the primary Maestro checkout's (`M AGENTS.md`, `?? .claude/`)
were not touched.

**Scope (item 60).** Confirmed absent from the candidate: real Maestro→aiControl network adapter, projector
fix, R3, live fence enablement, timeout scheduler/timer, invented sidecar writer, macOS argv/nonce redesign,
fallback/M5, frozen-architecture edit, schema change.

## 19. Reviewer disclosures

- Worktrees: this review worktree plus two throwaway detached worktrees (RED, base) — each with a `node_modules` **junction** into the primary checkout's install. No `pnpm install`/`rebuild` was run; `pnpm test` (which runs `ensure-native-runtime`) was deliberately avoided in favour of `vitest run --config config/vitest.config.ts`. Vitest wrote its normal cache under the shared `node_modules/.vite/vitest`; no other shared-install mutation.
- Reviewer probes (14 tests) and a copy of the RED files (to run them against GREEN production) were placed temporarily in the review worktree, **not committed**, and removed before this commit; archived copies are in the session scratchpad.
- The RTK shell hook rewrote some commands; results were taken from vitest JSON reports and raw file/blob reads, not from RTK summaries.

## 20. Final verdict

```
state_class:             ACCEPTED_READY_FOR_PUBLICATION
display_verdict:         ORCA_S5_POST_CUTOVER_LIFECYCLE_ACCEPTED_READY_FOR_PUBLICATION
accepted_technical_head: d6254d12f45ea97d6683ee14c265c7fdc5d1c151
```

Accepted for publication as dormant code that is sound against the frozen contract: every post-cutover
signal is gated by a durable, first-writer, reasoned teardown request; identity is never PID-only and
unverifiable identity never signals; classification, closure, five-field digest, event and outbox derive from
durable facts and converge across restarts and races; no fallback, no schema change, no aiControl change.
It is **not** evidence that a real PTY workload can be cancelled, timed out, or classified in production:
B-1 through B-4 need architecture decisions before any real-process wiring or live activation, and B-5 through
B-9 remain unimplemented. Authority `AICONTROL_NATIVE`; `ORCA_DELEGATED` not started; fence acquisition
disabled; R3 not started; M5 not started.
