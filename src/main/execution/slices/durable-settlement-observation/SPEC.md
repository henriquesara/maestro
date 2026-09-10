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

S2 adds, all Execution-owned:

- the `settlement_observation` and `settlement_incident` aggregates (§12, §13);
- the `DurableSettlementSource` **read port** (application) + one read-only
  infrastructure adapter over the shadow `orchestration.db` (§14);
- the `convergeSettlements` application service — the two-phase sweep (§8);
- an additive `withImmediateTransaction` seam on the Execution SQLite store
  (§16);
- the schema **v2 → v3** upgrade — **new tables only, no column added to any
  ORCA-S1 table** (§11);
- a modification to `reconcileIncompleteReservations` that replaces its
  terminal-Dispatch branch (§15).

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
`SHA-256(canonical_serialize(DurableSettlementSnapshot))`; (c) is produced by a
**two-phase** `convergeSettlements` sweep that is a pure, idempotent function of
`(Execution store state, shadow orchestration.db state, now)` — runnable at
process start, repeatedly, after a **settlement-projection rebuild**, and after
any crash, always reaching the same source-derived observation set. Divergences
that replay of durable facts cannot resolve — a foreign/unresolvable Dispatch, or
a later durable snapshot whose digest differs from the one already observed — are
recorded as blocking `settlement_incident` rows keyed by
`(correlation_id, kind, evidence_digest)` and **never** auto-resolved into or
over an observation (§F.7). Authority stays `AICONTROL_NATIVE`; Orca stays
advisory; `data/app.db` is never opened for write and is byte-identical before
and after, on every path including every incident and every crash path.

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
| **Settlement incident** | A divergence replay of durable facts cannot resolve (§F.7): `foreign_dispatch`, `source_snapshot_changed`, `invalid_or_unresolvable_source`. Recorded in `settlement_incident`, **blocks** that binding (no new observation; an existing observation row is preserved untouched), sweep continues, report lists it. **Never auto-resolved. Never overwritten by later conflicting evidence** (the key includes `evidence_digest`). |
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
  minimal JSON. (The same shape as Orca's own `canonicalPayload` in
  `attempt-observation-store.ts` — reuse it; do not invent a second canonical
  form.) `taskResultCanonical` is the parse-then-canonicalise of `tasks.result`;
  if `tasks.result` is present but not valid JSON → **not** a snapshot →
  `invalid_or_unresolvable_source` incident (§13).
- **`source_digest`** = `SHA-256(hex)` of the canonical serialisation of the whole
  `DurableSettlementSnapshot`.
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
binding with a terminal shadow Dispatch, no settlement_observation, digest D
    --convergeSettlements Phase A-->
        settlement_observation WRITTEN once (source_digest = D; status = 'observed')
        [run_reservation advances to 'observed' if still 'settled'/'executed'/'bound'/'orca_created']

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

already-observed binding, Phase B re-reads snapshot, digest == stored
    --convergeSettlements Phase B-->  no-op (§F.6)

already-observed binding, Phase B re-reads snapshot, digest != stored (digest D2)
    --convergeSettlements Phase B-->
        settlement_incident(kind='source_snapshot_changed', evidence_digest=D2); binding BLOCKED;
        settlement_observation.status: 'observed' -> 'observed_conflicted' (the ONLY permitted mutation of that row);
        all source-derived columns of the existing observation LEFT UNCHANGED
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
4. **Commit** the convergence decision atomically (§16): re-verify the snapshot
   digest inside the Execution write transaction, then
   `INSERT` the `settlement_observation` (PK `correlation_id`), advance the
   `run_reservation` to `observed` by CAS if still in
   `{orca_created, bound, executed, settled}`. A PK collision from a concurrent
   sweep is treated as a **no-op**, not an error (§16).

### Phase B — bindings **with** a `settlement_observation`

For each such binding:

1. Re-resolve and re-read the durable snapshot via the port (same identity checks
   as Phase A step 1; a Dispatch that has become foreign → `foreign_dispatch`
   incident).
