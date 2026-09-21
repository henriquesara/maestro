# POST-CUTOVER LIFECYCLE & TERMINAL CONVERGENCE — GREEN EVIDENCE (ORCA-S5)

The minimum production GREEN for the committed genuine RED. `POST-CUTOVER-LIFECYCLE-RED-EVIDENCE.md`
is preserved unmodified as the historical RED. Nothing here publishes, activates or authorizes
live `ORCA_DELEGATED`.

```
state_class:     GREEN_READY_FOR_INDEPENDENT_ACCEPTANCE
display_verdict: ORCA_S5_POST_CUTOVER_LIFECYCLE_GREEN_READY_FOR_INDEPENDENT_ACCEPTANCE
```

| Item | Value |
| --- | --- |
| Published base | `70e4a0743b0e8ffbfc980170fe288bcc209f81ff` |
| Genuine RED (parent of this commit) | `377a856a83165c1cf6da98f671011585644552b7` — not amended, not squashed |
| Accepted Cutover-Core production HEAD | `688d48a2eff1138bd37c7d42c5345234d095d530` |
| Architecture HEAD | `627b00b0b71a345783dbc37f9ebff99033e8dc80` |
| Schema | **no change** — `EXECUTION_SCHEMA_VERSION` stays 6; every table/column needed already exists |
| Authority (operational) | `AICONTROL_NATIVE`; `ORCA_DELEGATED` NOT STARTED; fence acquisition DISABLED; R3 NOT STARTED; M5 NOT STARTED |

## 1. Result

