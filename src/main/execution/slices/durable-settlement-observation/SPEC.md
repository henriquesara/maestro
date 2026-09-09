# ORCA-S2 — Durable Settlement Observation & Convergence — CANDIDATE SLICE SPEC

> SDD artifact. **Candidate — not yet frozen, not yet independently accepted.**
> When frozen it becomes the functional authority for this slice; code will not
> silently redefine it. A real conflict is `CONTRACT_CONFLICT` → architecture
> decision → amendment, never a silent edit here.
>
> This document is self-contained: a fresh implementation session consumes it
> without reconstructing architecture from chat history.

**Normative source:** aiControlCenter `master` /
`origin/master` == `c2d404a541a1136e4471d00aa94b616e1eac3a0d`,
`docs/roadmap/phase-m-model-governance-workforce-allocation.md`, published
amendment `ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01`.
Governing sections: **F** (Reconciliation — normative semantics — *this slice's
charter*), **L** (Identidade), **P** (Architecture Style), **S** (ORCA-S1), with
**E** (absolute authority invariant), **G** (ORCA_DELEGATED terminal transition)
and **H** (delegated side-effect ownership) read as the boundary S2 **must not
cross**, and **I** (`SHADOW_EXECUTION_SAFETY_POLICY`), **J** (`worker_done`
semantics), **K** (Governed DAG) inherited unchanged. aiControlCenter is
**READ-ONLY** for this slice.

**Maestro base:** `911b6679c26d6a7ce805262b8d1755e9c0532627` (`origin/main`, the
published ORCA-S1 technical HEAD).
**Orca base:** unchanged from ORCA-S1 — `bf4e2705046cf9ef9c915929a9646da85717af07`
semantics as vendored at the Maestro base. **No upstream integration**
(`upstream/main` `e80fae0c4d4d70424d52eebe383c57b2291b9daa`, 134 commits ahead of
the Orca base, is NOT merged — see §26).
**Predecessor:** ORCA-S1 — Shadow Identity & Observation
(`src/main/execution/slices/shadow-identity-observation/`), **CLOSED / PUBLISHED**.
**Candidate branch:** `orca-s2-durable-settlement-observation`.

---

## 0. CONTRACT_CONFLICT check (published §F, §E, §G, §L)

**No conflict.** §F item 2 says reconciliation is the "projeção e convergência
desse fato no plano de governança e, **durante a migração, em data/app.db**".
S2 runs at authority stage `AICONTROL_NATIVE` / Orca mode `ORCA_SHADOW_ADVISORY`.
§E (invariante absoluta de autoridade), §G (which scopes the `data/app.db`
terminal projection to the *delegated* transition) and §L (`agent_runs.id`
remains the canonical control-plane execution id at NATIVE/SHADOW) place the
`data/app.db` projection target **outside** this stage.

Resolution — **compliance, not relaxation**: S2 implements the §F reconciliation
**mechanism and invariants** (durable-state authority, projection/convergence,
hook-optional, identity-validated projection, duplicate-is-no-op, unresolved →
incident, converge-never-invent). The projection **target** at this stage is an
Execution-owned **advisory** record (`settlement_observation`) — never
`data/app.db`, never a Governance AgentRun terminal write. The `data/app.db` /
governance projection target is deferred to the `ORCA_DELEGATED` slice under its
own frozen contract (§G item 6). Building and proving the §F engine now at SHADOW
is the prerequisite for that later slice to only swap the projection target.

---

## 1. Name / purpose

**ORCA-S2 — Durable Settlement Observation & Convergence.**

Give the Execution bounded context a **durable, idempotent, restart-safe,
provenance-carrying** record of the fact that Orca has durably settled a bound
shadow Dispatch — **converged from `orchestration.db` durable state by a
reconciliation sweep that depends on no notification, no hook, and no in-flight
process**.

ORCA-S1 recorded parity only along the synchronous happy path
(`openShadowRun → runShadowWorkload → settleShadow → recordParityObservation`, one
`try` block). A crash **after** Orca durably settled the shadow Dispatch but
**before** Maestro observed it made S1's `reconcileIncompleteReservations`
**abandon** the run (`reconcile-incomplete-reservations.ts` always settles
incomplete reservations to `abandoned`). S2 makes that window **converge**
instead: the durable settlement fact is observed and recorded exactly once, or
raised as a blocking incident — **never invented, never abandoned when Orca
genuinely settled** (§F.4–F.7).

## 2. Bounded-context owner

**Execution** (§L: "O bounded context proprietário dessa integração é Execution";
§P.3, §P.13; ORCA-S1 §2). Domain analysis: the fact being converged is a *cross-
reference between an authoritative execution identity and an Orca dispatch
identity* — §L assigns exactly that integration to Execution. Delivery /
Governance may consume a converged outcome only through a future public
application contract; they never read or write S2's tables.

S2 adds, all Execution-owned: the `settlement_observation` and
`settlement_incident` aggregates, one `ExecutionPlane` port method
(`readDurableSettlement`), the `convergeSettlements` application service, the
source-watermark column on `run_binding`, and the schema-v3 migration.

## 3. Objective (one paragraph)

For every ORCA-S1 `run_binding` whose Orca shadow Dispatch has reached a terminal
status in the dedicated shadow `orchestration.db`, S2 durably records **one**
`settlement_observation` in the Execution store that (a) carries the converged
`ExecutionOutcome` derived **only from Orca's durable terminal facts** (dispatch
terminal status, task result, `completed_at`, and Orca's own
`attempt_observation_facts`), never from an in-process `ShadowExecutionResult`;
(b) cites its exact source facts as `provenance_json` plus a monotonic
per-dispatch `source_fact_seq` **watermark**; (c) is produced by a
`convergeSettlements` sweep that is a pure, idempotent function of `(Execution
store state, shadow orchestration.db state, now)` — runnable at process start,
repeatedly, after a wipe of the Execution store, and after any crash, always
reaching the same observation set. Divergences that replay of durable facts
cannot resolve (missing Git artifact, watermark regression, conflicting terminal
outcomes, foreign/stale Dispatch) are recorded as blocking `settlement_incident`
rows and **never** auto-resolved into an observation (§F.7). Authority stays
`AICONTROL_NATIVE`; Orca stays advisory; `data/app.db` is never opened for write
and is byte-identical before and after, on every path including every incident
and every crash path.

## 4. Ubiquitous / domain language