2. Recompute `source_digest`.
   - **== stored `source_digest`** → **no-op**.
   - **!= stored** → atomically (§16): `INSERT` a
     `settlement_incident(kind='source_snapshot_changed', evidence_digest=<new digest>)`,
     and mutate the existing `settlement_observation` `status`
     `'observed' → 'observed_conflicted'` + set `conflicted_at`. The existing
     observation's source-derived columns are **never** rewritten. The binding is
     blocked from further convergence.
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
- `shadowOrchestrationPath` — the **dedicated shadow** `orchestration.db`. It
  **MUST live outside** the disposable shadow worktree/root, at a stable,
  configured path (§17). `:memory:` is allowed **only** for a single-process
  test; a restart-safety test requires a real file path. The
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
     dbGuard: { pathHashBefore, pathHashAfter, sidecarsAfter, unchanged },
     sourceGuard: { openedReadonly: true, ddlIssued: 0, pragmaJournalMutations: 0,
                    triggersCreated: 0, metadataWrites: 0, sidecarsCreatedByS2: 0 } }`.
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
store are **structurally identical** (criterion 13). The upgrade shape (version
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
- **Deduplication** — PRIMARY KEY on `correlation_id`. Phase B with an
  **identical** `source_digest` → **no-op**.
- **Content identity, no ordering** — a Phase B pass with a **different**
  `source_digest` → `source_snapshot_changed` incident + `status`
  `'observed' → 'observed_conflicted'`. S2 makes **no** claim about which
  snapshot is newer; there is **no** watermark, **no** regression direction, **no**
  monotonic sequence.
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

Exactly three kinds, each with a deterministic trigger backed by durable facts:

| `kind` | Deterministic trigger (durable facts only) | `evidence_digest` | Durable evidence in `detail_json` | Blocks convergence? |
| --- | --- | --- | --- | --- |
| `foreign_dispatch` | The **latest** Dispatch for the correlation's task is not `run_binding.orca_dispatch_id`, **or** its `run_id` ≠ `run_binding.orca_run_id`, **or** the resolving task's `spec` marker matches no Execution `run_reservation`. (§F.5, ORCA-S1 I4.) | `SHA-256(resolved_dispatch_id ‖ resolved_run_id ‖ correlationId)` | resolved dispatch id + run id, the bound ids, which check failed | Yes — no observation for this binding. |
| `source_snapshot_changed` | A **Phase B** re-read produces a `DurableSettlementSnapshot` whose `source_digest` ≠ the `source_digest` stored on the existing `settlement_observation`. | the **new** (conflicting) `source_digest` | old digest, new digest, both canonical snapshots | Yes — plus `observation.status → 'observed_conflicted'`. The existing observation row's source columns are untouched. |
| `invalid_or_unresolvable_source` | The bound Dispatch is terminal but a `DurableSettlementSnapshot` cannot be built: `tasks.result` present but not valid JSON; or a field required for `SettlementObservedOutcome` (§6.2) is structurally absent and the status alone cannot classify. | `SHA-256` of the partial/failed canonical snapshot attempt | exactly what was read, and which structural expectation failed | Yes — no observation; **no invented outcome**. |

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

**Coupling classification (§25):** `SMALL_ADDITIVE_ORCA_READ_API` /
**schema-coupled read seam**. New files under `src/main/execution/infrastructure/`
only. **Zero Orca-core semantic modification.** The seam is coupled to the column
names of `tasks` / `dispatch_contexts` / `attempt_observation_facts` at the
vendored Orca base; a drift in those three tables is a maintenance signal
(Appendix B ratchet note). **No hook.**

## 15. Unified reconciliation state machine (§F, §S)

**`reconcileIncompleteReservations` is modified, not "kept behaviourally
intact".** Its terminal-Dispatch branch is replaced by a delegation to
`convergeSettlements`. There is exactly **one** authoritative reconciliation
state machine, evaluated per binding/reservation from durable state only:

| Condition (durable facts) | Outcome |
| --- | --- |
| No Dispatch ever created (reservation `reserved`; source `no_task` / `no_dispatch`) | **abandon** — `run_reservation → 'abandoned'` (unchanged from ORCA-S1). |
| Latest bound Dispatch exists, **non-terminal**, before `staleAfter` | leave; retried next pass. |
| Latest bound Dispatch exists, **non-terminal**, after `staleAfter` | `abandonShadow` + `run_reservation → 'abandoned'` (unchanged from ORCA-S1 — genuinely stuck). |
| Latest bound Dispatch is **terminal**, no `settlement_observation` | **converge** → `settlement_observation` once; `run_reservation → 'observed'` (Phase A). |
| Latest Dispatch for the task ≠ bound dispatch / `run_id` mismatch / marker mismatch | `foreign_dispatch` incident; binding **blocked**; no observation, no abandon. |
| Already observed, Phase B digest **==** stored | **no-op**. |
| Already observed, Phase B digest **!=** stored | `source_snapshot_changed` incident; `observation.status → 'observed_conflicted'`; binding **blocked**. |
| Incident-blocked binding (`settlement_incident` with `resolved_at IS NULL`) | **no automatic convergence, no abandon** — skipped in both phases. |

**Ordering guarantee (composition root, §21):** `convergeSettlements` (Phase A +
Phase B) runs to completion **before** any abandon decision in
`reconcileIncompleteReservations`. A reservation that Phase A advanced to
`observed` is therefore no longer in `listIncomplete` when the abandon pass
reads it. **The same durable source facts can never race to both `abandon` and
`converge`** — convergence has strict priority and is idempotent; abandon only
sees what convergence declined (never-created / non-terminal / stale).

**Crash windows** (superset of ORCA-S1's A–F; S2's are G1–G5):

| Window | Scenario | Required behaviour |
| --- | --- | --- |
| **G1** *(the window S2 exists for)* | Orca shadow Dispatch settled **durably**; Maestro process killed **before** any `convergeSettlements` ran. | Restart: Phase A converges it — exactly one `settlement_observation`, `source_digest` + full `provenance_json`. ORCA-S1 alone would have abandoned it. |
| **G2** | Killed mid-`convergeSettlements`, **after** the read-only snapshot read, **before** the Execution write transaction committed. | Restart re-reads and writes **once**: the observation write + reservation advance are one `BEGIN IMMEDIATE` transaction (§16); a partial prior write is impossible. |
| **G3** | Killed **after** the `settlement_observation` commit, **before** `run_reservation` advanced to `observed`. | Restart: Phase B recomputes the digest → `==` stored → no-op; the reservation advance is an idempotent CAS → **no** second observation. |
| **G4** | Killed **after** an incident commit, **before** anything downstream. | Restart re-detects the same evidence → same row (UNIQUE `(correlation_id, kind, evidence_digest)`); binding stays blocked. |
| **G5** | Shadow `orchestration.db` replaced by a differing copy (or Orca genuinely re-settles) so a Phase B re-read yields a **different** `source_digest`. | `source_snapshot_changed` incident + `observation.status → 'observed_conflicted'`; the existing observation's source columns are **preserved untouched**; **never** a silent re-observe, **never** a source-column rewrite. No claim about rollback *direction*. |

Harness: reuse ORCA-S1's separate-child-process SIGKILL pattern
(`shadow-run-child.mjs` — plain ESM + `node:sqlite`, durable write → READY marker
→ hang). S2's child additionally **durably settles the shadow Dispatch**
(`settleWorkerReport` against the shadow `orchestration.db`) **and closes /
checkpoints that DB** before the READY marker; the parent SIGKILLs the child,
then opens the read-only source, runs `convergeSettlements`, and asserts
convergence. Tests are **marker-driven, never timing-driven** (HANDOFF residual).

## 16. Execution-store atomicity + cross-DB decision protocol

### 16.1 Additive transaction seam

`SqliteExecutionStore` gains one additive method:

```
withImmediateTransaction<T>(fn: () => T): T   // BEGIN IMMEDIATE; fn(); COMMIT / ROLLBACK on throw
```

It wraps the shared `SyncDatabase` handle (the same handle `SqliteReservationStore`
uses). No ORCA-S1 method changes signature or behaviour.

### 16.2 One convergence decision = one transaction

A single Phase-A or Phase-B decision **atomically** owns, inside one
`withImmediateTransaction`:

- the incident **precheck** (is there an open `settlement_incident` for this
  binding? is there already an observation?);
- the `settlement_observation` **insert-or-no-op**;
- the `settlement_incident` **insert** (via the UNIQUE index, see below);
- the `run_reservation` / binding **state advancement** (CAS `UPDATE … WHERE
  state IN (…)`).

**Constraints are the authority, not exception handling:**

- `settlement_observation.correlation_id` PRIMARY KEY — a concurrent sweep's
  losing `INSERT` is caught and treated as a **no-op** (the winner's row stands);
  the loser then re-reads and continues as a Phase B pass.
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
2. `withImmediateTransaction`:
   a. Re-read the source snapshot **again** via the port; recompute
      `sourceDigest'`.
   b. If `sourceDigest' !== sourceDigest` → **ROLLBACK** and retry from step 1,
      bounded to a small fixed number of attempts (candidate: **3**).
   c. Otherwise apply the §16.2 decision and **COMMIT**.
