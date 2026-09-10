# ORCA-S3 — Durable Worktree Provenance & Convergence — CANDIDATE SLICE SPEC

> SDD artifact. **Candidate — not frozen, not independently accepted, not
> published.** Produced by an architecture-definition task. No code, schema,
> migration, test, dependency, or skill is changed by producing this document.
> When frozen it becomes the functional authority for the slice; code will not
> silently redefine it. A real conflict is `CONTRACT_CONFLICT` → architecture
> decision → amendment, never a silent edit here.
>
> This document is self-contained: a fresh implementation session consumes it
> without reconstructing architecture from chat history.

**State class:** `ARCHITECTURE_DEFINITION_READY`.
**Display verdict:** `MAESTRO_NEXT_MIGRATION_SLICE_ARCHITECTURE_SDD_READY_TO_REVIEW`.

---

## Artifact identity

| Field | Value |
| --- | --- |
| Proposed slice | **ORCA-S3 — Durable Worktree Provenance & Convergence** |
| Bounded context owner | **Execution** |
| Migration authority ladder stage (before) | `AICONTROL_NATIVE` |
| Migration authority ladder stage (after) | `AICONTROL_NATIVE` — **unchanged** |
| Orca mode (before → after) | `ORCA_SHADOW_ADVISORY` → `ORCA_SHADOW_ADVISORY` — **unchanged** |
| Authority transfer | **None.** Does not stop with `AUTHORITY_TRANSFER_REQUIRES_NEW_CONTRACT`. |
| Orca coupling classification | `EXECUTION_OWNED_SCHEMA_COUPLED_READER` + read-only Git plumbing. **No Orca core hook/API change.** |
| Candidate branch (not created) | `orca-s3-durable-worktree-provenance` |
| Maestro base / HEAD | `8eca5ddefc26a85d7589071ef720e891f2936779` (`origin/main` == ORCA-S2 published technical HEAD; ancestry verified, no drift) |
| Orca base | unchanged from ORCA-S1/S2 as vendored at the Maestro base (`bf4e2705046cf9ef9c915929a9646da85717af07` semantics). **No upstream integration.** |
| Predecessor | ORCA-S2 — Durable Settlement Observation & Convergence (`src/main/execution/slices/durable-settlement-observation/`), **CLOSED / PUBLISHED** |
| Candidate SPEC path | `src/main/execution/slices/durable-worktree-provenance/SPEC.md` |

**Normative source:** aiControlCenter amendment
`ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01` — governing
sections **§H** (delegated execution side-effect ownership — *primary*), **§G**
(`ORCA_DELEGATED` terminal-transition semantics), **§F** (reconciliation —
projection/convergence), **§L** (Identidade — `run_binding`, `base_commit`,
`candidate_head`), **§E** (absolute single-authority invariant), **§I**
(`SHADOW_EXECUTION_SAFETY_POLICY`), **§P** (architecture style). aiControlCenter
`master` (`c2d404a541a1136e4471d00aa94b616e1eac3a0d`) is **READ-ONLY** for this
slice.

---

## 0. `CONTRACT_CONFLICT` check (published §H, §G, §F, §E, §L)

**No conflict.** §H opens *"Para toda run cuja transição running→terminal tenha
sido delegada"* — its delegated-side-effect ownership rules (process teardown,
worktree finalization, `base_commit` / `candidate_head` capture,
execution-attempt identity closure, terminal-event emission) are written for the
`ORCA_DELEGATED` stage where Orca **owns** the terminal transition. At S3's stage
(`AICONTROL_NATIVE` / `ORCA_SHADOW_ADVISORY`) the authority matrix keeps
*Execution / settlement authority* with aiControl and Orca **advisory**. S3 does
**not** claim Orca owns any side effect and performs **no** side effect itself.

What S3 does is **pre-implement the durable capture-and-convergence engine for
the artifact half of the §H boundary** — real `base_commit`, real
`candidate_head`, the files-changed set — with the capture **target** being an
Execution-owned **advisory** record, never `data/app.db`, never a Governance
`AgentRun` write, never `parity_observation`. This mirrors ORCA-S2 §0:
*compliance, not relaxation.* Building and proving the §H artifact-provenance
convergence now, at SHADOW, against an advisory target is a prerequisite for the
later `ORCA_DELEGATED` slice (under its own frozen contract, §G item 6, §H) to
**swap the projection target** rather than invent capture logic at cutover time.
Nothing in this slice advances an authority stage.

---

## 1. Name / purpose

**ORCA-S3 — Durable Worktree Provenance & Convergence.**

Give the Execution bounded context a **durable, idempotent, restart-safe,
provenance-carrying** record of the **Git/worktree side-effect artifacts** a bound
shadow Dispatch produced — its real `base_commit`, its real `candidate_head`, and
its files-changed set — **converged from durable state by a sweep that depends on
no notification, no hook, and no in-flight process**, exactly as ORCA-S2
converges settlement facts.

