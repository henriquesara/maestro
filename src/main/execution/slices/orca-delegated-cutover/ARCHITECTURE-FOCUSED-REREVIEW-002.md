# ORCA-S5 Delegated Cutover — Focused Independent Rereview (composition-root correction, round 5)

> Independent focused rereview. Records a verdict only — does not modify
> `SPEC.md`, `ARCHITECTURE-INDEPENDENT-REVIEW-001.md`, or
> `CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md`, implement code, write tests,
> add migrations, enable fence acquisition, or authorize implementation.

## Scope

This rereview covers **only** the single blocker the full independent review
(`ARCHITECTURE-INDEPENDENT-REVIEW-001.md`) left open — the missing
composition root connecting the PTY/runtime call graph to the Execution
bounded context, and the unspecified `run_reservation` creation point — as
corrected by round 5 of `SPEC.md`. It does not reopen any area of §5+ the
full review already accepted, except to audit that the correction's diff
did not silently touch them.

## 1. Pre-flight / candidate identity

Performed in a fresh worktree (`C:/mw-orca-s5-arch-correction`, existing
worktree for branch `arch-correction/orca-s5-cutover-composition-root`) —
not the author's report.

- `origin/main`: `6b84afce586c9ecf56837446fb0b2886161c3202` — confirmed via
  fresh `git fetch`.
- Full SHAs resolved:
  - Architecture content HEAD: `7c1796e82c53de53f0a028123defbe53974eb652`
  - Independent review artifact (original): `f2817e2b1fe5000aae5cefe5354974d2ba2542b3`
  - Discovery artifact (original): `b828655e6b6951d27d20346e2c343ec354720466`
  - Correction candidate: `627b00b0b71a345783dbc37f9ebff99033e8dc80`
  - Review artifact (incorporated): `7d300faba6fbc8018f8b90ca88b58159cf591df0`
  - Discovery artifact (incorporated): `31b7acda046159c5dd41cce8274012cb264b17c2`
- **Ancestry, `git merge-base --is-ancestor` + `git log --ancestry-path`:**
  `7c1796e8` → (PRE_IMPLEMENTATION RED/GREEN chain, unrelated to this
  correction) → `6b84afce58` (=`origin/main`) → `7d300faba6` → `31b7acda04`
  → `627b00b0b7`. Linear, confirmed.
- **Byte-identity:** `git diff f2817e2b1f 7d300faba6 -- .../ARCHITECTURE-INDEPENDENT-REVIEW-001.md`
  → empty. `git diff b828655e6b 31b7acda04 -- .../CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md`
  → empty. Both artifacts carried into this branch byte-for-byte; no
  merge/rebase/amend altered them.
- **`SPEC.md` scope of change:** `627b00b0b7`'s parent is `31b7acda04`.
  Checked every intermediate commit between `7c1796e8` and `627b00b0b7`
  individually (`git show --stat <c> -- SPEC.md` for each of
  `0a1bf4c265, c75a76bd65, 9b31fb6ac7, 5e1f355ac0, ce0521e2a6, 5bde27ac63,
  eed09b3047, 6b84afce58, 7d300faba6, 31b7acda04`) — **none** touched
  `SPEC.md`. Only `627b00b0b7` did, and `git diff 7c1796e8 627b00b0b7 --
  SPEC.md` and `git diff 31b7acda04 627b00b0b7 -- SPEC.md` produce the
  **identical** stat: `1 file changed, 247 insertions(+), 9 deletions(-)`.
  The author-reported diff size is exact, not approximated.
- Correction commit touches only `SPEC.md`; the other 29 files in the full
  `7c1796e8..627b00b0` range (all under `.../orca-delegated-cutover/*.md`,
  `spawn-*`, `providers/*`, `runtime/*`, `shared/*`) belong to the
  already-published PRE_IMPLEMENTATION RED/GREEN chain and the two
  cherry-picked evidence artifacts — confirmed via per-commit `--stat`, not
  attributed to this correction.