| Suite | Result |
| --- | --- |
| Lifecycle suite (`post-cutover-lifecycle-*`) | **9 files / 98 tests, all pass**: the 86 RED-authored tests (78 RED → GREEN, 8 CONTROLs still green) + 12 GREEN additions |
| Focused unit tests added by GREEN (5 files) | **44 tests, all pass** |
| Cutover-Core (the 10 accepted files, by explicit path) | **10 files / 46 tests, all pass** |
| PRE_IMPLEMENTATION (the 7 named files) | **7 files / 38 tests, all pass** |
| `src/main/execution` | **96 files (94 passed, 2 skipped) — 641 passed, 11 skipped, 0 failed** (baseline 82 files / 499 / 11 / 0; +14 files, +142 tests = 86 + 12 + 44) |
| Runtime + providers + pty | see §11 |
| Typecheck `tsc --noEmit -p config/tsconfig.node.json` | **0 errors** (the RED baseline's single intended TS2307 is gone) |
| Lint / format (`oxlint`, `oxfmt --check`) on every changed file | clean; the S4 sweep file is now **under** the 300-line ceiling (§10) |

## 2. RED test-integrity audit (before any implementation)

Every RED assertion was re-derived against `SPEC.md`. **No RED assertion contradicts the frozen
architecture** (`POST_CUTOVER_RED_TEST_CONTRADICTS_FROZEN_ARCHITECTURE` not triggered). Two points
were examined specifically because they sit close to the mission text:

- *Racing INCOMPATIBLE terminal observations end as a PK no-op, not an incident.* The RED asserts
  this; SPEC X12 says the same ("whichever path commits first wins; the loser is a PK-collision
  no-op" — even for self-exit vs. signalled, which are incompatible outcomes). It is not
  "swallowing an incompatible conflict": the durable first commit **is** the terminal fact. Real
  conflicts still fail closed (§7).
- *Crash rows with two bindings assume one binding's crash does not stop the other.* That is S4
  SPEC §13 ("any exception for one binding is caught and reported; the sweep continues"), which the
  existing sweep did not implement (it rethrew). Implemented (§7).

**Every RED-invented name was kept** — none was worth changing (`markTeardownRequested(id, at,
reason)`, `RealDelegatedProcessPort` at `runtime/orca-runtime-real-delegated-process-port.ts`,
sweep deps `delegationCutovers` / `projectionWriter`, closure `terminalStatusRef`, coordinator
`reconcileDelegatedLifecycles` / `requestDelegatedCancellation`). **No assertion was removed or
weakened.** The complete list of edits to RED-authored files:

1. Harness wiring: the new `projections` store added to the fixture's stores and the sweep deps.
2. Harness: an optional `process` override on `commitDelegatedRun` (bind a REAL OS process).
3. Harness: `stripVolatile` now also drops `*path` / `*path_ref` keys. The RED never reached the
   "converges to the uninterrupted result" comparison; two fixtures necessarily have different
   tmp-dir worktree paths, which are environment facts, not lifecycle facts.
4. `real-process-port.test.ts`: the one test asserting the **"durable identity evidence exists"**
   branch now writes that evidence itself (§5), plus three new tests (evidence absent → fail
   closed; macOS-style identity; adoption of a dead pid is rejected).

## 3. The 8 CONTROL tests

All 8 still pass unchanged (authority derivation ×2, PID-reuse ⇒ no signal, `unavailable` marker ⇒
never PID-only, closure PK write-once, "no event/outbox before a closure" ×2, real-process
fixture soundness). They pin S4 mechanisms that already protected a delegated binding.

## 4. Real S4 bugs fixed (all four were demonstrated by the RED against existing code)

| # | Bug | Fix |
| --- | --- | --- |
| F5a | **Healthy delegated process killed on first sweep.** Phase 1 tore down any verified-live process (a synthetic-shadow policy). | For a delegated run `resolveProcessTermination` signals ONLY when a durable `teardown_requested_at` (with its reason) already exists. Observation, restart, the cutover row and the binding row never authorize termination. `left_running` is a first-class outcome. **S4 shadow bindings are byte-identical** (no `delegationCutovers` dep, or no cutover row ⇒ old policy). |
| F5b | **Real worktree deleted** when inside the shadow root (`status='finalized'`, `{"deleted":true}`). | `advanceWorktreeFinalization({ realDelegatedWorktree })`: the `rmSync` arm is unreachable for a delegated binding; the decision is recorded `skipped_not_eligible` (SPEC §13/§17, X14, gate 24). |
| F5c | **Real worktree outside the shadow root threw**, so no delegated run could ever close. | Same fix — the path is never consulted for a delegated binding; no allowed deletion was broadened. |
| F5d | **PK race made the loser's sweep fail.** | `insertOrConverge` (§7). |

## 5. `RealDelegatedProcessPort` and the identity seams

`runtime/orca-runtime-real-delegated-process-port.ts` — a **mechanism port** on the runtime side
(SPEC §4.8.6): no authority decision, no classification, no DB transaction, no aiControl
semantics. It implements the exact S4 surface:

- `spawn(adopt)` — **adopts** `{ pid, incarnationId }`; never creates a process; the OS start marker
  comes from the S4 primitive `captureOsStartMarkerSync` (or honestly `unavailable`); a pid that is
  not alive is rejected.
- `observe` / `requestTermination` / `requestTerminationByPid` — delegate **verbatim** to the S4
  adapter, so the exact S4 discipline (durable sidecar/nonce + pid-exists + OS-marker match) protects
  the real process. Unverifiable identity ⇒ `identity_unverifiable` ⇒ the sweep sends **no signal**.
  Never PID-only.

**Identity-sidecar seam — deliberately NOT invented.** Nothing in the accepted path writes an
identity sidecar for a real PTY process. The port uses durable sidecar evidence when it exists and
**fails closed** when it does not (asserted by a dedicated test). The one RED test that asserts the
"evidence exists" branch (*a live process whose durable identity matches is reported
`still_running`*) now supplies that evidence itself, exactly as a production writer eventually
would. **`FROZEN_ARCHITECTURE_GAP_REAL_PTY_IDENTITY_SIDECAR` was NOT triggered for any required GREEN
test** — no test requires production of a sidecar — **but the gap is real and remains open**:
in production today a live delegated process has no sidecar, so its post-restart identity is
`identity_unverifiable` (safe: no signal, blocked incident). This is a **PRE_LIVE blocker** and needs
an architecture answer before live activation. *(Decision surfaced for the reviewer: supplying the
evidence from the test rather than stopping is the reading of the mission's "when evidence exists it
can be used" that keeps every RED assertion intact; a stricter reading would stop here.)*

**macOS seam — not designed.** A `posix_ps_lstart` identity cannot satisfy S4 §9.1.3's argv/nonce
proof for a real shell, so the port reports a live such process `identity_unverifiable` and a dead
one `confirmed_dead_unknown_cause` — fail-closed, no signal, no argv protocol invented
(`FROZEN_ARCHITECTURE_GAP_MACOS_PROCESS_IDENTITY` not triggered: this slice's requirement is
fail-closed safety, which holds). Not exercisable on this Windows host beyond the unit assertion.

**Integration proof with a REAL process** (`post-cutover-lifecycle-real-port-sweep.test.ts`): a
healthy verified process survives repeated sweeps; a durable cancel terminates exactly it and the
run converges to `cancelled`, restart-stable; a recycled identity is never signalled (process stays
alive, blocked `process_identity_mismatch`, intent retained).

## 6. Teardown reason, outcomes, `terminal_status_ref`, digest

- **`teardown_reason`** (`SqliteDispatchProcessBindingStore.markTeardownRequested(id, at, reason?)`):
  `teardown_requested_at` and `teardown_reason` in **one** `UPDATE … WHERE teardown_requested_at IS
  NULL` (SPEC §9.1). **First writer wins (X13)**: a later conflicting reason is a silent no-op; a
  repeat converges; the call returns `{ applied }`. Proven at the SQL level (both conflict orders,
  repeat, reason-less S4 request, unknown id) and through the coordinator (cancel/timeout in both
  orders).
- **Writers of the intent**: `coordinator.requestDelegatedCancellation` (`user_cancel`) and
  `coordinator.requestDelegatedTimeout` (`timeout`) share one function. They record intent only —
  **the sweep signals**. A run with no durable cutover is rejected (nothing written); a run that
  already has a terminal fact returns `ALREADY_TERMINAL`.
- **Timeout SLA is NOT modelled** (SPEC §12, §21 item 1 unfrozen): no duration, timer, scheduler,
  policy source or config. `requestDelegatedTimeout` records an already-decided cause.
- **Classification** (`domain/delegated-terminal-status.ts`, pure, SPEC §9.2): `self_exit` → exit 0 ?
  `completed` : `failed` (signal exit ⇒ `failed`); `signalled` → `teardown_reason`
  (`user_cancel`→`cancelled`, `timeout`→`timeout`); `confirmed_dead_unknown_cause`, and `signalled`
  with no durable reason, → `NULL`. A self-exit that races a pending cancel is `completed`/`failed`
  by its own exit; the intent stays history. `cancelled ≠ timeout` is proven across DB reopen with
  reasons deliberately assigned against run order.
- **Five-field digest** (`computeLifecycleClosureDigest`): SHA-256 over
  settlement, provenance, termination, finalization, **terminal_status_ref**, joined by the existing
  `EVIDENCE_JOINER`, in that fixed order; `null` (unclassifiable) is the empty fifth field; an
  omitted field (S4 shadow closure) reproduces the **byte-identical four-field digest**. The encoding
  is pinned in an independent test (order sensitivity, each-field sensitivity, no mutable fields,
  no collisions among the four statuses and null).
- **Atomicity**: a closure with a classification is one `INSERT` carrying `terminal_status_ref`
  (never insert-then-update), so a row and its digest can never be observed apart.

## 7. Finalization, closure, event, concurrency

Order per delegated run (unmodified S4 §11 + one phase): **termination → finalization → closure →
event → (Phase 6) outbox**. Each phase derives from durable rows only.

- **Finalization**: same bound worktree (`orca_dispatch_id`), `dispatch_worktree` and
  `worktree_provenance` byte-unmodified, idempotent; a retryable store failure leaves the terminal
  fact, no closure, no event, authority `ORCA_DELEGATED`, and converges on retry.
- **Closure**: one per lifecycle, write-once, computed from durable facts (re-reads the binding for
  the reason), `terminal_status_ref` in the digest; a NULL classification still closes (SPEC §9.2)
  and raises the incident below.
- **`unclassifiable_terminal_status`** — the SPEC-named incident (§9.2, §21 item 3) added to the
  existing incident union; raised from Phase 6 (so it can never block the event/outbox), idempotent
  via the existing unique index, blocked. **One further kind, `terminal_projection_blocked`**, is added
  for aiControl outcomes that must not be treated as agreement (§10.2); SPEC §21 item 3 explicitly
  allows an implementation to add kinds under the same non-fabrication discipline. No overlapping
  category, no new incident table.
- **Concurrency (X12)** — `insertOrConverge`: the loser re-reads the **canonical** row; compatible
  (same lifecycle; closure: same `terminal_status_ref`) ⇒ converged no-op; incompatible ⇒
  `LifecycleRaceConflictError` (fail closed); a collision with no readable row, and every non-race
  error (busy, trigger `ABORT`, disk) ⇒ the original error, never swallowed. PK/UNIQUE is recognized
  by the `node:sqlite` result codes 1555/2067. Applied to termination, finalization, closure, event.
- **Per-binding isolation (S4 §13)**: a non-retryable failure for one binding is caught, sanitized
  into `report.sweepErrors` (same pattern as the S2/S3 sweeps), and the sweep continues. Retryable
  codes keep their existing path. Proven with a poisoned binding failing every pass while its
  sibling converges.

## 8. Projection outbox (Maestro side only)

`domain/aicontrol-terminal-projection.ts`, `SqliteAiControlTerminalProjectionStore` (the **only**
writer — audited), sweep Phase 6:

- Created **after the terminal event exists** (closure → event → projection) `pending` iff the closure
  is classified and has no post-closure conflict marker; else directly `blocked_closure_contradicted`
  with **no transport call**. `INSERT OR IGNORE` ⇒ racing creators are safe.
- Row is mutable retry bookkeeping only while `pending`; `pending → terminal-status` is one-way in
  SQL, so a non-pending row can never be rewritten or re-attempted.
- Delivery: one attempt per pass, bookkeeping written **before** the call. `PROJECTED` → `projected`;
  `ALREADY_TERMINAL` → `blocked_closure_contradicted` + incident (**unverifiable, never agreement**
  — the frozen stance while aiControl's projector is unfixed); `FENCE_MISMATCH` →
  `blocked_fence_mismatch`; `DIVERGENCE` → `blocked_already_terminal_divergent`. A transport
  exception leaves `pending` and changes neither terminal truth nor authority.
- **No network transport exists or is built.** The port is `projectDelegatedTerminalResult({ runId,
  token, status, finishedAt })` — the real published function's name and outcome enum, copies only.
  Absent a writer, rows stay `pending`.
- **Projection acknowledgement** is downstream convergence only: a lost ack retries the projection,
  never rolls back a closure, restores native authority, or duplicates a closure (X7 tested).
- **Projector `DIVERGENCE` gap** — aiControl's already-terminal path never compares — stays
  `EXTERNAL_PRE_LIVE_BLOCKER` (SPEC §10.2, §18.2 item 2). Not touched; no Maestro test assumes the
  unsafe behavior is correct.

## 9. Coordinator and recovery

- `reconcileDelegatedLifecycles()` on the **accepted** `DelegatedCutoverCoordinator`
  (`runtime/orca-runtime-delegated-lifecycle-composition.ts` builds the sweep over the coordinator's
  own persistent connection). One reconciliation pass; **no timer/scheduler/cadence** (SPEC §11,
  §21 item 7). Default port: `RealDelegatedProcessPort`; default transport: none.
- A static audit test proves **exactly one** production file outside `execution/` imports the sweep
  and that it is under `runtime/`; no writer of the outbox exists outside `execution/`.
- **Recovery from durable facts only** (no Promise, callback, flag or object identity): a durable
  terminal fact is never re-observed or re-signalled; an existing finalization is reused; a closure
  is immutable; missing downstream steps (event → outbox) complete on a later pass; a terminal
  observed but never written recovers **honestly** — the exit code died with the process, so the
  result is `confirmed_dead_unknown_cause` / `NULL` + incident, never a guessed completion, never a
  respawn. Proven at every boundary with real SQLite-trigger fault injection + reopen and compared
  to an uninterrupted reference, and under one-pass-per-restart cadence.
- Gate-26-class crash tests are **`IMPLEMENTATION_SUPPORTING_EVIDENCE`** (in-process reopen, not the
  separate-child-process harness) — **not** `PRE_LIVE_COMPLETE`.

## 10. Schema, scope and lint

- **Schema: no change.** `teardown_reason`, `terminal_status_ref` and `aicontrol_terminal_projection`
  already existed at v6; incident `kind` and projection `status` are unconstrained `TEXT`. No
  migration, no version bump.
- **Placeholder Cutover-Core worktree path/base commit** (`'unused'`, `'0'×40`) were **preserved**:
  delegated finalization never consults the path (§13), so the lifecycle operates on the frozen
  placeholder semantics; the RED's real-path tests use the accepted lower-level commit step with a real
  directory. `FROZEN_ARCHITECTURE_GAP_CUTOVER_WORKTREE_IDENTITY` not triggered; upstream not redesigned.
- **Max-lines**: the S4 sweep file was already over the ceiling (a known S4 debt) and, being touched,
  had to become compliant without any suppression. Behavior-preserving extraction into cohesive
  modules: `lifecycle-process-termination.ts` (Phase 1 + port types),
  `delegation-boundary-lifecycle-contract.ts` (deps/report types + disclaimers),
  `converge-delegated-lifecycle-steps.ts` (race convergence, outbox phase, shared helpers). The sweep
  re-exports its types, so **every existing import path is unchanged**; it is now < 300 effective lines.
  The report's disclaimer text is delegated-aware when a delegated run is in the pass.

## 11. Runtime / provider / pty

Production changes touch the runtime layer (the coordinator and the new port), so the broader suite
was run, and **failure IDENTITIES were compared, not counts**: the identical command
(`vitest run src/main/runtime src/main/providers src/main/ipc/pty`, JSON reporter) on the untouched RED
commit `377a856a83` (a throwaway detached worktree, since removed) and on this tree.

| | RED commit (before GREEN) | GREEN tree |
| --- | --- | --- |
| Files | 884 | 884 |
| Failed files | 15 | 15 |
| Failed tests | 31 (30 assertion failures + 1 file-level "No test found" in `local-pty-shell-startup-command.node-pty.test.ts`) | 31 (same) |
| Passed | 8826 | 8826 |

Failing tests only in GREEN: **none**. Failing tests only in the baseline: **none**. The 15 failing files
are **identical** (`ipc/pty-daemon-spawn-wsl-runtime`, `ipc/pty-login-shell-startup-commands`,
`ipc/pty-wsl-cwd-validation`, `providers/local-pty-shell-ready-wrapper-generation`,
`providers/local-pty-shell-startup-command.node-pty`, `runtime/agent-session-claim-identity`,
`runtime/exit-provenance-audit`, `runtime/orca-runtime-files-terminal-artifact-grants`,
`runtime/orca-runtime-files-terminal-artifact-io`, `runtime/orca-runtime-files-terminal-link-host-translation`,
`runtime/rpc/methods/ai-vault`, `runtime/runtime-extraction-regressions`,
`runtime/runtime-skill-install-queries`, `runtime/structured-agent-session-integration`,
`runtime/structured-worker-child-identity-env`). This is the accepted pre-existing failure set
(matching the Cutover-Core acceptance baseline of 15 files / 30 failed assertions); **it is not a clean
suite** and none of it is caused by, or fixed by, this change. (The reporter's "skipped" tally reads 73
in both trees; the accepted evidence's 67 counts differently — the value is identical across the two
trees, so it is not a regression signal.)

## 12. Gate mapping (updated from RED evidence §3; only what GREEN proves)

| Gates | Classification after GREEN |
| --- | --- |
| **13, 14, 15, 16, 17** | **`POST_CUTOVER_LIFECYCLE_GREEN`** — completed / failed / cancelled / timeout, durable and restart-stable; `cancelled ≠ timeout`. |
| **18** | `POST_CUTOVER_LIFECYCLE_GREEN` for the Maestro-side outbox and copy-never-decide at the port boundary; the real `AiControlDelegationProjectionWriter` transport remains `LATER_INTEGRATION`. |
| **23** | `POST_CUTOVER_LIFECYCLE_GREEN` runtime half (provenance byte-unmodified). The static S3-converge byte-diff audit is left to independent acceptance. |
| **24** | `POST_CUTOVER_LIFECYCLE_GREEN` — the deletion arm cannot fire for a delegated binding (runtime proof in and outside the shadow root). Static audit left to acceptance. |
| **25** | `POST_CUTOVER_LIFECYCLE_GREEN` — exactly-once, idempotent terminal event. |
| **27, 28** | `POST_CUTOVER_LIFECYCLE_GREEN` (runtime/durable half of 27; the static every-`signalProcessTree`/`kill` call-site audit is left to acceptance). No fallback on any failure path. |
| **30** | Control: S1–S4 suites green; new record keys appear only when non-NULL, so S4 row shapes are unchanged. |
| 4–9, 31, 38–40, 50, 51, 53, 54 | `ALREADY_GREEN_CUTOVER_CORE` (10/46 re-proven). |
| 32–37, 41–49, 52, 55–63 | `ALREADY_GREEN_PREIMPLEMENTATION` (7/38 re-proven). |
| 29 | `ALREADY_GREEN_CUTOVER_CORE` + acceptance audit (no remote/SSH identity claim added). |
| **19, 20, 21, 22, 26** | **`PRE_LIVE_ACTIVATION` — unchanged, not claimed.** Outbox idempotency/crash tests are `IMPLEMENTATION_SUPPORTING_EVIDENCE`. |
| 1, 2, 3, 10, 11, 12 | `LATER_INTEGRATION` — unchanged. |

## 13. Unresolved seams intentionally NOT invented / new PRE_LIVE facts

1. **Real-PTY identity sidecar** (§5) — no production writer; live delegated processes are
   `identity_unverifiable` after restart today. *Needs an architecture decision before live activation.*
2. **macOS process identity** (§5) — fail-closed only.
3. **Timeout SLA source/policy** (§6) — unfrozen.
4. **`RealDelegatedProcessPort` is not wired into site #5 / the coordinator's commit path** — this slice
   implements and proves the post-cutover mechanism; adoption at the spawn seam is unchanged
   Cutover-Core behavior (the callback still captures `pid` + marker itself).
5. **aiControl projector `DIVERGENCE`**, **R3**, **HTTP transport** — external / later, untouched.

## 14. Exclusions (unchanged)

No live aiControl HTTP, R3, projector fix, timeout scheduler, sidecar protocol, macOS argv redesign,
fallback/M5, live fence acquisition, live `ORCA_DELEGATED`, frozen-architecture edit, or schema change.

## 15. Environment notes

- The worktree's `node_modules` is still the junction into the primary checkout's install. GREEN ran
  **no** `pnpm install` / `pnpm rebuild`; all runs used `npx vitest` / `pnpm run typecheck:node` against
  the already-built install (the RED session's `pnpm test` had already rebuilt native modules).
- Full `src/main/execution` runs rewrite the tracked, nondeterministic
  `durable-settlement-observation/__evidence__/settlement-evidence-bundle.json` (random ids/digests);
  it was restored with `git checkout` after each run and is **not** in the commit.