### The gap being closed

ORCA-S1 captured `candidate_head` **only** along the synchronous happy path
(`OrcaExecutionPlane.settleShadow` → `git rev-parse HEAD` on the disposable
worktree → `store.setBindingCandidateHead(...)`). ORCA-S2 — by deliberate design
(§6.2, §18, §23) — made its converged `SettlementObservedOutcome` **source-only**:
on the crash-then-converge path it records `candidate_head: null`, reads **no**
Git state, and derives **no** files-changed set. So the artifact provenance is
**lost precisely when durability matters** — after a crash between Orca's durable
settle and Maestro's observation, which is the entire reason ORCA-S2 exists.

`run_binding.candidate_head` (nullable) is therefore **null on the durable path**
today; `run_binding.base_commit` (NOT NULL) is populated only at bind time from
ORCA-S1's *seeded disposable* worktree, not re-verified against the Dispatch's
real settled worktree. ORCA-S2 also **regressed** the parity `files_changed`
dimension that ORCA-S1 gate 8 compared (S2 reads no Git). §H names `base_commit`
/ `candidate_head` capture and worktree finalization as delegated acts the
`ORCA_DELEGATED` slice must *"enumerar e provar"*; §G's terminal projection into
`data/app.db` needs `candidate_head` as a durably-converged fact. S3 makes that
fact exist, converged and advisory, before delegation is considered.

## 2. Bounded-context owner

