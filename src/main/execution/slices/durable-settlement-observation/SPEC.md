# ORCA-S2 — Durable Settlement Observation & Convergence — CANDIDATE SLICE SPEC

> SDD artifact. **Candidate — not yet frozen, not yet independently accepted.**
> When frozen it becomes the functional authority for this slice; code will not
> silently redefine it. A real conflict is `CONTRACT_CONFLICT` → architecture
> decision → amendment, never a silent edit here.
>
> This document is self-contained: a fresh implementation session consumes it
> without reconstructing architecture from chat history.
>
> **Revision note (candidate, pre-freeze).** This revision corrects eight
> architecture blockers found by independent review of the prior candidate
> (`0950e74f0b`): (1) the `source_fact_seq` watermark had no durable source in
> ORCA-S1 shadow — replaced by a content **`source_digest`**; (2) convergence is
> now an explicit **two-phase** scan; (3) the "read-only `OrchestrationDb`"
> assumption is replaced by a real Execution-owned **`DurableSettlementSource`**
> read port over a genuinely SQLite-read-only handle; (4) the converged outcome
> no longer reconstructs `candidate_head` / `files_changed` from disposable Git
> state — no Git, no `missing_git_artifact`; (5) "Execution-store wipe" is
> replaced by **settlement-projection rebuild** with semantic (not byte-identical)
> replay equivalence; (6) an additive **`BEGIN IMMEDIATE`** Execution-store
> transaction seam plus a read→verify→commit protocol across the two databases;
> (7) one **unified reconciliation state machine** — `reconcileIncompleteReservations`
> is modified, not "kept intact"; (8) **no S2 write to `parity_observation`** at
> all. The prior candidate's `source_fact_seq`, watermark bump, Git reconstruction,
> `missing_git_artifact`, full Execution-store wipe, and `converged_by_s2` parity
> row are removed throughout, including every acceptance gate, TDD target, crash
> window, and appendix.
>
> **Revision note 2 (candidate, pre-freeze).** Focused architecture corrections
> on top of `7609b2c5c7`. This is **not** an amendment — the SPEC is still an
> unpublished candidate. (1) Transient source-snapshot instability during the
> read → re-verify window is **not** a conflict: it returns a retryable
> `SOURCE_UNSTABLE_RETRYABLE` result — never a `source_snapshot_changed`
> incident, never a `settlement_incident`, never a `settlement_observation`
> mutation, and it does not block the binding (§8, §13, §16.3, §16.4, §19).
> `source_snapshot_changed` is reserved strictly for an already-persisted
> `settlement_observation` versus a later **successfully-read stable** durable
> snapshot with a different `source_digest`. (2) The cross-DB guarantee is stated
> precisely — S2 claims **no** distributed atomicity; the source DB may still
> change after the final source read and before Execution `COMMIT`, and that
> window is closed only by a later Phase B re-read (§16.4). (3) One S1↔S2
> composition model: `executeShadowIdentityObservationSlice` remains the
> composition boundary and is extended by S2; a single application coordinator
> `reconcileShadowExecutionState` owns the strict ordering converge →
> verify-observed → abandon-remainder; there is **no** independent competing S2
> startup root and **no** separate unconditional abandon pass (§2, §15, §17,
> §21). (4) The implementation map now explicitly names the four ORCA-S1 files S2
> modifies at the composition/application seam
> (`reconcile-incomplete-reservations.ts`, `shadow-observation-service.ts`,
> `disposable-shadow-root.ts`, `shadow-identity-observation.ts`); every "S1 is
> unaffected" / "only one ORCA-S1 file changes" claim is removed — S1's
> **authority and semantics** remain valid, but S2 necessarily touches S1
> **composition seams** with **no authority transfer** (§2, §18, §24, §25,
> Appendix A). (5) One stable **durable** shadow orchestration DB for this
> Maestro shadow-migration environment, shared by the ORCA-S1/S2 shadow runtime
> across process restarts, living **outside** `DisposableShadowRoot`;
> missing-file startup fails closed with a named
> `ShadowSettlementSourceMissingError`; empty-new-environment initialization is
> defined separately from recovery; rollback never auto-deletes the durable
> source DB (§9, §17, §19, §24). (6) Coupling reclassified from
> `SMALL_ADDITIVE_ORCA_READ_API` to `EXECUTION_OWNED_SCHEMA_COUPLED_READER` — S2
> adds no Orca API and changes no Orca core surface (§14, §25). (7) The canonical
> serializer for `DurableSettlementSnapshot` is **Execution-owned** and mirrors
> Orca `canonicalPayload` normalization semantics with executable
> compatibility/ratchet tests — no import or export of Orca's module-private
> function (§6.1, §21). (8) `withImmediateTransaction` treats `SQLITE_BUSY` as a
> bounded retryable acquisition condition; on exhaustion it returns
> `EXECUTION_STORE_BUSY_RETRYABLE` with no observation, no incident, no partial
> state (§16.1, §16.3, §19). (9) The reconciliation state machine has exactly one
> outcome per condition, including the two new retryable results (§15).

**Normative source:** aiControlCenter `master` /
`origin/master` == `c2d404a541a1136e4471d00aa94b616e1eac3a0d`,
`docs/roadmap/phase-m-model-governance-workforce-allocation.md`, published
amendment `ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01`.
Governing sections: **F** (Reconciliation — normative semantics), **L**
(Identidade), **P** (Architecture Style), **S** (ORCA-S1), with **E** (absolute
authority invariant), **G** (`ORCA_DELEGATED` terminal transition) and **H**
(delegated side-effect ownership) read as the boundary S2 **must not cross**, and
**I** (`SHADOW_EXECUTION_SAFETY_POLICY`), **J** (`worker_done` semantics), **K**
(Governed DAG) inherited unchanged. aiControlCenter is **READ-ONLY** for this
slice.

**Maestro base:** `911b6679c26d6a7ce805262b8d1755e9c0532627` (`origin/main`, the
published ORCA-S1 technical HEAD).
**Orca base:** unchanged from ORCA-S1 — `bf4e2705046cf9ef9c915929a9646da85717af07`
semantics as vendored at the Maestro base. **No upstream integration.**
`upstream/main` is ahead of the vendored Orca base by an unpinned amount that is
irrelevant to this slice (§26); it is NOT merged by this task or the S2
implementation.
**Predecessor:** ORCA-S1 — Shadow Identity & Observation
(`src/main/execution/slices/shadow-identity-observation/`), **CLOSED / PUBLISHED**.
**Candidate branch:** `orca-s2-durable-settlement-observation`.

---

## 0. CONTRACT_CONFLICT check (published §F, §E, §G, §L)

**No conflict.** §F opens *"Quando o Orca possui uma transição"* — its
projection/convergence semantics are written for stages where Orca **owns** a
transition. At S2's stage (`AICONTROL_NATIVE` / `ORCA_SHADOW_ADVISORY`) the
authority matrix keeps *Execution / settlement authority* with aiControl and
Orca settlement **advisory**. S2 therefore does **not** claim Orca owns
settlement authority. What S2 does is **pre-implement the durable convergence
engine** described in §F — the reconciliation sweep, the durable-fact digest,
idempotent projection, duplicate-is-no-op, identity-validated projection,
unresolved-→-incident, converge-never-invent — with its projection **target**
being an Execution-owned **advisory** record (`settlement_observation`), never
`data/app.db`, never a Governance AgentRun terminal write.

Resolution — **compliance, not relaxation**. Building and proving the §F engine
now, at SHADOW, against an advisory target is the prerequisite for the later
`ORCA_DELEGATED` slice (under its own frozen contract, §G item 6) to only swap
the projection target. Nothing in this slice advances an authority stage.

---

## 1. Name / purpose

**ORCA-S2 — Durable Settlement Observation & Convergence.**

Give the Execution bounded context a **durable, idempotent, restart-safe,
provenance-carrying** record of the fact that Orca has durably settled a bound
shadow Dispatch — **converged from shadow `orchestration.db` durable state by a
reconciliation sweep that depends on no notification, no hook, and no in-flight
process**.

ORCA-S1 recorded parity only along the synchronous happy path
(`openShadowRun → runShadowWorkload → settleShadow → recordParityObservation`, one
`try` block). A crash **after** Orca durably settled the shadow Dispatch but
**before** Maestro observed it made S1's `reconcileIncompleteReservations`
**abandon** the run (`reconcile-incomplete-reservations.ts` unconditionally
settles every incomplete reservation to `abandoned`, even one whose shadow
Dispatch is already terminal). S2 makes that specific case **converge** instead:
the durable settlement fact is observed and recorded exactly once, or raised as a
blocking incident — **never invented, never abandoned when Orca genuinely
settled** (§F.4–F.7).

## 2. Bounded-context owner