| Term | Meaning in this slice |
| --- | --- |
| **Durable Orca settlement fact** | A shadow `dispatch_contexts` row that reached a terminal status (`completed` / `failed` / `circuit_broken`) in the dedicated shadow `orchestration.db`, together with its `tasks.result`, `completed_at`, and the ordered `attempt_observation_facts` for that dispatch. **The authority of the transition** (§F.1). Read-only to S2. |
| **Settlement observation** | A durable Execution-owned row: one converged durable Orca settlement fact for one `run_binding`. Fields §12. **Advisory.** Never a `data/app.db` write, never a Governance AgentRun terminal write. |
| **Convergence sweep** | `convergeSettlements(sliceRef, now)` — re-reads durable Orca state for every binding whose settlement is not yet observed and **idempotently** records the `settlement_observation`, or raises a `settlement_incident` (§F.4). |
| **Settlement provenance** | The exact durable facts an observation was derived from: `{ dispatch_id, source_status, source_completed_at, task_result_sha256, source_fact_seq }`. Non-empty for every observation. |
| **Source watermark (`source_fact_seq`)** | The per-`orca_dispatch_id` monotonic `attempt_observation_facts.sequence` last folded into an observation. Stored on `run_binding.source_watermark_seq`. Replay at/below the watermark with an identical outcome is a no-op; a fresh fact whose sequence is **below** the stored watermark, or whose outcome differs from the observed one, is a `watermark_regression` incident (§F.7). |
| **Settlement incident** | A divergence replay of durable facts cannot resolve (§F.7): `missing_git_artifact`, `watermark_regression`, `outcome_conflict`, `foreign_dispatch`. Recorded in `settlement_incident`, **blocks** that binding (no observation), sweep continues, report lists it. **Never auto-resolved by inventing state.** |
| **Stale / foreign Dispatch** | A Dispatch that is not `run_binding.orca_dispatch_id` for the correlation being converged, or whose `run_id` ≠ `run_binding.orca_run_id`, or whose task `spec` correlation marker matches no Execution `run_reservation`. §F.5 / §L / ORCA-S1 I4. Never projects. |
| **Converged `ExecutionOutcome`** | The ORCA-S1 `ExecutionOutcome` value object (`{ terminalOutcome, exitDisposition, cancellationBehavior, filesChanged }`) rebuilt from the durable Orca facts (dispatch terminal status + task result payload + a read-only `git` inspection of the *already-existing* disposable shadow worktree for `candidate_head` / `filesChanged`). |
| Opaque ref | `OrcaRunRef` / `OrcaDispatchRef` / `OrgTaskRef` / `AiControlRunRef` / `GovernanceAgentRunRef` / `CorrelationId` — branded strings, unchanged from ORCA-S1. No Orca row type crosses the port (§P.6). |

## 5. Authority before

`AICONTROL_NATIVE`. Orca mode `ORCA_SHADOW_ADVISORY`.
`data/app.db` is the sole correctness authority for native execution.

## 6. Authority after

`AICONTROL_NATIVE`. Orca mode `ORCA_SHADOW_ADVISORY`. **Unchanged. No transfer.**

S2 **observes**; it does not **decide**. It explicitly does **not**:

- set canonical aiControl terminal state from an Orca fact;
- invoke any delegated terminal side effect (§H);
- turn `agent_runs` into a projection;
- disable or bypass aiControl native `finalizeRunOnce`;
- transfer queue / capacity / scheduler ownership;
- claim Orca terminal state is authoritative for any production run.

If implementation discovers that a *useful* S2 genuinely requires any of the
above → **STOP** with `AUTHORITY_TRANSFER_REQUIRES_NEW_CONTRACT` and explain.
The architecture below is designed so this does not happen: observation of a
shadow fact into an advisory Execution-owned record needs no authority.

## 7. Allowed state transitions

`run_reservation` (ORCA-S1) keeps its lifecycle
(`reserved → orca_created → bound → executed → settled → observed`, plus
`abandoned`). S2 adds a **settlement fold** keyed by `correlation_id`, separate
from the reservation lifecycle:

```
binding with a terminal shadow Dispatch, no settlement_observation
    --convergeSettlements-->  settlement_observation WRITTEN (once)   [+ run_binding.source_watermark_seq set; run_reservation advances to 'observed' if still 'settled'/'executed']

binding whose reservation crashed mid-lifecycle (orca_created|bound|executed|settled)
AND whose shadow Dispatch IS terminal in orchestration.db
    --convergeSettlements-->  settlement_observation WRITTEN (once)   [replaces ORCA-S1's "abandon" for this case — CONVERGE, not abandon]

binding whose shadow Dispatch was never created (reservation 'reserved', crash window A)
    --convergeSettlements-->  reservation 'abandoned'                 [unchanged from ORCA-S1 — there is no durable fact to converge]

binding whose shadow Dispatch exists but is NON-terminal after `staleAfter`
    --convergeSettlements-->  abandonShadow + reservation 'abandoned' [unchanged from ORCA-S1 — genuinely stuck, no durable settlement]

binding with an unresolved divergence
    --convergeSettlements-->  settlement_incident WRITTEN; binding BLOCKED; NO observation

duplicate / repeated sweep pass over an already-observed binding
    --convergeSettlements-->  no-op (§F.6)

fresh higher attempt_observation_facts.sequence, SAME outcome
    --convergeSettlements-->  run_binding.source_watermark_seq bumped; observation row unchanged (idempotent)
```

- `settlement_observation.correlation_id` is **PRIMARY KEY** — at most one
  converged observation per binding.
- A binding with an open `settlement_incident` never gets a `settlement_observation`
  until the incident is adjudicated (adjudication is **out of S2 scope**; S2 only
  raises and blocks).

## 8. Forbidden state transitions