**Execution** (amendment §L: *"O bounded context proprietário dessa integração é
Execution"*; §P.3, §P.13; ORCA-S1 §2, ORCA-S2 §2). The facts being converged are
a cross-reference between an Orca dispatch identity and the Git artifacts of its
execution — §L assigns exactly that integration to Execution. Delivery /
Governance may consume a converged provenance only through a future public
application contract; they never read or write S3's tables.

S3 adds, all Execution-owned (new files):

- the `worktree_provenance` aggregate (§7) and its SQLite store;
- a `DurableWorktreeSource` **read port** (application) + one read-only
  infrastructure adapter over the shadow worktree (Git plumbing only) (§9);
- the `convergeWorktreeProvenance` application service — a two-phase sweep
  modelled on ORCA-S2's `convergeSettlements` (§8);
- an Execution-owned durable `dispatch_worktree` binding row so the worktree
  path is recoverable after restart (§7.2);
- the schema **v3 → v4** upgrade — **new tables + one nullable column only** (§7).

S3 also **modifies these existing ORCA-S1/S2 Execution files** at the
composition / application seam (no authority transfer):

- `application/reconcile-shadow-execution-state.ts` — the coordinator gains a
  **phase 2.5**: `convergeWorktreeProvenance`, run after settlement convergence
  (ORCA-S2 phases 1–2) and **before** abandon-remainder (ORCA-S2 phase 3).
- `application/shadow-observation-service.ts` — threads the worktree-source and
  provenance-store dependencies through `runShadowObservation`.
- `infrastructure/disposable-shadow-root.ts` — shadow **worktree retention** is
  extended so a settled worktree survives until its provenance is converged
  (bounded, Execution-owned — analogous to ORCA-S2 removing the durable
  `orchestration.db` from this root). Disposable worktrees whose provenance is
  already converged (or permanently `unresolved`) are still reaped.
- `slices/shadow-identity-observation/shadow-identity-observation.ts` — the
  single composition boundary constructs the worktree source + provenance store
  and passes them to the coordinator.
- `infrastructure/orca-execution-plane.ts` — `reconcileByCorrelation` currently
  returns `worktreeDir: ''` (within-call state discarded). S3 makes the
  dispatch→worktree-path mapping **durable** via the new `dispatch_worktree`
  row written at open time; the reconcile path reads it back. No Orca call added.

ORCA-S1's and ORCA-S2's **accepted authority and reconciliation semantics remain
valid and unchanged**; there is **no** authority transfer.

## 3. Objective (one paragraph)

For every `run_binding` whose Orca shadow Dispatch ORCA-S2 has durably observed as
**settled**, S3 durably records **one** `worktree_provenance` row in the Execution
store that (a) carries the **real** `base_commit` and `candidate_head` of that
Dispatch's worktree and the canonical ordered files-changed set, derived **only**
from durable Git state of the worktree bound to that exact dispatch — never from
an in-process result object, never fabricated; (b) cites its exact source
(`worktree_path_ref`, resolved commits, `git` command transcript hashes) as
`provenance_json` and pins a content `provenance_digest`; (c) is written
**exactly once** per `correlation_id`, converges from durable state with **no
hook / no notification / no in-flight process**, and is **idempotent** under
repeat, concurrency, restart, and projection-rebuild; (d) raises a **blocking
`settlement_incident`** — never a fabricated commit — when the worktree is gone,
is not attributable to the bound dispatch, or a stable re-read disagrees with an
already-recorded provenance; and (e) re-enables the ORCA-S1 gate-8
`files_changed` parity comparison on the durable path, every divergence
root-caused. No `data/app.db` write, no `finalizeRunOnce`, no `agent_runs` write,
no `parity_observation` mutation, no Orca-core change; authority stays
`AICONTROL_NATIVE`.

## 4. Ubiquitous / domain language

| Term | Meaning in this slice |
| --- | --- |
| Settled Dispatch | A bound shadow Dispatch that ORCA-S2 recorded as `settlement_observation.status ∈ {observed, observed_conflicted}`. S3 only ever acts on these. |
| Worktree provenance | `{ baseCommit, candidateHead, filesChanged, provenanceSource, provenanceDigest }` for one settled Dispatch. Advisory. |
| `provenanceSource` | `converged_from_worktree` \| `synchronous_capture` \| `unresolved`. Records *how* the fact was obtained; part of the row, never invented. |
| `DurableWorktreeSource` | Execution-owned read port: resolves a dispatch's durable worktree path and reads `base_commit` / `HEAD` / `base..HEAD` name-only diff over a **read-only Git handle** — plumbing commands only. |
| `dispatch_worktree` | Execution-owned durable row `(orca_dispatch_id → worktree_path, root_ref, opened_at)`. The only reason it exists: make the path recoverable after a restart. |
| Provenance sweep | `convergeWorktreeProvenance` — the two-phase scan (A: record new; B: re-verify recorded) analogous to ORCA-S2's `convergeSettlements`. |
| Provenance incident | A `settlement_incident` (ORCA-S2 table, reused) with an S3 `kind`: `worktree_missing`, `worktree_dispatch_mismatch`, `provenance_snapshot_changed`. |
| Opaque ref | `OrcaDispatchRef` / `OrcaRunRef` — branded strings. No Orca row type crosses the port (§P.6). |

## 5. Inputs / outputs

**Inputs (all read-only):**

- Execution store: `run_binding`, `run_reservation`, `settlement_observation`
  (ORCA-S2), the new `dispatch_worktree`.
- The dedicated **shadow** worktree on disk for the bound dispatch (Git plumbing
  reads only).
- `now()` clock; a bounded retry budget (spec constant, §11).

**Outputs (all Execution-owned, advisory):**

- `worktree_provenance` rows (write-once per `correlation_id`).
- `run_binding.candidate_head` populated on the durable path (the latent column).
- `settlement_incident` rows for the three S3 `kind`s (blocking, non-fabricating).
- A `WorktreeProvenanceReport` + frozen evidence bundle (JSON), analogous to
  ORCA-S2's `settlement-evidence-bundle.json`.
- A parity re-comparison result for the `files_changed` dimension (reported;
  persisted only into an S3-owned column/table, never `parity_observation`).

## 6. Allowed / forbidden state transitions

**Allowed:**

- `run_binding.candidate_head: NULL → <sha>` — once, on the durable path, from a
  verified worktree HEAD for the bound dispatch.
- `worktree_provenance: (absent) → status='recorded'` — Phase A, once per
  `correlation_id`.
- `worktree_provenance.status: 'recorded' → 'conflicted'` (+ `conflicted_at`) —
  Phase B, on a **stable** re-read `provenance_digest` mismatch. Every
  `base_commit` / `candidate_head` / `files_changed_json` / `provenance_json`
  column is **immutable** after Phase A.
- `dispatch_worktree: (absent) → present` — at shadow-run open time.

**Forbidden:**

- Any `run_binding.candidate_head` **overwrite** once non-null.
- Any `worktree_provenance` artifact-column mutation after Phase A.
- Writing a `base_commit` / `candidate_head` that was not read from a real Git
  object of the bound dispatch's worktree (no reconstruction from logs, no
  "empty tree" placeholder, no copy from a sibling binding).
- Any write to `data/app.db`, `agent_runs`, `parity_observation`; any
  `finalizeRunOnce` call in any mode; any client completion-signal emission.
- Any worktree mutation: no `checkout`, `reset`, `commit`, `fetch`, `gc`,
  `config` write, branch/ref update — plumbing **reads** only.
- Any teardown / process-tree kill / worktree *finalization ownership* /
  execution-attempt identity closure / terminal-event emission (§H lifecycle
  family — out of scope, §13).
- Any `promoteReadyTasks` / `OrganizationalTask` completion effect (§J, §K).

## 7. Durable model (Execution-owned, schema v3 → v4 — additive only)

### 7.1 `worktree_provenance`