3. Retries exhausted (the source kept changing under us) → record a
   `source_snapshot_changed` incident with the **latest** observed digest as
   `evidence_digest`; do **not** write an observation this pass.

**Guarantees:**

- The same source snapshot under concurrent sweeps converges to **exactly one**
  durable result (PK + `ON CONFLICT DO NOTHING`).
- A first observation and an incident are **never** produced from the **same**
  snapshot in the same pass: within one transaction the decision is either
  "insert observation" **or** "insert incident", never both; the re-verify step
  (2a) guarantees the committed decision matches a single coherent snapshot.
- A **later** differing snapshot is allowed to drive
  `observed → observed_conflicted` in a **subsequent** Phase B pass (§7, §8).

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

**Durable shadow `orchestration.db` lifetime / path model:**

- The shadow `orchestration.db` used for convergence **MUST** live **outside**
  the `DisposableShadowRoot` (whose `cleanup()` `rmSync`s the whole tree). It has
  a **stable, configured** path supplied to the S2 composition root.
- On first run the composition root persists that absolute path in the existing
  `execution_meta` table under key `shadow_orchestration_path`. On any later run
  (including after a process restart) it **reads that key back**:
  - key absent → persist the supplied path;
  - key present and **==** supplied path → proceed;
  - key present and **!=** supplied path → **fail closed**
    (`ShadowSourcePathMismatchError`) — S2 does not silently converge against a
    different source DB than the one its projection was built from.