- Any write to `data/app.db` (§E, §0).
- Any write to `orchestration.db` **from the sweep path** (the sweep opens it
  read-only; ORCA-S1's writer is untouched and is not on the sweep path).
- Recording a `settlement_observation` from an in-process `ShadowExecutionResult`
  instead of the durable Orca fact (that is ORCA-S1's path; S2's observation MUST
  cite `orchestration.db` durable state — §3, P-S2-2).
- Recording a `settlement_observation` for a Dispatch that is not
  `run_binding.orca_dispatch_id` for that `correlation_id` (§F.5 / ORCA-S1 I4).
- A second, differing `settlement_observation` for the same `correlation_id`
  (§F.6).
- Converging a fact whose `source_fact_seq` is below the stored watermark **and**
  whose outcome differs → must be `watermark_regression` incident, never an
  overwrite, never a silent skip (§F.7).
- Auto-resolving a `settlement_incident` by inventing `candidate_head` / outcome /
  artifact (§F.7 — "Nunca auto-resolvidos por invenção de estado").
- Abandoning a reservation whose shadow Dispatch **has** reached terminal status
  (the ORCA-S1 behavior S2 corrects for this case).
- Any authoritative-side transition; any `finalizeRunOnce` call; any `agent_runs`
  write; any client completion-signal emission (§H is delegated-only).
- Any `promoteReadyTasks` / OrganizationalTask-completion effect (§J, §K).
- Introducing an `onDispatchSettled` hook, a coordinator process, or delegated
  settlement (deferred slices — §14, §23).
- Reading the user's real / production `orchestration.db` — S2 reads only the
  **dedicated shadow** `orchestration.db` (ORCA-S1 amendment 001 §9 / B6).

## 9. Inputs

- `executionStorePath` — the ORCA-S1 Execution-owned SQLite store, migrated to
  schema v3. `:memory:` allowed for tests. **Rejected if it aliases
  `data/app.db`** (ORCA-S1 B4 guard, reused).
- `shadowOrchestrationPath` — the **dedicated shadow** `orchestration.db`
  (ORCA-S1 B6). `:memory:` or a disposable file under the shadow root. The sweep
  opens it **read-only**.
- `aicontrolDbPath` — canonical aiControlCenter `data/app.db`. **GUARD ONLY**
  (SHA-256 + sidecar check). Never opened. Unchanged from ORCA-S1.
- `sliceRef` — `orca-s2-durable-settlement-observation`.
- `now: () => string`, `newId: (prefix) => string` — injected clock / id.
- `staleAfter` — bounded cutoff (passes or wall time) after which a still-non-
  terminal shadow Dispatch is abandoned rather than retried (ORCA-S1 behavior).
- The set of `run_binding` rows (from ORCA-S1, or from an S2-driven re-run of the
  sample — §10 note) with no `settlement_observation`.

## 10. Outputs / durable artifacts

- `settlement_observation` rows — one per converged binding (§12).
- `settlement_incident` rows — one per unresolved divergence; blocks its binding
  (§13).
- A `SettlementConvergenceReport` value:
  `{ sliceRef, scanned, observed: ObservedRef[], incidents: IncidentRef[],
     noop: number, abandoned: AbandonRef[], sweepErrors: SweepErrorRef[],
     dbGuard: { pathHashBefore, pathHashAfter, sidecarsAfter, unchanged } }`.
- **ADDITIVE only:** where ORCA-S1 wrote **no** `parity_observation` for a binding
  because the process crashed before `recordParityObservation`, S2 MAY attach the
  converged `ExecutionOutcome` to a new `parity_observation` row for that binding
  (kind marked `converged_by_s2`). Never a rewrite of an existing
  `parity_observation`.

**Frozen sample note.** S2's acceptance sample MAY reuse ORCA-S1's frozen shape
(N = 6 bindings / M = 3 profiles) or a smaller S2-specific N; the exact value is
fixed by the *frozen* version of this spec (this candidate proposes **N = 4**:
one clean `completed`, one `failed` non-zero-exit, one `cancelled`, and one
**file-mutating** synthetic workload so the `candidate_head` / `filesChanged`
provenance path and its `missing_git_artifact` incident are exercised with a real
diff — all four still `synthetic` / `repo_local_code_only` per §I). Fewer than the
required distinct bindings → `workload_exclusion` (`code:
'sample_source_unavailable'`), sample reported partial, never back-filled.

## 11. Persistence ownership

Execution-owned, **schema v3** (`EXECUTION_SCHEMA_VERSION` 2 → 3), **same**
Execution SQLite file as ORCA-S1. Changes, all **additive**:

- new table `settlement_observation` (§12);
- new table `settlement_incident` (§13);
- new nullable column `run_binding.source_watermark_seq INTEGER`;
- (optional) new nullable column `parity_observation.converged_by` for the §10
  ADDITIVE attachment.

No column of any ORCA-S1 table is dropped or renamed. `orchestration.db` is
opened **read-only**. `data/app.db` is never opened. aiControlCenter
`DB_BASELINE.json` is not touched.

```sql
CREATE TABLE IF NOT EXISTS settlement_observation (
  correlation_id        TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id      TEXT NOT NULL,          -- MUST equal run_binding.orca_dispatch_id
  slice_ref             TEXT NOT NULL,
  source_status         TEXT NOT NULL,          -- 'completed' | 'failed' | 'circuit_broken'
  source_outcome        TEXT NOT NULL,          -- Orca worker outcome: 'succeeded' | 'failed'
  source_completed_at   TEXT,                   -- Orca dispatch_contexts.completed_at
  source_task_result_sha256 TEXT NOT NULL,      -- sha256 of tasks.result body
  source_fact_seq       INTEGER NOT NULL,       -- attempt_observation_facts.sequence watermark
  observed_outcome_json TEXT NOT NULL,          -- the converged ExecutionOutcome
  provenance_json       TEXT NOT NULL,          -- full citation; non-empty
  observed_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS settlement_observation_by_slice ON settlement_observation(slice_ref);

CREATE TABLE IF NOT EXISTS settlement_incident (
  id                TEXT PRIMARY KEY,
  correlation_id    TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  orca_dispatch_id  TEXT,
  slice_ref         TEXT NOT NULL,
  kind              TEXT NOT NULL,              -- missing_git_artifact | watermark_regression | outcome_conflict | foreign_dispatch
  detail_json       TEXT NOT NULL,              -- observed facts; NO invented state
  blocked           INTEGER NOT NULL DEFAULT 1,
  raised_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS settlement_incident_unique ON settlement_incident(correlation_id, kind);
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
  reconstructed from logs (§L).
- **Source fact** — read from the shadow `orchestration.db`:
  `dispatch_contexts.status` + `completed_at`, `tasks.result`,
  `attempt_observation_facts(dispatch_id)` ordered by `sequence`.
  `provenance_json` stores the raw citation.
- **Deduplication** — PRIMARY KEY on `correlation_id`. A repeat pass that finds an
  existing observation with the **same** `source_fact_seq` and **same**
  `observed_outcome_json` → **no-op**. Same seq, different outcome → not
  reachable by a deterministic fold → `outcome_conflict` incident.
- **Monotonicity** — `source_fact_seq` only ever increases across passes. A pass
  offering a **higher** seq with an **identical** converged outcome bumps
  `run_binding.source_watermark_seq` and the observation's `source_fact_seq`;
  the outcome row is unchanged. A pass offering a **lower** seq, or a higher seq
  with a **different** outcome → `watermark_regression` incident.
- **Replay behaviour** — `convergeSettlements` is safe to run any number of times.
  After the first successful observation for a binding, further passes are no-ops
  for that binding (§F.6). Deleting the Execution store's S2 tables and re-running
  against the same `orchestration.db` reconstructs byte-identical
  `settlement_observation` rows (modulo `observed_at`) and identical incidents
  (I-S2-3).
- **Stale / wrong Dispatch rejection** — if the terminal Dispatch reachable for
  the correlation's task is not `run_binding.orca_dispatch_id`, or its `run_id` ≠
  `run_binding.orca_run_id`, S2 does **not** observe → `settlement_incident(kind =
  'foreign_dispatch')` (§F.5, ORCA-S1 I4, reuses the `run_dispatch_pair_mismatch`
  guard).
- **`observed_at` / source watermark** — `observed_at` = wall clock of the
  converging pass; `source_completed_at` = Orca's `completed_at`;
  `source_fact_seq` = the watermark. A stored watermark is **required** because
  §F.7's "orchestration.db aparenta rollback para antes de watermark já
  projetado" is otherwise undetectable.
- **Unresolved / divergent state** — any of {terminal status but
  `candidate_head` unresolvable; watermark regression with a differing outcome;
  two terminal outcomes for one dispatch; foreign dispatch} → `settlement_incident`,
  binding blocked, no observation, sweep continues, report lists it. **Never
  invented** (§F.7).

## 13. Reconciliation semantics (§F — this slice's charter)

S2 upgrades ORCA-S1's reconcile from **"abandon incomplete"** to **"converge
settled · abandon genuinely-dead · incident the unresolvable"**. §F item by item:

| §F clause | S2 realisation |
| --- | --- |
| F.1 — `orchestration.db` durable state is the authority of the transition | The sweep's only source of a settled outcome is the shadow `dispatch_contexts` terminal row + `tasks.result` + `attempt_observation_facts`. Never the in-process `ShadowExecutionResult`. |
| F.2 — reconciliation is projection/convergence, **not** execution authority | Output is an **advisory** `settlement_observation`. No `data/app.db`, no governance terminal, no authority. |
| F.3 — notification hooks are fast-path only; a hook that never fires / fires twice / throws / is lost does not change correctness | **S2 has no hook.** The sweep is the *only* path. This slice's job is to prove the hook-free path is complete, which is the precondition for any future hook to be a safe optimisation. |
| F.4 — lost hook + restart must converge through durable reconciliation; the sweep re-reads `orchestration.db` for not-yet-converged bindings and idempotently applies the projection | `convergeSettlements` at process start (and repeatedly) scans every `run_binding` with no `settlement_observation`, resolves its shadow Dispatch via the durable correlation marker, and — if terminal — writes the observation once. |
| F.5 — the projection path validates the correct identity/binding; a stale / wrong / foreign Dispatch never settles or projects the wrong run | Dispatch-equality + `run_id`-equality + correlation-marker-match checks before any write; failure → `foreign_dispatch` incident, never a projection. |
| F.6 — duplicate application is a no-op | PRIMARY KEY on `correlation_id`; identical `(source_fact_seq, outcome)` → no-op; deterministic fold. |
| F.7 — divergences unresolvable by replay of durable facts are **incidents**, recorded and blocked for adjudication, **never** auto-resolved by inventing state | `settlement_incident` table; four `kind`s; `blocked = 1`; `detail_json` holds only observed facts. |
| "reconciliation converge fatos conhecidos. Não cria fatos." | S2 writes a `settlement_observation` **iff** a durable terminal fact exists; it never fabricates one. |

- **Durable Orca state scanned:** per binding — `findShadowRunByCorrelation`
  (ORCA-S1) → shadow task + its Dispatch → `dispatch_contexts.status` +
  `completed_at`, `tasks.result`, `attempt_observation_facts(dispatch_id)`.
- **Maestro state projected/recorded:** a `settlement_observation` (converged
  `ExecutionOutcome` + provenance). **Not** a `data/app.db` row. **Not** a
  governance terminal.
- **Idempotent because:** PRIMARY KEY + `source_fact_seq` monotonic guard +
  deterministic fold from durable facts.
- **Survives hook loss because:** there is no hook; the sweep is total.
- **Survives process restart because:** `run_reservation`, `run_binding`, and the
  shadow `orchestration.db` durable settlement are all on disk (ORCA-S1). A fresh
  process runs `convergeSettlements` and converges anything settled while it was
  down. No in-memory state is authoritative (ORCA-S1's `OrcaExecutionPlane.cache`
  stays a within-call cache only).
- **Duplicate terminal observations:** Orca's `settleWorkerReport` is already
  idempotent (`{ action: 'settled', duplicate: true }`); the sweep reads status,
  so a duplicate Orca settlement yields the same `source_fact_seq` / status → S2
  no-op. Two Orca settlements with *different* outcomes for one dispatch are not
  reachable through Orca's own guards; if ever observed → `outcome_conflict`
  incident.
- **Stale / foreign Dispatch fails closed:** `foreign_dispatch` incident, binding
  blocked, no projection.
- **Conflicting durable facts → incidents, not invented state:** §F.7 verbatim.

## 14. Hook semantics

**None. S2 is `ADDITIVE`, no hook.**

Rationale: §F.3–F.4 make a notification hook **fast-path only** and require
correctness to survive hook-never / hook-twice / hook-throws / hook-lost via the
durable sweep. The task's HOOK DECISION says: *"If polling/reconciliation alone is
sufficient for S2, prefer ADDITIVE and defer the hook. Do not add a hook just
because the architecture amendment mentions one."* ORCA-S1's own §12 already
defers `onDispatchSettled` hook wiring. The sweep alone satisfies §F end to end,
and proving the hook-free path is total is the prerequisite for any future hook to
be demonstrably correctness-neutral.

**Deferred:** the `onDispatchSettled` `SMALL_HOOK` is deferred to a later slice
(earliest: an `ORCA_DELEGATED`-preparation slice), where it must be proven
correctness-neutral against the S2 sweep under: hook never fires; hook fires
twice; hook throws; process crashes immediately after Orca durable settlement.

## 15. Crash / restart semantics

**Invariant:** at any crash point, a restart + `convergeSettlements` reaches the
same `settlement_observation` set as an uninterrupted run, **or** raises the same
incidents.

Crash windows (superset of ORCA-S1's A–F):

| Window | Scenario | Required behaviour |
| --- | --- | --- |
| **G1** *(the window S2 exists for)* | Orca shadow Dispatch settled **durably**; Maestro process killed **before** any `convergeSettlements` ran. | Restart converges it: exactly one `settlement_observation`, full provenance. ORCA-S1 would have abandoned it. |
| **G2** | Killed mid-`convergeSettlements`, **after** reading the Orca fact, **before** writing the observation. | Restart re-reads and writes **once** (the write is a single INSERT under the PRIMARY KEY; a partial prior write is impossible). |
| **G3** | Killed **after** the `settlement_observation` write, **before** `run_reservation` advanced to `observed`. | Restart: observation exists → the advance is idempotent → **no** second observation. |
| **G4** | Killed **after** raising a `settlement_incident`, **before** anything downstream. | Restart re-detects the same unresolved divergence → same row (UNIQUE `(correlation_id, kind)`); binding stays blocked. |
| **G5** | `orchestration.db` restored from an **older** copy after restart, so a fact `sequence` now sits **below** the stored `source_watermark_seq`. | `watermark_regression` incident — **never** a silent re-observe, **never** an overwrite. |

Harness: reuse ORCA-S1's separate-child-process SIGKILL pattern
(`shadow-run-child.mjs` — plain ESM + `node:sqlite`, durable write → READY marker
→ hang). S2's child additionally **durably settles the shadow Dispatch**
(`settleWorkerReport` against the shadow `orchestration.db`) before the READY
marker; the parent SIGKILLs the child, then runs `convergeSettlements` and
asserts convergence. Tests are **marker-driven, never timing-driven** (HANDOFF
residual: "cancellation timing is a loud-failure flake vector").

## 16. Idempotency invariants

- **I-S2-1** — `convergeSettlements` is a pure function of `(Execution store
  state, shadow orchestration.db state, now)`. Running it N times ≡ running it
  once, for the observation set (§F.6).
- **I-S2-2** — `settlement_observation` is **write-once** per `correlation_id`.
  The only permitted mutation is a `source_fact_seq` bump when a **strictly
  higher** watermark carries an **identical** converged outcome.
- **I-S2-3** — deleting the Execution store's S2 tables and re-running
  `convergeSettlements` against the same `orchestration.db` reproduces
  byte-identical `settlement_observation` rows (modulo `observed_at`) and
  identical `settlement_incident` rows.
- **I-S2-4** — a duplicate Orca `settleWorkerReport` (Orca returns
  `duplicate: true`) produces **zero** additional `settlement_observation` rows.
- **I-S2-5** — concurrent `convergeSettlements` passes (two processes, same
  stores) produce at most one `settlement_observation` per binding (PRIMARY KEY;
  the loser's INSERT fails and is treated as a no-op, not an error).

## 17. Identity / provenance invariants

- **P-S2-1** — every `settlement_observation.orca_dispatch_id` **==** the
  `run_binding.orca_dispatch_id` for its `correlation_id`; enforced before
  insert, not assumed (§F.5, ORCA-S1 I4, §L).
- **P-S2-2** — every observation carries non-empty `provenance_json` citing
  `{ dispatch_id, source_status, source_completed_at, source_fact_seq,
  task_result_sha256 }`. `assertObservationConverged` throws on incomplete
  provenance.
- **P-S2-3** — `run_binding` is **never** reconstructed heuristically; identity
  is resolved only through the durable `correlation_id` marker on **both** sides
  (§L — "não é reconstruído heurísticamente a partir de logs").
- **P-S2-4** — a settled Dispatch whose task `spec` correlation marker matches no
  Execution `run_reservation` is **ignored** by the sweep (not S2's binding) —
  never observed, never an incident (it is simply foreign).
- **P-S2-5** — `agent_runs.id` semantics unchanged: canonical control-plane
  execution id at NATIVE/SHADOW (§L). `settlement_observation` never asserts
  otherwise; it holds `aicontrol_run_ref` only as an opaque traceability string.
- **P-S2-6** — **`AgentRun` settled ≠ `OrganizationalTask` completed** (§J, §K).
  A `settlement_observation` records a shadow Dispatch settlement only. It carries
  no `OrganizationalTask` state and triggers no `promoteReadyTasks` / successor
  work.

## 18. Side-effect ownership

**S2 owns and performs:**

- writes to `settlement_observation`, `settlement_incident`;
- the `run_binding.source_watermark_seq` column;
- (ADDITIVE only) a `converged_by_s2` `parity_observation` row **iff** ORCA-S1
  wrote none for that binding due to a crash;
- a **read-only** `git rev-parse HEAD` / `git diff --name-only base..HEAD` in the
  **already-existing** disposable shadow worktree to resolve `candidate_head` /
  `filesChanged` when the durable fact lacks them. If that worktree is gone →
  `missing_git_artifact` incident (never an invented head — §F.7, §H boundary).

**S2 does NOT own and does NOT perform** (this is §H's list — delegated-only,
**out of scope**): process / process-tree teardown; worktree *finalization*
(creation/lifecycle stays with ORCA-S1's disposable root and the shadow adapter);
`base_commit` / `candidate_head` **capture** as an authoritative act; closing an
execution-attempt identity authoritatively; emitting terminal events to
execution-plane consumers; any `data/app.db` write; any client completion signal;
any second terminal decision; any external mutating call; `finalizeRunOnce` in
any mode. The shadow Dispatch already owns its own teardown **within ORCA-S1's
disposable shadow root**; S2 only *reads* what that left behind.

## 19. Failure semantics

| Situation | S2 behaviour |
| --- | --- |
| Reservation `reserved`, no shadow Dispatch ever created (crash window A) | `abandoned` — unchanged from ORCA-S1; no durable fact to converge. |
| Shadow Dispatch exists, **non-terminal** in `orchestration.db` | Left incomplete this pass; retried next `convergeSettlements`; after `staleAfter` still non-terminal → `abandonShadow` + reservation `abandoned` (ORCA-S1 behaviour for genuinely-stuck runs). |
| Shadow Dispatch **terminal** in `orchestration.db` | **Converge** → `settlement_observation`. *(New.)* |
| Terminal, but `candidate_head` unresolvable (worktree cleaned, no durable head) | `settlement_incident(kind = 'missing_git_artifact')`; binding blocked (§F.7). |
| Fact `sequence` below stored watermark, or higher seq with a different outcome | `settlement_incident(kind = 'watermark_regression')` (§F.7). |
| Two different terminal outcomes for one dispatch | `settlement_incident(kind = 'outcome_conflict')` (§F.7). |
| Terminal Dispatch is not the bound one / wrong `run_id` / foreign correlation marker | `settlement_incident(kind = 'foreign_dispatch')` (§F.5). |
| Any exception during the sweep for one binding | Caught; recorded as a `sweepError` in the report; sweep continues with the next binding; `data/app.db` provably untouched (ORCA-S1 I5 inherited); authority still `AICONTROL_NATIVE`. |
| `data/app.db` missing / has a `-wal` or `-shm` sidecar at start | `DbGuardError`; S2 does not run (ORCA-S1 gate 9 inherited). |

## 20. Acceptance criteria

1. **Spec satisfied** — implementation matches this (frozen) spec; no silent
   redefinition; a real conflict → `CONTRACT_CONFLICT` → amendment.
2. **Module boundary** — no forbidden cross-module import; no Orca row type in
   `domain/` or `application/`; `settlement_observation` / `settlement_incident`
   are Execution-owned; no Governance / Delivery table read or written.
3. **TDD / RED evidence** — for I-S2-1..5, P-S2-1..6, and each crash window
   G1–G5, a failing test captured **before** the behaviour it checks. Evidence:
   `slices/durable-settlement-observation/RED-EVIDENCE.md`.
4. **Zero authoritative writes** — call-site audit + runtime test: the whole
   slice writes nothing to `data/app.db` (SHA-256 unchanged, no sidecars); the
   sweep opens `orchestration.db` **read-only** (no write method reachable from
   the sweep path).
5. **No authority transfer** — static audit: no `finalizeRunOnce` import, no
   `agent_runs` write, no delegated side-effect call, no queue / capacity /
   scheduler / `promoteReadyTasks` touch anywhere in S2 code. Authority
   before == after == `AICONTROL_NATIVE`; Orca mode == `ORCA_SHADOW_ADVISORY`.
6. **Convergence from durable state, no hook** — a test that settles a shadow
   Dispatch durably in a dedicated shadow `orchestration.db`, **discards all
   in-memory state**, constructs a fresh sweep, and proves a
   `settlement_observation` with the correct converged `ExecutionOutcome` and
   full provenance — with **no hook, no notification, no in-flight process**.
7. **Idempotency** — `convergeSettlements` run ×3 back-to-back, and again after an
   Execution-store-only wipe → identical `settlement_observation` set (modulo
   `observed_at`), zero duplicates, zero extra incidents (I-S2-1..5).
8. **Restart safety** — the separate-child-process harness: the child durably
   settles the shadow Dispatch, then is SIGKILLed; the parent runs
   `convergeSettlements`; asserts convergence, a single observation, correct
   provenance, `data/app.db` byte-identical, authority `AICONTROL_NATIVE`.
   Windows **G1–G5 each covered**.
9. **Identity / provenance** — a wrong / stale / foreign Dispatch **cannot**
   produce an observation (produces a `foreign_dispatch` incident); every
   observation's `orca_dispatch_id` equals the bound one; every observation has
   complete `provenance_json`; `run_binding` is never heuristically reconstructed.
10. **Incident, not invention** — adversarial tests induce each incident `kind`
    (`missing_git_artifact`, `watermark_regression`, `outcome_conflict`,
    `foreign_dispatch`); each is recorded, blocks its binding, and is **never**
    auto-resolved into a `settlement_observation` (§F.7).
11. **Duplicate Orca settlement no-op** — a second `settleWorkerReport`
    (`duplicate: true`) produces zero additional observations (I-S2-4).
12. **Operational DB guard** — `data/app.db` SHA-256 ==
    `13E6571177CD027D618AA294B7A26DA5C07C1370123C236E1706F6F235E65178` before and
    after; no `-wal` / `-shm` residual; aiControlCenter `DB_BASELINE.json`
    unchanged.
13. **Migration guard** — `EXECUTION_SCHEMA_VERSION` 2 → 3 is strictly additive;
    an existing ORCA-S1 store opens, keeps every S1 row, and gains the S2 tables /
    columns; no S1 column dropped or renamed; a v2 store and a fresh v3 store end
    structurally identical after migration.
14. **ORCA-S1 regression** — the full ORCA-S1 acceptance suite passes,
    byte-unchanged, against the same Maestro base.

## 21. TDD targets

- `convergeSettlements` (application) — the pure fold: durable facts →
  `SettlementConvergenceReport`; idempotent; incident classification;
  converge-vs-abandon decision.
- `SettlementObservationStore` (infrastructure, SQLite) — write-once, PRIMARY KEY
  `correlation_id`, watermark monotonicity, provenance round-trip.
- `SettlementIncidentStore` (infrastructure, SQLite) — UNIQUE `(correlation_id,
  kind)`, `blocked` flag, `detail_json` carries only observed facts.
- `ExecutionPlane.readDurableSettlement` + its `OrcaExecutionPlane`
  implementation — resolve a `correlationId` to
  `{ dispatchStatus, terminalOutcome, taskResultSha256, completedAt, factSeq } |
  undefined`; reject foreign dispatch; **read-only**.
- `assertObservationConverged` (domain) — throws unless provenance complete **and**
  dispatch identity matches.
- watermark-regression predicate (domain) — pure over
  `(storedSeq, storedOutcome, freshSeq, freshOutcome)`.
- reconcile composition — keep ORCA-S1's `reconcileIncompleteReservations`
  intact for its own tests; add `convergeSettlements` that runs first / alongside
  and changes only the "terminal shadow Dispatch" branch from *abandon* to
  *converge*.
- `migrateExecutionStore` v2 → v3.
- The S2 composition root (`durable-settlement-observation.ts`) — constructs the
  dedicated shadow `OrchestrationDb` (never accepts a live one), the guards, the
  read-only sweep.

## 22. Required executable evidence

- `slices/durable-settlement-observation/RED-EVIDENCE.md` (+ `-002` / `-003` if
  focused-fix passes occur).
- `durable-settlement-observation.convergence.test.ts` — the no-hook convergence
  proof (criterion 6).
- `durable-settlement-observation.idempotency.test.ts` — criterion 7.
- `durable-settlement-observation.restart.test.ts` + `settlement-converge-child.mjs`
  — criterion 8, windows G1–G5.
- `settlement-incident.adversarial.test.ts` — criterion 10, each incident `kind`
  (clearly labelled adversarial; never presented as observed parity evidence).
- `durable-settlement-observation.acceptance.test.ts` — the frozen end-to-end:
  the §10 sample, every binding converged from durable state, provenance
  asserted, DB guard, authority unchanged, ORCA-S1 suite still green.
- `execution-schema.migration.test.ts` — v2 → v3 additive; S1 rows preserved.
- A frozen evidence bundle (JSON), analogous to ORCA-S1's `frozen-sample.ts` /
  `ShadowObservationReport`.

## 23. Out of scope (explicit)

- Any authority transfer (`ORCA_DELEGATED` / `ORCA_AUTHORITATIVE`); any
  `data/app.db` projection of terminal state; any Governance AgentRun terminal
  write; `finalizeRunOnce` reuse or "projection-only mode" (§G item 6 — that is
  the `ORCA_DELEGATED` slice, with its own frozen contract and independent
  acceptance).
- `onDispatchSettled` / any notification hook or coordinator process (deferred —
  §14; §F.3–F.4 make it optional; ORCA-S1 already defers it).
- §H delegated side-effect ownership (teardown, worktree finalization ownership,
  execution-attempt closure, terminal-event emission, client completion signal).
- Governed-DAG / `OrganizationalTask` runtime / `promoteReadyTasks` at the
  organisational boundary (§J, §K) — **not** introduced "because it is planned".
- Real coding-agent-turn replay in shadow (ORCA-S1 R1 — still deferred).
- Real (non-`MockExecutor`) executor parity (ORCA-S1 R1 / R2 — deferred).
- Reads of the user's real / production `orchestration.db` — S2 reads only the
  **dedicated shadow** `orchestration.db` (ORCA-S1 B6).
- The architecture-boundary enforcement tool (§P.11).
- Any Orca-core modification beyond **ADDITIVE** new files under
  `src/main/execution/`.
- Upstream Orca integration (§26).

## 24. Rollback

Pure additive + advisory. To roll back: stop calling `convergeSettlements`; drop
`settlement_observation`, `settlement_incident`, and the
`run_binding.source_watermark_seq` column (or leave them — inert). `data/app.db`
and `orchestration.db` were never written by S2, so there is **no authority
rollback**. Any `converged_by_s2` `parity_observation` rows may be retained as
evidence or nulled. ORCA-S1 is unaffected and continues to function.
`EXECUTION_SCHEMA_VERSION` may remain at 3 (v3 is a strict superset of v2).

## 25. Upstream-coupling budget

**`ADDITIVE`.** New files only under `src/main/execution/`, plus the schema-version
bump in the Execution-owned `execution-schema.ts` (itself additive DDL). **Zero**
Orca-core file changed. **Zero** aiControlCenter file changed. The sweep reads
only Orca's existing public `OrchestrationDb` surface —
`getDispatchContextById`, `getTask`, `listTasks`, `getAttemptObservationFacts`,
the `dispatch_contexts` terminal-status lifecycle, and `settleWorkerReport`
idempotency semantics — all present and already exercised by ORCA-S1 at the
Maestro base. **No `SMALL_HOOK`.**

If, during implementation, the sweep is found to genuinely need an Orca read API
that does not exist at the base (e.g. "list dispatches settled since sequence S"
for scale), that is a `SMALL_ADDITIVE_ORCA_READ_API` decision recorded as an
amendment to this spec — **not assumed here**. The frozen baseline mechanism is
ORCA-S1's `listTasks()` + per-task dispatch lookup.

## 26. Independent-acceptance attack surfaces

A fresh reviewer (a session distinct from the implementer) should specifically
attack:

1. **Hidden authority transfer** — does *any* S2 path write `data/app.db`, call
   `finalizeRunOnce`, mutate `agent_runs`, or emit a client completion signal?
2. **Invented state** — can any incident path be coerced into writing a
   `settlement_observation` with a fabricated `candidate_head` / outcome /
   artifact (§F.7)?
3. **Watermark bypass** — can a regressed `orchestration.db` (restored from an
   older copy) cause a silent re-observe or an overwrite instead of a
   `watermark_regression` incident?
4. **Foreign-dispatch projection** — seed the dedicated shadow `orchestration.db`
   with a settled Dispatch bound to a *different* correlation; confirm S2 ignores
   it (no observation, no incident on our bindings — P-S2-4).
5. **Non-idempotency** — run the sweep concurrently / repeatedly / after a
   partial write / after an Execution-store wipe; assert exactly-once observation
   (I-S2-1..5).
6. **In-memory authority leak** — does `OrcaExecutionPlane.cache` (or any new
   `Map`) ever become the source of a `settlement_observation` instead of the
   durable fact?
7. **Orca-type leak** — any `DispatchContextRow` / `TaskRow` / `RunRow` /
   `WorkerDispatchRow` reaching `domain/` or `application/`?
8. **Shadow / real DB confusion** — can S2 be pointed at the user's real
   `orchestration.db`? The composition root must construct / enforce the
   dedicated shadow one (ORCA-S1 B6) and must not accept a caller's live handle.
9. **DB guard totality** — `data/app.db` SHA-256 + sidecars asserted before and
   after, **including on every incident path and every crash-window path**.
10. **ORCA-S1 regression** — S1 suite unchanged and green; the reconcile change
    (abandon → converge for the "terminal shadow Dispatch" branch) never abandons
    a genuinely-settled run and never converges a genuinely-dead one.
11. **`AgentRun` vs `OrganizationalTask`** — does a `settlement_observation` ever
    carry or imply `OrganizationalTask` completion, or trigger successor work
    (§J, §K, P-S2-6)?

---

## Appendix A — Predecessor facts consumed (ORCA-S1, as published at `911b6679c2`)

- **`run_reservation`** (`execution-schema.ts` v2) — `correlation_id` PK; states
  `reserved | orca_created | bound | executed | settled | observed | abandoned`;
  UNIQUE `(slice_ref, authoritative_run_ref, workload_id) WHERE state !=
  'abandoned'`. Durable pre-Dispatch intent (amendment 001 §5 / blocker B2).
- **`run_binding`** (`execution-schema.ts` v2) — `orca_dispatch_id` PK;
  `correlation_id` UNIQUE FK; `aicontrol_run_id` UNIQUE when present;
  `governance_agent_run_id`, `orca_run_id`, `org_task_id`, `slice_ref`,
  `base_commit`, `candidate_head`, `bound_at`. Shape defined by amendment §L.
- **`parity_observation`**, **`workload_exclusion`**, **`execution_meta`** —
  ORCA-S1 tables; S2 does not modify them (except the optional additive
  `converged_by` column on `parity_observation`).
- **Durable correlation on both sides** — Execution `run_reservation.correlation_id`
  **and** the shadow Orca task `spec` JSON `{ orcaS1CorrelationId, sliceRef,
  workloadId }` (`OrcaExecutionPlane`, `CORRELATION_KEY = 'orcaS1CorrelationId'`).
- **`ExecutionPlane` port** (`application/execution-plane.ts`) —
  `openShadowRun`, `runShadowWorkload`, `settleShadow`, `abandonShadow`,
  `findShadowRunByCorrelation(correlationId) -> { orcaRunRef, orcaDispatchRef,
  orgTaskRef, settled: boolean } | undefined`. **S2 adds `readDurableSettlement`.**
- **`OrcaExecutionPlane`** (`infrastructure/orca-execution-plane.ts`) — the only
  file that touches Orca row types (§P.6); `cache: Map` is a within-call cache
  only, never correctness authority (blocker B2); `requirePair` enforces
  `run_dispatch_pair_mismatch` (blocker B3 / I4).
- **Dedicated shadow `OrchestrationDb`** — the composition root constructs its own
  (`new OrchestrationDb(shadowOrchPath)`), dedicated coordinator pane key
  `tab_orca_s1_shadow:*` (S2 uses `tab_orca_s2_shadow:*`); never a live handle
  (amendment 001 §9 / blocker B6).
- **`reconcileIncompleteReservations`** (`application/`) — runs first inside
  `runShadowObservation`; **currently abandons every incomplete reservation**.
  S2's `convergeSettlements` changes only the branch where the shadow Dispatch is
  terminal.
- **`DisposableShadowRoot`**, **`assertExecutionStorePathNotAlias`** (B4),
  **`assertNoSqliteSidecars`** + **`sha256File`** (gate 9), **`shadow-run-child.mjs`**
  (B10 separate-process SIGKILL harness) — all reused.

## Appendix B — Orca settlement seams consumed (read-only, present at Maestro base)

- **`OrchestrationDb.settleWorkerReport({ taskId, dispatchId, outcome, result })`**
  (`db/dispatch-context/worker-report-settlement.ts`) — returns
  `{ action: 'settled', outcome, duplicate: boolean }` or
  `{ action: 'rejected', code, reason }` with `code ∈ { unknown_task,
  unknown_dispatch, task_dispatch_mismatch, inactive_dispatch, stale_dispatch }`.
  **Already idempotent**: a duplicate settlement on the terminal statuses returns
  `{ settled, duplicate: true }` and records an accepted-report fact. Written by
  ORCA-S1's adapter; **not on S2's sweep path** (the sweep only reads).
- **`dispatch_contexts.status` lifecycle** (`db/lifecycle-transition.ts`) —
  `pending → dispatched → { completed | failed | circuit_broken }`. Terminal
  set: `completed`, `failed`, `circuit_broken`.
- **`attempt_observation_facts`** (`db/attempt-observation-store.ts`) — Orca's own
  durable observation ledger: `(dispatch_id, sequence)` UNIQUE, monotonic per
  dispatch; `authority_id`, `authority_clock` (`'home'`), `facet`
  (`'worker_report'`), `payload` JSON, `source_observed_at` /
  `execution_received_at` / `home_received_at` multi-clock watermarks.
  `getAttemptObservationFacts(dispatchId)` → ordered by `sequence`.
  **This is the model S2's `source_fact_seq` watermark mirrors.**
- **`getDispatchContextById(id)`**, **`getDispatchContext(taskId)`**,
  **`getTask(id)`**, **`listTasks()`** — the sweep's read primitives (ORCA-S1
  already uses `listTasks()` + per-task lookup in `findShadowRunByCorrelation`).
- **`worker_done`** (§J) — `worker_done → Dispatch settled → AgentRun completed`,
  **never** `worker_done → OrganizationalTask completed`. S2 honours this: a
  `settlement_observation` is a Dispatch-settlement record only.

## Appendix C — ORCA-S1 residual disposition

| Residual (source) | Disposition for S2 |
| --- | --- |
| **R1** (amendment 002 §10) — authoritative leaf executor is `MockExecutor`, not a real CLI/LLM executor | **Intentionally deferred beyond S2.** S2 observes *settlement*, not execution fidelity. Real-executor parity is a separate later slice. **Not** required to close before `ORCA_DELEGATED` (delegation is about *who decides terminal*, not *what the executor is*) — but see the note below. |
| **R2** (amendment 002 §10) — `files_changed` is `[]` for every slot (`MockExecutor` edits nothing) | **Relevant to S2.** S2's `candidate_head` / Git-artifact provenance path and its `missing_git_artifact` incident must be exercised with a real diff, so S2's §10 sample adds **one file-mutating synthetic workload** (still `synthetic` / `repo_local_code_only` per §I — no external effect). The *authoritative* side is not required to produce diffs. |
| **R3** (amendment 002 §10) — acceptance suite needs a resolvable canonical aiControlCenter checkout + `node_modules` | **Reduced by S2, otherwise hygiene.** S2's convergence proof runs against the dedicated shadow `orchestration.db` + the Execution store; it does **not** need the aiControl native harness. Only the `data/app.db` guard needs a path (hash + sidecar check — no checkout). |
| **R4** (amendment 002 §10) — native fixture slow (`drizzle-kit push` + vitest subprocess) | **Not relevant to S2** — S2 has no native fixture. Its restart harness is a small `node:sqlite` child, fast. |
| **R2** (amendment 001 §10) — symlink/junction adversarial tests platform-gated on Windows | **Pure hygiene, carried unchanged.** S2 adds no new symlink surface; path confinement is inherited for any new worktree. |
| **HANDOFF** — "stale inert adjudication branches / off-path `AiControlDbReader`" | **Pure hygiene debt.** Not pulled into S2. S2 touches `aicontrol-db-reader.ts` only for the guard (already used). |
| **HANDOFF** — "cancellation timing is a loud-failure flake vector, not a false-acceptance risk" | **Relevant to S2 test robustness, not correctness.** S2's crash-window tests are **marker-driven** (durable-settle → READY marker → SIGKILL → sweep), never timing-driven. |
| **ORCA-S1 §12** defers "delegated settlement; `onDispatchSettled` hook wiring; **durable reconciliation sweep** (later slices)" | The **durable reconciliation sweep** is precisely S2's mandate. `onDispatchSettled` hook wiring and delegated settlement remain deferred past S2 (§14, §23). |

**Recorded (not S2's job):** ORCA-S1 **R1** (real-executor parity) and the
`onDispatchSettled` hook decision should be resolved **before or within** the
`ORCA_DELEGATED` slice — delegation makes the executor's terminal decision
authoritative and a projection-latency budget begins to matter. **S2 explicitly
does not close them.**

## Appendix D — Upstream integration

**Not required before S2 implementation.** Every Orca seam S2 reads (Appendix B)
is present and already exercised by ORCA-S1 at Maestro base
`911b6679c26d6a7ce805262b8d1755e9c0532627`. `upstream/main`
(`e80fae0c4d4d70424d52eebe383c57b2291b9daa`, 134 commits ahead of the Orca base
`bf4e2705`) contains no API S2 requires; it is **NOT** integrated by this task or
by the S2 implementation. Integrating upstream drift is a separate, explicitly
reviewed `upstream-integration` task (§P thin-fork / non-rewrite discipline). If
S2 implementation discovers a genuine need for a new Orca read API for scale, that
is a `SMALL_ADDITIVE_ORCA_READ_API` amendment (§25) — still ADDITIVE, still no
upstream merge.

---

_State class: `ARCHITECTURE_DEFINITION_READY` (candidate — awaiting freeze +
independent acceptance)._
_Display verdict: `MAESTRO_ORCA_S2_ARCHITECTURE_SDD_READY_TO_FREEZE`._