```
worktree_provenance (
  correlation_id      TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id    TEXT NOT NULL,
  orca_run_id         TEXT NOT NULL,
  slice_ref           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'recorded',   -- recorded | conflicted
  base_commit         TEXT NOT NULL,
  candidate_head      TEXT NOT NULL,
  files_changed_json  TEXT NOT NULL,                      -- canonical ordered set
  provenance_source   TEXT NOT NULL,                      -- converged_from_worktree | synchronous_capture | unresolved
  worktree_path_ref   TEXT NOT NULL,
  provenance_digest   TEXT NOT NULL,                      -- content digest; excludes local metadata
  first_seen_at       TEXT NOT NULL,
  observed_at         TEXT NOT NULL,
  conflicted_at       TEXT
)
```

- `provenance_source = 'unresolved'` rows carry sentinel empty
  `base_commit`/`candidate_head` **only** alongside a raised incident and
  `blocked = 1`; they are never treated as a usable fact and never satisfy
  acceptance gate 7. (Alternative for the freeze review: model `unresolved` as
  *incident-only, no row* — mirrors ORCA-S2 §F.7 "converge never invents". This
  spec's baseline is incident + `blocked` row for queryability; the reviewer
  chooses.)

### 7.2 `dispatch_worktree`

```
dispatch_worktree (
  orca_dispatch_id TEXT PRIMARY KEY,
  worktree_path    TEXT NOT NULL,
  root_ref         TEXT NOT NULL,     -- which DisposableShadowRoot generation
  opened_at        TEXT NOT NULL,
  reaped_at        TEXT               -- set when the disposable worktree is finally removed
)
```

### 7.3 `settlement_incident` (ORCA-S2 table — reused, new `kind` values only)

`worktree_missing` · `worktree_dispatch_mismatch` · `provenance_snapshot_changed`.
Unchanged: `(correlation_id, kind, evidence_digest)` UNIQUE; `blocked` default 1;
non-overwriting `evidence_digest`; contract-only resolution (ORCA-S2 §13.1).

### 7.4 `run_binding`

One nullable column already exists (`candidate_head`) — **no DDL**; S3 only
starts populating it on the durable path. `base_commit` stays NOT NULL and
unchanged; S3 records the *verified* base separately on `worktree_provenance` and
raises `worktree_dispatch_mismatch` if the verified base disagrees with the bound
value.

## 8. Convergence design (two-phase, from durable state — mirrors ORCA-S2 §8)

**Phase A — record.** For each `run_binding` with an ORCA-S2
`settlement_observation` and **no** `worktree_provenance`:

1. Resolve the durable worktree path via `dispatch_worktree` (never heuristically
   from logs — §P-S3-3).
2. Through `DurableWorktreeSource` (read-only Git handle):
   `git rev-parse HEAD`, `git rev-parse <bound base>^{commit}`,
   `git diff --name-only <base>..HEAD` — **double-read** and re-verify, exactly
   like ORCA-S2's snapshot re-verify.
3. Assert the worktree HEAD's dispatch attribution (§P-S3-3): the worktree path's
   `root_ref` + `dispatch_worktree.orca_dispatch_id` **==**
   `run_binding.orca_dispatch_id` for this `correlation_id`.
4. Build the canonical `WorktreeProvenanceSnapshot`, compute `provenance_digest`
   (content only — no `observed_at`, no incident id, no path absolute prefix).
5. In a single `withImmediateTransaction` (ORCA-S2 seam, reused): insert
   `worktree_provenance` (`status='recorded'`, `provenance_source='converged_from_worktree'`)
   **and** `UPDATE run_binding SET candidate_head = ? WHERE orca_dispatch_id = ? AND candidate_head IS NULL`.

**Phase B — re-verify.** For each existing `worktree_provenance` with
`status='recorded'`: re-read the worktree, recompute `provenance_digest`.
Stable-and-equal → no-op. Stable-and-different → one
`provenance_snapshot_changed` incident + `status → 'conflicted'`, artifact
columns preserved. Unstable across the bounded retry budget →
`WORKTREE_SOURCE_UNSTABLE_RETRYABLE` (no row mutation, no incident, not blocked —
mirrors ORCA-S2 `SOURCE_UNSTABLE_RETRYABLE`).

**Fixed-point property:** `convergeWorktreeProvenance` is a pure function of
`(Execution store state, worktree filesystem state, now)`. N runs ≡ 1 run for the
worktree-derived provenance set. Retryable results write nothing durable.

## 9. `DurableWorktreeSource` — read port + adapter

```
DurableWorktreeSource {
  readProvenance(input: {
    correlationId: string
    boundDispatchId: string
    boundBaseCommit: string
    worktreePath: string
  }): DurableWorktreeRead
}

type DurableWorktreeRead =
  | { kind: 'missing' }                                        // path absent / not a git worktree
  | { kind: 'dispatch_mismatch'; failedCheck: string }         // worktree not attributable to bound dispatch
  | { kind: 'unstable' }                                       // double-read disagreed across retry budget
  | { kind: 'resolved'; baseCommit: string; candidateHead: string;
      filesChanged: readonly string[]; provenanceDigest: string;
      transcript: readonly { cmd: string; outHash: string }[] }
```

