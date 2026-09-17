# ORCA-S5 Delegated Cutover — Full Independent Architecture Review (§5+)

> Independent architecture review. Records a verdict only — does not modify
> `SPEC.md`, fix any finding, implement code, or authorize implementation.

## Reviewer scope

- **Architecture content HEAD reviewed:** `7c1796e82c53de53f0a028123defbe53974eb652`
  (`SPEC.md`, read in full — all 23 sections, 2404 lines).
- **Current Maestro evidence HEAD:** `6b84afce586c9ecf56837446fb0b2886161c3202`
  (`origin/main`, fetched fresh this session).
- **aiControl evidence HEAD:** `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`
  (`origin/master`, fetched fresh this session; read via `git show` against
  tracked files only, never the local working-tree checkout).
- **Published PRE_IMPLEMENTATION technical HEAD treated as established, not
  re-reviewed:** `eed09b3047db4f71d25763c215335a2f2db0b403` (Parts A/B —
  deferred command delivery, true async spawn-commit propagation, provider
  hold capability, synchronous-reentry hardening).
- **Boundary:** everything in `SPEC.md` from §5 onward (the fence → prepare →
  bind → cutover → release → ownership → cancellation → recovery → closure →
  projection mechanism), i.e. everything *not* already implemented and
  independently accepted as Parts A/B.

## Lineage verification (pre-flight)

```
66dab643 (orca-s4 base)
  → ef699e9f  round 1 — full draft, ARCHITECTURE_READY_FOR_INDEPENDENT_REVIEW
  → 28b664fe  round 2 — focused correction (provider seam)
  → f0c3dfbe  round 3 — focused correction (deferred delivery + true await)
  → 7c1796e8  round 4 — focused correction (complete call-graph, current content HEAD)
```

Confirmed linear, zero merge commits, `f1d339647...` (rejected candidate) is
**not** an ancestor in either direction. `SPEC.md` at `origin/main`
(`6b84afce58`) is byte-identical to `7c1796e8` (`git diff` empty) — the
PRE_IMPLEMENTATION work did not touch it.

## Independent re-derivation performed this session

Read-only, against real code, not against SPEC's own paraphrase:

- `src/main/execution/infrastructure/execution-schema.ts` (full) — the actual
  Execution-store schema and `migrateExecutionStore`'s real transaction shape.
- `src/main/execution/application/worktree-provenance-bind-step.ts` (full) —
  the real bind-time composition, including ORCA-S4's existing
  `ShadowLifecycleProcessPort`-driven insert-transaction pattern.
- `src/main/runtime/orca-runtime-create-agent-session.ts` (imports + request
  handling) — confirmed zero reference to any Execution-bounded-context type,
  store, or transaction runner, and zero reference to
  `aicontrol`/`orcaFence`/`delegat*` anywhere in the file.
- Repository-wide grep confirming zero imports from `execution/application`,
  `execution/infrastructure`, or `execution/domain` anywhere under
  `src/main/runtime/` or `src/main/providers/`.
- `aiControlCenter` `orca-fence.ts` (full) and `orca-fence-projection.ts`
  (full) at `origin/master` — every CAS predicate, outcome enum, and the
  `DIVERGENCE`/`ALREADY_TERMINAL` gap SPEC.md cites, verified byte-for-byte
  against the real source, not re-derived from SPEC's paraphrase.
- Confirmed `adoptStablePane`/`reconcileRemoteTerminalCreate`-family code is
  real and present (`src/main/ipc/pty/pane/adopt-stable.ts` and callers).

## Section-by-section findings

### §5 core cutover protocol / state machine — SOUND, one dependency flagged

The S0–S12 sequence is internally coherent: exactly one authority-transfer
instant (S5's commit), no dual-authority window, no vacuum window in the
happy path. This matches real code for the parts checked (process creation
necessarily precedes any commit — confirmed, `spawnLocalPty` has no
prepare-without-spawn primitive). **Flagged dependency:** the sequence never
states where/when `run_reservation` (the row every other insert's FK
ultimately depends on, see §8 below) is created relative to S0–S4. See the
blocker in "Composition-root wiring" below — this is the same root cause, not
a separate defect.

### §6/atomic transaction (§5.4) — SOUND, verified feasible

`dispatch_process_binding`, `run_binding`, `dispatch_worktree` all live in
**one** SQLite database, written through **one** `SyncDatabase` instance
(`execution-schema.ts`), and `worktree-provenance-bind-step.ts` already
performs a real multi-insert `withImmediateTransaction` (`run_binding` +
`dispatch_worktree` + `dispatch_process_binding`, conditionally) — direct,
real precedent for §5.4's proposed four-insert transaction adding
`delegation_cutover`. No cross-database participant. `BEGIN IMMEDIATE` +
bounded-retry is the established primitive project-wide, not invented for
this SPEC. **No blocker.**

### §7 `delegation_cutover` as sole authority fact / §8 schema — SOUND

`delegation_cutover`'s proposed FKs (`correlation_id → run_reservation`,
`orca_dispatch_id → dispatch_process_binding`) reference real, existing PK
columns of matching type (`TEXT`). The proposed `dispatch_process_binding.pid
INTEGER NOT NULL` requirement is **already true today** — checked the live
schema, `pid` is already `NOT NULL` — confirming SPEC's own claim that "no
amendment" is needed there. The two proposed `ALTER TABLE ... ADD COLUMN`
statements (`teardown_reason`, `terminal_status_ref`) are additive/nullable
against tables that exist today with the exact shape SPEC describes.
Write-once + `PRIMARY KEY`/`UNIQUE` enforcement is consistent with every
other Execution-store table's existing discipline (all use the same
PK-per-correlation_id / unique-index pattern). **No blocker.**