**Pre-flight verdict: PASS.** Candidate ancestry, evidence-artifact
byte-identity, and the reported diff size are all independently confirmed
against real git history, not taken on the author's word.

## 2. Original blocker (re-derived from the review, read first)

`ARCHITECTURE-INDEPENDENT-REVIEW-001.md`'s sole blocker: SPEC.md traced the
PTY/runtime call graph (§4) and specified the Execution-owned schema (§8) in
isolation, but never named **which live module** invokes the durable
bind+cutover transaction from inside site #5's callback, nor **where/when**
`run_reservation` — the row every other Execution-store FK in §8 chains
to — gets created, since §5.4's four-insert transaction never inserts one
itself. Evidence cited: `orca-runtime-create-agent-session.ts` has zero
Execution-bounded-context imports; zero files under `runtime/` or
`providers/` import from `execution/*`; the only existing caller of the
bind-time transaction is `shadow-observation-service.ts`, a disjoint,
ephemeral composition root.

`CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md` independently traced the real
call graph and Execution-side composition and proposed: a new
`OrcaRuntimeWithDelegatedCutoverCoordinator` mixin on `OrcaRuntimeService`'s
existing linear chain, following the real, already-shipping
`OrcaRuntimeWithFenceAutomationOwner.getOrchestrationDb()` lazy/memoized
pattern; `run_reservation` created by the coordinator as its own first
write at S2, under a distinct `slice_ref`; the S5.4 transaction unchanged in
shape, invoked by the coordinator against the same Execution SQLite
database; a new, additive `RuntimeCreateAgentSessionRequest.delegatedCutover`
field; recovery reusing the same coordinator/mixin.

## 3. Independently-derived eight-point rubric