**Adapter (infrastructure, Execution-owned):** `ReadOnlyWorktreeProvenanceSource`.

- Invokes `git` via the existing `runProcess`/`runProcessSync`
  (`src/shared/child-process/`, per AGENTS.md) with `cwd = worktreePath`.
- Whitelisted argv only: `rev-parse`, `cat-file -e`, `diff --name-only`,
  `-c core.fsmonitor=false rev-parse --is-inside-work-tree`. Any other subcommand
  is a programming error the adapter refuses.
- **Zero** worktree mutation: no `add`, `commit`, `checkout`, `reset`, `fetch`,
  `gc`, `config` (write), `worktree add/remove`, ref update. A guard test asserts
  the worktree's own HEAD, index mtime, and object count are unchanged across a
  full sweep.
- Returns a plain `DurableWorktreeRead`; no `DispatchContextRow` / `TaskRow` /
  Orca type reaches `domain/` or `application/` (§P.6, §P-S3-7).
- **Coupling:** `EXECUTION_OWNED_SCHEMA_COUPLED_READER` (Execution store) + a
  read-only Git plumbing dependency on the vendored Git baseline (AGENTS.md Git
  2.25 floor — `rev-parse`, `cat-file -e`, `diff --name-only` all predate it).
  **No Orca API. No Orca core change. No hook.**

## 10. Design tension for the freeze review (worktree lifetime)

ORCA-S1's `DisposableShadowRoot` `rmSync`s shadow worktrees on `cleanup()`. After
a crash + restart the worktree may be **gone**, making `candidate_head`
genuinely unrecoverable → `worktree_missing` incident (correct, PROV-1). To make
the durable path *usefully* converge, S3's baseline (§2) **extends worktree
retention** until provenance is converged — a bounded, Execution-owned
composition-seam change, directly analogous to ORCA-S2 moving the durable
`orchestration.db` out of the disposable root. **Two options for the reviewer:**

- **(A, baseline)** Retain the settled worktree until `worktree_provenance`
  exists (or is permanently `unresolved`); reap immediately after. Bounded disk
  cost; converges the common crash window.
- **(B)** Do not extend retention; capture eagerly at settle time on the
  synchronous path, and accept `worktree_missing` on any crash-then-converge
  path. Smaller change; weaker durable guarantee.

The freeze must pick one explicitly. Everything else in this spec is identical
under both.

## 11. Failure semantics

| Situation | S3 behaviour |
| --- | --- |
| No `settlement_observation` for the binding yet | Skipped this pass — S3 only acts after ORCA-S2 converged settlement. |
| `dispatch_worktree` row present, path exists, HEAD attributable | **Converge** → `worktree_provenance` (`converged_from_worktree`); `run_binding.candidate_head` filled. *(New.)* |
| `dispatch_worktree` path **absent** / not a git worktree | `settlement_incident(kind='worktree_missing')`; `blocked`; `provenance_source='unresolved'`; **no fabricated SHA** (§F.7 analogue). |
| Worktree HEAD not attributable to the bound dispatch (`root_ref` / id mismatch, or verified base ≠ `run_binding.base_commit`) | `settlement_incident(kind='worktree_dispatch_mismatch')`; `blocked`; no row. |
| Phase B **stable** re-read `provenance_digest` ≠ stored | `settlement_incident(kind='provenance_snapshot_changed')` + `status → 'conflicted'`; artifact columns byte-unchanged. |
| Worktree kept changing across the bounded re-verify retries | `WORKTREE_SOURCE_UNSTABLE_RETRYABLE` — no row, no incident, not blocked; surfaced in the report; next sweep may retry. |
| Execution write-txn not acquired within the `SQLITE_BUSY` budget | `EXECUTION_STORE_BUSY_RETRYABLE` (ORCA-S2 seman­tics) — no durable row, no incident, not blocked. |
| Any exception for one binding | Caught; `sweepError` in the report; sweep continues; `data/app.db` provably untouched; authority still `AICONTROL_NATIVE`. |
| `data/app.db` missing / has `-wal`/`-shm` at start | `DbGuardError`; S3 does not run (ORCA-S1 gate 9 / ORCA-S2 inherited). |

## 12. Invariants

- **PROV-1 — no fabrication.** `base_commit` / `candidate_head` / `files_changed`
  come only from real Git objects of the **bound dispatch's** worktree.
  Unresolvable ⇒ incident + `blocked`, never a synthesized value.
- **PROV-2 — convergence-safe idempotency.** Sweep N times ≡ once; restart and
  settlement-/provenance-projection rebuild reproduce **semantically equivalent**
  rows (`provenance_digest`, commits, files set, `status`); local metadata
  (`observed_at`, `first_seen_at`, incident id) is excluded from every digest,
  dedup key, and replay-equivalence check.