### Composition-root wiring between the PTY/runtime layer and the Execution bounded context — **BLOCKER**

This is the one substantive, code-evidenced defect this review found.

**The invariant violated:** SPEC.md's own principle, restated throughout
(§4.5.1a, §7): every claim must be traced to a real function/line, never
asserted. §4.5.1 site #5 (`orca-runtime-create-agent-session.ts:225-227`,
"the real logical operation's home") states the callback "**Becomes** `async
(): Promise<DelegationCutoverCommitResult> => { … }` for a delegated spawn
(checked via a capability/mode flag, never by guessing)" and that "this is
where the durable transaction (§7's five-insert commit) **must actually
run**" — but no such capability/mode flag is named, and no application-layer
module is named that would perform that transaction.

**Verified this session, not assumed:**
- `orca-runtime-create-agent-session.ts` (the file hosting site #5) imports
  nothing from any Execution-bounded-context module, and contains no
  reference to `aicontrol`, `orcaFence`, or `delegat*` anywhere in the file.
- Repository-wide: **zero** files under `src/main/runtime/` or
  `src/main/providers/` import anything from `src/main/execution/{application,infrastructure,domain}`.
  The two module families are, today, completely disjoint.
- The only existing caller of the Execution store's bind-time transaction
  (`bindDispatchWorktree`, in `worktree-provenance-bind-step.ts`) is
  `shadow-observation-service.ts` — a different composition root entirely,
  triggered by whatever currently decides to open a `run_reservation` for an
  **observed** (shadow) dispatch, not by an interactive
  `createAgentSession` call. `RuntimeCreateAgentSessionRequest` (the actual
  request type `createAgentSession` accepts) carries no
  `aicontrolRunId`/`fenceToken`/`correlationId` field today.
- `run_reservation` is the root row every other Execution-store FK in §8
  ultimately chains to (`run_binding.correlation_id`,
  `dispatch_worktree.correlation_id`, `delegation_cutover.correlation_id`
  all `REFERENCES run_reservation(correlation_id)`). §5.4's four-insert
  transaction does **not** include an `INSERT run_reservation` — meaning it
  must already exist by S5 — but the S0–S12 state machine (§5.2) never names
  where, by whom, or at which state a `run_reservation` row would be created
  for a delegated interactive session. Today that row is created only by the
  shadow-observation flow, for a different trigger.

**Why this is architecture, not implementation detail:** this is exactly the
class of gap rounds 2–4 of this same SPEC found and fixed on the *PTY side*
(a call graph traced in exhaustive, line-exact detail across four rounds).
The identical rigor was never applied to the *Execution-store side* of the
same seam — the document specifies the schema in isolation (§8) and the PTY
call graph in isolation (§4), but never names the bridge between them: which
new application-layer module owns the delegated bind+cutover step, how
`OrcaRuntimeWithCreateAgentSession`'s composition root obtains an
`ExecutionStore`/`ExecutionTransactionRunner` instance it has zero
dependency on today, and how a `createAgentSession` request becomes
associated with an aiControl `runId`/fence token in the first place. This
also affects the recovery sweep (§11/§12), which must read
`dispatch_process_binding`/`delegation_cutover` from the Execution store and
then call `adoptStablePane`/`reconcileRemoteTerminalCreate` in the
runtime/provider layer — the same cross-boundary call, in reverse.

**Smallest required correction:** name the missing seam explicitly — the new
application module (analogous to `worktree-provenance-bind-step.ts`, but
driven from `createAgentSession`'s `onPtySpawnCommitted` instead of from
`shadow-observation-service.ts`), the extension to
`RuntimeCreateAgentSessionRequest` carrying aiControl identity, and the
composition-root change that gives the Orca runtime a dependency on an
`ExecutionStore`/`ExecutionTransactionRunner` instance. **This requires
prerequisite technical discovery** (tracing the real composition root the
same way §4 traced the PTY call graph), **not a pure SPEC-text edit** — the
answer isn't obviously a one-line addition; it may have real implications for
bounded-context boundaries (Execution depending on / being depended on by
Runtime) that the "Execution owns this, no new bounded context" framing in
§2 does not yet address for this direction of coupling.

### §9 cross-DB fence↔cutover protocol / §10 safe release — SOUND

No distributed-transaction fiction — SPEC explicitly and correctly treats
`data/app.db` and Maestro's Execution DB as genuinely separate, converging
only through durable facts + idempotent retries (§14's X1–X16 table). Cross
checked against the real `acquireOrcaFence`/`safeReleaseOrcaFence` CAS
predicates — byte-accurate. `safeReleaseOrcaFence`'s CAS matches only
`orca_fence_state='fenced'`, confirmed in real code — a stale release after
cutover is a real, verified no-op, not merely asserted. SPEC never treats
timeout/lost-response/crash as positive evidence, consistent with the real
function's own doc comment. **No blocker.**

### §11 cardinality / recovery — SOUND, contingent on the composition blocker

1:1:1:1 cardinality is schema-enforced (`dispatch_process_binding` PK
`orca_dispatch_id`, `run_binding` UNIQUE `correlation_id`/`aicontrol_run_id`,
`delegation_cutover` PK `correlation_id` + UNIQUE `aicontrol_run_id`).
`adoptStablePane` and the `reconcileRemoteTerminalCreate` family are real,
existing functions, not invented. The recovery *logic* is sound; whether the
recovery *sweep* can actually reach both the Execution store and the
runtime/provider layer is exactly the blocker above, not a new one.

### §12 prepare/bind/release / §13 release uncertainty — SOUND at the logic level

The fail-closed "process alive but delivery status unknown → never guess,
never redeliver, never respawn" disposition (§5.7) is a coherent, honestly
under-determined design, consistent with the deferred-delivery seam Parts A/B
already implemented and published. No fabricated durable fact is introduced.

### §14 cancellation vs. cutover / §15 timeout — SOUND

Resolved by whichever CAS/transaction commits first, never by wall-clock
comparison — verified against the real `finalizeRunOnce`/fence CAS shape.
`teardown_reason` captured atomically with `teardown_requested_at`, before
any signal, closing the cancel/timeout conflation defect item D targeted.
`dispatch_termination`'s existing `PRIMARY KEY (correlation_id)` (confirmed
in `execution-schema.ts`) already provides the single-writer race resolution
SPEC claims for X12/X13. **No blocker.**

### §16 terminal authority / §17 projection / §18 acknowledgement — SOUND

Exactly one authoritative fact (`dispatch_lifecycle_closure`, schema
confirmed real) with `terminal_status_ref` computed from durable facts only.
Projection is genuinely COPY-NEVER-DECIDE against the real
`projectDelegatedTerminalResult` — confirmed the function trusts `status`
verbatim and never touches `execution_attempts`. The `DIVERGENCE` gap is
real and correctly classified `PRE_LIVE_ACTIVATION`, not silently assumed
fixed — confirmed the function's live code still returns `ALREADY_TERMINAL`
unconditionally on identity match, never comparing fields.
`acknowledgeOrcaCutover`'s idempotent-retry and wrong/stale-token rejection
match the real CAS exactly.

### §19 process ownership/signaling / §20 worktree / §21 settlement / §22 terminal event / §23 incidents — SOUND at the logic level

Each names a single owner per column per state; none introduces a second
settlement/worktree/incident authority. `worktree_finalization`'s real
deletion arm is confirmed structurally never invoked for a delegated run
(schema/ownership consistent with §13's claim). No blocker found in these
sections' internal logic; their eventual implementation still depends on the
same composition-root wiring named above, not on any defect specific to
these sections.

### §24 full crash matrix (X1–X16) — SOUND, no row requires JS Promise state for correctness

Every row resolves through a durable fact (a committed row, or its absence)
rather than in-memory/Promise state, satisfying the mission's explicit
constraint. Consistent with the real, single-DB transaction model confirmed
above.

### §25 authority table — SOUND

No row has two independent decision owners for the same column; re-checked
against the real schema and fence CAS predicates rather than taken on faith.

### §26 R3/pre-live, §27 no-fallback, §28 provider scope — SOUND, correctly classified

Confirmed live: `isOrcaFenceAcquisitionEnabled()` reads
`ORCA_FENCE_ACQUISITION_ENABLED === 'true'`, defaults false, no bypass.
`R3 NOT STARTED` is accurately stated as the real, current rollout state per
the fence module's own doc comment. No-fallback and local-only-provider-scope
are structural (the eligibility gate is additive, unrelated to this review's
blocker) and correctly kept out of scope for M5/remote.

### §29 SOURCE/PROJECTION/INCIDENT classification — SOUND

Cross-checked against `execution-schema.ts`'s own inline comments (which
independently state the same SOURCE-vs-PROJECTION classification per table,
e.g. `dispatch_lifecycle_incident` is the only S4 table classified
PROJECTION) — matches SPEC.md's §17 table exactly.

### §30 gates 1–63 — classification

- **ALREADY_TECHNICALLY_PROVEN_PREIMPLEMENTATION:** 31, 32, 33, 34, 35, 36,
  37, 41, 42, 43, 44, 45, 46, 47, 48, 49, 52, 55, 56, 57, 58, 59, 60, 61, 62,
  63 (the seam/callback-propagation gates §18.1 Parts A/B implemented and
  published).
- **ARCHITECTURE_BLOCKED (pending the composition-root wiring finding
  above):** 4, 5, 6, 7, 8, 9, 31 (re-exercised against the real seam once it
  exists), 38, 39, 40, 50, 51, 53, 54 — every gate whose test would need to
  invoke the not-yet-named application module.
- **ARCHITECTURE_SOUND_IMPLEMENTABLE (design is coherent; implementation has
  not started, no blocker):** 1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  23, 24, 25, 27, 28, 29, 30.
- **PRE_LIVE_ACTIVATION (frozen dependency, not an architecture defect):**
  19, 20, 21, 22, 26.

### Async-late residual compatibility (§31 of this mission)

`ASYNC_LATE_SELF_DEPENDENCY` (`UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL`)
remains compatible. Nothing in §5+ introduces a callback capable of
asynchronously capturing and re-entering its own spawn-commit reporter — the
new callback this review's blocker concerns (the not-yet-named
Execution-store bind step) is a **new caller** of the existing guard, not a
new implementation of the guard itself, and nothing in SPEC.md proposes
having it call back into its own reporter. Residual status unchanged.

## aiControl guard

- `origin/master`: `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` — confirmed via
  fresh `git fetch`, matches exactly.
- `data/app.db` SHA-256: `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`
  — confirmed via `sha256sum`, matches exactly. No `-wal`/`-shm`/journal
  present. Not mutated — read via `git show origin/master:<path>` only.

## Authority

Before/after this review: `AICONTROL_NATIVE`. `ORCA_DELEGATED`: NOT STARTED.
Fence acquisition: DISABLED. R3: NOT STARTED. M5: NOT STARTED. This review
performed zero writes to any database, zero code changes, zero test changes.

## Verdict

**One architecture blocker found.** It does not invalidate the design's
internal logic (fence handshake, atomic transaction, cardinality, crash
matrix, authority table, cancellation/timeout, terminal projection are all
independently verified sound against real code). It means the design is
incomplete in exactly the dimension the PTY-side rounds 2–4 already proved
matters most for this SPEC: the seam between two real, disjoint parts of the
codebase must be traced with the same rigor as the PTY call graph was, not
asserted as "must actually run."

```
state_class: ARCHITECTURE_CHANGES_REQUIRED
display_verdict: ORCA_S5_DELEGATED_CUTOVER_FULL_ARCHITECTURE_CHANGES_REQUIRED
```

**Blocker:**

| Field | Value |
| --- | --- |
| Violated invariant | Every normative claim must be traced to a real function/line (§4.5.1a's own binding rule, applied here to the Execution-store side of the same seam) |
| SPEC section | §4.5.1 site #5, §5 (S0–S5), §7, §11/§12 (recovery sweep direction) |
| Real code evidence | `orca-runtime-create-agent-session.ts` has zero Execution-bounded-context imports; zero files under `src/main/runtime/` or `src/main/providers/` import from `src/main/execution/*`; `bindDispatchWorktree`'s only caller is `shadow-observation-service.ts`, a disjoint composition root; `RuntimeCreateAgentSessionRequest` carries no aiControl/fence identity field; §5.4's transaction FK-requires a pre-existing `run_reservation` row that no state in §5.2's S0–S12 sequence creates |
| Smallest required correction | Name the missing application-layer module bridging `createAgentSession`'s callback to the Execution store's transaction runner, the `RuntimeCreateAgentSessionRequest` extension carrying aiControl identity, the composition-root dependency-injection point, and the state (S1 or S2) at which `run_reservation`/`run_binding` identity is established |
| SPEC-only or prerequisite technical discovery | **Prerequisite technical discovery** — this is a real composition-root tracing exercise, the same kind of work rounds 2–4 already did for the PTY side, not a paraphrase fix |

No other blocker was found. `ARCHITECTURE_ACCEPTED_READY_TO_FREEZE` is not
warranted until this is resolved by a further focused architecture
correction (round 5) that traces and names the Execution-store-side seam
with the same rigor §4 already applied to the PTY-side seam.