**Execution** (§L: *"O bounded context proprietário dessa integração é
Execution"*; §P.3, §P.13; ORCA-S1 §2). The fact being converged is a
cross-reference between an authoritative execution identity and an Orca dispatch
identity — §L assigns exactly that integration to Execution. Delivery /
Governance may consume a converged outcome only through a future public
application contract; they never read or write S2's tables.

S2 adds, all Execution-owned (new files):

- the `settlement_observation` and `settlement_incident` aggregates (§12, §13);
- the `DurableSettlementSource` **read port** (application) + one read-only
  infrastructure adapter over the shadow `orchestration.db` (§14);
- the `convergeSettlements` application service — the two-phase sweep (§8);
- the `reconcileShadowExecutionState` application **coordinator** — the single
  ordering authority converge → verify-observed → abandon-remainder (§15);
- an additive `withImmediateTransaction` seam on the Execution SQLite store
  (§16);
- the schema **v2 → v3** upgrade — **new tables only, no column added to any
  ORCA-S1 table** (§11).

S2 also **modifies these existing ORCA-S1 files** at the
Execution-composition / application seam (no authority transfer — §6, §18, §25):

- `src/main/execution/application/reconcile-incomplete-reservations.ts` — its
  terminal-Dispatch branch must **no longer unconditionally abandon**; it
  delegates to convergence via the coordinator (§15).
- `src/main/execution/application/shadow-observation-service.ts` — the
  convergence / reconciliation dependencies and the unified converge-before-abandon
  ordering are threaded through `runShadowObservation` (§15, §21).
- `src/main/execution/infrastructure/disposable-shadow-root.ts` — the disposable
  worktree/root **no longer owns the durable convergence DB lifetime**;
  `shadowOrchestrationDbPath()` / `cleanup()` stop governing the shared durable
  shadow `orchestration.db` (§17).
- `src/main/execution/slices/shadow-identity-observation/shadow-identity-observation.ts`
  — `executeShadowIdentityObservationSlice` composes the **durable out-of-root**
  shadow DB path, the shadow writer + the read-only reader construction, and the
  cleanup ownership split (§17, §21).

Plus the Execution-owned schema/store files `execution-schema.ts` (versioned
v2→v3, additive DDL only) and `sqlite-execution-store.ts` (the additive
`withImmediateTransaction` method — no existing method changes).

This is an ORCA-S1 **implementation / composition seam** change to extend the
published runtime. ORCA-S1's **accepted authority and reconciliation semantics
remain valid and unchanged**; there is **no** authority transfer. The claim "S1
is unaffected" / "only one ORCA-S1 application file changes" does **not** hold
and is not made anywhere in this spec.

## 3. Objective (one paragraph)

For every ORCA-S1 `run_binding` whose Orca shadow Dispatch has reached a terminal
status in the dedicated shadow `orchestration.db`, S2 durably records **one**
`settlement_observation` in the Execution store that (a) carries a
settlement-specific `SettlementObservedOutcome` derived **only** from durable
Orca settlement facts — dispatch terminal status, dispatch `completed_at`, task
status, task `completed_at`, the canonicalised `tasks.result` body, and the
canonicalised ordered `attempt_observation_facts` for that dispatch **if any
exist** — never from an in-process `ShadowExecutionResult` and never from Git
worktree state; (b) cites its exact source facts as `provenance_json` and pins
their content with a **`source_digest`** =
`SHA-256(canonicalSerialize(DurableSettlementSnapshot))` — the serialiser is
Execution-owned (§6.1); (c) is produced by a
**two-phase** `convergeSettlements` sweep that is a pure, idempotent function of
`(Execution store state, shadow orchestration.db state, now)` — runnable at
process start, repeatedly, after a **settlement-projection rebuild**, and after
any crash, always reaching the same source-derived observation set. **Durable
semantic** divergences that replay of durable facts cannot resolve — a
foreign/unresolvable Dispatch, or a later **successfully-read stable** durable
snapshot whose digest differs from the immutable digest already observed — are
recorded as blocking `settlement_incident` rows keyed by
`(correlation_id, kind, evidence_digest)` and **never** auto-resolved into or
over an observation (§F.7). A **transient** inability to obtain a stable
point-in-time snapshot, or to acquire the Execution write transaction, is **not**
a divergence and **not** an incident — it returns a retryable result
(`SOURCE_UNSTABLE_RETRYABLE` / `EXECUTION_STORE_BUSY_RETRYABLE`), leaves the
binding untouched, and is surfaced in the convergence report for the next sweep
(§16). Authority stays `AICONTROL_NATIVE`; Orca stays advisory; `data/app.db` is
never opened for write and is byte-identical before and after, on every path
including every incident, every retryable result, and every crash path.

## 4. Ubiquitous / domain language

| Term | Meaning in this slice |
| --- | --- |
| **Durable Orca settlement fact** | A shadow `dispatch_contexts` row that reached a terminal status (`completed` / `failed` / `circuit_broken`) in the dedicated shadow `orchestration.db`, together with its `tasks` row (`status`, `result`, `completed_at`) and the ordered `attempt_observation_facts` for that dispatch, if any. **The authority of the transition once Orca owns it** (§F.1). Read-only to S2. |
| **`DurableSettlementSnapshot`** | The canonical, source-only value S2 derives everything from (§6). Fields: correlation identity; `orca_dispatch_id` / `org_task_id` / `orca_run_id`; dispatch terminal `status` + `completed_at`; task `status` + `completed_at`; canonicalised `tasks.result`; canonicalised ordered `attempt_observation_facts` (`[]` when absent). Contains **no** local clock, **no** Git state, **no** in-process result. |
| **`source_digest`** | `SHA-256` over the canonical serialisation of a `DurableSettlementSnapshot` (§6). The content identity of one durable settlement fact. No ordering or regression **direction** is claimed — only "same" vs "different". |
| **`SettlementObservedOutcome`** | The narrowed observed outcome (§12), derived **only** from a `DurableSettlementSnapshot`: `{ terminalOutcome: 'completed' \| 'failed' \| 'cancelled', exitDisposition: 'zero_exit' \| 'non_zero_exit' \| 'no_exit', cancellation: 'cancelled' \| 'not_cancelled' }`. **No `filesChanged`. No `candidate_head`. No `cancelled_clean` vs `cancelled_mid_flight`** — durable facts do not prove that distinction. |
| **Settlement observation** | A durable Execution-owned row: one converged `DurableSettlementSnapshot` for one `run_binding`. Fields §12. **Advisory.** Never a `data/app.db` write, never a Governance AgentRun terminal write, never a `parity_observation` write. |
| **Two-phase convergence sweep** | `convergeSettlements(sliceRef, now)` — **Phase A** attempts convergence for every binding with no `settlement_observation`; **Phase B** re-reads the durable snapshot for every already-observed binding and verifies its `source_digest` (§8). |
| **Settlement provenance** | `provenance_json` — the full canonical `DurableSettlementSnapshot` plus `{ resolved_dispatch_id, resolved_run_id, source_db_path }`. Non-empty for every observation and every incident. Only observed durable facts; no invented state. |
| **Settlement incident** | A **durable semantic** divergence replay of durable facts cannot resolve (§F.7): `foreign_dispatch`, `invalid_or_unresolvable_source`, `source_snapshot_changed`. Recorded in `settlement_incident`, **blocks** that binding (no new observation; an existing observation row is preserved untouched), sweep continues, report lists it. **Never auto-resolved. Never overwritten by later conflicting evidence** (the key includes `evidence_digest`). A transient operational inability (source snapshot unstable across the double-read; `SQLITE_BUSY`; transaction-acquisition failure) is **not** an incident (§13). |
| **Retryable convergence result** | `SOURCE_UNSTABLE_RETRYABLE` (a stable point-in-time source snapshot could not be obtained within the bounded re-verify budget) or `EXECUTION_STORE_BUSY_RETRYABLE` (the Execution write transaction could not be acquired within the bounded busy-retry budget). Neither writes any durable row, mutates any observation, or blocks the binding. Both are surfaced in the `SettlementConvergenceReport` / diagnostics (never a silent skip); the next sweep may retry (§16.3, §19). |
| **Foreign / unresolvable Dispatch** | The **latest** Dispatch for the correlation's task is not `run_binding.orca_dispatch_id`, or its `run_id` ≠ `run_binding.orca_run_id`, or the task `spec` correlation marker matches no Execution `run_reservation`. §F.5 / §L / ORCA-S1 I4. Never projects → `foreign_dispatch` incident. |
| **Settlement-projection rebuild** | Drop and recreate **only** S2-owned projection state (`settlement_observation`, `settlement_incident`) while preserving `run_binding`, `run_reservation`, and the durable shadow `orchestration.db`. Replay equivalence is **semantic** equivalence of source-derived fields, not byte-identical rows (§17). |
| Opaque ref | `OrcaRunRef` / `OrcaDispatchRef` / `OrgTaskRef` / `AiControlRunRef` / `GovernanceAgentRunRef` / `CorrelationId` — branded strings, unchanged from ORCA-S1. No Orca row type crosses the port (§P.6). |

## 5. Authority before

`AICONTROL_NATIVE`. Orca mode `ORCA_SHADOW_ADVISORY`.
`data/app.db` is the sole correctness authority for native execution.

## 6. Authority after

`AICONTROL_NATIVE`. Orca mode `ORCA_SHADOW_ADVISORY`. **Unchanged. No transfer.**

S2 **observes**; it does not **decide**. It explicitly does **not**:

- set canonical aiControl terminal state from an Orca fact;
- claim Orca owns settlement authority at this stage;
- invoke any delegated terminal side effect (§H);
- turn `agent_runs` into a projection;
- disable or bypass aiControl native `finalizeRunOnce`;
- transfer queue / capacity / scheduler ownership;
- claim Orca terminal state is authoritative for any production run.

If implementation discovers that a *useful* S2 genuinely requires any of the
above → **STOP** with `AUTHORITY_TRANSFER_REQUIRES_NEW_CONTRACT` and explain.
The architecture below is designed so this does not happen: observation of a
shadow fact into an advisory Execution-owned record needs no authority.

### 6.1 `DurableSettlementSnapshot` and `source_digest` — normative definition

The snapshot is built **entirely** by the `DurableSettlementSource` read port
(§14) from the shadow `orchestration.db`. Canonical field set, in this order:

```
DurableSettlementSnapshot {
  correlationId          : string            // Execution-minted; also the task spec marker
  orgTaskId              : string            // tasks.id
  orcaRunId              : string            // tasks.run_id
  orcaDispatchId         : string            // the resolved latest dispatch_contexts.id for the task
  dispatchStatus         : 'completed' | 'failed' | 'circuit_broken'
  dispatchCompletedAt    : string | null     // dispatch_contexts.completed_at
  taskStatus             : 'completed' | 'failed'
  taskCompletedAt        : string | null     // tasks.completed_at
  taskResultCanonical    : CanonicalJson | null   // canonicalised tasks.result body (null when the column is NULL)
  attemptFactsCanonical  : CanonicalJson[]   // canonicalised attempt_observation_facts for orcaDispatchId,
                                             //   ORDER BY sequence, rowid; [] when none exist
}
```

- **Canonical serialisation.** Object keys sorted ascending; arrays in the
  documented order; `undefined` encoded as `null`; strings/numbers/booleans as
  minimal JSON. This serialiser is **Execution-owned** (a new domain function,
  `canonicalSerialize(DurableSettlementSnapshot)`), **not** an import of Orca's
  module-private `canonicalPayload` (`attempt-observation-store.ts` — it is not
  exported, and S2 requires **no** Orca-core export change). It **mirrors** the
  relevant normalization semantics of `canonicalPayload` where those apply
  (recursive key-sort, array order preserved, minimal scalar encoding), pinned by
  executable **compatibility / ratchet tests** that fail loudly if Orca's
  canonical form drifts from S2's. `taskResultCanonical` is the
  parse-then-`canonicalSerialize` of `tasks.result`; if `tasks.result` is
  present but not valid JSON → **not** a snapshot → `invalid_or_unresolvable_source`
  incident (§13).
- **`source_digest`** = `SHA-256(hex)` of
  `canonicalSerialize(DurableSettlementSnapshot)` over the whole snapshot.
- **No wall clock, no Git, no in-process result** contributes to the snapshot or
  the digest. `dispatchCompletedAt` / `taskCompletedAt` are Orca's own durable
  timestamps and are part of the content identity.
- **Direction-free.** Two snapshots are only ever "same digest" or "different
  digest". S2 asserts nothing about which is newer, and records no
  `watermark_regression` — that concept is removed.

### 6.2 `SettlementObservedOutcome` — derivation (source-only)

From a `DurableSettlementSnapshot` only:

- `terminalOutcome`:
  - a `cancelled` marker in `taskResultCanonical` (`cancelled === true`) →
    `'cancelled'`;
  - else `dispatchStatus === 'completed'` **and** `taskStatus === 'completed'` →
    `'completed'`;
  - else (`failed` / `circuit_broken`, or a status disagreement) → `'failed'`.
- `exitDisposition`, from `taskResultCanonical.exitCode`:
  `0` → `'zero_exit'`; a positive integer → `'non_zero_exit'`; `null` / absent /
  `cancelled` → `'no_exit'`.
- `cancellation`: `'cancelled'` iff `terminalOutcome === 'cancelled'`, else
  `'not_cancelled'`. **No finer granularity.**

If a required field for this derivation is structurally absent from an otherwise
terminal dispatch (e.g. `taskResultCanonical` is `null` **and** the dispatch
status alone cannot classify the outcome) → `invalid_or_unresolvable_source`
incident (§13), **not** an invented outcome.

## 7. Allowed state transitions

`run_reservation` (ORCA-S1) keeps its lifecycle
(`reserved → orca_created → bound → executed → settled → observed`, plus
`abandoned`). S2 adds **one** new reservation-adjacent state and a settlement
fold keyed by `correlation_id`, separate from the reservation lifecycle:

```
binding with a terminal shadow Dispatch, no settlement_observation,
STABLE snapshot re-read inside the write txn yields digest D
    --convergeSettlements Phase A-->
        settlement_observation WRITTEN once (source_digest = D; status = 'observed')
        [run_reservation advances to 'observed' if still 'settled'/'executed'/'bound'/'orca_created']

binding with a terminal shadow Dispatch, no settlement_observation,
BUT the source snapshot keeps changing across the bounded re-verify retries
    --convergeSettlements Phase A-->
        NO settlement_observation, NO settlement_incident, binding NOT blocked;
        return SOURCE_UNSTABLE_RETRYABLE (surfaced in the report); next sweep may retry

any Phase-A or Phase-B decision whose Execution write transaction cannot be
acquired within the bounded SQLITE_BUSY retry budget
    --convergeSettlements-->
        NO durable row of any kind, NO partial state, binding NOT blocked;
        return EXECUTION_STORE_BUSY_RETRYABLE (surfaced in the report); next sweep may retry

binding whose reservation crashed mid-lifecycle (orca_created|bound|executed|settled)
AND whose LATEST shadow Dispatch IS the bound one AND IS terminal in orchestration.db
    --convergeSettlements Phase A-->
        settlement_observation WRITTEN once   [replaces ORCA-S1's "abandon" for this case — CONVERGE, not abandon]

binding whose shadow Dispatch was never created (reservation 'reserved')
    --convergeSettlements / reconcile-->  reservation 'abandoned'   [unchanged from ORCA-S1 — no durable fact to converge]

binding whose LATEST shadow Dispatch exists but is NON-terminal
    --convergeSettlements / reconcile-->  left this pass; retried next pass;
        after `staleAfter` still non-terminal → abandonShadow + reservation 'abandoned' [unchanged from ORCA-S1]

binding whose LATEST shadow Dispatch for the task ≠ run_binding.orca_dispatch_id
   (or run_id mismatch, or correlation-marker mismatch)
    --convergeSettlements-->  settlement_incident(kind='foreign_dispatch'); binding BLOCKED; NO observation

already-observed binding, Phase B STABLE re-read, digest == stored
    --convergeSettlements Phase B-->  no-op (§F.6)

already-observed binding, Phase B STABLE re-read (digest coherent across the
double-read), digest != the immutable stored source_digest (digest D2)
    --convergeSettlements Phase B-->
        settlement_incident(kind='source_snapshot_changed', evidence_digest=D2); binding BLOCKED;
        settlement_observation.status: 'observed' -> 'observed_conflicted' (the ONLY permitted mutation of that row);
        all source-derived columns of the existing observation LEFT UNCHANGED

already-observed binding, Phase B re-read UNSTABLE across the bounded retries
    --convergeSettlements Phase B-->
        NO settlement_incident, NO status mutation, binding NOT blocked;
        return SOURCE_UNSTABLE_RETRYABLE (surfaced in the report); next sweep may retry
```

- `settlement_observation.correlation_id` is **PRIMARY KEY** — at most one
  converged observation per binding, ever.
- `settlement_observation.status` ∈ `{ 'observed', 'observed_conflicted' }`. The
  **only** permitted mutation to an existing `settlement_observation` row is
  `'observed' → 'observed_conflicted'` together with setting `conflicted_at`.
  `source_digest`, `observed_outcome_json`, `provenance_json`, and every
  `source_*` column are **immutable** after the first write.
- A binding with an open (`resolved_at IS NULL`) `settlement_incident` gets **no**
  new `settlement_observation` and **no** further convergence for that binding
  until the incident is adjudicated. Adjudication is **out of S2 scope**; S2 only
  raises, blocks, and exposes the contract (§13).
- **`source_snapshot_changed` is reserved for exactly one condition:** an
  already-persisted `settlement_observation` **plus** a later
  **successfully-read stable** durable source snapshot whose `source_digest`
  differs from the immutable stored digest. Only that condition may insert a
  `source_snapshot_changed` incident, transition `observed → observed_conflicted`,
  and set `conflicted_at`. A **Phase A** pass (no observation yet) can **never**
  create `source_snapshot_changed`. A source that merely changed *during* the
  read → re-verify window is **transient instability**, not a conflict:
  `SOURCE_UNSTABLE_RETRYABLE`, no incident, no mutation, no block (§16.3).

## 8. Two-phase convergence — normative scan model

`convergeSettlements(sliceRef, now)` runs, in order, over the bindings for
`sliceRef` (`store.listBindings(sliceRef)` — a bounded, Execution-owned set):

### Phase A — bindings with **no** `settlement_observation`

For each such binding whose `run_reservation` is not `abandoned`:

1. **Resolve** via the `DurableSettlementSource` port (§14): find the task whose
   `spec` JSON correlation marker == `binding.correlationId`; take its **latest**
   Dispatch (`ORDER BY rowid DESC LIMIT 1` — matching Orca's own
   `getDispatchContext`); then check identity:
   - latest dispatch `id` == `binding.orca_dispatch_id`, **and**
   - latest dispatch `run_id` == `binding.orca_run_id`, **and**
   - the resolving task's marker matches this binding's reservation.
   Any mismatch → `foreign_dispatch` incident (§13); binding blocked; continue.
2. If the resolved (bound) Dispatch is **non-terminal** → leave for a later pass;
   the abandon-after-`staleAfter` decision belongs to the unified state machine
   (§15) and runs **after** all convergence.
3. If terminal → build the `DurableSettlementSnapshot` and `source_digest` (§6).
   If it cannot be canonicalised → `invalid_or_unresolvable_source` incident
   (§13); binding blocked; continue.
4. **Commit** the convergence decision atomically (§16): enter
   `withImmediateTransaction` (bounded `SQLITE_BUSY` retry — on exhaustion return
   `EXECUTION_STORE_BUSY_RETRYABLE`, no row, no incident), **re-read** the source
   snapshot inside the transaction and recompute the digest; if the re-read
   digest differs from step 3's (source moved under us), `ROLLBACK` and retry
   from step 1 up to the bounded budget, and on budget exhaustion return
   `SOURCE_UNSTABLE_RETRYABLE` — **no `settlement_observation`, no
   `settlement_incident`, binding not blocked** (§16.3). On a stable re-read:
   `INSERT` the `settlement_observation` (PK `correlation_id`), advance the
   `run_reservation` to `observed` by CAS if still in
   `{orca_created, bound, executed, settled}`. Because `BEGIN IMMEDIATE`
   serialises Execution-store writers, a concurrent sweep that acquires second
   re-reads inside its own transaction, sees the existing observation in the
   precheck, and no-ops; the `correlation_id` PK is a backstop, not the primary
   mechanism, and a PK collision is treated as a **no-op**, not an error (§16).

### Phase B — bindings **with** a `settlement_observation`

For each such binding:

1. Re-resolve and re-read the durable snapshot via the port (same identity checks
   as Phase A step 1; a Dispatch that has become foreign → `foreign_dispatch`
   incident).
2. Obtain a **stable** `source_digest`: read, enter `withImmediateTransaction`
   (bounded `SQLITE_BUSY` retry → `EXECUTION_STORE_BUSY_RETRYABLE` on
   exhaustion), re-read inside the transaction; if the two reads disagree,
   `ROLLBACK` and retry up to the bounded budget, and on exhaustion return
   `SOURCE_UNSTABLE_RETRYABLE` — **no incident, no `status` mutation, binding not
   blocked** (§16.3). On a stable digest:
   - **== stored `source_digest`** → **no-op**.
   - **!= the immutable stored `source_digest`** → atomically (§16): `INSERT` a
     `settlement_incident(kind='source_snapshot_changed', evidence_digest=<new stable digest>)`,
     and mutate the existing `settlement_observation` `status`
     `'observed' → 'observed_conflicted'` + set `conflicted_at`. The existing
     observation's source-derived columns are **never** rewritten. The binding is
     blocked from further convergence. This is the **only** path that creates a
     `source_snapshot_changed` incident.
3. If the observation already has `status = 'observed_conflicted'` and an open
   incident with the same `evidence_digest` → **no-op** (idempotent
   re-detection). A *different* new digest → a *new* incident row (the key
   includes `evidence_digest`); still no rewrite of the observation.

`convergeSettlements` performs **no** abandon and **no** `abandonShadow`; those
are the state machine's (§15). It performs **no** Git call of any kind.

## 9. Inputs

- `executionStorePath` — the ORCA-S1 Execution-owned SQLite store, migrated to
  schema v3. `:memory:` allowed for tests. **Rejected if it aliases
  `data/app.db`** (ORCA-S1 B4 guard, reused).
- `shadowOrchestrationPath` — the **one durable shadow** `orchestration.db` for
  this shadow-migration environment, shared by the ORCA-S1 writer and the S2
  reader across restarts. It **MUST live outside** `DisposableShadowRoot`, at a
  stable, configured path re-verified against
  `execution_meta.shadow_orchestration_path` on every startup (§17):
  configured≠persisted → `ShadowSourcePathMismatchError`; persisted-but-file-missing
  with durable bindings present → `ShadowSettlementSourceMissingError` (S2 does
  **not** create a replacement). `:memory:` is allowed **only** for a
  single-process test; a restart-safety test requires a real file path. The
  `DurableSettlementSource` adapter opens it **genuinely SQLite-read-only**
  (`readonly: true, fileMustExist: true`).
- `aicontrolDbPath` — canonical aiControlCenter `data/app.db`. **GUARD ONLY**
  (SHA-256 + sidecar check). Never opened. Unchanged from ORCA-S1.
- `sliceRef` — `orca-s2-durable-settlement-observation`.
- `now: () => string`, `newId: (prefix) => string` — injected clock / id, used
  only for **local metadata** (`observed_at`, `first_seen_at`, `raised_at`,
  incident `id`) — never for a source-derived field or a digest.
- `staleAfter` — bounded cutoff after which a still-non-terminal bound shadow
  Dispatch is abandoned rather than retried (ORCA-S1 behaviour).
- The set of `run_binding` rows from ORCA-S1.

## 10. Outputs / durable artifacts

- `settlement_observation` rows — one per converged binding (§12), `status`
  `observed` or `observed_conflicted`.
- `settlement_incident` rows — one per unresolved divergence, keyed
  `(correlation_id, kind, evidence_digest)`; blocks its binding (§13).
- A `SettlementConvergenceReport` value:
  `{ sliceRef, scannedPhaseA, scannedPhaseB, observed: ObservedRef[],
     conflicted: ConflictedRef[], incidents: IncidentRef[], noop: number,
     abandoned: AbandonRef[], sweepErrors: SweepErrorRef[],
     retryable: RetryableRef[],   // { correlationId, phase, reason:
                                  //   'SOURCE_UNSTABLE_RETRYABLE' | 'EXECUTION_STORE_BUSY_RETRYABLE',
                                  //   attempts } — never a silent skip
     dbGuard: { pathHashBefore, pathHashAfter, sidecarsAfter, unchanged },
     sourceGuard: { openedReadonly: true, ddlIssued: 0, pragmaJournalMutations: 0,
                    triggersCreated: 0, metadataWrites: 0, sidecarsCreatedByS2: 0 } }`.
  A `retryable` entry writes **no** durable row and leaves its binding for the
  next sweep (§16.3).
- **No `parity_observation` row is written or modified by S2** (§18, §26 attack
  11).

**Frozen sample note.** S2's acceptance sample MAY reuse ORCA-S1's frozen shape
or a smaller S2-specific N; the exact value is fixed by the *frozen* version of
this spec (this candidate proposes **N = 3**: one clean `completed` / zero-exit,
one `failed` / non-zero-exit, one `cancelled` — all `synthetic` /
`repo_local_code_only` per §I). No file-mutating workload is required: S2 reads
**no** Git state. Fewer than the required distinct bindings →
`workload_exclusion` (`code: 'sample_source_unavailable'`), sample reported
partial, never back-filled.

## 11. Persistence ownership

Execution-owned, **schema v3** (`EXECUTION_SCHEMA_VERSION` 2 → 3), **same**
Execution SQLite file as ORCA-S1. Changes are **new tables only**:

- new table `settlement_observation` (§12);
- new table `settlement_incident` (§13);
- **no column added to any ORCA-S1 table.** The prior candidate's
  `run_binding.source_watermark_seq` is removed. The prior candidate's optional
  `parity_observation.converged_by` is removed.

The shadow `orchestration.db` path is persisted for restart rediscovery in the
**existing** `execution_meta` key/value table (§17) — not in a new column.

No column of any ORCA-S1 table is dropped or renamed. `orchestration.db` is
opened **genuinely read-only** by the source adapter (§14). `data/app.db` is
never opened. aiControlCenter `DB_BASELINE.json` is not touched.

### 11.1 Real v2 → v3 upgrade path

`migrateExecutionStore` is extended from its current "create-if-absent + first
insert" shape to a **versioned** upgrade:

1. `db.exec(CREATE_SQL)` where `CREATE_SQL` now also contains
   `CREATE TABLE IF NOT EXISTS settlement_observation (...)` and
   `CREATE TABLE IF NOT EXISTS settlement_incident (...)` and their indexes.
2. Read `execution_meta.schema_version`.
   - absent → `INSERT` `schema_version = '3'`.
   - present and `>= 3` → done.
   - present and `< 3` → run the v3 step (for v3 the step is **only** "ensure the
     two S2 tables + indexes exist", already done by step 1, because S2 adds no
     column and therefore needs no `ALTER TABLE`), then
     `UPDATE execution_meta SET value = '3' WHERE key = 'schema_version'`.
3. The upgrade is idempotent and transactional (wrap steps 1–2 in
   `BEGIN IMMEDIATE … COMMIT`).

**Result:** an existing ORCA-S1 (v2) store opens, keeps every S1 row untouched,
and gains the two S2 tables; a v2 store upgraded to v3 and a freshly created v3
store are **structurally identical** (criterion 15). The upgrade shape (version
compare + explicit bump) is defined now even though v3 needs no `ALTER`, so a
later v4 has a real ladder to extend.

```sql
CREATE TABLE IF NOT EXISTS settlement_observation (
  correlation_id             TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id           TEXT NOT NULL,          -- MUST equal run_binding.orca_dispatch_id (checked before insert)
  orca_run_id                TEXT NOT NULL,
  org_task_id                TEXT NOT NULL,
  slice_ref                  TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'observed',   -- 'observed' | 'observed_conflicted'
  source_dispatch_status     TEXT NOT NULL,          -- 'completed' | 'failed' | 'circuit_broken'
  source_dispatch_completed_at TEXT,
  source_task_status         TEXT NOT NULL,          -- 'completed' | 'failed'
  source_task_completed_at   TEXT,
  source_digest              TEXT NOT NULL,          -- SHA-256 of canonical DurableSettlementSnapshot
  observed_outcome_json      TEXT NOT NULL,          -- SettlementObservedOutcome; source-derived only
  provenance_json            TEXT NOT NULL,          -- full canonical snapshot + resolved ids + source_db_path; non-empty
  first_seen_at              TEXT NOT NULL,          -- LOCAL metadata; excluded from replay equivalence
  observed_at                TEXT NOT NULL,          -- LOCAL metadata; excluded from replay equivalence
  conflicted_at              TEXT                    -- LOCAL metadata; set only on 'observed' -> 'observed_conflicted'
);
CREATE INDEX IF NOT EXISTS settlement_observation_by_slice ON settlement_observation(slice_ref);

CREATE TABLE IF NOT EXISTS settlement_incident (
  id               TEXT PRIMARY KEY,
  correlation_id   TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  orca_dispatch_id TEXT,
  slice_ref        TEXT NOT NULL,
  kind             TEXT NOT NULL,      -- foreign_dispatch | source_snapshot_changed | invalid_or_unresolvable_source
  evidence_digest  TEXT NOT NULL,      -- SHA-256 of the evidence snapshot/identity that triggered THIS row (§13)
  detail_json      TEXT NOT NULL,      -- observed durable facts only; NO invented state
  blocked          INTEGER NOT NULL DEFAULT 1,
  resolved_at      TEXT,               -- manual-resolution contract (§13.1); NULL while blocking
  resolution_note  TEXT,
  raised_at        TEXT NOT NULL       -- LOCAL metadata
);
CREATE UNIQUE INDEX IF NOT EXISTS settlement_incident_unique
  ON settlement_incident(correlation_id, kind, evidence_digest);
CREATE INDEX IF NOT EXISTS settlement_incident_by_slice ON settlement_incident(slice_ref);
```

## 12. Settlement-observation semantics

- **Owner** — Execution (`settlement_observation` table).
- **Identity** — `correlation_id` PRIMARY KEY, 1:1 with `run_binding`.
  `orca_dispatch_id` NOT NULL and **checked equal** to
  `run_binding.orca_dispatch_id` before insert (P-S2-1).
- **Correlation** with `run_reservation` / `run_binding` — via `correlation_id`
  (FK) and the dispatch-equality check. Resolved **only** through the durable
  correlation marker present on **both** sides (Execution `run_reservation` +
  Orca task `spec` JSON `orcaS1CorrelationId`), exactly as ORCA-S1 — never
  reconstructed from logs (§L, P-S2-3).
- **Source fact** — read from the shadow `orchestration.db` via the
  `DurableSettlementSource` port (§14): `dispatch_contexts.status` +
  `completed_at`, `tasks.status` + `result` + `completed_at`,
  `attempt_observation_facts(dispatch_id)` ordered by `sequence, rowid`.
  Assembled into a `DurableSettlementSnapshot` (§6). `provenance_json` stores the
  whole canonical snapshot plus `{ resolved_dispatch_id, resolved_run_id,
  source_db_path }`.
- **Observed outcome** — `observed_outcome_json` is the `SettlementObservedOutcome`
  (§6.2). **No `filesChanged`, no `candidate_head`, no Git.**
- **Deduplication** — PRIMARY KEY on `correlation_id`. Phase B with a **stable**
  re-read whose `source_digest` is **identical** → **no-op**.
- **Content identity, no ordering** — a Phase B pass with a **stable** re-read
  whose `source_digest` **differs** from the immutable stored one →
  `source_snapshot_changed` incident + `status` `'observed' → 'observed_conflicted'`.
  A re-read that could not be stabilised across the bounded budget is
  `SOURCE_UNSTABLE_RETRYABLE` — **no** incident, **no** mutation (§16.3). S2 makes
  **no** claim about which snapshot is newer; there is **no** watermark, **no**
  regression direction, **no** monotonic sequence.
- **Replay behaviour** — `convergeSettlements` is safe to run any number of times.
  After the first observation for a binding, Phase A skips it and Phase B is a
  no-op while the digest is stable. A **settlement-projection rebuild** (§17) +
  re-run against the same `orchestration.db` reproduces **semantically
  equivalent** observations — identical `source_digest`, `orca_dispatch_id`,
  `observed_outcome_json`, `provenance_json`, `status` — and semantically
  equivalent incidents (identical `(correlation_id, kind, evidence_digest,
  detail_json)`). Local metadata (`observed_at`, `first_seen_at`,
  `conflicted_at`, incident `id`, `raised_at`) is **excluded** from replay
  equivalence (I-S2-3).
- **Foreign / unresolvable Dispatch rejection** — see §8 step 1 and §13.

## 13. Incident semantics (§F.7 — minimal, executable, non-overwriting)

Incidents are **durable semantic** divergences only. Exactly three kinds, each
with a deterministic trigger backed by durable facts:

| `kind` | Deterministic trigger (durable facts only) | `evidence_digest` | Durable evidence in `detail_json` | Blocks convergence? |
| --- | --- | --- | --- | --- |
| `foreign_dispatch` | Durable identity / equality violation: the **latest** Dispatch for the correlation's task is not `run_binding.orca_dispatch_id`, **or** its `run_id` ≠ `run_binding.orca_run_id`, **or** the resolving task's `spec` marker matches no Execution `run_reservation`. (§F.5, ORCA-S1 I4.) | `SHA-256(resolved_dispatch_id ‖ resolved_run_id ‖ correlationId)` | resolved dispatch id + run id, the bound ids, which check failed | Yes — no observation for this binding. |
| `invalid_or_unresolvable_source` | A **stable** durable source exists but cannot satisfy the required canonical source contract: the bound Dispatch is terminal but a `DurableSettlementSnapshot` cannot be built — `tasks.result` present but not valid JSON; or a field required for `SettlementObservedOutcome` (§6.2) is structurally absent and the status alone cannot classify. | `SHA-256` of the partial/failed canonical snapshot attempt | exactly what was read, and which structural expectation failed | Yes — no observation; **no invented outcome**. |
| `source_snapshot_changed` | **Only:** an already-persisted `settlement_observation` **plus** a **Phase B** re-read that produced a **stable** `DurableSettlementSnapshot` (digest coherent across the double-read) whose `source_digest` ≠ the immutable `source_digest` stored on that observation. | the **new** stable (conflicting) `source_digest` | old digest, new digest, both canonical snapshots | Yes — plus `observation.status → 'observed_conflicted'`. The existing observation row's source columns are untouched. |

**Not an incident — transient operational inability (no durable row of any
kind, binding not blocked, surfaced in the report, retried next sweep):**

- the source snapshot changed *during* the read → re-verify double-read window
  and stayed unstable across the bounded retry budget → `SOURCE_UNSTABLE_RETRYABLE`
  (§16.3). This proves only "a stable point-in-time source snapshot could not be
  obtained", **not** a semantic conflict;
- `SQLITE_BUSY` on the Execution write transaction across the bounded busy-retry
  budget → `EXECUTION_STORE_BUSY_RETRYABLE` (§16.1);
- any other temporary transaction-acquisition failure.

Rules for every kind:

- **Retry repeats the same incident.** A re-run that reads the same evidence hits
  the UNIQUE `(correlation_id, kind, evidence_digest)` index → treated as a
  no-op, not an error, not a second row.
- **Later conflicting evidence never overwrites.** A genuinely different evidence
  snapshot has a different `evidence_digest` → a **new** incident row. Old rows
  are retained as evidence.
- **Never disappears automatically.** No sweep clears `blocked`. There is no
  auto-resolution path in S2.
- **Never auto-resolved by inventing state** (§F.7 verbatim): `detail_json`
  contains only what was read.

### 13.1 Manual-resolution contract (workflow out of scope)

S2 does **not** ship a resolution UI or workflow. It **does** define the contract
a future operator tool must honour:

- Resolution is a single durable write: set `resolved_at` (ISO string) and
  `resolution_note` (non-empty) on the `settlement_incident` row.
- While `resolved_at IS NULL` the binding is blocked: `convergeSettlements` skips
  it in both phases.
- Once `resolved_at` is set, the **next** `convergeSettlements` pass may act on
  that binding again: Phase A if it still has no observation, Phase B otherwise.
  A still-divergent Phase B raises a **new** incident row (new pass, possibly new
  `evidence_digest`) — resolution does not suppress a real ongoing divergence.
- A resolved incident row is **never mutated back**; a recurrence is a new row.

## 14. `DurableSettlementSource` — read port + read-only adapter

**Port (application, Execution-owned):**

```
DurableSettlementSource {
  // Resolve + read in one call, entirely over a read-only shadow orchestration.db.
  readSettlement(input: {
    correlationId: string
    boundDispatchId: string
    boundRunId: string
  }): DurableSettlementRead
}

type DurableSettlementRead =
  | { kind: 'no_task' }                                   // no task carries this correlation marker
  | { kind: 'no_dispatch' }                               // task found, no dispatch row
  | { kind: 'non_terminal'; dispatchId: string }          // latest bound dispatch not terminal
  | { kind: 'foreign'; resolvedDispatchId: string; resolvedRunId: string; failedCheck: string }
  | { kind: 'unresolvable'; partial: unknown; failedExpectation: string }
  | { kind: 'terminal'; snapshot: DurableSettlementSnapshot; sourceDigest: string }
```

**Adapter (infrastructure, Execution-owned):** `ReadOnlyShadowSettlementSource`.

- Opens `shadowOrchestrationPath` with `new SyncDatabase(path,
  { readonly: true, fileMustExist: true })` — a genuine
  `SQLITE_OPEN_READONLY` handle. It **never** constructs `OrchestrationDb`.
- Issues **only** parameterised `SELECT` against `tasks`, `dispatch_contexts`,
  `attempt_observation_facts`:
  - find task: `SELECT id, run_id, status, result, completed_at, spec FROM tasks`
    then match `parseCorrelation(spec) === correlationId` (same marker key
    `orcaS1CorrelationId` as ORCA-S1's `OrcaExecutionPlane`);
  - latest dispatch:
    `SELECT id, run_id, status, completed_at FROM dispatch_contexts
     WHERE task_id = ? ORDER BY rowid DESC LIMIT 1`;
  - facts:
    `SELECT * FROM attempt_observation_facts WHERE dispatch_id = ?
     ORDER BY sequence, rowid`.
- Performs **zero** of: migration, DDL (`CREATE`/`ALTER`/`DROP`/trigger),
  `PRAGMA journal_mode` mutation, any `INSERT`/`UPDATE`/`DELETE`, `-wal`/`-shm`
  creation attributable to S2. On a read-only handle every one of these is either
  impossible or throws — the adapter must not attempt them, and the
  `sourceGuard` block of the report (§10) records the observed counts (all
  zero) for the acceptance audit.
- **WAL / sidecar note.** A `-wal`/`-shm` left by the ORCA-S1 writer is that
  writer's artifact, not S2's. The S2 restart/acceptance harness (§15, §20)
  closes / checkpoints the shadow writer **before** opening the read-only source,
  so the read sees a checkpointed main file and S2 provably creates no sidecar.
- **Terminal statuses:** `completed`, `failed`, `circuit_broken`
  (`dispatch_contexts` CHECK at the Orca base).

**Coupling classification (§25):** `EXECUTION_OWNED_SCHEMA_COUPLED_READER`. The
adapter lives under `src/main/execution/infrastructure/`; opens the **existing**
shadow orchestration SQLite database directly **read-only**; issues **SELECT-only**
over the required Orca-owned tables; makes **no Orca API / core source change**;
performs **no migration / DDL / trigger / write / journal-mode mutation**. The
table/column coupling to `tasks` / `dispatch_contexts` / `attempt_observation_facts`
at the vendored Orca base is **explicit**, and schema-drift **ratchet tests fail
loudly** if the vendored Orca schema changes (Appendix B). S2 adds **no Orca
API** and changes **no Orca core surface**. **No hook.**

## 15. Unified reconciliation state machine (§F, §S)

### 15.1 One coordinator, one ordering

There is exactly **one** application reconciliation coordinator,
`reconcileShadowExecutionState(deps, { sliceRef, now })` (new,
`src/main/execution/application/`), threaded through `runShadowObservation`
(`shadow-observation-service.ts`) where `reconcileIncompleteReservations` runs
today. It runs three phases in **strict order**, from durable state only:

1. **Converge** terminal durable Dispatches — `convergeSettlements` Phase A.
2. **Verify** already-observed bindings — `convergeSettlements` Phase B.
3. **Abandon remainder** — only *then* apply the ORCA-S1 abandonment semantics
   to reservations still incomplete (never-created / non-terminal / stale). This
   is the **modified** `reconcileIncompleteReservations`: its terminal-Dispatch
   case is no longer unconditionally abandoned — that case has already been
   handled by phase 1 and is no longer `listIncomplete` when phase 3 reads.

There is **no** independent competing S2 startup root and **no** separate
unconditional abandon pass running in parallel with convergence.
`reconcileIncompleteReservations` is **modified**, not "kept behaviourally
intact".

### 15.2 Per-binding outcomes — exactly one per condition

| Condition (durable facts) | Outcome |
| --- | --- |
| No Dispatch ever created (reservation `reserved`; source `no_task` / `no_dispatch`) | **abandon** — `run_reservation → 'abandoned'` (unchanged ORCA-S1 semantics; phase 3). |
| Latest bound Dispatch exists, **non-terminal**, before `staleAfter` | leave; retried next pass (phase 3). |
| Latest bound Dispatch exists, **non-terminal**, after `staleAfter` | `abandonShadow` + `run_reservation → 'abandoned'` (unchanged ORCA-S1 semantics — genuinely stuck; phase 3). |
| Latest bound Dispatch **terminal**, no `settlement_observation`, **stable** snapshot obtained | **converge** → `settlement_observation` once; `run_reservation → 'observed'` (phase 1 / Phase A). |
| Latest bound Dispatch **terminal**, no `settlement_observation`, but a **stable** snapshot could not be obtained within the bounded re-verify budget | **`SOURCE_UNSTABLE_RETRYABLE`** — no observation, **no incident**, no abandon, binding **not** blocked; surfaced in the report; retried next sweep (§16.3). |
| Any decision whose Execution write transaction cannot be acquired within the bounded `SQLITE_BUSY` retry budget | **`EXECUTION_STORE_BUSY_RETRYABLE`** — no durable row, no partial state, **no incident**, no abandon, binding **not** blocked; surfaced in the report; retried next sweep (§16.1). |
| Latest Dispatch for the task ≠ bound dispatch / `run_id` mismatch / marker mismatch | `foreign_dispatch` incident; binding **blocked**; no observation, no abandon. |
| Already observed, Phase B **stable** re-read, digest **==** stored | **no-op**. |
| Already observed, Phase B **stable** re-read, digest **!=** the immutable stored digest | `source_snapshot_changed` incident; `observation.status → 'observed_conflicted'` + `conflicted_at`; binding **blocked**; source columns untouched. |
| Already observed, Phase B re-read **unstable** across the bounded budget | **`SOURCE_UNSTABLE_RETRYABLE`** — no incident, no `status` mutation, no block; retried next sweep. |
| Incident-blocked binding (`settlement_incident` with `resolved_at IS NULL`) | **no automatic convergence, no abandon** — skipped in all phases. |

**No same durable stable snapshot may race into both abandon and observation.**

**Ordering guarantee (coordinator, §21):** phases 1–2 run to completion **before**
any abandon decision in phase 3. A reservation that phase 1 advanced to
`observed` is no longer in `listIncomplete` when phase 3 reads it. Convergence
has strict priority and is idempotent; abandon only ever sees what convergence
declined (never-created / non-terminal / stale). The retryable results
(`SOURCE_UNSTABLE_RETRYABLE`, `EXECUTION_STORE_BUSY_RETRYABLE`) leave the binding
exactly where it was — a still-incomplete reservation with a terminal Dispatch is
**not** abandoned on the strength of a retryable convergence failure; it waits
for the next sweep.

**Crash windows** (superset of ORCA-S1's A–F; S2's are G1–G6):

| Window | Scenario | Required behaviour |
| --- | --- | --- |
| **G1** *(the window S2 exists for)* | Orca shadow Dispatch settled **durably**; Maestro process killed **before** any `reconcileShadowExecutionState` ran. | Restart: phase 1 (Phase A) converges it — exactly one `settlement_observation`, `source_digest` + full `provenance_json`. ORCA-S1 alone would have abandoned it. |
| **G2** | Killed mid-convergence, **after** the read-only snapshot read, **before** the Execution write transaction committed. | Restart re-reads, re-verifies a **stable** digest, and writes **once**: the observation write + reservation advance are one `BEGIN IMMEDIATE` transaction (§16); a partial prior write is impossible. If the source moved meanwhile and stays unstable → `SOURCE_UNSTABLE_RETRYABLE`, no row, retried next sweep. |
| **G3** | Killed **after** the `settlement_observation` commit, **before** `run_reservation` advanced to `observed`. | Restart: Phase B recomputes the digest → **stable** `==` stored → no-op; the reservation advance is an idempotent CAS → **no** second observation. |
| **G4** | Killed **after** an incident commit, **before** anything downstream. | Restart re-detects the same evidence → same row (UNIQUE `(correlation_id, kind, evidence_digest)`); binding stays blocked. |
| **G5** | Shadow `orchestration.db` replaced by a differing copy (or Orca genuinely re-settles) so a Phase B re-read yields a **stable different** `source_digest` for an **already-observed** binding. | `source_snapshot_changed` incident + `observation.status → 'observed_conflicted'`; the existing observation's source columns are **preserved untouched**; **never** a silent re-observe, **never** a source-column rewrite. No claim about rollback *direction*. |
| **G6** | Killed during a bounded retry loop that was returning `SOURCE_UNSTABLE_RETRYABLE` or `EXECUTION_STORE_BUSY_RETRYABLE` (no transaction ever committed). | Restart finds **no** durable row, **no** incident, binding **not** blocked; the next sweep re-attempts convergence from scratch. A retryable result is never persisted. |

Harness: reuse ORCA-S1's separate-child-process SIGKILL pattern
(`shadow-run-child.mjs` — plain ESM + `node:sqlite`, durable write → READY marker
→ hang). S2's child additionally **durably settles the shadow Dispatch**
(`settleWorkerReport` against the shared durable shadow `orchestration.db`) **and
closes / checkpoints that DB** before the READY marker; the parent SIGKILLs the
child, then opens the read-only source, runs `reconcileShadowExecutionState`
(convergence phases 1–2, then abandon phase 3), and asserts convergence. Tests
are **marker-driven, never timing-driven** (HANDOFF residual).

## 16. Execution-store atomicity + cross-DB decision protocol

### 16.1 Additive transaction seam

`SqliteExecutionStore` gains one additive method:

```
withImmediateTransaction<T>(fn: () => T): T
//   BEGIN IMMEDIATE; fn(); COMMIT / ROLLBACK on throw.
//   BEGIN IMMEDIATE serialises Execution-store writers.
//   SQLITE_BUSY on acquiring the write lock is a BOUNDED retryable condition:
//   retry the acquisition a small fixed number of times (candidate: 5), then
//   give up and signal EXECUTION_STORE_BUSY_RETRYABLE to the caller.
//   Give-up leaves NO transaction open, NO partial state.
```

It wraps the shared `SyncDatabase` handle (the same handle `SqliteReservationStore`
uses). No ORCA-S1 method changes signature or behaviour.

- `BEGIN IMMEDIATE` **serialises** Execution-store writers — the design does
  **not** rely on the losing writer reaching the `settlement_observation` PK
  first. The second writer, once it acquires the lock, re-runs the §16.2
  precheck inside its own transaction, sees the winner's observation, and
  no-ops; the PK / UNIQUE constraints are a **backstop**.
- On `SQLITE_BUSY` retry-budget exhaustion the decision returns
  `EXECUTION_STORE_BUSY_RETRYABLE`: **no** `settlement_observation`, **no**
  `settlement_incident`, **no** reservation advance, **no** partial state. The
  binding is unchanged and the result is surfaced in the
  `SettlementConvergenceReport`; the next sweep retries.

### 16.2 One convergence decision = one transaction

A single Phase-A or Phase-B decision **atomically** owns, inside one
`withImmediateTransaction`:

- the incident **precheck** (is there an open `settlement_incident` for this
  binding? is there already an observation?);
- the `settlement_observation` **insert-or-no-op**;
- the `settlement_incident` **insert** (via the UNIQUE index, see below);
- the `run_reservation` / binding **state advancement** (CAS `UPDATE … WHERE
  state IN (…)`).

**Serialisation first, constraints as backstop:**

- `BEGIN IMMEDIATE` serialises writers (§16.1); the in-transaction precheck is
  the primary exactly-once mechanism.
- `settlement_observation.correlation_id` PRIMARY KEY — if, despite
  serialisation, a concurrent sweep's `INSERT` still collides, it is caught and
  treated as a **no-op** (the winner's row stands); the loser then re-reads and
  continues as a Phase B pass.
- `settlement_incident` UNIQUE `(correlation_id, kind, evidence_digest)` —
  `INSERT … ON CONFLICT DO NOTHING`; a duplicate is a no-op.
- reservation advance is `UPDATE run_reservation SET state='observed' WHERE
  correlation_id=? AND state IN ('orca_created','bound','executed','settled')` —
  0 rows changed is acceptable (already advanced / already terminal), never an
  error.

### 16.3 Read → enter-write → re-verify → commit / retry

The source DB (read-only) cannot enlist in the Execution write transaction.
Protocol:

1. Read `DurableSettlementRead` + `sourceDigest` via the port (outside any
   Execution transaction).
2. `withImmediateTransaction` (bounded `SQLITE_BUSY` retry per §16.1; on
   exhaustion → `EXECUTION_STORE_BUSY_RETRYABLE`, nothing written):
   a. Re-read the source snapshot **again** via the port; recompute
      `sourceDigest'`.
   b. If `sourceDigest' !== sourceDigest` → **ROLLBACK** and retry the whole
      convergence attempt from step 1, bounded to a small fixed number of
      attempts (candidate: **3**).
   c. Otherwise apply the §16.2 decision and **COMMIT**.
3. **Retry budget exhausted** (a stable point-in-time source snapshot could not
   be obtained — the source kept changing across the double-read window):
   - **ROLLBACK.**
   - Do **NOT** create `source_snapshot_changed`.
   - Do **NOT** create `settlement_incident` of any kind.
   - Do **NOT** block the binding.
   - Do **NOT** mutate `settlement_observation`.
   - Return the explicit retryable convergence result **`SOURCE_UNSTABLE_RETRYABLE`**,
     surfaced in the `SettlementConvergenceReport` / diagnostics (never a silent
     skip). The next sweep may try again.

   This condition means **only** "a stable point-in-time source snapshot could
   not be obtained". It does **not** prove a semantic conflict. A `Phase A`
   binding with no observation can **never** produce `source_snapshot_changed`
   from this path.

**What each layer actually guarantees:**

- The same **stable** source snapshot under concurrent sweeps converges to
  **exactly one** durable result (`BEGIN IMMEDIATE` serialisation + the
  in-transaction precheck; PK / `ON CONFLICT DO NOTHING` as backstop).
- A first observation and an incident are **never** produced from the **same**
  snapshot in the same pass: within one transaction the decision is either
  "insert observation" **or** "insert incident", never both.
- A **later stable differing** snapshot is allowed to drive
  `observed → observed_conflicted` in a **subsequent** Phase B pass (§7, §8) —
  not in the pass that first observed.

### 16.4 Exact cross-DB consistency guarantee (no distributed atomicity)

S2 spans two SQLite databases — the read-only shadow `orchestration.db` and the
Execution store — and **does not** provide a distributed transaction across
them. The achievable guarantee, stated precisely:

- the **source snapshot is point-in-time coherent** at the moment of the
  successful in-transaction re-verification (step 2a);
- the **Execution decision is atomic** inside the Execution-store
  `BEGIN IMMEDIATE` transaction;
- the source DB **may still change** after that final source read and before the
  Execution `COMMIT` — S2 **does not** pretend to close that cross-database
  window;
- every future **Phase B** pass re-reads every already-observed binding;
- any **later stable different** snapshot then becomes a `source_snapshot_changed`
  incident + `observed_conflicted`;
- the **original observation is never rewritten**.

S2 makes **no** claim that "the committed decision matches the final / current
source state", nor any equivalent cross-DB atomicity claim. The observation
records *the snapshot that was coherent at re-verification*; divergence
afterwards is detected, not prevented.

## 17. Settlement-projection rebuild + durable shadow DB lifetime

**"Execution-store wipe" is not a thing S2 defines.** The reconstructive
invariant is **settlement-projection rebuild**:

- **Scope:** drop and recreate **only** `settlement_observation` and
  `settlement_incident`. `run_binding`, `run_reservation`, `parity_observation`,
  `workload_exclusion`, `execution_meta`, and every other Execution row are
  **preserved**.
- **Replay equivalence is semantic:** after a rebuild + a fresh
  `convergeSettlements` against the **same** shadow `orchestration.db`, for every
  binding the regenerated `settlement_observation` matches the pre-rebuild one on
  `{ source_digest, orca_dispatch_id, orca_run_id, org_task_id,
  observed_outcome_json, provenance_json, status }`, and every regenerated
  `settlement_incident` matches on `{ correlation_id, kind, evidence_digest,
  detail_json, blocked }`. `observed_at`, `first_seen_at`, `conflicted_at`,
  incident `id`, and `raised_at` are **local metadata** and are **excluded** from
  the comparison. **No byte-identical-row claim.**

- **Settlement-projection rebuild preserves** `run_binding`, `run_reservation`,
  `execution_meta.shadow_orchestration_path`, and the durable shadow
  `orchestration.db` file itself. It touches **only** the two S2 projection
  tables.

**Durable shadow `orchestration.db` — one stable DB, shared across restarts:**

There is **one** durable shadow orchestration DB for this Maestro
shadow-migration environment, shared by the ORCA-S1 shadow **writer** and the
ORCA-S2 read-only **reader** across process restarts. It is the point-in-time
authority S2 converges from.

- It **MUST** live **OUTSIDE** `DisposableShadowRoot`. `DisposableShadowRoot`'s
  `cleanup()` (`rmSync` of the whole tree) **must never delete it** —
  `disposable-shadow-root.ts` stops returning / owning this path (§2, §18).
- Its canonical configured absolute path is persisted in
  `execution_meta.shadow_orchestration_path` (existing key/value table — no new
  column). `executeShadowIdentityObservationSlice` is the single place that
  reads the config, persists the binding, and constructs both the writer
  `OrchestrationDb` and the read-only `ReadOnlyShadowSettlementSource` against
  that one path.

**Startup rules:**

- **First initialization (empty brand-new environment):** no
  `shadow_orchestration_path` binding exists *and* the environment has no
  durable bindings/history → persist the configured durable path **before**
  first use, then create the DB there. This is the *only* path on which S2
  creates the shadow orchestration DB file.
- **Later startup (recovery):**
  - configured path **==** persisted path → continue;
  - configured path **!=** persisted path → **fail closed**
    `ShadowSourcePathMismatchError` — S2 does not converge against a different
    source DB than the one its projection was built from;
  - persisted path present but the **database file is missing** → **fail closed**
    `ShadowSettlementSourceMissingError` (named) — S2 does **not** silently
    create a replacement DB when durable bindings / history exist;
  - persisted path present and file present → open it (writer read-write for the
    S1 path, `ReadOnlyShadowSettlementSource` genuinely read-only for S2).
- A `:memory:` shadow DB is permitted **only** for single-process tests; any
  restart-safety or rebuild test uses a real file path outside the disposable
  root.

## 18. Side-effect ownership

**S2 owns and performs:**

- writes to `settlement_observation` (insert; and the single permitted
  `status` mutation `observed → observed_conflicted` + `conflicted_at`);
- writes to `settlement_incident` (insert only; `resolved_at` /
  `resolution_note` are the future operator tool's, §13.1);
- the `execution_meta.shadow_orchestration_path` key — first-init persist +
  restart re-verify, failing closed with `ShadowSourcePathMismatchError` /
  `ShadowSettlementSourceMissingError` (§17);
- **read-only** `SELECT`s against the shadow `orchestration.db` via the
  `DurableSettlementSource` adapter (§14);
- the new `reconcileShadowExecutionState` coordinator and the modification of
  **four** existing ORCA-S1 files at the composition / application seam (§2, §15):
  `reconcile-incomplete-reservations.ts` (terminal-Dispatch branch no longer
  unconditionally abandons), `shadow-observation-service.ts` (coordinator +
  ordering threaded through `runShadowObservation`), `disposable-shadow-root.ts`
  (no longer owns the durable convergence DB lifetime),
  `shadow-identity-observation.ts` (`executeShadowIdentityObservationSlice`
  composes the out-of-root durable DB path + writer/reader construction + the
  cleanup ownership split);
- the additive `withImmediateTransaction` seam, incl. bounded `SQLITE_BUSY`
  retry → `EXECUTION_STORE_BUSY_RETRYABLE` (§16.1);
- the v2 → v3 Execution-schema upgrade (§11.1).

None of the above is an authority transfer and none is an upstream Orca
modification — ORCA-S1's accepted authority and reconciliation semantics are
unchanged (§6, §25).

**S2 does NOT own and does NOT perform:**

- **any `parity_observation` write or column** — S2 never touches ORCA-S1 parity
  evidence, which is semantically immutable (§26 attack 11);
- **any Git operation** — no `rev-parse`, no `diff`, no worktree inspection; the
  converged outcome is source-only (§6.2);
- `candidate_head` / `base_commit` **capture** (a delegated §H act);
- any `data/app.db` write; any `finalizeRunOnce` call in any mode;
- any `agent_runs` write; any client completion-signal emission;
- process / process-tree teardown; worktree finalization (stays with ORCA-S1's
  disposable root + shadow adapter);
- `settleWorkerReport` or any `orchestration.db` write from the sweep path (the
  ORCA-S1 writer is untouched and is not on S2's sweep path);
- any `promoteReadyTasks` / `OrganizationalTask`-completion effect (§J, §K);
- introducing a hook, a coordinator process, or delegated settlement (deferred —
  §14 close, §23).

## 19. Failure semantics

| Situation | S2 behaviour |
| --- | --- |
| Reservation `reserved`, no shadow Dispatch ever created | `abandoned` — unchanged from ORCA-S1; no durable fact to converge. |
| Latest bound shadow Dispatch **non-terminal** in `orchestration.db` | Left this pass; retried; after `staleAfter` still non-terminal → `abandonShadow` + reservation `abandoned` (ORCA-S1 behaviour). |
| Latest bound shadow Dispatch **terminal** in `orchestration.db` | **Converge** → `settlement_observation` (Phase A). *(New.)* |
| Terminal, but no `DurableSettlementSnapshot` can be built (bad `tasks.result` JSON / structurally missing field) | `settlement_incident(kind='invalid_or_unresolvable_source')`; binding blocked; **no invented outcome** (§F.7). |
| Latest Dispatch for the task is not the bound one / wrong `run_id` / foreign correlation marker | `settlement_incident(kind='foreign_dispatch')`; binding blocked (§F.5). |
| Phase B **stable** re-read digest differs from the immutable stored `source_digest` (already-observed binding) | `settlement_incident(kind='source_snapshot_changed')` + `observation.status → 'observed_conflicted'`; existing observation source columns preserved (§13, G5). |
| Source snapshot kept changing across all bounded re-verify retries (Phase A **or** Phase B) | **`SOURCE_UNSTABLE_RETRYABLE`** — no observation, **no incident**, no `status` mutation, binding **not** blocked; surfaced in the report; next sweep may retry (§16.3). Proves only "no stable point-in-time snapshot", not a conflict. |
| Execution write transaction not acquired within the bounded `SQLITE_BUSY` retry budget | **`EXECUTION_STORE_BUSY_RETRYABLE`** — no durable row of any kind, no partial state, **no incident**, binding **not** blocked; surfaced in the report; next sweep may retry (§16.1). |
| Any exception during the sweep for one binding | Caught; recorded as a `sweepError` in the report; sweep continues with the next binding; `data/app.db` provably untouched (ORCA-S1 I5 inherited); authority still `AICONTROL_NATIVE`. |
| `data/app.db` missing / has a `-wal` or `-shm` sidecar at start | `DbGuardError`; S2 does not run (ORCA-S1 gate 9 inherited). |
| Configured `shadow_orchestration_path` disagrees with the persisted `execution_meta` value | `ShadowSourcePathMismatchError`; S2 does not run (§17). |
| Persisted `shadow_orchestration_path` present but the DB **file is missing** and durable bindings/history exist | `ShadowSettlementSourceMissingError`; S2 does not run and does **not** create a replacement DB (§17). |

## 20. Acceptance criteria

1. **Spec satisfied** — implementation matches this (frozen) spec; no silent
   redefinition; a real conflict → `CONTRACT_CONFLICT` → amendment.
2. **Module boundary** — no forbidden cross-module import; no Orca row type in
   `domain/` or `application/`; `settlement_observation` / `settlement_incident`
   are Execution-owned; no Governance / Delivery table read or written; **no
   `parity_observation` write anywhere in S2**.
3. **TDD / RED evidence** — for I-S2-1..5, P-S2-1..6, and each crash window
   G1–G6, a failing test captured **before** the behaviour it checks. Evidence:
   `slices/durable-settlement-observation/RED-EVIDENCE.md`.
4. **Zero authoritative writes** — call-site audit + runtime test: the whole
   slice writes nothing to `data/app.db` (SHA-256 unchanged, no sidecars).
5. **Genuinely read-only source** — a test asserts the `DurableSettlementSource`
   adapter opens the shadow `orchestration.db` with `readonly: true`; that a
   write attempt through it throws; and that across a full sweep the
   `sourceGuard` counters (§10) are all zero — **no** DDL, **no** journal-mode
   pragma mutation, **no** trigger creation, **no** metadata write, **no**
   `-wal`/`-shm` created by S2.
6. **No authority transfer** — static audit: no `finalizeRunOnce` import, no
   `agent_runs` write, no delegated side-effect call, no queue / capacity /
   scheduler / `promoteReadyTasks` touch, **no Git call**, anywhere in S2 code.
   Authority before == after == `AICONTROL_NATIVE`; Orca mode ==
   `ORCA_SHADOW_ADVISORY`.
7. **Convergence from durable state, no hook** — a test that settles a shadow
   Dispatch durably in a dedicated shadow `orchestration.db`, **discards all
   in-memory state**, constructs a fresh sweep, and proves a
   `settlement_observation` with the correct `SettlementObservedOutcome`,
   `source_digest`, and full `provenance_json` — with **no hook, no
   notification, no in-flight process, no Git**.
8. **Two-phase idempotency** — `convergeSettlements` run ×3 back-to-back
   (Phase A then Phase B each pass), and again after a **settlement-projection
   rebuild** → **semantically equivalent** `settlement_observation` set
   (§17 field list), zero duplicate rows, zero extra incidents (I-S2-1..5).
9. **Digest change → conflict, not replacement** — a test mutates the shadow
   `orchestration.db` terminal facts after an observation exists; the next Phase
   B raises exactly one `source_snapshot_changed` incident, sets
   `status = 'observed_conflicted'`, and leaves every `source_*` column and
   `observed_outcome_json` / `provenance_json` **byte-unchanged**.
10. **Restart safety** — the separate-child-process harness: the child durably
    settles the shadow Dispatch and checkpoints/closes that DB, then is
    SIGKILLed; the parent runs `reconcileShadowExecutionState` (converge phases
    1–2, abandon phase 3); asserts convergence, a single observation, correct
    `source_digest` + provenance, `data/app.db` byte-identical, authority
    `AICONTROL_NATIVE`. Windows **G1–G6 each covered**, including G6 (a kill
    during a retryable loop leaves no durable row and no block).
11. **Identity / provenance** — a wrong / stale / foreign **latest** Dispatch
    **cannot** produce an observation (produces a `foreign_dispatch` incident);
    every observation's `orca_dispatch_id` equals the bound one; every
    observation and incident has non-empty `provenance_json` / `detail_json`
    containing only durable facts; `run_binding` is never heuristically
    reconstructed.
12. **Incident, not invention** — adversarial tests induce each incident `kind`
    (`foreign_dispatch`, `invalid_or_unresolvable_source`,
    `source_snapshot_changed`); each is recorded, keyed by
    `(correlation_id, kind, evidence_digest)`, blocks its binding, is **never**
    auto-resolved, and a later differing evidence snapshot produces a **new** row
    rather than overwriting (§13). And the negative: a source that changes during
    the double-read, a `SQLITE_BUSY`, and a transaction-acquisition failure each
    produce a **retryable result and no `settlement_incident` row** (§13, §16).
13. **Atomicity / concurrency** — a **two-process / concurrent-sweep** test runs
    two convergence passes against the same stores over one binding and asserts:
    exactly one `settlement_observation` (via `BEGIN IMMEDIATE` serialisation +
    in-transaction precheck, **not** by assuming which writer hits the PK
    first), no `sweepError`, **never** a first-observation + incident pair from
    the same snapshot; and that a forced `SQLITE_BUSY` exhaustion yields
    `EXECUTION_STORE_BUSY_RETRYABLE` with no partial state and the same stable
    snapshot still converging to at most one observation on the retry (§16).
14. **Operational DB guard** — `data/app.db` SHA-256 ==
    `13E6571177CD027D618AA294B7A26DA5C07C1370123C236E1706F6F235E65178` before and
    after; no `-wal` / `-shm` residual; aiControlCenter `DB_BASELINE.json`
    unchanged.
15. **Real migration v2 → v3** — an existing ORCA-S1 (v2) store opens, keeps
    every S1 row byte-unchanged, gains **only** the two S2 tables + indexes, and
    ends with `execution_meta.schema_version == '3'`; a v2 store upgraded to v3
    and a freshly created v3 store are **structurally identical**; no S1 column
    dropped, renamed, or added.
16. **Unified reconciliation** — a test exercises every row of the §15.2 state
    machine through the single `reconcileShadowExecutionState` coordinator and
    proves: a terminal bound Dispatch with a **stable** snapshot converges (never
    abandoned); phases 1–2 (converge + verify) run to completion **before** any
    phase-3 abandon decision; there is **no** separate unconditional abandon
    pass; **no same durable stable snapshot ever reaches both `abandon` and
    `converge`**; a `SOURCE_UNSTABLE_RETRYABLE` / `EXECUTION_STORE_BUSY_RETRYABLE`
    result does **not** cause the still-incomplete reservation to be abandoned;
    and the full ORCA-S1 acceptance suite passes **byte-unchanged** against the
    same Maestro base despite the four S1 composition-seam file modifications.
17. **Durable shadow DB lifetime** — tests prove: the durable shadow
    `orchestration.db` lives outside `DisposableShadowRoot` and survives its
    `cleanup()`; first-init persists `execution_meta.shadow_orchestration_path`
    before first use; a configured-vs-persisted path mismatch fails closed with
    `ShadowSourcePathMismatchError`; a persisted path whose DB file is missing
    (with durable bindings present) fails closed with
    `ShadowSettlementSourceMissingError` and **no** replacement DB is created; a
    settlement-projection rebuild preserves `run_binding`, `run_reservation`,
    the path key, and the DB file; rollback deletes only the two S2 projection
    tables and never the durable source DB.

## 21. TDD targets

- `convergeSettlements` (application) — the two-phase fold: Phase A convergence,
  Phase B digest verification, incident classification, converge-vs-defer;
  idempotent; pure over `(Execution store state, shadow orchestration.db state,
  now)`.
- `buildDurableSettlementSnapshot` + `canonicalSerialize` + `sourceDigest`
  (domain) — the **Execution-owned** canonical serialiser (not an import of
  Orca's module-private `canonicalPayload`): stable, field-order-fixed;
  `undefined → null`; digest is `SHA-256` of the canonical form; two
  structurally-equal snapshots ⇒ equal digest; any field change ⇒ different
  digest. Plus a **compatibility / ratchet test** that pins `canonicalSerialize`
  against Orca `canonicalPayload`'s normalization semantics and fails loudly on
  drift.
- `settlementObservedOutcome` (domain) — pure map `DurableSettlementSnapshot →
  { terminalOutcome, exitDisposition, cancellation }`; `cancelled` marker →
  `cancelled` / `no_exit`; missing classifying field ⇒ throws (drives
  `invalid_or_unresolvable_source`).
- `SettlementObservationStore` (infrastructure, SQLite) — write-once PRIMARY KEY
  `correlation_id`; the **only** permitted mutation is `status
  observed → observed_conflicted` + `conflicted_at`; every `source_*` column
  immutable; provenance round-trip.
- `SettlementIncidentStore` (infrastructure, SQLite) — UNIQUE
  `(correlation_id, kind, evidence_digest)`; `ON CONFLICT DO NOTHING`;
  `blocked` flag; `detail_json` carries only observed facts; `resolved_at`
  contract (§13.1).
- `ReadOnlyShadowSettlementSource` (infrastructure) — opens `readonly: true,
  fileMustExist: true`; resolves latest dispatch for the task; equality-checks
  against the bound ids; returns the tagged `DurableSettlementRead`; issues no
  DDL / pragma / write; creates no sidecar.
- `withImmediateTransaction` (infrastructure) — `BEGIN IMMEDIATE` (serialises
  writers); commit on success; rollback on throw; **bounded `SQLITE_BUSY` retry
  on lock acquisition → `EXECUTION_STORE_BUSY_RETRYABLE` on exhaustion, no
  transaction left open, no partial state**; the read → re-verify → retry
  protocol (§16.3) with the bounded attempt count, returning
  `SOURCE_UNSTABLE_RETRYABLE` on exhaustion (no incident, no observation
  mutation). A two-process case is required (criterion 13).
- `assertObservationConverged` (domain) — throws unless provenance is complete,
  dispatch identity matches, and `observed_outcome_json` is a valid
  `SettlementObservedOutcome`.
- `reconcileShadowExecutionState` (application, **new**) — the single ordering
  authority: phase 1 `convergeSettlements` Phase A, phase 2 Phase B, phase 3 the
  modified `reconcileIncompleteReservations`. Proves phases 1–2 complete before
  phase 3; no separate abandon pass; retryable results do not trigger abandon.
- **modify** `reconcileIncompleteReservations` (`reconcile-incomplete-reservations.ts`)
  — its terminal-Dispatch case is no longer unconditionally abandoned (handled
  by phase 1); it no-ops on an already-observed / `observed_conflicted` /
  incident-blocked reservation; it still abandons never-created and
  stale-non-terminal.
- **modify** `shadow-observation-service.ts` — `runShadowObservation` calls
  `reconcileShadowExecutionState` where it called `reconcileIncompleteReservations`,
  threading the convergence / source-port dependencies.
- **modify** `disposable-shadow-root.ts` — remove ownership of the durable
  convergence DB path/lifetime; `cleanup()` must not touch the shared durable
  shadow `orchestration.db`.
- **modify** `shadow-identity-observation.ts` — `executeShadowIdentityObservationSlice`
  composes the out-of-root durable shadow DB path (config → `execution_meta`
  persist/re-verify → `ShadowSourcePathMismatchError` /
  `ShadowSettlementSourceMissingError`), constructs the writer `OrchestrationDb`
  **and** the read-only `ReadOnlyShadowSettlementSource` against that one path
  (never an `OrchestrationDb` for the reader), wires the guards, and invokes
  `reconcileShadowExecutionState`. It remains the **single** composition
  boundary — there is no separate S2 startup root.
- `migrateExecutionStore` v2 → v3 — versioned upgrade (§11.1).

## 22. Required executable evidence

- `slices/durable-settlement-observation/RED-EVIDENCE.md` (+ `-002` / `-003` if
  focused-fix passes occur).
- `durable-settlement-observation.convergence.test.ts` — the no-hook / no-Git
  convergence proof (criterion 7).
- `durable-settlement-observation.two-phase-idempotency.test.ts` — criteria 8, 9.
- `durable-settlement-observation.restart.test.ts` + `settlement-converge-child.mjs`
  — criterion 10, windows G1–G6.
- `read-only-shadow-settlement-source.test.ts` — criterion 5 (readonly open, no
  DDL/pragma/write, no sidecar, latest-dispatch resolution, foreign rejection).
- `settlement-atomicity.test.ts` — criterion 13 (two-process concurrent sweeps,
  one observation via `BEGIN IMMEDIATE` serialisation, no observation+incident
  from one snapshot, forced `SQLITE_BUSY` → `EXECUTION_STORE_BUSY_RETRYABLE` with
  no partial state).
- `settlement-source-instability.test.ts` — a source snapshot that keeps changing
  across the bounded re-verify window yields `SOURCE_UNSTABLE_RETRYABLE` with
  **no** `settlement_incident`, **no** observation mutation, binding **not**
  blocked, result surfaced in the report; a Phase A binding never produces
  `source_snapshot_changed`.
- `shadow-orchestration-db-lifetime.test.ts` — criterion 17 (out-of-root
  survival of `cleanup()`, first-init persist, `ShadowSourcePathMismatchError`,
  `ShadowSettlementSourceMissingError`, projection-rebuild preservation set).
- `settlement-incident.adversarial.test.ts` — criterion 12, each incident `kind`,
  non-overwriting `evidence_digest` key, plus the negative cases (transient
  instability / busy / acquisition failure raise **no** incident) — clearly
  labelled adversarial; never presented as observed parity evidence.
- `durable-settlement-observation.acceptance.test.ts` — the frozen end-to-end:
  the §10 sample, every binding converged from durable state, `source_digest` +
  provenance asserted, DB guard, authority unchanged, ORCA-S1 suite still green,
  **no `parity_observation` row written by S2**.
- `execution-schema.migration.test.ts` — v2 → v3 versioned upgrade; S1 rows
  preserved; only S2 tables added; `schema_version == '3'`.
- A frozen evidence bundle (JSON), analogous to ORCA-S1's `frozen-sample.ts` /
  `ShadowObservationReport`, carrying the `SettlementConvergenceReport` +
  `sourceGuard`.

## 23. Out of scope (explicit)

- Any authority transfer (`ORCA_DELEGATED` / `ORCA_AUTHORITATIVE`); any
  `data/app.db` projection of terminal state; any Governance AgentRun terminal
  write; `finalizeRunOnce` reuse or "projection-only mode" (§G item 6).
- `onDispatchSettled` / any notification hook or long-lived coordinator **OS
  process** (§F.3–F.4 make it optional; ORCA-S1 already defers it). The sweep is
  the only path; `reconcileShadowExecutionState` is an in-process application
  function invoked by the existing composition boundary, not a process.
- §H delegated side-effect ownership (teardown, worktree finalization ownership,
  execution-attempt closure, terminal-event emission, client completion signal,
  `base_commit` / `candidate_head` capture).
- **Any Git / worktree inspection** — the converged outcome is source-only; there
  is no `candidate_head`, no `files_changed`, no `missing_git_artifact` in S2.
- Governed-DAG / `OrganizationalTask` runtime / `promoteReadyTasks` (§J, §K).
- Real coding-agent-turn replay in shadow (ORCA-S1 R1 — still deferred).
- Real (non-`MockExecutor`) executor parity (ORCA-S1 R1 / R2 — deferred).
- Any write to or column on `parity_observation` — S1 parity evidence is
  semantically immutable (§18, §26 attack 11).
- Reads of the user's real / production `orchestration.db` — S2 reads only the
  **dedicated shadow** `orchestration.db` (ORCA-S1 B6), and read-only.
- The incident **resolution UI / workflow** — only its contract is defined
  (§13.1).
- The architecture-boundary enforcement tool (§P.11).
- Any Orca-core modification. The read seam is `ADDITIVE` new files under
  `src/main/execution/` only.
- Upstream Orca integration (§26).

## 24. Rollback

Advisory + additive-projection. To roll back: stop invoking
`reconcileShadowExecutionState`'s convergence phases (or revert
`shadow-observation-service.ts` to call `reconcileIncompleteReservations`
directly); drop **only** `settlement_observation` and `settlement_incident` (or
leave them — inert).

- The **durable shadow `orchestration.db` is NOT deleted** by rollback. It is
  Orca-owned durable state that ORCA-S1's writer also uses; it may be **retained
  as evidence** and removed only by an explicit later operator / governed
  cleanup procedure — never automatically.
- The `execution_meta.shadow_orchestration_path` key may be left in place (inert)
  or cleared by that same governed procedure.
- `data/app.db` and `orchestration.db` were never **written** by S2, so there is
  **no authority rollback**.
- The four ORCA-S1 composition-seam file changes
  (`reconcile-incomplete-reservations.ts`, `shadow-observation-service.ts`,
  `disposable-shadow-root.ts`, `shadow-identity-observation.ts`) are a plain
  `git revert` of the S2 change — the terminal-Dispatch branch returns to
  unconditional abandon and ORCA-S1 behaviour is restored **exactly**. This is a
  code revert, not an authority or data rollback; S1's accepted semantics were
  never changed.
- No `parity_observation` row was written, so there is nothing to clean there.
- `EXECUTION_SCHEMA_VERSION` may remain at 3 (v3 is a strict superset of v2 —
  tables only).

## 25. Upstream-coupling budget

**`EXECUTION_OWNED_SCHEMA_COUPLED_READER`.** S2 adds **no Orca API** and changes
**no Orca core surface**. The reader:

- lives under `src/main/execution/infrastructure/`;
- opens the **existing** shadow orchestration SQLite database **directly
  read-only**;
- issues **SELECT-only** over the required Orca-owned tables (`tasks`,
  `dispatch_contexts`, `attempt_observation_facts` at the vendored base);
- makes **no Orca API / core source change**;
- performs **no migration / DDL / trigger / write / journal-mode mutation**;
- has **explicit** table/column coupling, guarded by **schema-drift ratchet
  tests** that fail loudly if the vendored Orca schema changes (Appendix B);
- does **not** call any `OrchestrationDb` method and does **not** construct
  `OrchestrationDb`.

**Overall product-code coupling remains additive within Maestro — EXCEPT** the
explicit ORCA-S1 Execution-composition / application seam changes:
`reconcile-incomplete-reservations.ts`, `shadow-observation-service.ts`,
`disposable-shadow-root.ts`, `shadow-identity-observation.ts`, plus the
versioned schema-v3 bump in `execution-schema.ts` (additive DDL only) and the
additive `withImmediateTransaction` method in `sqlite-execution-store.ts`. These
are **Maestro-owned Execution files** — **not** an upstream Orca modification and
**not** an authority transfer (§6, §18). New S2-owned files: the
`DurableSettlementSource` port + `ReadOnlyShadowSettlementSource` adapter, the
`convergeSettlements` service, the `reconcileShadowExecutionState` coordinator,
the two SQLite stores.

**Zero Orca-core file changed. Zero Orca-core semantic modification. Zero
aiControlCenter file changed. No `SMALL_HOOK`.**

If, during implementation, the sweep is found to genuinely need an Orca **read
API** that does not exist at the base (e.g. "list dispatches settled since T" for
scale), that is a separate additive decision recorded as an amendment to this
spec — **not assumed here**, and still `ADDITIVE` with no upstream merge. The
baseline mechanism is a bounded per-binding read over `run_binding`.

## 26. Independent-acceptance attack surfaces

A fresh reviewer (a session distinct from the implementer) should specifically
attack:

1. **Hidden authority transfer** — does *any* S2 path write `data/app.db`, call
   `finalizeRunOnce`, mutate `agent_runs`, or emit a client completion signal?
2. **Invented state** — can any incident path be coerced into writing a
   `settlement_observation` with a fabricated outcome (§F.7,
   `invalid_or_unresolvable_source`)?
3. **Digest bypass** — can a **stable** differing Phase B snapshot cause a silent
   re-observe or a `source_*` column rewrite instead of a `source_snapshot_changed`
   incident + `observed_conflicted`?
3a. **Transient instability mis-classified as a conflict** — make the source
   snapshot change *during* the read → re-verify double-read and stay unstable
   across the retry budget. Confirm the result is `SOURCE_UNSTABLE_RETRYABLE`
   with **no** `settlement_incident`, **no** `settlement_observation` mutation,
   the binding **not** blocked, and the result surfaced in the report — not a
   `source_snapshot_changed` incident, and never on a Phase A binding (§16.3).
3b. **`SQLITE_BUSY` mis-handling** — force write-lock contention to exhaust the
   bounded busy-retry budget. Confirm `EXECUTION_STORE_BUSY_RETRYABLE` with no
   durable row, no incident, no partial state, no block; and that the design does
   **not** depend on which writer reaches the observation PK first (§16.1).
4. **Foreign-dispatch projection** — seed the shadow `orchestration.db` so the
   **latest** Dispatch for the task is bound to a *different* correlation;
   confirm S2 raises `foreign_dispatch` and writes no observation (P-S2-4).
5. **Non-idempotency** — run the sweep concurrently / repeatedly / after a
   partial write / after a settlement-projection rebuild; assert exactly-once
   observation and **semantic** (not byte) replay equivalence (I-S2-1..5).
6. **Genuinely read-only source** — can the adapter be made to issue DDL, mutate
   journal mode, create a trigger, write metadata, or leave a `-wal`/`-shm`
   attributable to S2? Is it ever a `new OrchestrationDb(...)` in disguise?
7. **Orca-type leak** — any `DispatchContextRow` / `TaskRow` / `RunRow` reaching
   `domain/` or `application/`? (The adapter returns a plain
   `DurableSettlementRead`.)
8. **Shadow / real DB confusion + durable-DB lifetime** — can S2 be pointed at
   the user's real `orchestration.db`? Is the shadow path stable,
   out-of-`DisposableShadowRoot`, and re-verified against `execution_meta` on
   restart? Does `DisposableShadowRoot.cleanup()` still reach the durable shadow
   DB? Does a missing DB file at a persisted path fail closed
   (`ShadowSettlementSourceMissingError`) rather than silently creating a
   replacement? Does rollback or a settlement-projection rebuild ever delete it
   (§17, §24)?
9. **DB guard totality** — `data/app.db` SHA-256 + sidecars asserted before and
   after, **including on every incident path and every crash-window path**.
10. **ORCA-S1 regression** — S1 acceptance suite byte-unchanged and green despite
    the four S1 composition-seam file edits; the reconcile change (abandon →
    converge for the terminal-Dispatch branch, now via
    `reconcileShadowExecutionState`) never abandons a genuinely-settled run and
    never converges a genuinely-dead one; convergence phases provably run before
    abandon; there is no separate unconditional abandon pass; S1's accepted
    authority/semantics are unchanged and no authority transfer occurs.
11. **`parity_observation` immutability** — does S2 write, alter, or add a column
    to `parity_observation` anywhere? (It must not — §18, §23.)
12. **Local metadata leaking into identity** — is `observed_at` / `first_seen_at`
    / `raised_at` / incident `id` ever part of a digest, a dedup key, or a replay
    equivalence check? (It must not be — §6, §17.)
13. **`AgentRun` vs `OrganizationalTask`** — does a `settlement_observation` ever
    carry or imply `OrganizationalTask` completion, or trigger successor work
    (§J, §K, P-S2-6)?

---

## Idempotency invariants

- **I-S2-1** — `convergeSettlements` is a pure function of `(Execution store
  state, shadow orchestration.db state, now)`. Running it N times ≡ running it
  once, for the source-derived observation set (§F.6). A retryable result
  (`SOURCE_UNSTABLE_RETRYABLE`, `EXECUTION_STORE_BUSY_RETRYABLE`) writes nothing
  durable and leaves the binding for a later pass — it does not perturb the
  fixed point.
- **I-S2-2** — `settlement_observation` is **write-once** per `correlation_id`.
  The only permitted mutation is `status: 'observed' → 'observed_conflicted'`
  (+ `conflicted_at`) driven by a Phase B **stable** digest mismatch against an
  already-persisted observation. Every `source_*` column, `observed_outcome_json`,
  and `provenance_json` are immutable. A source that is merely unstable across
  the double-read never mutates the row.
- **I-S2-3** — a **settlement-projection rebuild** (§17) + re-run against the
  same `orchestration.db` reproduces **semantically equivalent**
  `settlement_observation` rows (`source_digest`, `orca_dispatch_id`,
  `orca_run_id`, `org_task_id`, `observed_outcome_json`, `provenance_json`,
  `status`) and semantically equivalent `settlement_incident` rows
  (`correlation_id`, `kind`, `evidence_digest`, `detail_json`, `blocked`). Local
  metadata is excluded.
- **I-S2-4** — a duplicate Orca `settleWorkerReport` (Orca returns
  `duplicate: true`, same terminal status, same `tasks.result`) yields the same
  `source_digest` → **zero** additional `settlement_observation` rows.
- **I-S2-5** — concurrent `convergeSettlements` passes (two processes, same
  stores) produce at most one `settlement_observation` per binding. `BEGIN
  IMMEDIATE` serialises the writers and the second writer's in-transaction
  precheck sees the first observation and no-ops; the `correlation_id` PK is a
  backstop, not the mechanism. Never an observation + incident from one
  snapshot. A write-lock contention that exhausts the bounded busy-retry budget
  returns `EXECUTION_STORE_BUSY_RETRYABLE` with no partial state; the retry still
  converges to at most one observation (§16).

## Identity / provenance invariants

- **P-S2-1** — every `settlement_observation.orca_dispatch_id` **==** the
  `run_binding.orca_dispatch_id` for its `correlation_id`; enforced before
  insert, not assumed (§F.5, ORCA-S1 I4, §L).
- **P-S2-2** — every observation carries non-empty `provenance_json` = the full
  canonical `DurableSettlementSnapshot` + `{ resolved_dispatch_id,
  resolved_run_id, source_db_path }`. `assertObservationConverged` throws on
  incomplete provenance.
- **P-S2-3** — `run_binding` is **never** reconstructed heuristically; identity
  is resolved only through the durable `correlation_id` marker on **both** sides
  (§L).
- **P-S2-4** — a settled Dispatch whose task `spec` correlation marker matches no
  Execution `run_reservation` is **ignored** by the sweep (not S2's binding) —
  never observed; it produces an incident only when it is the *latest* Dispatch
  for a task that a *bound* correlation resolves to (`foreign_dispatch`),
  otherwise it is simply skipped.
- **P-S2-5** — `agent_runs.id` semantics unchanged: canonical control-plane
  execution id at NATIVE/SHADOW (§L). `settlement_observation` never asserts
  otherwise; it holds `aicontrol_run_ref` only as an opaque traceability string
  (carried in `provenance_json`, not a typed column here).
- **P-S2-6** — **`AgentRun` settled ≠ `OrganizationalTask` completed** (§J, §K).
  A `settlement_observation` records a shadow Dispatch settlement only. It
  carries no `OrganizationalTask` state and triggers no `promoteReadyTasks` /
  successor work.

---

## Appendix A — Predecessor facts consumed (ORCA-S1, as published at `911b6679c2`)

- **`run_reservation`** (`execution-schema.ts` v2) — `correlation_id` PK; states
  `reserved | orca_created | bound | executed | settled | observed | abandoned`;
  `state` column has **no CHECK constraint**, so S2 needs no migration to let
  `convergeSettlements` read/skip it. UNIQUE `(slice_ref,
  authoritative_run_ref, workload_id) WHERE state != 'abandoned'`.
- **`run_binding`** (`execution-schema.ts` v2) — `orca_dispatch_id` PK;
  `correlation_id` UNIQUE FK; `aicontrol_run_id` UNIQUE when present;
  `governance_agent_run_id`, `orca_run_id`, `org_task_id`, `slice_ref`,
  `base_commit`, `candidate_head`, `bound_at`. **S2 adds no column here.**
- **`parity_observation`**, **`workload_exclusion`**, **`execution_meta`** —
  ORCA-S1 tables. **S2 does not modify `parity_observation` at all.** S2 uses
  the existing `execution_meta` key/value table for
  `shadow_orchestration_path` and `schema_version`.
- **Durable correlation on both sides** — Execution `run_reservation.correlation_id`
  **and** the shadow Orca task `spec` JSON `{ orcaS1CorrelationId, sliceRef,
  workloadId }` (`OrcaExecutionPlane`, `CORRELATION_KEY = 'orcaS1CorrelationId'`).
  The S2 read adapter parses the same key.
- **`ExecutionPlane` port** (`application/execution-plane.ts`) —
  `openShadowRun`, `runShadowWorkload`, `settleShadow`, `abandonShadow`,
  `findShadowRunByCorrelation`. **S2 does not add to this port**; it introduces a
  separate `DurableSettlementSource` read port (§14). `abandonShadow` is still
  invoked by the unified state machine for the stale-non-terminal case (§15).
- **`OrcaExecutionPlane`** (`infrastructure/orca-execution-plane.ts`) — unchanged
  by S2. Its `cache: Map` is a within-call cache only, never correctness
  authority; S2 does not read it (§26 attack 7).
- **Durable shadow `OrchestrationDb`** — one stable DB for this shadow-migration
  environment, shared across restarts (§17). ORCA-S1's *writer* constructs an
  `OrchestrationDb` over it; S2's *reader* opens the **same file path** genuinely
  read-only and never constructs `OrchestrationDb`. `executeShadowIdentityObservationSlice`
  composes both against the one out-of-root path. S2 uses coordinator pane key
  namespace `tab_orca_s2_shadow:*` where it needs one.

**ORCA-S1 files S2 modifies at the Execution composition / application seam** —
no authority transfer; S1's accepted authority and reconciliation semantics are
unchanged (§2, §6, §15, §18, §25):

- **`reconcile-incomplete-reservations.ts`** (`application/`) —
  `reconcileIncompleteReservations` runs first inside `runShadowObservation` and
  **currently abandons every incomplete reservation**. S2 changes it so the
  terminal-Dispatch case is **no longer unconditionally abandoned** — it becomes
  phase 3 of `reconcileShadowExecutionState`, run only after convergence.
- **`shadow-observation-service.ts`** (`application/`) — `runShadowObservation`
  is rewired to call the new `reconcileShadowExecutionState` coordinator (which
  threads the convergence / `DurableSettlementSource` dependencies and enforces
  converge → verify-observed → abandon ordering) where it called
  `reconcileIncompleteReservations` directly.
- **`disposable-shadow-root.ts`** (`infrastructure/`) — currently owns
  `shadowOrchestrationDbPath()` under a tree that `cleanup()` `rmSync`s. S2
  removes its ownership of the **durable** convergence DB path/lifetime; the
  durable shadow `orchestration.db` lives outside this root and `cleanup()` must
  never reach it. Disposable *worktrees* stay under it, unchanged.
- **`shadow-identity-observation.ts`** (`slices/shadow-identity-observation/`) —
  `executeShadowIdentityObservationSlice` remains the **single** composition
  boundary and is extended: it resolves the durable out-of-root shadow DB path
  (config → `execution_meta.shadow_orchestration_path` persist / re-verify →
  `ShadowSourcePathMismatchError` / `ShadowSettlementSourceMissingError`),
  constructs the writer `OrchestrationDb` **and** the read-only
  `ReadOnlyShadowSettlementSource` against it, owns the cleanup split (durable DB
  not disposed with the root), and invokes `reconcileShadowExecutionState`.

- **`assertExecutionStorePathNotAlias`** (B4), **`assertNoSqliteSidecars`** +
  **`sha256File`** (gate 9), **`shadow-run-child.mjs`** (B10 separate-process
  SIGKILL harness) — all reused unchanged.

## Appendix B — Orca read seams consumed (SELECT-only, present at Maestro base)

The `ReadOnlyShadowSettlementSource` adapter reads these three tables directly
over a `readonly: true` `SyncDatabase` handle. **No `OrchestrationDb` method is
called.**

- **`tasks`** (`schema/create-graph-tables-sql.ts`) — columns used: `id`,
  `run_id`, `status` (`pending|ready|dispatched|completed|failed|blocked`),
  `spec` (JSON; carries `orcaS1CorrelationId`), `result` (nullable JSON body),
  `completed_at`.
- **`dispatch_contexts`** (same file) — columns used: `id`, `run_id`, `task_id`,
  `status` (CHECK `pending|dispatched|completed|failed|circuit_broken`; terminal
  set `completed|failed|circuit_broken`), `completed_at`. Latest row per task is
  `ORDER BY rowid DESC LIMIT 1` (mirrors Orca's own `getDispatchContext`).
- **`attempt_observation_facts`** (`db/attempt-observation-store.ts`) — Orca's
  durable per-dispatch ledger: `(dispatch_id, sequence)` UNIQUE, monotonic per
  dispatch; `ORDER BY sequence, rowid`. **Note:** at the Maestro base ORCA-S1's
  shadow settlement path (`orca-execution-plane.ts`) calls `settleWorkerReport`
  **without** an `observation` argument, so `recordAcceptedReportFact` is a
  no-op and this table is typically **empty** for S1 shadow dispatches. S2 does
  not depend on it being populated — `attemptFactsCanonical` is `[]` when there
  are none, and the digest is still well-defined. If Orca (or a future S1 change)
  starts populating it, the facts fold into the same canonical snapshot and
  digest with no S2 change.
- **Ratchet:** the adapter's own tests pin these column names; a drift at a
  future Orca base is a compile/test signal, not a silent break.
- **`worker_done`** (§J) — `worker_done → Dispatch settled → AgentRun completed`,
  **never** `worker_done → OrganizationalTask completed`. S2 honours this: a
  `settlement_observation` is a Dispatch-settlement record only.

## Appendix C — ORCA-S1 residual disposition

| Residual (source) | Disposition for S2 |
| --- | --- |
| **R1** (amendment 002 §10) — authoritative leaf executor is `MockExecutor` | **Intentionally deferred beyond S2.** S2 observes *settlement*, not execution fidelity. |
| **R2** (amendment 002 §10) — `files_changed` is `[]` for every slot | **No longer relevant to S2.** S2 reads **no** Git state and records **no** `files_changed`; the prior candidate's file-mutating sample workload and `missing_git_artifact` incident are **removed**. |
| **R3** (amendment 002 §10) — acceptance needs a resolvable aiControl checkout + `node_modules` | **Reduced by S2, otherwise hygiene.** S2's convergence proof runs against the dedicated shadow `orchestration.db` (read-only) + the Execution store; it does **not** need the aiControl native harness. Only the `data/app.db` guard needs a path (hash + sidecar check — no checkout). |
| **R4** (amendment 002 §10) — native fixture slow | **Not relevant to S2** — S2 has no native fixture. Its restart harness is a small `node:sqlite` child, fast. |
| **R2** (amendment 001 §10) — symlink/junction adversarial tests platform-gated on Windows | **Pure hygiene, carried unchanged.** S2 adds no new symlink surface. |
| **HANDOFF** — "stale inert adjudication branches / off-path `AiControlDbReader`" | **Pure hygiene debt.** Not pulled into S2. S2 touches `aicontrol-db-reader.ts` only for the guard (already used). |
| **HANDOFF** — "cancellation timing is a loud-failure flake vector" | **Relevant to S2 test robustness, not correctness.** S2's crash-window tests are **marker-driven** (durable-settle → checkpoint/close → READY marker → SIGKILL → sweep), never timing-driven. And S2 records only `cancelled` / `not_cancelled` — no `cancelled_mid_flight` distinction to flake on. |
| **ORCA-S1 §12** defers "delegated settlement; `onDispatchSettled` hook wiring; **durable reconciliation sweep** (later slices)" | The **durable reconciliation sweep** is precisely S2's mandate. `onDispatchSettled` hook wiring and delegated settlement remain deferred past S2 (§14 close, §23). |

**Recorded (not S2's job):** ORCA-S1 **R1** (real-executor parity) and the
`onDispatchSettled` hook decision should be resolved **before or within** the
`ORCA_DELEGATED` slice. **S2 explicitly does not close them.**

## Appendix D — Upstream integration

**Not required before S2 implementation.** Every Orca seam S2 reads (Appendix B)
is present and already exercised by ORCA-S1 at Maestro base
`911b6679c26d6a7ce805262b8d1755e9c0532627`. `upstream/main` is ahead of the
vendored Orca base by an amount this spec does not pin (it changes over time and
is irrelevant to S2); it is **NOT** integrated by this task or by the S2
implementation. Integrating upstream drift is a separate, explicitly reviewed
`upstream-integration` task (§P thin-fork / non-rewrite discipline). If S2
implementation discovers a genuine need for a **new Orca read API** for scale,
that is a separate additive amendment (§25) — still ADDITIVE, still no upstream
merge, and still not a change to any Orca core surface.

---

_State class: `FIX_READY_FOR_REREVIEW` (candidate — focused corrections applied,
awaiting independent re-review, then freeze)._
_Display verdict: `MAESTRO_ORCA_S2_ARCHITECTURE_FINAL_CORRECTIONS_READY_FOR_REREVIEW`._