- **PROV-3 — identity binding.** `worktree_provenance.orca_dispatch_id` ==
  `run_binding.orca_dispatch_id` for its `correlation_id`; a worktree resolving
  to another dispatch ⇒ `worktree_dispatch_mismatch`, no row. `run_binding` is
  never reconstructed heuristically (§L; ORCA-S1 I4; ORCA-S2 P-S2-3).
- **PROV-4 — advisory only / zero authority movement.** No `data/app.db` write;
  no `finalizeRunOnce` (any mode); no `agent_runs` write; no client signal; no
  `parity_observation` write or column; no queue / capacity / scheduler /
  `promoteReadyTasks` touch; no Orca-core change. `data/app.db` SHA-256 ==
  operational baseline before and after, including every incident and crash-window
  path; no `-wal`/`-shm` residual. Authority before == after ==
  `AICONTROL_NATIVE`; Orca mode == `ORCA_SHADOW_ADVISORY`.
- **PROV-5 — read-only w.r.t. Git.** Only `rev-parse` / `cat-file -e` /
  `diff --name-only` (or equivalent plumbing). No checkout, reset, commit, fetch,
  gc, config write, ref/branch update. No worktree mutation attributable to S3
  (HEAD, index mtime, object count unchanged across a sweep).
- **PROV-6 — observation, not ownership.** S3 performs **no** teardown,
  process-tree kill, worktree-finalization *ownership*, execution-attempt
  identity closure, or terminal-event emission. It only records artifacts Orca's
  shadow plane already produced. Extended worktree *retention* (§10-A) is a reap
  delay, not finalization ownership.
- **PROV-7 — parity restoration.** The ORCA-S1 gate-8 `files_changed` comparison
  (authoritative-native vs shadow) runs again on the durable path; each
  divergence is root-caused; results are reported and, if persisted, into an
  S3-owned column — never `parity_observation`.
- **PROV-8 — no Orca type leak.** No `DispatchContextRow` / `TaskRow` / `RunRow`
  in `domain/` or `application/`; only branded refs / plain reads cross the port.
- **PROV-9 — no stage advance.** No transition in
  `AICONTROL_NATIVE → ORCA_SHADOW → ORCA_DELEGATED → ORCA_AUTHORITATIVE` occurs.

## 13. Out of scope (explicit)

- **Any authority transfer / cutover** (`ORCA_DELEGATED` / `ORCA_AUTHORITATIVE`);
  any `data/app.db` projection of terminal state or Git artifacts; any
  `agent_runs` write; any `finalizeRunOnce` reuse or "projection-only mode" (§G
  item 6 — belongs to the delegation slice).
- **The §H lifecycle side-effect family:** process teardown, process-tree
  teardown, *ownership* of worktree finalization, execution-attempt identity
  closure, terminal-event emission to execution-plane consumers, the
  `data/app.db` client completion signal. S3 observes artifacts; it does not own
  or perform lifecycle acts. → a later slice (provisionally **ORCA-S4 —
  Delegated Side-Effect Boundary Enumeration & Shadow Proof**) or the
  `ORCA_DELEGATED` slice's mandatory §H enumeration.
- **Real (non-`MockExecutor`) executor parity** (ORCA-S1 residual R1) — still
  deferred; S3 captures worktree provenance regardless of executor fidelity.
  "Before or within `ORCA_DELEGATED`" per ORCA-S2 Appendix C — not S3.
- **`onDispatchSettled` / any notification hook or long-lived coordinator OS
  process.** The ORCA-S2 sweep remains the only path; S3's phase 2.5 is an
  in-process function on the existing composition boundary.
- **Capacity / admission / FIFO / `QUEUE_FULL` semantics**, and any move of them
  to `orchestration.db` — `ORCA_AUTHORITATIVE`, and requires its own append-only
  amendment (§C.2). Not touched.
- **Any `parity_observation` schema change** — ORCA-S1 parity evidence is
  semantically immutable (ORCA-S2 §18, §26 attack 11).
- **Governed-DAG / `OrganizationalTask` runtime / `promoteReadyTasks`** (§J, §K).
- **Incident-resolution UI / workflow** — contract only, inherited from ORCA-S2
  §13.1.
- **Upstream Orca integration; any Orca-core modification;** the
  architecture-boundary enforcement tool (§P.11); the semantic `PublicationGuard`
  (§N). All separate slices in their own contexts.
- **Reads of the user's real / production `orchestration.db` or real worktrees.**
  S3 reads only the dedicated **shadow** worktree tree.

## 14. Acceptance gates (all mandatory; independent acceptance in a fresh session)