- A `:memory:` shadow DB is permitted **only** for single-process tests; any
  restart-safety or rebuild test uses a real file path outside the disposable
  root.

## 18. Side-effect ownership

**S2 owns and performs:**

- writes to `settlement_observation` (insert; and the single permitted
  `status` mutation `observed → observed_conflicted` + `conflicted_at`);
- writes to `settlement_incident` (insert only; `resolved_at` /
  `resolution_note` are the future operator tool's, §13.1);
- the `execution_meta.shadow_orchestration_path` key (§17);
- **read-only** `SELECT`s against the shadow `orchestration.db` via the
  `DurableSettlementSource` adapter (§14);
- the modification of `reconcileIncompleteReservations`'s terminal branch (§15);
- the additive `withImmediateTransaction` seam (§16.1);
- the v2 → v3 Execution-schema upgrade (§11.1).

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
| Phase B re-read digest differs from the stored `source_digest` | `settlement_incident(kind='source_snapshot_changed')` + `observation.status → 'observed_conflicted'`; existing observation source columns preserved (§13, G5). |
| Source DB kept changing across all bounded re-verify retries | `source_snapshot_changed` incident with the latest digest; no observation this pass (§16.3). |
| Any exception during the sweep for one binding | Caught; recorded as a `sweepError` in the report; sweep continues with the next binding; `data/app.db` provably untouched (ORCA-S1 I5 inherited); authority still `AICONTROL_NATIVE`. |
| `data/app.db` missing / has a `-wal` or `-shm` sidecar at start | `DbGuardError`; S2 does not run (ORCA-S1 gate 9 inherited). |
| `shadow_orchestration_path` disagrees with the persisted `execution_meta` value | `ShadowSourcePathMismatchError`; S2 does not run (§17). |

## 20. Acceptance criteria

1. **Spec satisfied** — implementation matches this (frozen) spec; no silent
   redefinition; a real conflict → `CONTRACT_CONFLICT` → amendment.
2. **Module boundary** — no forbidden cross-module import; no Orca row type in
   `domain/` or `application/`; `settlement_observation` / `settlement_incident`
   are Execution-owned; no Governance / Delivery table read or written; **no
   `parity_observation` write anywhere in S2**.
3. **TDD / RED evidence** — for I-S2-1..5, P-S2-1..6, and each crash window
   G1–G5, a failing test captured **before** the behaviour it checks. Evidence:
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
    SIGKILLed; the parent runs `convergeSettlements`; asserts convergence, a
    single observation, correct `source_digest` + provenance, `data/app.db`
    byte-identical, authority `AICONTROL_NATIVE`. Windows **G1–G5 each covered**.
11. **Identity / provenance** — a wrong / stale / foreign **latest** Dispatch
    **cannot** produce an observation (produces a `foreign_dispatch` incident);
    every observation's `orca_dispatch_id` equals the bound one; every
    observation and incident has non-empty `provenance_json` / `detail_json`
    containing only durable facts; `run_binding` is never heuristically
    reconstructed.
12. **Incident, not invention** — adversarial tests induce each incident `kind`
    (`foreign_dispatch`, `source_snapshot_changed`,
    `invalid_or_unresolvable_source`); each is recorded, keyed by
    `(correlation_id, kind, evidence_digest)`, blocks its binding, is **never**
    auto-resolved, and a later differing evidence snapshot produces a **new** row
    rather than overwriting (§13).
13. **Atomicity / concurrency** — a test runs two `convergeSettlements` passes
    concurrently against the same stores over one binding and asserts exactly one
    `settlement_observation`, no `sweepError`, and **never** a
    first-observation + incident pair from the same snapshot (§16).
14. **Operational DB guard** — `data/app.db` SHA-256 ==
    `13E6571177CD027D618AA294B7A26DA5C07C1370123C236E1706F6F235E65178` before and
    after; no `-wal` / `-shm` residual; aiControlCenter `DB_BASELINE.json`
    unchanged.
15. **Real migration v2 → v3** — an existing ORCA-S1 (v2) store opens, keeps
    every S1 row byte-unchanged, gains **only** the two S2 tables + indexes, and
    ends with `execution_meta.schema_version == '3'`; a v2 store upgraded to v3
    and a freshly created v3 store are **structurally identical**; no S1 column
    dropped, renamed, or added.
16. **Unified reconciliation** — a test exercises every row of the §15 state
    machine and proves: a terminal bound Dispatch converges (never abandoned);
    convergence runs before any abandon decision; the same durable facts never
    reach both `abandon` and `converge`; the full ORCA-S1 acceptance suite passes
    **byte-unchanged** against the same Maestro base.

## 21. TDD targets

- `convergeSettlements` (application) — the two-phase fold: Phase A convergence,
  Phase B digest verification, incident classification, converge-vs-defer;
  idempotent; pure over `(Execution store state, shadow orchestration.db state,
  now)`.
- `buildDurableSettlementSnapshot` + `sourceDigest` (domain) — canonical
  serialisation is stable and field-order-fixed; `undefined → null`; digest is
  `SHA-256` of the canonical form; two structurally-equal snapshots ⇒ equal
  digest; any field change ⇒ different digest.
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
- `withImmediateTransaction` (infrastructure) — `BEGIN IMMEDIATE`; commit on
  success; rollback on throw; the read→verify→retry protocol (§16.3) with the
  bounded attempt count.
- `assertObservationConverged` (domain) — throws unless provenance is complete,
  dispatch identity matches, and `observed_outcome_json` is a valid
  `SettlementObservedOutcome`.
- reconcile composition — **modify** `reconcileIncompleteReservations`: its
  terminal-Dispatch branch delegates to `convergeSettlements`; it no-ops on an
  already-observed / `observed_conflicted` / incident-blocked reservation; it
  still abandons never-created and stale-non-terminal.
- `migrateExecutionStore` v2 → v3 — versioned upgrade (§11.1).
- The S2 composition root (`durable-settlement-observation.ts`) — supplies the
  stable out-of-root shadow DB path, persists/rediscovers it via
  `execution_meta`, constructs the read-only source (never an `OrchestrationDb`),
  the guards, and runs convergence **before** abandon.

## 22. Required executable evidence

- `slices/durable-settlement-observation/RED-EVIDENCE.md` (+ `-002` / `-003` if
  focused-fix passes occur).
- `durable-settlement-observation.convergence.test.ts` — the no-hook / no-Git
  convergence proof (criterion 7).
- `durable-settlement-observation.two-phase-idempotency.test.ts` — criteria 8, 9.
- `durable-settlement-observation.restart.test.ts` + `settlement-converge-child.mjs`
  — criterion 10, windows G1–G5.
- `read-only-shadow-settlement-source.test.ts` — criterion 5 (readonly open, no
  DDL/pragma/write, no sidecar, latest-dispatch resolution, foreign rejection).
- `settlement-atomicity.test.ts` — criterion 13 (concurrent sweeps, one
  observation, no observation+incident from one snapshot).
- `settlement-incident.adversarial.test.ts` — criterion 12, each incident `kind`,
  non-overwriting `evidence_digest` key (clearly labelled adversarial; never
  presented as observed parity evidence).
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
- `onDispatchSettled` / any notification hook or coordinator process (§F.3–F.4
  make it optional; ORCA-S1 already defers it). The sweep is the only path.
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

Pure additive + advisory. To roll back: stop calling `convergeSettlements`; drop
`settlement_observation`, `settlement_incident`, and the
`execution_meta.shadow_orchestration_path` key (or leave them — inert).
`data/app.db` and `orchestration.db` were never written by S2, so there is **no
authority rollback**. ORCA-S1 is unaffected — its `reconcileIncompleteReservations`
change is a strict superset (terminal-Dispatch branch now converges instead of
abandons); reverting it restores the ORCA-S1 behaviour exactly. No
`parity_observation` row was written, so there is nothing to clean there.
`EXECUTION_SCHEMA_VERSION` may remain at 3 (v3 is a strict superset of v2 —
tables only).

## 25. Upstream-coupling budget

**`SMALL_ADDITIVE_ORCA_READ_API` / schema-coupled read seam.** New files only
under `src/main/execution/` — the `DurableSettlementSource` port + its
`ReadOnlyShadowSettlementSource` adapter, the `convergeSettlements` service, the
two SQLite stores, the `withImmediateTransaction` seam — plus the versioned
schema-v3 bump in the Execution-owned `execution-schema.ts` (additive DDL only)
and the modification of the Execution-owned `reconcile-incomplete-reservations.ts`
terminal branch. **Zero Orca-core file changed. Zero Orca-core semantic
modification. Zero aiControlCenter file changed. No `SMALL_HOOK`.**

The read seam issues plain `SELECT` against three Orca tables at the vendored
base — `tasks`, `dispatch_contexts`, `attempt_observation_facts` — and depends on
their column names there. It does **not** call any `OrchestrationDb` method and
does **not** construct `OrchestrationDb`. A drift in those three tables' columns
is a maintenance signal caught by the adapter's own tests (Appendix B).

If, during implementation, the sweep is found to genuinely need an Orca read API
that does not exist at the base (e.g. "list dispatches settled since T" for
scale), that is a further `SMALL_ADDITIVE_ORCA_READ_API` decision recorded as an
amendment to this spec — **not assumed here**. The frozen baseline mechanism is a
bounded per-binding read over `run_binding`.

## 26. Independent-acceptance attack surfaces

A fresh reviewer (a session distinct from the implementer) should specifically
attack:

1. **Hidden authority transfer** — does *any* S2 path write `data/app.db`, call
   `finalizeRunOnce`, mutate `agent_runs`, or emit a client completion signal?
2. **Invented state** — can any incident path be coerced into writing a
   `settlement_observation` with a fabricated outcome (§F.7,
   `invalid_or_unresolvable_source`)?
3. **Digest bypass** — can a differing Phase B snapshot cause a silent re-observe
   or a `source_*` column rewrite instead of a `source_snapshot_changed`
   incident + `observed_conflicted`?
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
8. **Shadow / real DB confusion** — can S2 be pointed at the user's real
   `orchestration.db`? Is the shadow path stable, out-of-disposable-root, and
   re-verified against `execution_meta` on restart (§17)?
9. **DB guard totality** — `data/app.db` SHA-256 + sidecars asserted before and
   after, **including on every incident path and every crash-window path**.
10. **ORCA-S1 regression** — S1 suite byte-unchanged and green; the reconcile
    change (abandon → converge for the terminal-Dispatch branch) never abandons a
    genuinely-settled run and never converges a genuinely-dead one; convergence
    provably runs before abandon.
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
  once, for the source-derived observation set (§F.6).
- **I-S2-2** — `settlement_observation` is **write-once** per `correlation_id`.
  The only permitted mutation is `status: 'observed' → 'observed_conflicted'`
  (+ `conflicted_at`) driven by a Phase B digest mismatch. Every `source_*`
  column, `observed_outcome_json`, and `provenance_json` are immutable.
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
  stores) produce at most one `settlement_observation` per binding (PK; the
  loser's INSERT is a no-op) and never an observation + incident from one
  snapshot (§16).

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
- **Dedicated shadow `OrchestrationDb`** — ORCA-S1's composition root constructs
  its own for the shadow *writer*. S2's *reader* opens the **same file path**
  read-only and never constructs `OrchestrationDb`. S2 uses coordinator pane key
  namespace `tab_orca_s2_shadow:*` where it needs one.
- **`reconcileIncompleteReservations`** (`application/`) — runs first inside
  `runShadowObservation`; **currently abandons every incomplete reservation**.
  **S2 modifies its terminal-Dispatch branch to converge** (§15) — this is the
  one ORCA-S1 application file S2 changes.
- **`DisposableShadowRoot`** — reused for shadow *worktrees*. **The shadow
  `orchestration.db` S2 converges against must NOT live under this root** (§17);
  its `cleanup()` `rmSync`s the tree.
- **`assertExecutionStorePathNotAlias`** (B4), **`assertNoSqliteSidecars`** +
  **`sha256File`** (gate 9), **`shadow-run-child.mjs`** (B10 separate-process
  SIGKILL harness) — all reused.

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
implementation discovers a genuine need for a new Orca read API for scale, that
is a `SMALL_ADDITIVE_ORCA_READ_API` amendment (§25) — still ADDITIVE, still no
upstream merge.

---

_State class: `FIX_READY_FOR_REREVIEW` (candidate — corrections applied, awaiting
independent re-review, then freeze)._
_Display verdict: `MAESTRO_ORCA_S2_ARCHITECTURE_CORRECTED_READY_FOR_REREVIEW`._