Before reading the corrected SPEC's conclusions, the eight required
correction points were derived from §§1–2 above (matches the discovery's own
§15 list, arrived at independently from the review's blocker + discovery's
evidence, not copied from the discovery's framing):

1. Coordinator owner/path (a real, legal module).
2. Creation/composition root (how it comes to exist, and when).
3. Identity transport (how aiControl run/fence identity reaches the
   coordinator without leaking into provider contracts).
4. Spawn-commit callback owner (site #5's corrected body).
5. Atomic transaction invocation point (who calls §5.4's transaction, and
   through what primitive).
6. `run_reservation` creation/order (relative to S0–S4, idempotent under
   retry).
7. Recovery composition point (same reach, opposite direction).
8. Dependency direction (Runtime → Execution/aiControl-port; provider/PTY
   stay ignorant).

## 4. Diff audit

Full `SPEC.md` diff (`7c1796e8..627b00b0`, `git diff --stat` = 256
lines changed / **247 insertions(+), 9 deletions(-)**, matching the
author's report exactly) read hunk-by-hunk:

| Hunk | Content | Class |
| --- | --- | --- |
| Header status/verdict + "round 5" correction-history note | Display verdict renamed, new note summarizing the correction and its scope | B — required, non-normative administrative record |
| §4.5.1 site #5 row | Callback body corrected to name the coordinator call | A |
| New §4.8 (4.8.1–4.8.6) | Coordinator owner/path, dependency direction, identity transport, callback ownership, fence port, process-port relationship | A |
| §5.2 S2 state | Adds `run_reservation` creation as the coordinator's first durable write, under a distinct `slice_ref` | A |
| §5.4 invoker note | Names `DelegatedCutoverCoordinator.commitDelegatedCutover` as invoker, via the existing `ExecutionTransactionRunner.withImmediateTransaction` primitive; clarifies `run_reservation` is read via FK, not re-inserted | A |
| §5.5 C0 row | Adds the "reservation may already be durable" sub-case; authority disposition (`AICONTROL_NATIVE`) and retry semantics unchanged | B — consequential, same root cause |
| §6 fence-acquisition invoker note | Names the coordinator + `AiControlFenceClientPort` as the sole caller of `acquireOrcaFence` | A/B |
| §8 schema note (`delegation_cutover` bullet) | Restates the single-DB, single-transaction-primitive claim, cross-referencing §4.8 | B |
| §11 recovery-ownership addition | Names the same coordinator mixin as the sweep's owner; explicitly defers exact trigger/cadence to implementation, argues correctness does not depend on it | A |
| §14 X2 row | Mirrors the C0 row's `run_reservation`-may-be-durable sub-case | B |
| §16 authority table, `ORCA_PREPARING` (S2) row | Adds "Execution FK-anchor only... never itself an authority/admission fact" to the existing N/A row | B |
| §19 gates section, "Round 5 note" | Reclassifies 14 named gates `ARCHITECTURE_BLOCKED` → `ARCHITECTURE_SOUND_IMPLEMENTABLE`; explicitly states none is proven/GREEN by this correction | B |
| Open-questions list, new item 7 | States the sweep-cadence non-freeze as an explicit open question, not a concealed gap | B |

**No category-C (unrelated architecture change) hunk found.** Every hunk
either directly closes the composition-root/`run_reservation` gap or is a
minimal, same-root-cause consequence of doing so (crash-window notes,
authority-table note, gate reclassification, open-questions entry). No
fence-CAS, cross-DB-protocol, cardinality, cancellation/timeout, terminal-
projection, or settlement text was touched — confirmed by the diff itself
containing no hunks in those sections.

## 5. Coordinator owner / composition root

`OrcaRuntimeWithDelegatedCutoverCoordinator`
(`src/main/runtime/orca-runtime-delegated-cutover-coordinator.ts`, not yet
created — correctly so, this is an architecture document) is specified to
join `OrcaRuntimeService`'s existing single linear mixin chain.

**Independently verified against real code** (not the author's report):
built the actual `extends` graph across every `OrcaRuntimeWith*` class under
`src/main/runtime/*.ts` (134 classes) and walked it from
`OrcaRuntimeWithResolveWaiter` (the direct parent of the `OrcaRuntimeService`
class body in `orca-runtime.ts`). Confirmed **both**
`OrcaRuntimeWithFenceAutomationOwner` (the cited precedent) **and**
`OrcaRuntimeWithCreateAgentSession` (the mixin hosting site #5) are on that
same chain, sharing one `this` at runtime with the class the new mixin would
extend into. This is the fact the entire composition-root argument depends
on, and it holds.

`getOrchestrationDb()`'s lazy/memoized shape is confirmed real
(`orca-runtime-fence-automation-owner.ts:152-165`): `if (!this._orchestrationDb) { … }`,
constructed on first use, held on `this`. The proposed
`getDelegatedCutoverCoordinator()` mirrors this exactly.

**Verdict: legal, implementable composition root.** Application/composition
responsibility confirmed — no PTY/provider file gains a new import (§7
below), and the coordinator sits in the same place `getOrchestrationDb()`
already does today.

## 6. Execution store lifetime

Confirmed independently: `shadow-identity-observation.ts` opens
`new SyncDatabase(input.executionStorePath)`, runs `migrateExecutionStore`,
and closes everything (`execDb.close()`, `shadowOrchestration.close()`,
`shadowRoot.cleanup()`) in a `finally` block — a genuinely ephemeral,
batch-scoped composition root, exactly as the discovery states. The
corrected SPEC's claim that the Execution bounded context has "no live,
persistent, request-driven presence in the running app at all" today is
accurate.

The correction requires the coordinator to lazily own one persistent
Execution SQLite connection, application-lifetime, analogous to
`getOrchestrationDb()`'s `userData/orchestration.db`. This is a real gap
being closed, not a fictional one — and the proposed fix (memoized,
lazy-constructed, same `this`) is the same shape as the one real precedent
that exists for "a domain owns a persistent SQLite store" in this codebase.
**Verdict: sound — no accidental multi-connection or lifecycle ambiguity.**
Only one instance is ever constructed (memoization on `this`), and it is the
same database `run_reservation`/`run_binding`/`dispatch_worktree`/
`dispatch_process_binding` already live in (confirmed: all defined in the
single `execution-schema.ts` migrated by one `migrateExecutionStore` call).

## 7. Dependency direction

Independently verified (repo-wide grep, this session, against
`src/main/providers/` and `src/main/ipc/pty/`): **zero** files in either
directory import from `src/main/execution/*`, in the corrected candidate's
tree. This matches both the original review's claim and the correction's
explicit "forbidden, unchanged from discovery" statement in §4.8.2. The
proposed graph (`OrcaRuntimeService → DelegatedCutoverCoordinator →
{Execution store, AiControlFenceClientPort}`, and separately
`DelegatedCutoverCoordinator → runtime/held-execution mechanism → PTY/
provider`) introduces no cycle: the coordinator is a new leaf consumer of
Execution/aiControl, and an upstream caller of the existing runtime/provider
mechanism (via the same closure that already exists at site #5) — it does
not invert any existing edge. **No blocker.**

## 8. Identity transport

`RuntimeCreateAgentSessionRequest`, read directly
(`src/shared/agent-session-host-authority.ts:122-135`), confirmed to have
**no** aiControl/fence/delegation field today — the proposed
`delegatedCutover?: { aicontrolRunId, fenceToken }` addition is genuinely
additive, not a rename or an overload of an existing field, and every
existing non-delegated caller is unaffected (optional field, no shape
change to any existing call site). It is captured at the real, existing
call site (`createAgentSession`, which already constructs the site-#5
closure and already mints `correlationId`/`orcaDispatchId`-equivalent
identity there today, confirmed at lines 215-227). The field does not
propagate into `PtySpawnOptions`/`RuntimePtySpawnState` — confirmed no such
field was added to either in the diff. **No blocker.**

## 9. Site #5 callback ownership

`orca-runtime-create-agent-session.ts:225-227`, read directly, is exactly
`onPtySpawnCommitted: () => { retainReplayFence = true }` — byte-accurate to
both the original review's citation and the corrected SPEC's "site #5" row.
The corrected callback body,
`this.getDelegatedCutoverCoordinator().commitDelegatedCutover({ aicontrolRunId, fenceToken, correlationId, orcaDispatchId, processIdentity })`,
is a same-class method call reachable from this exact closure once the
coordinator mixin (§5 above) is added to the same chain — no hidden global
lookup is required. `processIdentity` is stated to be the same `{ pid,
osStartMarker, osStartMarkerSource }` the real spawn already produces at the
seam (§4.3, unchanged) — available at this call site today. **No blocker.**

## 10. Callback success semantics

§4.8.4 states resolution means the atomic transaction (§5.4) has
**committed**; rejection means the held workload must not be released — this
is restated, not altered, from the already-published async-guard contract
(`eed09b3047`). Nothing in the correction moves the resolve point earlier
(e.g., to transaction start, to the pre-commit inserts, or to in-memory
state) — the transaction-invocation text (§5.4, corrected) explicitly frames
the coordinator's call as wrapping `withImmediateTransaction`, whose
resolution is commit-gated by construction (SQLite's own atomicity, not a
new claim). **Matches PRE_IMPLEMENTATION semantics. No blocker.**

## 11. Same prepared execution

`processIdentity` is explicitly the value "the real spawn already produced
at the seam" and is described as "the **same** identity the coordinator's
transaction commits and the **same** identity release later addresses; no
second process is ever created to satisfy a retry or recovery attempt."
Combined with §4.8.6's confirmation that `RealDelegatedProcessPort` "stays
exactly where §7.1 already places it" and the coordinator only ever consumes
identity as a plain value handed in by the closure (never constructs or
re-resolves it), there is no seam through which a second process could be
substituted. **No blocker.**

## 12. `run_reservation` — actual semantics

Confirmed against real schema (`execution-schema.ts:25-44` +
`run_reservation_authoritative_workload` unique index on `(slice_ref,
authoritative_run_ref, workload_id) WHERE state != 'abandoned'`): the row is
Execution's own FK-anchor bookkeeping, not an aiControl-facing concept at
all — nothing in the schema references `orca_fence_state` or any aiControl
admission field. The correction's repeated framing ("Execution's internal
FK-anchor bookkeeping only, not a second admission/capacity authority... it
never gates or duplicates aiControl's own admission decision") is consistent
with this schema and does not, anywhere in the diff, attach an authority or
permission-to-execute meaning to the row. **No dual admission ownership
created. No blocker.**

## 13. `run_reservation` — order

Corrected §5.2 places the coordinator's `run_reservation` insert at S2,
**after** S1 (fence acquisition, aiControl's own database — confirmed no
coupling introduced) and **before** any process preparation (S3) and before
the S5.4 transaction, which is confirmed (§5.4 note) to no longer insert it.
This matches the independently-derived expected ordering
(eligible → fence acquired → reservation established → held-process
preparation → atomic bind+cutover → release). The corrected authority table
row (`ORCA_PREPARING` (S2)) explicitly keeps authority `AICONTROL_NATIVE`
even when the reservation is durable — reservation existence alone does not
start delegated execution. **No blocker.**

## 14. `run_reservation` — idempotency / identity

C0 and X2 (the two crash rows touched by this correction) both state: "a
pre-existing `run_reservation` for the same `correlation_id` is read/reused,
never re-inserted or duplicated," and retry explicitly reuses "the same
token" per the already-accepted §6 Phase 1 fence-retry idempotency. Since
`correlationId` is minted by `createAgentSession` today (unchanged by this
correction) and the fence token is caller-generated and reused on retry
(already-accepted, round ≤4 material), a retry after response loss or a
restart before S5 resolves to the same `correlation_id`/token pair, and the
unique index (`slice_ref`, `authoritative_run_ref`, `workload_id`,
`WHERE state != 'abandoned'`) prevents a second non-abandoned reservation
for the same identity. **No duplicate logical delegated attempt possible
under retry. No blocker.**

## 15. Distinct S5 `slice_ref`

Confirmed real and load-bearing: `SHADOW_IDENTITY_OBSERVATION_SLICE_REF =
'ORCA-S1'` (`frozen-sample.ts:15`) is the shadow-observation flow's fixed
value, and the schema's unique index is scoped **by** `slice_ref` — so a
shared `slice_ref` between the two flows would risk exactly the collision
the correction warns against, while a distinct one avoids it structurally,
not just by convention. The correction does not pin an exact literal string
for the new `slice_ref` (e.g., no `ORCA_S5_DELEGATED_CUTOVER_SLICE_REF`
constant named) — acceptable at architecture level; the requirement
("distinct, never reused from shadow's own") is precise enough to prevent
implementation-time collision and is not left ambiguous about *whether* it
must differ, only about its exact spelling. **Sufficient. No blocker.**

## 16. Atomic transaction invocation

§5.4's corrected invoker text names `DelegatedCutoverCoordinator.commitDelegatedCutover(...)`,
invoked "through the existing `ExecutionTransactionRunner.withImmediateTransaction`
primitive `worktree-provenance-bind-step.ts` already uses." Independently
verified: `worktree-provenance-bind-step.ts` imports `ExecutionTransactionRunner`
as a type and calls `deps.txn.withImmediateTransaction(() => { store.recordBinding(binding); ... })`
at line 124 — the exact primitive name and call shape SPEC cites, not a
paraphrase. Both the existing bind step and the new coordinator would run
against the **same** `ExecutionStore`/`SyncDatabase` instance (the
coordinator's own lazily-owned connection, per §5/§6 above) — no cross-DB
participant. **No blocker.**

## 17. Exact transaction set

Confirmed: §5.4's transaction inserts remain exactly `run_binding` +
`dispatch_worktree` + `dispatch_process_binding` + `delegation_cutover` (all
FK-referencing `run_reservation.correlation_id`, confirmed real in
`execution-schema.ts`); `run_reservation` itself is explicitly excluded from
this transaction and is instead read via FK — consistent with it already
existing by S5 (created at S2, §13 above). Schema confirms every required FK
target (`run_reservation`) durably exists before the transaction opens under
the corrected ordering. Rollback (transaction atomicity, SQLite-guaranteed)
leaves no partial binding/cutover fact — unchanged from the already-accepted
§5.4 shape; this correction only adds the invoker, not new inserts.
**No blocker.**

## 18. Sole authority transfer

Re-checked every state the correction touches (S2/`ORCA_PREPARING`,
C0, X2, the authority-table row) against the invariant "only durable COMMIT
of `delegation_cutover` transfers authority": all consistently state
`AICONTROL_NATIVE` up through and including a durable `run_reservation`, and
none of coordinator-start, process-prepare, callback-creation, process-
binding-alone, or callback-resolve-before-commit is assigned authority
anywhere in the diff. Authority-table §5.4 and §5.5/§14 language is
unchanged for every state **other than** the two explicitly touched rows.
**Invariant preserved. No blocker.**

## 19. Release ordering

§4.8.4 states resolution requires the transaction to have committed, and the
release path (unchanged from the already-published async guard) proceeds
only after that resolution. No new release channel or direct coordinator
command bypassing the existing PRE_IMPLEMENTATION hold is introduced — the
correction only names *what* the existing closure body does, not a new
propagation path. **No blocker.**

## 20. `AiControlFenceClientPort`

§4.8.5, read in full: explicitly an outbound port owned by Execution
infrastructure, coordinator-only caller, "transport details (HTTP client
shape, auth, retry) are not specified here." Independently verified the
discovery's claim that no existing Maestro code calls aiControl's real HTTP
API routes today: grepped `execution/infrastructure/` for `aicontrol-*` —
only `aicontrol-db-reader.ts` (reads `data/app.db` directly, read-only) and
`native-results-authoritative-executor.ts` (replays canned results) exist;
neither performs an HTTP call. The correction does not claim a concrete
adapter exists, consistent with this. **No blocker.**

## 21. Process port relationship

§4.8.6, read in full: `RealDelegatedProcessPort` (§7.1, confirmed already
present in `SPEC.md` prior to this diff — not introduced by round 5) "stays
exactly where §7.1 already places it, inside the runtime/provider seam,
never imported by Execution infrastructure"; the coordinator only consumes
identity as a plain value handed to it by the closure. No second process
abstraction is created. **No blocker.**

## 22. Recovery ownership

§11's addition names the same coordinator mixin as the sweep owner, citing
`adoptStablePane`/`reconcileRemoteTerminalCreate`. Both confirmed real
(`src/main/ipc/pty/pane/adopt-stable.ts` and 16 other real call sites for
`adoptStablePane`; `reconcileRemoteTerminalCreate` present in
`orca-runtime-terminal-create-deduplication.ts` and
`orca-runtime-create-agent-session.ts`). The correction's claim that the
coordinator "already shares `this` with the runtime methods that call"
these functions follows directly from the same mixin-chain fact verified in
§5 above (both `OrcaRuntimeWithCreateAgentSession` and the target functions'
host mixins sit on the one linear chain the new coordinator would also join).
Recovery reads the durable facts listed (`run_reservation`, `run_binding`,
`dispatch_worktree`, `dispatch_process_binding`, `delegation_cutover`,
lifecycle facts) — all confirmed to exist in `execution-schema.ts`. No
Promise state is required for correctness anywhere in this section.
**No blocker.**

## 23. Recovery trigger / cadence

Explicitly classified as an open implementation-time decision, not frozen:
"whenever the sweep runs, it derives authority exclusively from the durable
facts above and never spawns a second process under uncertainty, regardless
of how often or when it runs." Independently assessed: every crash-boundary
row this correction touches (C0, X2) resolves through a durable fact (a
committed row or its absence), never through elapsed time or Promise state —
so the *correctness* invariant genuinely does not depend on cadence, only
*liveness* (how promptly an orphan is noticed) does, matching the required
disposition exactly. **Sound classification. No blocker.**

## 24. Crash boundaries

Walked A–I (fence-acquired/before-reservation, reservation-exists/before-
prepare, process-prepared/before-transaction, transaction-executing,
committed, callback-not-returned, callback-resolved, release-pending,
released) against the corrected C0/X2 rows and the unchanged remainder of
§5.5/§14: at every boundary exactly one authority is assigned
(`AICONTROL_NATIVE` through commit, `ORCA_DELEGATED` from commit onward),
sufficient durable evidence is named for each transition, no boundary
permits a second process under uncertainty, and no boundary falls back to
native execution after a committed cutover. **No blocker.**

## 25. Crash-matrix delta audit

Diffed §5.5 (C-table) and §14 (X-table) individually: **only** C0 and X2
changed (confirmed above, §4 diff audit). Every other crash-matrix row
(C1–C3, X1, X3–X16) is byte-identical to `7c1796e8`. Matches the author's
report exactly. **No unrelated crash-matrix change.**

## 26. Authority-table delta audit

Diffed §16 (authority table): **only** the `ORCA_PREPARING` (S2) row
changed, and only in its recovery-detail column (adds "Execution FK-anchor
only... never itself an authority/admission fact" to the existing N/A
entry) — no authority owner column changed, no new authority state
introduced, pre-cutover remains `AICONTROL_NATIVE`, post-cutover remains
`ORCA_DELEGATED`. Matches the author's report exactly.

## 27. Async-late self-dependency

Independently assessed against the actual proposed callback shape (§4.8.4):
`commitDelegatedCutover` is invoked once per delegated `createAgentSession`
call, from a closure created once per call (unchanged creation pattern from
the existing, already-hardened site #5), and its body is a single `await`
of a new coordinator method — nothing in the correction has the coordinator
call back into `onPtySpawnCommitted`'s own reporter, capture it, or schedule
later re-entry. The `commitDelegatedCutover` method is a **new caller** of
the already-published guard machinery, not a new implementation of it.
**Residual (`ASYNC_LATE_SELF_DEPENDENCY`,
`UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL`)
remains unreachable. No blocker.**

## 28. Already-accepted §5+ areas — unrelated-diff audit

Confirmed via the full diff (§4 above, complete — 13 hunks, all itemized)
that none of the following was touched: fence CAS predicates, cross-DB
cutover protocol, safe release, cardinality, cancellation, timeout, terminal
classification, projection, acknowledgement, process signaling, worktree
ownership, settlement, lifecycle events, incident taxonomy, R3/pre-live,
no-fallback, provider scope. **No unexpected correction-diff effect found
in any of these areas.**

## 29. Gates

§19's "Round 5 note" (new, read in full): reclassifies exactly
`4, 5, 6, 7, 8, 9, 31, 38, 39, 40, 50, 51, 53, 54` from
`ARCHITECTURE_BLOCKED` to `ARCHITECTURE_SOUND_IMPLEMENTABLE`, explicitly
stating "none of these gates is satisfied, proven, or reclassified GREEN by
this correction." `ALREADY_TECHNICALLY_PROVEN_PREIMPLEMENTATION` gates
(31–37, 41–49, 52, 55–63) and `PRE_LIVE_ACTIVATION` gates (19, 20, 21, 22,
26) are explicitly stated unaffected — confirmed unchanged in the diff (no
hunk touches the gate list outside this one new note). **Correctly
classified. No blocker.**

## 30. SPEC status

`SPEC.md` header, read directly: **State class:**
`ARCHITECTURE_READY_FOR_FOCUSED_REREVIEW`. Grepped the full document for
`FROZEN`, `INDEPENDENTLY_ACCEPTED`, `IMPLEMENTATION_AUTHORIZED`, and a
self-declared `PUBLISHED` status — zero matches (the document's own opening
disclaimer states the negative: "not frozen, not independently accepted,
not published, authorizes no implementation"). **Confirmed — this document
does not self-declare acceptance.**

## 31. aiControl guard

Performed read-only, this session, against the real `aiControlCenter`
checkout:

- `origin/master`, fresh `git fetch`: `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` — **matches exactly.**
- `data/app.db` SHA-256 (`sha256sum`): `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` — **matches exactly.**
- No `-wal`/`-shm`/journal file present alongside `app.db`.
- No write performed against `aiControlCenter` at any point this session.

## 32. Authority

Before/after this rereview: `AICONTROL_NATIVE`. `ORCA_DELEGATED`: NOT
STARTED. Fence acquisition: DISABLED. R3: NOT STARTED. M5: NOT STARTED. This
rereview performed zero writes to any database, zero production-code
changes, zero test changes — only this artifact file was created.

## 33. Independent rereview artifact

This file. No other file was created or modified by this session.

---

## Summary verdicts

| Area | Verdict |
| --- | --- |
| Eight-point correction coverage | All eight present and each independently verified against real code |
| Coordinator legality | Sound — confirmed on the real 134-class linear mixin chain |
| Execution store lifetime | Sound — one memoized connection, correctly contrasted with the real ephemeral shadow-observation root |
| Dependency direction | Sound — zero `providers/`/`ipc/pty/` imports from `execution/*`, confirmed this session |
| Identity transport | Sound — additive, optional, confirmed absent from the real type today |
| Callback ownership | Sound — byte-accurate to the real site #5 closure |
| `run_reservation` semantics | Sound — FK-anchor only, no dual admission authority, confirmed against real schema |
| Reservation order / idempotency | Sound — S2, before transaction, retry-safe via existing token/correlation reuse |
| Transaction invocation | Sound — real, existing `ExecutionTransactionRunner.withImmediateTransaction` primitive, byte-accurate |
| Release ordering | Sound — commit-gated, unchanged from published guard contract |
| Fence port | Sound — new, transport-neutral, no adapter claimed to exist |
| Process port | Sound — no competing abstraction, `RealDelegatedProcessPort` unmoved |
| Recovery | Sound — same coordinator, real recovery primitives confirmed |
| Recovery cadence classification | Sound — correctness independent of cadence, confirmed against every touched crash row |
| Crash-boundary / crash-matrix delta | Sound — only C0/X2 changed, confirmed |
| Authority-table delta | Sound — only the S2 row's detail column changed, confirmed |
| Async-late residual | Unchanged — remains unreachable |
| Unrelated §5+ diff audit | Clean — no category-C hunk found |
| Gates | Correctly classified `ARCHITECTURE_SOUND_IMPLEMENTABLE`, not proven |
| SPEC status | Remains `ARCHITECTURE_READY_FOR_FOCUSED_REREVIEW`, no self-declared freeze |
| aiControl guard | Matches exactly, read-only, unmutated |

```
state_class: ARCHITECTURE_ACCEPTED_READY_TO_FREEZE
display_verdict: ORCA_S5_DELEGATED_CUTOVER_FULL_ARCHITECTURE_ACCEPTED_READY_TO_FREEZE
accepted_architecture_head: 627b00b0b71a345783dbc37f9ebff99033e8dc80
```

- **Original full-review blocker:** CLOSED.
- **Remaining §5+ architecture:** INDEPENDENTLY ACCEPTED (unchanged by this
  correction, confirmed via diff audit, §4/§28 above).
- **PRE_IMPLEMENTATION seam:** IMPLEMENTED / ACCEPTED / PUBLISHED
  (`eed09b3047db4f71d25763c215335a2f2db0b403`, unaffected).
- **Architecture may now proceed to:** STATUS RATIFICATION / FREEZE
  PUBLICATION.
- **Cutover-Core implementation:** NOT YET AUTHORIZED until freeze/
  ratification is published.
- **Live `ORCA_DELEGATED` activation:** NOT AUTHORIZED.

This rereview performed no SPEC edits, no code changes, no test changes, no
migrations, no fence-acquisition enablement, and does not itself freeze,
ratify, or publish the architecture — it records only that the sole
outstanding blocker from `ARCHITECTURE-INDEPENDENT-REVIEW-001.md` is closed
and that no new architecture blocker was introduced.