1. **Spec satisfied** — implementation matches the frozen spec; no silent
   redefinition; a real conflict → `CONTRACT_CONFLICT` → amendment.
2. **Module boundary** — no forbidden cross-module import; no Orca row type in
   `domain/` or `application/`; `worktree_provenance` / `dispatch_worktree`
   Execution-owned; no Governance / Delivery table read or written; **no
   `parity_observation` write anywhere**.
3. **TDD / RED evidence** — for PROV-1..PROV-9 and each crash window, a failing
   test captured **before** the behaviour it checks. Evidence:
   `slices/durable-worktree-provenance/RED-EVIDENCE.md`.
4. **Zero authoritative writes** — call-site audit + runtime test: the whole
   slice writes nothing to `data/app.db` (SHA-256 unchanged, no sidecars),
   including on every incident and crash-window path.
5. **No authority transfer** — static audit: no `finalizeRunOnce` import, no
   `agent_runs` write, no delegated lifecycle call, no queue / capacity /
   scheduler / `promoteReadyTasks` touch anywhere in S3. Authority before ==
   after == `AICONTROL_NATIVE`; Orca mode == `ORCA_SHADOW_ADVISORY`.
6. **Read-only Git** — a test asserts only whitelisted plumbing argv is ever
   spawned; that the shadow worktree's HEAD, index mtime, and object count are
   unchanged across a full sweep; that no `checkout`/`reset`/`commit`/`fetch`/
   `gc`/`config`(write)/ref-update is ever issued.
7. **Convergence from durable state, no hook** — settle a shadow Dispatch
   durably, **discard all in-memory state**, construct a fresh sweep, and prove a
   `worktree_provenance` with the correct real `base_commit`, `candidate_head`,
   `files_changed`, `provenance_digest`, and full `provenance_json` — with **no
   hook, no notification, no in-flight process**. `run_binding.candidate_head` is
   filled by the same transaction.
8. **Idempotency** — sweep ×3 back-to-back (Phase A then B each pass), and again
   after a provenance-projection rebuild → semantically equivalent
   `worktree_provenance` set, zero duplicate rows, zero extra incidents
   (PROV-2).
9. **Digest change → conflict, not replacement** — mutate the worktree after a
   provenance row exists; the next Phase B raises exactly one
   `provenance_snapshot_changed` incident, sets `status='conflicted'`, and leaves
   every artifact column byte-unchanged.
10. **Restart safety** — a separate-child-process harness: the child durably
    settles + records provenance, checkpoints/closes, is `SIGKILL`ed at defined
    windows; the parent's fresh sweep reaches exactly-once provenance and never a
    fabricated commit.
11. **No fabrication under loss** — delete / corrupt the worktree before
    convergence: `worktree_missing` incident, `blocked`, `provenance_source =
    'unresolved'`, **no** synthesized SHA, binding surfaced not silently dropped.
12. **Identity** — a worktree seeded to resolve to a *different* dispatch raises
    `worktree_dispatch_mismatch` and writes no row (PROV-3).
13. **Parity restoration** — the ORCA-S1 N=6 / M=3 sample (or a spec-frozen S3
    sample) is compared again on `files_changed` **on the durable path**; every
    divergence root-caused; ORCA-S1 and ORCA-S2 acceptance suites still green and
    byte-unchanged.
14. **Operational DB guard** — `data/app.db` SHA-256 == the operational baseline
    before and after; no `-wal`/`-shm` residual.
15. **Orca coupling** — schema-drift ratchet tests pin the consumed Execution +
    Git surfaces; no `OrchestrationDb` constructed; no Orca API called; no Orca
    core file changed.

## 15. Rollback

Advisory + additive. To roll back: stop invoking `convergeWorktreeProvenance`
(revert the coordinator's phase 2.5); drop **only** `worktree_provenance` and
`dispatch_worktree` (or leave them — inert). `run_binding.candidate_head` values
written on the durable path are correct facts and may be left in place or nulled
by an explicit governed procedure. `data/app.db` and `orchestration.db` were
never written by S3 → **no authority rollback**. Worktree retention (§10-A)
reverts to ORCA-S1's immediate reap by reverting the `disposable-shadow-root.ts`
change. `EXECUTION_SCHEMA_VERSION` may remain at 4 (v4 is a strict superset of v3
— tables + one nullable column).

## 16. Relationship to future `ORCA_DELEGATED`

`ORCA_DELEGATED` (§G, §H) requires the delegation slice to, under its own frozen
contract and independent acceptance:

- **(a)** enumerate and prove the delegated execution-plane side-effect boundary
  — process/process-tree teardown, worktree finalization ownership, `base_commit`
  / `candidate_head` capture, execution-attempt identity closure, terminal-event
  emission (§H); and
- **(b)** prove a terminal-projection path into `data/app.db` that **copies —
  never re-decides** — the authoritative terminal outcome and does **not**
  duplicate side effects: either `finalizeRunOnce` in a proven projection-only
  mode or a dedicated terminal-projection path (§G item 6).

**S3 delivers the artifact half of (a)** as a proven, durable, convergence-safe
advisory fact under SHADOW. When the delegation slice arrives, `base_commit` /
`candidate_head` / `files_changed` are **already converged facts** it can project
(target swap, per ORCA-S2 §0), and the §H enumeration for the artifact family is
already executable. S3 leaves the **lifecycle** half of (a) and all of (b) to the
delegation slice (or an intervening ORCA-S4). **Nothing in S3 advances the
authority ladder**; it makes the eventual cutover a projection-target swap for
the artifact facts rather than capture logic invented at cutover time — reducing
the risk surface of the first real authority transfer.

## 17. Predecessor facts consumed

**From ORCA-S1 (published `911b6679c2`):** `run_binding`
(`orca_dispatch_id` PK; `base_commit` NOT NULL; `candidate_head` nullable —
**the latent column S3 fills**), `run_reservation`, `parity_observation`
(**read-only, never mutated**), `execution_meta`, `DisposableShadowRoot`,
`OrcaExecutionPlane` (`reconcileByCorrelation` — extended to persist the
worktree path), `workload-git-runtime.ts` (`git()` helper, `filesChangedSet`,
`toExecutionOutcome`), the ORCA-S1 gate-8 parity comparator (`domain/parity.ts`).

**From ORCA-S2 (published `8eca5ddefc`):** `settlement_observation` /
`settlement_incident` (the latter reused with new `kind`s),
`reconcileShadowExecutionState` (the coordinator — gains phase 2.5),
`withImmediateTransaction` + bounded `SQLITE_BUSY` → retryable seman­tics, the
two-phase read→re-verify→commit convergence pattern, the
`SOURCE_UNSTABLE_RETRYABLE` / `EXECUTION_STORE_BUSY_RETRYABLE` result vocabulary,
the versioned schema ladder (v3 → v4), the frozen-evidence-bundle pattern, the
`data/app.db` guard (`aicontrol-db-reader.ts`, `assertNoSqliteSidecars`,
`sha256File`), the separate-child-process restart harness pattern.

## 18. Independent-acceptance attack surfaces

1. **Hidden authority transfer** — does *any* S3 path write `data/app.db`, call
   `finalizeRunOnce`, mutate `agent_runs`, emit a client completion signal, or
   touch queue/capacity/scheduler?
2. **Fabrication under loss** — can `worktree_missing` be coerced into writing a
   `worktree_provenance` with a synthesized `candidate_head` (empty-tree SHA,
   bound `base_commit` copied as head, sibling binding's head)?
3. **Digest bypass** — can a stable differing Phase B worktree cause a silent
   re-record or artifact-column rewrite instead of a
   `provenance_snapshot_changed` incident + `conflicted`?
4. **Instability mis-classified as conflict** — worktree changing *during* the
   double-read → stays unstable across the retry budget → must be
   `WORKTREE_SOURCE_UNSTABLE_RETRYABLE` (no incident, no row mutation, not
   blocked), never `provenance_snapshot_changed`.
5. **Cross-dispatch contamination** — seed a worktree that resolves to a
   different dispatch / a stale `root_ref`; confirm `worktree_dispatch_mismatch`
   and no row (PROV-3).
6. **Git write in disguise** — any `add` / `commit` / `checkout` / `config`
   (write) / ref update / `gc` reachable from the adapter? Is the worktree's
   HEAD / index mtime / object count provably unchanged across a sweep?
7. **Orca-type leak** — any `DispatchContextRow` / `TaskRow` reaching `domain/`
   or `application/`?
8. **`run_binding.candidate_head` overwrite** — can an already-non-null value be
   rewritten by a later pass or a rebuild?
9. **`parity_observation` immutability** — does S3 write, alter, or add a column
   to it anywhere? (Must not.)
10. **Worktree-retention scope creep (§10-A)** — is the retention change a
    bounded reap delay only, or has it crept into worktree *finalization
    ownership* / teardown (which is §H / out of scope)?
11. **ORCA-S1 / ORCA-S2 regression** — both acceptance suites byte-unchanged and
    green despite the coordinator + composition-seam edits; settlement
    convergence still runs before worktree convergence before abandon-remainder;
    no separate unconditional abandon pass.
12. **Local metadata in identity** — is `observed_at` / `first_seen_at` /
    incident `id` / an absolute path prefix ever part of `provenance_digest`, a
    dedup key, or a replay-equivalence check? (Must not be.)

---

_State class: `ARCHITECTURE_DEFINITION_READY` (candidate — not frozen, not
independently accepted, not published)._
_Display verdict: `MAESTRO_NEXT_MIGRATION_SLICE_ARCHITECTURE_SDD_READY_TO_REVIEW`._
