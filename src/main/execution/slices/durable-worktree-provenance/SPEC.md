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
>
> **Revision note (candidate, pre-freeze — focused architecture corrections).**
> This revision corrects five blockers and seven precision residuals found by
> independent architecture review of the prior candidate (`71baddc2ad`). It is
> **not** an amendment — the SPEC is still an unpublished candidate.
>
> - **B1 — incident isolation.** S3 no longer reuses ORCA-S2's
>   `settlement_incident`. It introduces its own `worktree_provenance_incident`
>   channel whose open-incident predicate gates **only** S3 provenance
>   convergence and never suppresses ORCA-S2 Phase A / Phase B or ORCA-S1 abandon
>   semantics (§7.3, §12 PROV-10). `evidence_digest` is defined canonically per
>   kind. Operational Git/source failures are retryable, never incidents.
> - **B2 — worktree identity.** Path alone is not identity. A durable identity
>   discriminator `{ correlationId, orcaRunId, orcaDispatchId, worktreeNonce }`
>   is minted at bind time, written **into the worktree** (`.git/`-scoped, never
>   in any diff) and persisted on `dispatch_worktree`. Convergence requires an
>   exact match **before** any provenance read. `root_ref` / path / base-object
>   existence are corroborating evidence only (§7.2, §8, §12 PROV-3).
> - **B3 — source state vs projection.** `dispatch_worktree` is durable **source
>   state**, written atomically with `run_binding` at the `recordBinding`
>   composition seam (not from `orca-execution-plane.ts`). It is preserved across
>   provenance-projection rebuild, rollback, and restart. Only `worktree_provenance`
>   and `worktree_provenance_incident` are projection-rebuildable (§7.2, §7.5, §15).
> - **B4 — lifecycle boundary.** All A/B forks resolved. The shadow worktree S3
>   reads is durable Execution **source state living OUTSIDE `DisposableShadowRoot`**
>   — retention-by-storage-boundary, exactly as ORCA-S2 moved the durable
>   `orchestration.db` out of that root (§10, §12 PROV-6, PROV-11). S3 owns **no**
>   teardown / reap timing / `rm` / `rmSync` / `git worktree remove` / process
>   cleanup / finalization / publication / execution-attempt closure. Governed
>   cleanup is deferred to a later lifecycle / delegation-preparation slice.
> - **B5 — no parity responsibility.** The claim that ORCA-S2 "regressed" S1
>   `files_changed` parity is deleted. ORCA-S2 intentionally excluded Git
>   reconstruction from settlement convergence (S2 §4, §18, §23, Appendix C R2) —
>   an accepted separation of concerns, not a regression. S3 does **not** restore
>   parity, touch `parity_observation`, reopen ORCA-S1 gate 8, or perform any
>   durable-path parity comparison. S3 produces only durable shadow-side artifact
>   provenance (`base_commit`, `candidate_head`, `files_changed`,
>   `provenance_digest`); a future slice may consume that evidence (§3, §12 PROV-7,
>   §13).
> - **Precisions R1–R7.** `files_changed` pinned exactly to ORCA-S1 semantics
>   (committed `git diff --name-only <base_commit>..HEAD` through the existing
>   `filesChangedSet`; staged/unstaged/untracked out of scope; empty → `[]`)
>   (R1, §6, §8). `candidate_head`: `null → verified SHA` via CAS, `same → no-op`,
>   `different stable value → worktree_dispatch_mismatch` incident, never overwrite
>   (R2, §6, §7.4). `base_commit` authority stays `run_binding.base_commit`
>   (R3, §7.4). `provenance_digest` excludes every local path / absolute prefix /
>   timestamp / incident id (R4, §8, §12 PROV-2). Git failure taxonomy:
>   confirmed stable non-repository → `worktree_missing` semantic incident;
>   timeout / IO / lock / other operational error → `WORKTREE_SOURCE_OPERATIONAL_RETRYABLE`;
>   unstable double-read → `WORKTREE_SOURCE_UNSTABLE_RETRYABLE`; SQLite busy →
>   `EXECUTION_STORE_BUSY_RETRYABLE`; no incident or block for any retryable
>   (R5, §8, §9, §11). Every open-ended Git phrase replaced with an exact
>   read-only argv whitelist (R6, §9, §12 PROV-5). Convergence is a **sibling S3
>   sweep** invoked by the composition boundary **after**
>   `reconcileShadowExecutionState(...)` — **no "phase 2.5"** inside the ORCA-S2
>   coordinator (R7, §2, §8).

**State class:** `ARCHITECTURE_DEFINITION_READY`.
**Display verdict:** `MAESTRO_ORCA_S3_ARCHITECTURE_CORRECTED_READY_FOR_FOCUSED_REREVIEW`.

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
| Orca coupling classification | `EXECUTION_OWNED_SCHEMA_COUPLED_READER` + read-only Git plumbing over an **exact argv whitelist**. **No Orca core hook/API change. No `reconcileShadowExecutionState` change.** |
| Candidate branch | `orca-s3-durable-worktree-provenance` |
| Maestro base / HEAD | `8eca5ddefc26a85d7589071ef720e891f2936779` (`origin/main` == ORCA-S2 published technical HEAD; ancestry verified, no drift) |
| Orca base | unchanged from ORCA-S1/S2 as vendored at the Maestro base (`bf4e2705046cf9ef9c915929a9646da85717af07` semantics). **No upstream integration.** |
| Predecessor | ORCA-S2 — Durable Settlement Observation & Convergence (`src/main/execution/slices/durable-settlement-observation/`), **CLOSED / PUBLISHED** |
| Candidate SPEC path | `src/main/execution/slices/durable-worktree-provenance/SPEC.md` |

**Normative source:** aiControlCenter external-plane amendment
`ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01` (amendment
canonical base `598c1f57def37746796a237380fad262e64aadd6`; amendment technical
HEAD `b84451f4303144a4759adfb711d9ac724a029479`). Governing sections: **§H**
(delegated execution side-effect ownership — *primary boundary S3 must not
cross*), **§G** (`ORCA_DELEGATED` terminal-transition semantics), **§F**
(reconciliation — projection/convergence; **§F.7** incidents: *"reconciliation
converge fatos conhecidos. Não cria fatos"*), **§L** (Identidade — `run_binding`,
`base_commit`, `candidate_head`, *"não é reconstruído heurísticamente"*), **§E**
(absolute single-authority invariant), **§I** (`SHADOW_EXECUTION_SAFETY_POLICY`),
**§P** (architecture style), and the **§D authority matrix** rows *"Git / worktree
ownership"* (ORCA_SHADOW: *"Orca possui worktrees shadow"*; capture of real
`base_commit` / `candidate_head` at the execution/governance boundary is an
**ORCA_DELEGATED** act), *"Recovery / reaping"* (ORCA_SHADOW: *"Orca recupera
somente workers shadow"*), and *"Terminal side-effect owner"*. aiControlCenter
`origin/master` (`c9d548eecbf2b4e18bfb305131552f8feb8d2eff`) is **READ-ONLY** for
this slice.

---

## 0. `CONTRACT_CONFLICT` check (published §H, §G, §F, §E, §L)

**No conflict.** §H opens *"Para toda run cuja transição running→terminal tenha
sido delegada"* — its delegated-side-effect ownership rules (process teardown,
worktree finalization, `base_commit` / `candidate_head` capture,
execution-attempt identity closure, terminal-event emission) are written for the
`ORCA_DELEGATED` stage where Orca **owns** the terminal transition. At S3's stage
(`AICONTROL_NATIVE` / `ORCA_SHADOW_ADVISORY`) the §D authority matrix keeps
*Execution / settlement authority* with aiControl and Orca **advisory**. S3 does
**not** claim Orca owns any side effect and performs **no** side effect itself —
no teardown, no finalization, no filesystem removal, no terminal event.

What S3 does is **pre-implement the durable capture-and-convergence engine for
the artifact half of the §H boundary** — real `base_commit`, real
`candidate_head`, the files-changed set — with the capture **target** being an
Execution-owned **advisory** record, never `data/app.db`, never a Governance
`AgentRun` write, never `parity_observation`, never `settlement_incident`. This
mirrors ORCA-S2 §0: *compliance, not relaxation.* Building and proving the §H
artifact-provenance convergence now, at SHADOW, against an advisory target is a
prerequisite for the later `ORCA_DELEGATED` slice (under its own frozen contract,
§G item 6, §H) to **swap the projection target** rather than invent capture logic
at cutover time. Nothing in this slice advances an authority stage.

Per §F.7, S3's incidents are **durable semantic contradictions only**, recorded
and blocked for adjudication, **never auto-resolved by inventing state**. They
live in an **S3-owned channel** (`worktree_provenance_incident`, §7.3) and gate
**only** S3 convergence; they never touch another slice's reconciliation.

---

## 1. Name / purpose

**ORCA-S3 — Durable Worktree Provenance & Convergence.**

Give the Execution bounded context a **durable, idempotent, restart-safe,
provenance-carrying** record of the **Git/worktree side-effect artifacts** a bound
shadow Dispatch produced — its real `base_commit`, its real `candidate_head`, and
its files-changed set — **converged from durable state by a sibling sweep that
depends on no notification, no hook, and no in-flight process**, exactly as
ORCA-S2 converges settlement facts.

### The gap being closed

ORCA-S1 captured `candidate_head` **only** along the synchronous happy path
(`shadow-observation-service.ts` → `plane.settleShadow` → `git rev-parse HEAD` on
the shadow worktree → `store.setBindingCandidateHead(...)`, line 274). ORCA-S2 —
**by deliberate design** (S2 §6.2, §18, §23, Appendix C R2) — made its converged
`SettlementObservedOutcome` **source-only**: on the crash-then-converge path it
records `candidate_head: null`, reads **no** Git state, and derives **no**
files-changed set. That was an **accepted separation of concerns** (ORCA-S2's
architecture review accepted "settlement facts now; Git artifacts to a later
slice"), **not a regression** — on the crash-then-converge path ORCA-S1 would
*abandon* the run, so there was never a `files_changed` comparison there to lose.
ORCA-S1's synchronous-path `files_changed` comparison and its stored
`parity_observation` rows are untouched by ORCA-S2 and are untouched by S3.

The genuine gap: the **artifact provenance is absent precisely when durability
matters** — after a crash between Orca's durable settle and Maestro's observation,
which is the entire reason ORCA-S2 exists. `run_binding.candidate_head` (nullable)
is `null` on the durable path today; `run_binding.base_commit` (NOT NULL) is
populated only at bind time from ORCA-S1's *seeded* shadow worktree, not
re-verified against the Dispatch's real settled worktree. §H names `base_commit` /
`candidate_head` capture and worktree finalization as delegated acts the
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

- the `worktree_provenance` aggregate (§7.1) and its SQLite store —
  **projection / evidence**, projection-rebuildable;
- the `dispatch_worktree` aggregate (§7.2) and its SQLite store — durable
  **SOURCE state**, written atomically with `run_binding`, **never**
  projection-rebuilt;
- the `worktree_provenance_incident` aggregate (§7.3) and its SQLite store —
  the **S3-only incident channel** (never `settlement_incident`);
- a `DurableWorktreeSource` **read port** (application) + one read-only
  infrastructure adapter over the shadow worktree, restricted to an **exact
  Git plumbing argv whitelist** (§9);
- the `convergeWorktreeProvenance` application service — a **sibling** two-phase
  sweep modelled on ORCA-S2's `convergeSettlements` (§8), invoked by the
  composition boundary **after** `reconcileShadowExecutionState(...)` returns;
- a `durable-shadow-worktree-root.ts` infrastructure helper (Execution-owned)
  that resolves / persists the **out-of-`DisposableShadowRoot`** durable shadow
  worktree root path in `execution_meta`, mirroring
  `durable-shadow-orchestration-path.ts` (§10);
- the schema **v3 → v4** upgrade — **three new tables + zero column added to any
  prior table** (§7).

S3 also **modifies these existing ORCA-S1/S2 Execution files** at the
composition / application seam (no authority transfer):

- `application/shadow-observation-service.ts` —
  (a) writes the `dispatch_worktree` row **and** the on-disk identity
  discriminator (§7.2, §8) in the **same Execution transaction as
  `store.recordBinding(binding)`** (line 258); (b) threads the
  `DurableWorktreeSource` + provenance/incident/`dispatch_worktree` store
  dependencies; (c) invokes `convergeWorktreeProvenance(...)` as a **sibling
  sweep immediately after** `reconcileShadowExecutionState(...)` (line 148),
  reading and writing **only** S3 state.
- `slices/shadow-identity-observation/shadow-identity-observation.ts` — the
  single composition boundary constructs the **durable out-of-root shadow
  worktree root** (via `durable-shadow-worktree-root.ts`), routes
  `worktreeDirFor('shadow', …)` under it (the `'auth'` worktrees stay under
  `DisposableShadowRoot`), constructs the `DurableWorktreeSource` + the three S3
  stores, and owns the **cleanup split** (the durable shadow worktree root is
  **not** disposed with `DisposableShadowRoot` and is **never** removed by S3).
- `infrastructure/disposable-shadow-root.ts` — **stops parenting the shadow
  worktrees**. `DisposableShadowRoot` keeps only the disposable **auth**
  worktrees; its `cleanup()` (`rmSync` of its own tree) **must never reach** the
  durable shadow worktree root, exactly as ORCA-S2 removed the durable
  `orchestration.db` from this root's ownership (S2 §17).

S3 does **not** modify:

- `application/reconcile-shadow-execution-state.ts` — **byte-unchanged.** S3 is a
  sibling sweep, never a phase of the ORCA-S2 coordinator. There is **no
  "phase 2.5"**.
- `infrastructure/orca-execution-plane.ts` — **byte-unchanged.** The
  `dispatch_worktree` write happens at the `recordBinding` seam in
  `shadow-observation-service.ts`; the adapter is not touched.
- `infrastructure/settlement-incident-store.ts` / `sqlite-settlement-incident-store.ts`
  / the `settlement_incident` table — **byte-unchanged.** S3 has its own
  incident channel.
- `domain/parity.ts` / the ORCA-S1 gate-8 comparator / `parity_observation` —
  **byte-unchanged.** S3 performs no parity comparison.

ORCA-S1's and ORCA-S2's **accepted authority and reconciliation semantics remain
valid and unchanged**; there is **no** authority transfer.

## 3. Objective (one paragraph)

For every `run_binding` whose Orca shadow Dispatch ORCA-S2 has durably observed as
**settled** (`settlement_observation.status ∈ {observed, observed_conflicted}`),
S3 durably records **at most one** `worktree_provenance` row in the Execution
store that (a) carries the **real** `base_commit` and `candidate_head` of that
Dispatch's worktree and the canonical ordered files-changed set, derived **only**
from durable Git state of the worktree **whose durable identity discriminator
exactly matches** that dispatch — never from an in-process result object, never
fabricated; (b) cites its exact source (resolved commits, the whitelisted `git`
command transcript hashes) as `provenance_json` and pins a content
`provenance_digest` that excludes every local path, absolute prefix, timestamp,
and incident id; (c) is written **exactly once** per `correlation_id`, converges
from durable state with **no hook / no notification / no in-flight process**, and
is **idempotent** under repeat, concurrency, restart, and projection-rebuild;
(d) raises a **blocking `worktree_provenance_incident`** (S3's own channel, never
`settlement_incident`) — never a fabricated commit — when the worktree identity
discriminator is missing or mismatched, the worktree is a confirmed
non-repository, or a stable re-read disagrees with an already-recorded provenance;
and (e) fills the latent `run_binding.candidate_head` on the durable path via a
`WHERE candidate_head IS NULL` CAS, raising `worktree_dispatch_mismatch` on a
non-null disagreement rather than overwriting. **S3 produces only durable
shadow-side artifact provenance — `base_commit`, `candidate_head`,
`files_changed`, `provenance_digest`. It does not restore, compute, or persist
any `files_changed` parity comparison; a future slice may consume this evidence
for comparison under its own contract.** No `data/app.db` write, no
`finalizeRunOnce`, no `agent_runs` write, no `parity_observation` read or write,
no `settlement_incident` write, no `reconcileShadowExecutionState` change, no
filesystem removal, no Orca-core change; authority stays `AICONTROL_NATIVE`.

## 4. Ubiquitous / domain language

| Term | Meaning in this slice |
| --- | --- |
| Settled Dispatch | A bound shadow Dispatch that ORCA-S2 recorded as `settlement_observation.status ∈ {observed, observed_conflicted}`. S3 only ever acts on these. |
| Worktree provenance | `{ baseCommit, candidateHead, filesChanged, provenanceSource, provenanceDigest }` for one settled Dispatch. Advisory. |
| `provenanceSource` | `converged_from_worktree` \| `synchronous_capture`. Records *how* the row's facts were obtained. There is **no** `unresolved` value and **no** sentinel row — an unresolved case is incident-only (§7.1). |
| Worktree identity discriminator | `{ correlationId, orcaRunId, orcaDispatchId, worktreeNonce }` — Execution-minted at bind time, written **into the shadow worktree** at `<worktree>/.git/orca-provenance-identity.json` (inside `.git/`, so never in any `git diff`) **and** persisted verbatim on the `dispatch_worktree` row. `worktreeNonce` is an immutable Execution-minted random id. Convergence requires the on-disk file to exist and **exactly equal** the `dispatch_worktree` row, which must itself match `run_binding`. `root_ref` / path / `git cat-file -e <base_commit>` are **corroborating evidence only**. |
| `DurableWorktreeSource` | Execution-owned read port: over a **read-only Git handle restricted to an exact argv whitelist** (§9), reads `HEAD`, corroborates `<base_commit>` object existence, and reads the `base_commit..HEAD` name-only diff. Plumbing reads only. |
| `dispatch_worktree` | Execution-owned durable **SOURCE row** `(orca_dispatch_id → worktree_path, root_ref, correlation_id, orca_run_id, worktree_nonce, opened_at)`. Written **atomically with `run_binding`**. **Preserved** across provenance-projection rebuild, rollback, and restart. The only durable record of where the worktree is and which identity it must carry. |
| Provenance sweep | `convergeWorktreeProvenance(sliceRef, now)` — a **sibling** two-phase scan (A: record new; B: re-verify recorded), invoked by the composition boundary **after** `reconcileShadowExecutionState(...)`. **Never a phase inside the ORCA-S2 coordinator.** |
| Provenance incident | A `worktree_provenance_incident` row (S3's **own** table, **never** `settlement_incident`) with an S3 `kind`: `worktree_missing`, `worktree_dispatch_mismatch`, `provenance_snapshot_changed`. Its open-incident predicate gates **only** S3 convergence. |
| Retryable convergence result | `WORKTREE_SOURCE_OPERATIONAL_RETRYABLE` (git timeout / IO / lock / spawn error), `WORKTREE_SOURCE_UNSTABLE_RETRYABLE` (double-read disagreed across the bounded budget), or `EXECUTION_STORE_BUSY_RETRYABLE` (write txn not acquired within the `SQLITE_BUSY` budget). **None** writes a durable row, raises an incident, or blocks the binding. All are surfaced in the report. |
| Opaque ref | `OrcaDispatchRef` / `OrcaRunRef` — branded strings. No Orca row type crosses the port (§P.6). |

## 5. Inputs / outputs

**Inputs (all read-only to the sweep):**

- Execution store: `run_binding`, `run_reservation`, `settlement_observation`
  (ORCA-S2), and the new `dispatch_worktree` (SOURCE).
- The dedicated **durable out-of-`DisposableShadowRoot` shadow** worktree on disk
  for the bound dispatch, and its `<worktree>/.git/orca-provenance-identity.json`
  discriminator file (Git plumbing + a single plain file read only).
- `now()` clock; bounded retry budgets (spec constants, §11).

**Outputs (all Execution-owned, advisory):**

- `worktree_provenance` rows (write-once per `correlation_id`).
- `run_binding.candidate_head` populated on the durable path via
  `WHERE candidate_head IS NULL` CAS (the latent column; no DDL).
- `worktree_provenance_incident` rows for the three S3 `kind`s (blocking,
  non-fabricating) — **never** `settlement_incident`.
- A `WorktreeProvenanceReport` + frozen evidence bundle (JSON), analogous to
  ORCA-S2's `settlement-evidence-bundle.json`, carrying the observed set,
  incidents, and the retryable list (`WORKTREE_SOURCE_OPERATIONAL_RETRYABLE` /
  `WORKTREE_SOURCE_UNSTABLE_RETRYABLE` / `EXECUTION_STORE_BUSY_RETRYABLE`, each
  with attempt counts — never a silent skip) and a `gitGuard` block (whitelisted
  argv only; HEAD / index-mtime / object-count deltas all zero).

**Not an output:** any `files_changed` parity comparison result; any
`parity_observation` row or column; any `settlement_incident` row.

## 6. Allowed / forbidden state transitions

**Allowed:**

- `run_binding.candidate_head: NULL → <sha>` — once, on the durable path, via
  `UPDATE run_binding SET candidate_head = ? WHERE orca_dispatch_id = ? AND
  candidate_head IS NULL`, from a verified worktree `HEAD` for the
  identity-matched dispatch.
- `run_binding.candidate_head`: already `<sha>` **and equal** to the verified
  `HEAD` → **no-op**.
- `worktree_provenance: (absent) → status='recorded'` — Phase A, once per
  `correlation_id`, `provenance_source ∈ {converged_from_worktree,
  synchronous_capture}`.
- `worktree_provenance.status: 'recorded' → 'conflicted'` (+ `conflicted_at`) —
  Phase B, on a **stable** re-read `provenance_digest` mismatch. Every
  `base_commit` / `candidate_head` / `files_changed_json` / `provenance_json`
  column is **immutable** after Phase A.
- `dispatch_worktree: (absent) → present` — **only** at bind time, **in the same
  Execution transaction as `run_binding`**, together with the on-disk
  discriminator file.
- `worktree_provenance_incident: (absent) → present (blocked=1)` — a stable
  semantic contradiction (§7.3). `evidence_digest` never overwritten; a genuinely
  different evidence snapshot is a new row.

**Forbidden:**

- `run_binding.candidate_head`: already `<sha>` **and different** from the
  verified `HEAD` → a **`worktree_dispatch_mismatch` incident, no provenance
  row**, never an overwrite.
- Any `worktree_provenance` artifact-column mutation after Phase A.
- Any `worktree_provenance` row for an unresolved case (missing/mismatched
  identity, confirmed non-repository) — those are **incident-only, no row**.
- Writing a `base_commit` / `candidate_head` that was not read from a real Git
  object of the identity-matched dispatch's worktree (no reconstruction from
  logs, no "empty tree" placeholder, no copy from a sibling binding, no sentinel).
- Any write to `data/app.db`, `agent_runs`, `parity_observation`; any
  `finalizeRunOnce` call in any mode; any client completion-signal emission.
- **Any write to, column on, or schema change of `settlement_incident`.**
- **Any modification of `reconcile-shadow-execution-state.ts` or insertion of a
  convergence phase into the ORCA-S2 coordinator.**
- **Any modification of `orca-execution-plane.ts` for the `dispatch_worktree`
  write.**
- **Any `parity_observation` read, write, column, or comparison; any reopening of
  ORCA-S1 gate 8; any durable-path `files_changed` parity comparison.**
- Any worktree mutation **from the sweep**: no `checkout`, `reset`, `commit`,
  `fetch`, `gc`, `config` write, `add`, branch/ref update — plumbing **reads**
  only over the §9 whitelist.
- **Any filesystem removal from any S3 code path**: no `rm`, `rmSync`, `rmdir`,
  `unlink`, `git worktree remove`, directory deletion — of the durable shadow
  worktree or anything else.
- Any teardown / process-tree kill / worktree *finalization ownership* / reap
  timing / execution-attempt identity closure / terminal-event emission
  (§H lifecycle family — out of scope, §13).
- Any `promoteReadyTasks` / `OrganizationalTask` completion effect (§J, §K).

## 7. Durable model (Execution-owned, schema v3 → v4 — additive only)

Schema `EXECUTION_SCHEMA_VERSION` 3 → 4. **Three new tables + their indexes; zero
column added to any ORCA-S1/S2 table** (`run_binding.candidate_head` already
exists — S3 only starts populating it on the durable path). The versioned ladder
in `execution-schema.ts` (`migrateExecutionStore`, version-compare + explicit
bump) is extended with a `current < 4` step whose body is only "ensure the three
S3 tables + indexes exist" (no `ALTER`). A v3 store upgraded to v4 and a freshly
created v4 store are structurally identical.

### 7.1 `worktree_provenance` — projection / evidence (rebuildable)

```
worktree_provenance (
  correlation_id      TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id    TEXT NOT NULL,
  orca_run_id         TEXT NOT NULL,
  slice_ref           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'recorded',   -- recorded | conflicted
  base_commit         TEXT NOT NULL,
  candidate_head      TEXT NOT NULL,
  files_changed_json  TEXT NOT NULL,                      -- canonical ordered set (filesChangedSet)
  provenance_source   TEXT NOT NULL,                      -- converged_from_worktree | synchronous_capture
  worktree_path_ref   TEXT NOT NULL,                      -- LOCAL metadata; excluded from digest + replay equivalence
  provenance_digest   TEXT NOT NULL,                      -- content digest; excludes local paths / absolute prefixes / timestamps / incident ids
  first_seen_at       TEXT NOT NULL,                      -- LOCAL metadata
  observed_at         TEXT NOT NULL,                      -- LOCAL metadata
  conflicted_at       TEXT
)
CREATE INDEX IF NOT EXISTS worktree_provenance_by_slice ON worktree_provenance(slice_ref);
```

- **No sentinel / `unresolved` row.** An unresolvable case (missing/mismatched
  identity discriminator; confirmed stable non-repository) is **incident-only,
  no `worktree_provenance` row** — mirrors §F.7 *"reconciliation … não cria
  fatos"*.
- Every `base_commit` / `candidate_head` / `files_changed_json` /
  `provenance_json` / `provenance_source` column is **immutable** after Phase A.
  The **only** permitted mutation is `status: 'recorded' → 'conflicted'`
  (+ `conflicted_at`) on a Phase B stable digest mismatch.
- `provenance_digest` = `SHA-256` over the canonical serialisation of
  `{ baseCommit, candidateHead, filesChanged }` **only** — commit SHAs plus the
  `filesChangedSet`-ordered repo-relative paths. It **excludes**
  `worktree_path_ref`, any absolute path prefix, `observed_at`, `first_seen_at`,
  `conflicted_at`, and any incident id (R4, §12 PROV-2).

### 7.2 `dispatch_worktree` — durable SOURCE state (never rebuilt)

```
dispatch_worktree (
  orca_dispatch_id  TEXT PRIMARY KEY,
  correlation_id    TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  orca_run_id       TEXT NOT NULL,
  worktree_nonce    TEXT NOT NULL,     -- immutable Execution-minted random id
  worktree_path     TEXT NOT NULL,     -- absolute; corroborating only
  root_ref          TEXT NOT NULL,     -- which durable-shadow-worktree-root generation; corroborating only
  opened_at         TEXT NOT NULL
)
CREATE INDEX IF NOT EXISTS dispatch_worktree_by_correlation ON dispatch_worktree(correlation_id);
```

- Written **once**, at bind time, **in the same `withImmediateTransaction` as
  `store.recordBinding(binding)`** (`shadow-observation-service.ts` line 258).
  The same step writes `<worktree_path>/.git/orca-provenance-identity.json` =
  `{ correlationId, orcaRunId, orcaDispatchId, worktreeNonce, sliceRef }`
  (inside `.git/`, so `git add -A` at workload time never stages it and it never
  appears in any `base_commit..HEAD` diff).
- **SOURCE state.** Preserved across provenance-projection rebuild, rollback, and
  restart (§7.5, §15). It is the **only** durable record of the worktree path and
  the identity the worktree must carry; it is **not** re-derivable from any other
  durable state, so it is **never dropped**.
- `worktree_path` / `root_ref` are **corroborating evidence only** — a durable
  identity check is the `worktree_nonce` + id triple match (§8, §12 PROV-3),
  never a path comparison.

### 7.3 `worktree_provenance_incident` — S3-only incident channel (B1)

```
worktree_provenance_incident (
  id               TEXT PRIMARY KEY,
  correlation_id   TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  orca_dispatch_id TEXT,
  slice_ref        TEXT NOT NULL,
  kind             TEXT NOT NULL,      -- worktree_missing | worktree_dispatch_mismatch | provenance_snapshot_changed
  evidence_digest  TEXT NOT NULL,
  detail_json      TEXT NOT NULL,      -- observed durable facts only; NO invented state
  blocked          INTEGER NOT NULL DEFAULT 1,
  resolved_at      TEXT,               -- contract-only resolution (mirrors ORCA-S2 §13.1); NULL while blocking
  resolution_note  TEXT,
  raised_at        TEXT NOT NULL       -- LOCAL metadata
)
CREATE UNIQUE INDEX IF NOT EXISTS worktree_provenance_incident_unique
  ON worktree_provenance_incident(correlation_id, kind, evidence_digest);
CREATE INDEX IF NOT EXISTS worktree_provenance_incident_by_slice
  ON worktree_provenance_incident(slice_ref);
```

- **Open-incident predicate** `hasOpenWorktreeProvenanceIncident(correlationId)` =
  `SELECT 1 … WHERE correlation_id = ? AND resolved_at IS NULL`. It is consulted
  **only** by `convergeWorktreeProvenance`. It is **never** consulted by
  `convergeSettlements` (Phase A or Phase B) or `reconcileIncompleteReservations`.
  An open S3 incident therefore **cannot** suppress ORCA-S2 settlement
  observation, ORCA-S2 Phase B re-verification, or ORCA-S1 abandon semantics
  (§12 PROV-10).
- **`evidence_digest`, defined canonically per kind** (NUL-joined components,
  `SHA-256` hex):
  - `worktree_missing` — `SHA-256(correlationId ‖ boundDispatchId ‖ "worktree_missing")`.
    Stable per binding: a genuinely absent directory or a confirmed
    non-repository for the identity-matched dispatch.
  - `worktree_dispatch_mismatch` —
    `SHA-256(correlationId ‖ boundDispatchId ‖ observedIdentityDigest ‖ failedCheck)`,
    where `observedIdentityDigest` = `SHA-256` of the discriminator actually
    found on disk (or the literal `"<absent>"` when the file is missing or the
    `dispatch_worktree` row is absent), and `failedCheck ∈
    { identity_discriminator_absent, identity_discriminator_mismatch,
      dispatch_worktree_row_absent, base_commit_disagreement,
      candidate_head_disagreement }`.
  - `provenance_snapshot_changed` — the **new stable** conflicting
    `provenance_digest` **is** the `evidence_digest` (mirrors ORCA-S2
    `source_snapshot_changed`).
- **Rules** (mirror ORCA-S2 §13): retry that reads the same evidence hits the
  UNIQUE index → **no-op**, not a second row, not an error. Genuinely different
  evidence → a **new** row; old rows retained. **Never** cleared automatically;
  no auto-resolution path in S3. `detail_json` contains **only** what was read.
  Resolution is a future operator tool's single durable write (`resolved_at` +
  non-empty `resolution_note`); while `resolved_at IS NULL` the binding is
  skipped by `convergeWorktreeProvenance` in both phases.
- **Operational failures are never incidents** — `WORKTREE_SOURCE_OPERATIONAL_RETRYABLE`,
  `WORKTREE_SOURCE_UNSTABLE_RETRYABLE`, `EXECUTION_STORE_BUSY_RETRYABLE` write no
  row here.

### 7.4 `run_binding` — the latent `candidate_head` column (no DDL)

`candidate_head TEXT` (nullable) already exists. S3 starts populating it on the
durable path via `UPDATE … WHERE candidate_head IS NULL`. Transitions (R2):

- `NULL → <verified HEAD sha>` — the CAS succeeds; write in the same transaction
  as the `worktree_provenance` insert (§8 Phase A step 6).
- already `<sha>` **and equal** to the verified `HEAD` — the CAS matches 0 rows;
  **no-op**, not an error.
- already `<sha>` **and different** from the verified `HEAD` — **do not write**;
  raise `worktree_dispatch_mismatch` (`failedCheck =
  candidate_head_disagreement`), **no `worktree_provenance` row**. Never
  overwrite.

`run_binding.base_commit` stays **NOT NULL and unchanged** and is the
**authority** for the dispatch's base (R3). `worktree_provenance.base_commit`
holds the **verified** base; if the base resolved against the worktree disagrees
with `run_binding.base_commit`, raise `worktree_dispatch_mismatch`
(`failedCheck = base_commit_disagreement`), **no row**.

### 7.5 Source state vs projection (B3)

- **SOURCE state — preserved across provenance-projection rebuild, rollback, and
  restart:** `dispatch_worktree`, `run_binding`, `run_reservation`,
  `execution_meta` (including the durable shadow worktree root key), and the
  durable shadow worktree files on disk.
- **PROJECTION state — the only thing a provenance-projection rebuild
  drops+recreates:** `worktree_provenance` and `worktree_provenance_incident`.
- The rebuild helper (mirrors `durable-shadow-orchestration-path.ts`'s
  `rebuildSettlementProjection`) executes
  `DROP TABLE IF EXISTS worktree_provenance_incident; DROP TABLE IF EXISTS
  worktree_provenance; <WORKTREE_PROVENANCE_PROJECTION_SQL>` — it **never**
  touches `dispatch_worktree` or the worktree files.
- After a rebuild + a fresh `convergeWorktreeProvenance` against the **same**
  durable shadow worktrees, every regenerated row matches the pre-rebuild one on
  `{ provenance_digest, base_commit, candidate_head, files_changed_json,
  orca_dispatch_id, status }` and every regenerated incident on
  `{ correlation_id, kind, evidence_digest, detail_json, blocked }`. Local
  metadata (`observed_at`, `first_seen_at`, `conflicted_at`, `worktree_path_ref`,
  incident `id`, `raised_at`) is **excluded** from the comparison.

## 8. Convergence design — sibling two-phase sweep (mirrors ORCA-S2 §8)

`convergeWorktreeProvenance(sliceRef, now)` is invoked by the composition
boundary **after** `reconcileShadowExecutionState(...)` returns
(`shadow-observation-service.ts`, immediately after line 148). It reads
`run_binding` + `settlement_observation` + `dispatch_worktree` + the durable
shadow worktree filesystem, and writes **only** `worktree_provenance`,
`worktree_provenance_incident`, and `run_binding.candidate_head`. It performs
**no** abandon, **no** reap, **no** filesystem removal, **no** Git write, and is
**never** a phase inside the ORCA-S2 coordinator.

**Phase A — record.** For each `run_binding` that has a `settlement_observation`
(`status ∈ {observed, observed_conflicted}`), **no** `worktree_provenance`, and
**no** open `worktree_provenance_incident`:

1. **Resolve** the `dispatch_worktree` row for `binding.orca_dispatch_id` (never
   heuristically from logs — §L). Row absent → `worktree_dispatch_mismatch`
   (`failedCheck = dispatch_worktree_row_absent`), no row, return.
2. **Verify identity first, before any provenance read.** Read
   `<worktree_path>/.git/orca-provenance-identity.json` (a plain file read; no
   git). File absent → `worktree_dispatch_mismatch`
   (`identity_discriminator_absent`), no row, return. Parse and require
   `{ correlationId, orcaRunId, orcaDispatchId, worktreeNonce }` to **exactly
   equal** the `dispatch_worktree` row, which must itself equal
   `run_binding.{correlationId, orcaRunId, orcaDispatchId}`. Any inequality →
   `worktree_dispatch_mismatch` (`identity_discriminator_mismatch`), no row,
   return. `root_ref` / `worktree_path` / base-object existence are checked only
   as corroboration and never on their own establish or deny identity.
3. Through `DurableWorktreeSource` (§9), over the **exact argv whitelist**:
   `git rev-parse HEAD`; `git cat-file -e <run_binding.base_commit>^{commit}`
   (corroboration); `git diff --name-only <run_binding.base_commit>..HEAD`.
   **Double-read** and re-verify, exactly like ORCA-S2's snapshot re-verify.
   Classify a failure:
   - path exists **and** `git -c core.fsmonitor=false rev-parse
     --is-inside-work-tree` returns `false`, **or** the worktree directory is
     absent (`ENOENT`) → **confirmed stable non-repository** →
     `worktree_missing` incident, blocked, **no row**, **no fabricated SHA**
     (§F.7 analogue, PROV-1);
   - `git` timed out (the shared `runProcess` timeout), or failed with an IO /
     lock / spawn / non-classifiable nonzero error → **`WORKTREE_SOURCE_OPERATIONAL_RETRYABLE`**:
     no row, **no incident**, not blocked; surfaced in the report; next sweep
     retries;
   - the two reads disagreed and stayed unstable across the bounded re-verify
     budget → **`WORKTREE_SOURCE_UNSTABLE_RETRYABLE`**: no row, no incident, not
     blocked.
4. If the resolved base disagrees with `run_binding.base_commit` →
   `worktree_dispatch_mismatch` (`base_commit_disagreement`), no row, return.
   If `run_binding.candidate_head` is already non-null and ≠ the read `HEAD` →
   `worktree_dispatch_mismatch` (`candidate_head_disagreement`), no row, return
   (R2).
5. Build the canonical `WorktreeProvenanceSnapshot`
   `{ baseCommit, candidateHead, filesChanged }` (`filesChanged` via the existing
   `filesChangedSet` from `parity.ts` — sorted, de-duped, trimmed; committed
   `base_commit..HEAD` name-only only; staged / unstaged / untracked are **out of
   scope**; empty → `[]`), and compute `provenance_digest` over that content
   only (§7.1).
6. In a single `withImmediateTransaction` (bounded `SQLITE_BUSY` retry → on
   exhaustion return **`EXECUTION_STORE_BUSY_RETRYABLE`**, no row, no incident):
   re-read the worktree snapshot inside the transaction and recompute the digest;
   if it differs (worktree moved under us), `ROLLBACK` and retry the whole
   attempt from step 3 up to the bounded budget, then
   **`WORKTREE_SOURCE_UNSTABLE_RETRYABLE`**. On a stable re-read:
   `INSERT worktree_provenance` (`status='recorded'`,
   `provenance_source='converged_from_worktree'`, or `'synchronous_capture'` when
   this pass is the one in which the shadow Dispatch settled) **and**
   `UPDATE run_binding SET candidate_head = ? WHERE orca_dispatch_id = ? AND
   candidate_head IS NULL` — one transaction. A `correlation_id` PK collision
   from a concurrent sweep is a **no-op**, not an error.

**Phase B — re-verify.** For each `worktree_provenance` with `status='recorded'`
and **no** open `worktree_provenance_incident`:

1. Re-verify identity (step A2). A discriminator that is now absent/mismatched →
   `worktree_dispatch_mismatch`, `status` unchanged, binding blocked.
2. Re-read the worktree (step A3) and recompute `provenance_digest`.
   - stable-and-equal → **no-op**;
   - stable-and-different → **one** `provenance_snapshot_changed` incident +
     `status → 'conflicted'` (+ `conflicted_at`); every artifact column
     **byte-preserved**;
   - operational failure → `WORKTREE_SOURCE_OPERATIONAL_RETRYABLE` (no mutation,
     no incident);
   - unstable across the budget → `WORKTREE_SOURCE_UNSTABLE_RETRYABLE` (no
     mutation, no incident);
   - write-txn not acquired → `EXECUTION_STORE_BUSY_RETRYABLE` (no mutation, no
     incident).

**Fixed-point property:** `convergeWorktreeProvenance` is a pure function of
`(Execution store state, durable shadow worktree filesystem state, now)`. N runs
≡ 1 run for the worktree-derived provenance set. Every retryable result writes
**nothing** durable and leaves the binding for the next sweep — it does not
perturb the fixed point.

## 9. `DurableWorktreeSource` — read port + adapter (exact argv whitelist)

```
DurableWorktreeSource {
  readProvenance(input: {
    correlationId: string
    boundDispatchId: string
    boundRunId: string
    boundBaseCommit: string
    worktreePath: string
    expectedIdentity: { correlationId: string; orcaRunId: string;
                        orcaDispatchId: string; worktreeNonce: string }
  }): DurableWorktreeRead
}

type DurableWorktreeRead =
  | { kind: 'identity_absent' }                                // .git discriminator file missing
  | { kind: 'identity_mismatch'; observedIdentityDigest: string }
  | { kind: 'missing' }                                        // confirmed non-repository / dir absent
  | { kind: 'operational_error'; detail: string }              // timeout / IO / lock / spawn / non-classifiable nonzero
  | { kind: 'unstable' }                                       // double-read disagreed across the retry budget
  | { kind: 'resolved'; baseCommit: string; candidateHead: string;
      filesChanged: readonly string[]; provenanceDigest: string;
      transcript: readonly { cmd: string; outHash: string }[] }
```

**Adapter (infrastructure, Execution-owned):** `ReadOnlyWorktreeProvenanceSource`.

- Reads the identity discriminator with a plain `readFileSync` of
  `<worktreePath>/.git/orca-provenance-identity.json` — **no** git for identity.
- Invokes `git` **only** through the existing `runProcess` / `runProcessSync`
  (`src/shared/child-process/`, per AGENTS.md) with `cwd = worktreePath`, and
  **only** these four argv forms — an **exact whitelist**, no "or equivalent":
  1. `rev-parse HEAD`
  2. `cat-file -e <boundBaseCommit>^{commit}`
  3. `diff --name-only <boundBaseCommit>..HEAD`
  4. `-c core.fsmonitor=false rev-parse --is-inside-work-tree`

  Any other subcommand, flag, or argument shape is a **programming error** the
  adapter refuses before spawning.
- **Zero** worktree mutation: never `add`, `commit`, `checkout`, `reset`,
  `fetch`, `gc`, `config` (write), `worktree add/remove`, ref update, index
  write. A guard test asserts the worktree's own `HEAD`, `.git/index` mtime, and
  loose+packed object count are **unchanged** across a full sweep, and that none
  of the forbidden subcommands is ever spawned.
- Classifies a `git` failure: `is-inside-work-tree == false` or `ENOENT` on the
  directory → `{ kind: 'missing' }`; a non-zero exit with a timeout / lock / IO
  signature, or any non-classifiable failure → `{ kind: 'operational_error' }`.
  It **never** returns `missing` for a transient failure.
- Returns a plain `DurableWorktreeRead`; no `DispatchContextRow` / `TaskRow` /
  Orca type reaches `domain/` or `application/` (§P.6, §12 PROV-8).
- **Coupling:** `EXECUTION_OWNED_SCHEMA_COUPLED_READER` (Execution store) + a
  read-only Git plumbing dependency on the vendored Git baseline (AGENTS.md Git
  2.25 floor — `rev-parse`, `cat-file -e`, `diff --name-only` all predate it).
  **No Orca API. No Orca core change. No hook. No
  `reconcileShadowExecutionState` change.**

## 10. Worktree lifetime — RESOLVED: retention-by-storage-boundary (B4)

**No A/B fork.** The shadow worktree S3 reads is **durable Execution SOURCE
state that lives OUTSIDE `DisposableShadowRoot`** — directly analogous to ORCA-S2
moving the durable `orchestration.db` out of that root (S2 §17).

- A new Execution infrastructure helper `durable-shadow-worktree-root.ts`
  resolves and persists the canonical absolute durable shadow worktree root path
  in `execution_meta` (mirroring `durable-shadow-orchestration-path.ts`), failing
  closed on a configured-vs-persisted mismatch. `shadow-identity-observation.ts`
  routes `worktreeDirFor('shadow', …)` under this root.
- `DisposableShadowRoot` keeps **only** the disposable `'auth'` worktrees (never
  read after the run). Its `cleanup()` (`rmSync` of its own tree) **must never
  reach** the durable shadow worktree root.
- **S3 performs no filesystem removal** (§6 forbidden; §12 PROV-6) and does
  **not** decide when the durable shadow worktree is deleted.
- Governed cleanup / finalization / reaping of the durable shadow worktree root
  is **explicitly deferred** to a later lifecycle / delegation-preparation slice
  (provisionally **ORCA-S4 — Delegated Side-Effect Boundary Enumeration & Shadow
  Proof**), or the `ORCA_DELEGATED` slice's mandatory §H enumeration. This is
  **retention-by-storage-boundary, not S3 finalization ownership** — §D
  ("Recovery / reaping", ORCA_SHADOW) keeps reaping with the owner; S3 only
  reads.
- If, despite the storage boundary, the worktree is genuinely gone (e.g. the OS
  cleared the durable root out-of-band) and the path is a confirmed
  non-repository, S3 raises `worktree_missing` (PROV-1) — never a fabricated SHA.

## 11. Failure semantics

| Situation | S3 behaviour |
| --- | --- |
| No `settlement_observation` for the binding yet | Skipped this pass — S3 only acts after ORCA-S2 converged settlement. |
| Open `worktree_provenance_incident` for the binding (`resolved_at IS NULL`) | Skipped in both phases — S3-only block. ORCA-S2 / ORCA-S1 sweeps are **unaffected**. |
| `dispatch_worktree` row absent | `worktree_dispatch_mismatch` (`dispatch_worktree_row_absent`); `blocked`; **no row**. |
| Identity discriminator file absent / not exactly equal to the `dispatch_worktree` row (and `run_binding`) | `worktree_dispatch_mismatch` (`identity_discriminator_absent` / `identity_discriminator_mismatch`); `blocked`; **no row**. |
| Identity OK; path is a **confirmed non-repository** / directory absent | `worktree_missing`; `blocked`; **no row**; **no fabricated SHA** (§F.7 analogue). |
| Identity OK; `git` timed out / IO / lock / spawn / non-classifiable error | **`WORKTREE_SOURCE_OPERATIONAL_RETRYABLE`** — no row, **no incident**, not blocked; surfaced in the report; retried next sweep. |
| Identity OK; double-read disagreed and stayed unstable across the budget | **`WORKTREE_SOURCE_UNSTABLE_RETRYABLE`** — no row, no incident, not blocked. |
| Identity OK; resolved base ≠ `run_binding.base_commit` | `worktree_dispatch_mismatch` (`base_commit_disagreement`); `blocked`; **no row**. |
| Identity OK; `run_binding.candidate_head` already non-null and ≠ read `HEAD` | `worktree_dispatch_mismatch` (`candidate_head_disagreement`); `blocked`; **no row**; never overwrite (R2). |
| Identity OK; terminal; stable double-read | **Converge** → `worktree_provenance` (`converged_from_worktree`); `run_binding.candidate_head` filled by CAS in the same txn. *(New.)* |
| Phase B **stable** re-read `provenance_digest` ≠ stored | `worktree_provenance_incident(kind='provenance_snapshot_changed')` + `status → 'conflicted'`; artifact columns byte-unchanged. |
| Execution write-txn not acquired within the `SQLITE_BUSY` budget | **`EXECUTION_STORE_BUSY_RETRYABLE`** — no durable row, no incident, not blocked. |
| Any exception for one binding | Caught; `sweepError` in the report; sweep continues; `data/app.db` provably untouched; `settlement_incident` untouched; authority still `AICONTROL_NATIVE`. |
| `data/app.db` missing / has `-wal`/`-shm` at start | `DbGuardError`; S3 does not run (ORCA-S1 gate 9 / ORCA-S2 inherited). |

## 12. Invariants

- **PROV-1 — no fabrication.** `base_commit` / `candidate_head` / `files_changed`
  come only from real Git objects of the **identity-matched** dispatch's
  worktree. Unresolvable ⇒ `worktree_provenance_incident` + `blocked`, **no
  `worktree_provenance` row**, never a synthesized value, never a sentinel row.
- **PROV-2 — convergence-safe idempotency.** Sweep N times ≡ once; restart and
  provenance-projection rebuild reproduce **semantically equivalent** rows
  (`provenance_digest`, `base_commit`, `candidate_head`, `files_changed_json`,
  `status`); local metadata (`observed_at`, `first_seen_at`, `conflicted_at`,
  `worktree_path_ref`, incident `id`, `raised_at`) **and every absolute path /
  path prefix** are excluded from every digest, dedup key, and
  replay-equivalence check.
- **PROV-3 — identity binding.** Convergence reads provenance **only** after the
  on-disk discriminator `{ correlationId, orcaRunId, orcaDispatchId,
  worktreeNonce }` exactly equals the `dispatch_worktree` row, which exactly
  equals `run_binding`. `root_ref` / `worktree_path` /
  `git cat-file -e <base_commit>` are **corroborating evidence only**. Absence or
  mismatch ⇒ `worktree_dispatch_mismatch`, **no row**. `run_binding` is never
  reconstructed heuristically (§L; ORCA-S1 I4; ORCA-S2 P-S2-3).
- **PROV-4 — advisory only / zero authority movement.** No `data/app.db` write;
  no `finalizeRunOnce` (any mode); no `agent_runs` write; no client signal; no
  `parity_observation` write / column / comparison; no `settlement_incident`
  write / column / schema change; no `reconcile-shadow-execution-state.ts`
  change; no `orca-execution-plane.ts` change; no queue / capacity / scheduler /
  `promoteReadyTasks` touch; no Orca-core change. `data/app.db` SHA-256 ==
  operational baseline before and after, including every incident and
  crash-window path; no `-wal`/`-shm` residual. Authority before == after ==
  `AICONTROL_NATIVE`; Orca mode == `ORCA_SHADOW_ADVISORY`.
- **PROV-5 — read-only w.r.t. Git (exact whitelist).** The sweep spawns **only**
  `rev-parse HEAD`, `cat-file -e <base_commit>^{commit}`,
  `diff --name-only <base_commit>..HEAD`, and
  `-c core.fsmonitor=false rev-parse --is-inside-work-tree`. No `checkout`,
  `reset`, `commit`, `add`, `fetch`, `gc`, `config` write, ref/branch update, or
  index write. The worktree's `HEAD`, `.git/index` mtime, and loose+packed
  object count are unchanged across a full sweep. (The `.git/orca-provenance-identity.json`
  discriminator is written **once at bind time**, not by the sweep.)
- **PROV-6 — observation, not ownership; no filesystem removal.** S3 performs
  **no** teardown, process-tree kill, worktree-finalization *ownership*, reap
  timing, execution-attempt identity closure, terminal-event emission, **and no
  `rm` / `rmSync` / `rmdir` / `unlink` / `git worktree remove` / directory
  deletion on any code path**. It only records artifacts Orca's shadow plane
  already produced. The durable shadow worktree root's lifetime is owned by a
  future lifecycle slice — **not** S3, **not** `DisposableShadowRoot`.
- **PROV-7 — no parity responsibility.** S3 does **not** restore, compute, or
  persist any `files_changed` parity comparison; does **not** read, write, or add
  a column to `parity_observation`; does **not** reopen ORCA-S1 gate 8; does
  **not** perform any durable-path parity comparison. ORCA-S2's exclusion of Git
  reconstruction from settlement convergence was an accepted separation of
  concerns, not a regression. S3 produces only the durable shadow-side artifact
  (`base_commit`, `candidate_head`, `files_changed`, `provenance_digest`); a
  future slice may consume it under its own contract.
- **PROV-8 — no Orca type leak.** No `DispatchContextRow` / `TaskRow` / `RunRow`
  in `domain/` or `application/`; only branded refs / plain reads cross the port.
- **PROV-9 — no stage advance.** No transition in
  `AICONTROL_NATIVE → ORCA_SHADOW → ORCA_DELEGATED → ORCA_AUTHORITATIVE` occurs.
- **PROV-10 — incident isolation.** `worktree_provenance_incident` is a distinct
  S3-owned channel. Its open-incident predicate gates **only**
  `convergeWorktreeProvenance`. An open S3 incident **never** suppresses
  `convergeSettlements` Phase A, `convergeSettlements` Phase B, or
  `reconcileIncompleteReservations` abandon semantics. `settlement_incident` is
  never written, altered, queried, or schema-changed by S3.
- **PROV-11 — source-state durability.** `dispatch_worktree` and the durable
  shadow worktree root are SOURCE state: written atomically with `run_binding`
  and preserved across provenance-projection rebuild, rollback, and restart. Only
  `worktree_provenance` and `worktree_provenance_incident` are
  projection-rebuildable.

## 13. Out of scope (explicit)

- **Any parity work** — no `files_changed` parity comparison, no
  `parity_observation` read / write / column, no reopening of ORCA-S1 gate 8, no
  durable-path parity comparison (B5). A future slice may consume S3's artifact
  evidence.
- **Any modification of the ORCA-S2 coordinator** —
  `reconcile-shadow-execution-state.ts` stays byte-unchanged; there is **no
  "phase 2.5"**. S3 is a sibling sweep invoked after
  `reconcileShadowExecutionState(...)`.
- **Any reuse or modification of `settlement_incident`** — S3 has its own
  `worktree_provenance_incident` channel (B1).
- **Any modification of `orca-execution-plane.ts`** for the `dispatch_worktree`
  write — it happens at the `recordBinding` seam (B3, R6).
- **The §H lifecycle side-effect family and all filesystem removal:** process
  teardown, process-tree teardown, *ownership* of worktree finalization, reap
  timing, `rm` / `rmSync` / `git worktree remove`, execution-attempt identity
  closure, terminal-event emission, the `data/app.db` client completion signal.
  Governed cleanup of the durable shadow worktree root → a later slice
  (provisionally **ORCA-S4**) or the `ORCA_DELEGATED` slice's mandatory §H
  enumeration (B4).
- **Any authority transfer / cutover** (`ORCA_DELEGATED` / `ORCA_AUTHORITATIVE`);
  any `data/app.db` projection of terminal state or Git artifacts; any
  `agent_runs` write; any `finalizeRunOnce` reuse or "projection-only mode" (§G
  item 6 — belongs to the delegation slice).
- **Real (non-`MockExecutor`) executor parity** (ORCA-S1 residual R1) — still
  deferred; S3 captures worktree provenance regardless of executor fidelity.
- **`onDispatchSettled` / any notification hook or long-lived coordinator OS
  process.** The sweep is the only path; `convergeWorktreeProvenance` is an
  in-process function on the existing composition boundary.
- **Capacity / admission / FIFO / `QUEUE_FULL` semantics** and any move of them
  to `orchestration.db` — `ORCA_AUTHORITATIVE`, requires its own append-only
  amendment (§C.2). Not touched.
- **Governed-DAG / `OrganizationalTask` runtime / `promoteReadyTasks`** (§J, §K).
- **Incident-resolution UI / workflow** — contract only, mirrored from ORCA-S2
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
   `domain/` or `application/`; `worktree_provenance` / `dispatch_worktree` /
   `worktree_provenance_incident` Execution-owned; **no `settlement_incident`
   write / column / schema change anywhere**; **no `parity_observation` read /
   write / column anywhere**; **`reconcile-shadow-execution-state.ts` and
   `orca-execution-plane.ts` byte-unchanged**.
3. **TDD / RED evidence** — for PROV-1..PROV-11 and each crash window, a failing
   test captured **before** the behaviour it checks. Evidence:
   `slices/durable-worktree-provenance/RED-EVIDENCE.md`.
4. **Zero authoritative writes** — call-site audit + runtime test: the whole
   slice writes nothing to `data/app.db` (SHA-256 unchanged, no sidecars),
   including on every incident and crash-window path.
5. **No authority transfer / no lifecycle ownership** — static audit: no
   `finalizeRunOnce` import, no `agent_runs` write, no delegated lifecycle call,
   no queue / capacity / scheduler / `promoteReadyTasks` touch, **no `rm` /
   `rmSync` / `rmdir` / `unlink` / `git worktree remove` / directory-deletion
   call**, and **no "phase 2.5"** anywhere in S3. Authority before == after ==
   `AICONTROL_NATIVE`; Orca mode == `ORCA_SHADOW_ADVISORY`.
6. **Read-only Git (exact whitelist)** — a test asserts only the four whitelisted
   argv forms are ever spawned; that the shadow worktree's `HEAD`, `.git/index`
   mtime, and loose+packed object count are unchanged across a full sweep; that
   no `checkout` / `reset` / `commit` / `add` / `fetch` / `gc` / `config`(write)
   / ref-update / index-write is ever issued.
7. **Convergence from durable state, no hook** — settle a shadow Dispatch
   durably, **discard all in-memory state**, construct a fresh **sibling** sweep,
   and prove a `worktree_provenance` with the correct real `base_commit`,
   `candidate_head`, `files_changed`, `provenance_digest`, and full
   `provenance_json` — with **no hook, no notification, no in-flight process**,
   and **without invoking `reconcileShadowExecutionState`**.
   `run_binding.candidate_head` is filled by the same transaction via the
   `IS NULL` CAS.
8. **Idempotency** — sweep ×3 back-to-back (Phase A then B each pass), and again
   after a provenance-projection rebuild → semantically equivalent
   `worktree_provenance` + `worktree_provenance_incident` set, zero duplicate
   rows, zero extra incidents (PROV-2). `dispatch_worktree` and the worktree
   files are untouched by the rebuild.
9. **Digest change → conflict, not replacement** — mutate the worktree after a
   provenance row exists; the next Phase B raises exactly one
   `provenance_snapshot_changed` incident, sets `status='conflicted'`, and leaves
   every artifact column byte-unchanged.
10. **Restart safety** — a separate-child-process harness (ORCA-S2 pattern): the
    child durably settles + writes `dispatch_worktree` + the discriminator,
    checkpoints/closes, is `SIGKILL`ed at defined windows; the parent's fresh
    sibling sweep reaches exactly-once provenance and never a fabricated commit.
    A window where `run_binding` is written but the crash precedes the same
    transaction's `dispatch_worktree` insert is impossible (single transaction);
    a window after both, before convergence, converges normally.
11. **No fabrication under loss** — make the worktree a confirmed non-repository
    (or delete the directory) before convergence: `worktree_missing` incident,
    `blocked`, **no `worktree_provenance` row**, **no synthesized SHA**, binding
    surfaced not silently dropped. And: induce a git **timeout / lock / IO**
    error → `WORKTREE_SOURCE_OPERATIONAL_RETRYABLE`, **never** `worktree_missing`.
12. **Identity** — a worktree whose `.git/orca-provenance-identity.json` is
    absent, or carries a different `{ correlationId, orcaRunId, orcaDispatchId,
    worktreeNonce }`, or a binding whose `dispatch_worktree` row is absent →
    `worktree_dispatch_mismatch` and **no row** (PROV-3). A reused/copied
    filesystem path with the wrong discriminator does **not** converge.
13. **Incident isolation + no parity** — prove an open
    `worktree_provenance_incident` does **not** block `convergeSettlements`
    Phase A, `convergeSettlements` Phase B, or `reconcileIncompleteReservations`;
    prove S3 writes nothing to `parity_observation` or `settlement_incident`
    anywhere; the ORCA-S1 and ORCA-S2 acceptance suites are still green and
    **byte-unchanged**.
14. **Operational DB guard** — `data/app.db` SHA-256 == the operational baseline
    before and after; no `-wal`/`-shm` residual.
15. **Orca coupling** — schema-drift ratchet tests pin the consumed Execution +
    Git surfaces; no `OrchestrationDb` constructed; no Orca API called; no Orca
    core file changed; `reconcile-shadow-execution-state.ts` and
    `orca-execution-plane.ts` byte-unchanged; the `dispatch_worktree` write is at
    the `recordBinding` seam.
16. **Source-state durability** — a provenance-projection rebuild **and** a
    rollback each preserve `dispatch_worktree`, `run_binding`, `run_reservation`,
    `execution_meta` (incl. the durable shadow worktree root key), and the
    durable shadow worktree files; only `worktree_provenance` +
    `worktree_provenance_incident` are dropped/recreated; a fresh sweep after
    rebuild reproduces semantically equivalent rows (PROV-11).
17. **Retryable taxonomy** — tests induce each of
    `WORKTREE_SOURCE_OPERATIONAL_RETRYABLE`,
    `WORKTREE_SOURCE_UNSTABLE_RETRYABLE`, `EXECUTION_STORE_BUSY_RETRYABLE` and
    prove none writes a durable row, none raises an incident, none blocks the
    binding, and each is surfaced in the report with an attempt count.

## 15. Rollback

Advisory + additive. To roll back: stop the composition boundary from invoking
`convergeWorktreeProvenance` (revert the `shadow-observation-service.ts` call
site); drop **only** `worktree_provenance` and `worktree_provenance_incident` (or
leave them — inert).

- **`dispatch_worktree` and the durable shadow worktree files are SOURCE state —
  NEVER deleted by rollback.** They may be retained and removed only by an
  explicit later governed cleanup procedure (a lifecycle / delegation-preparation
  slice), never by S3, never automatically.
- `run_binding.candidate_head` values written on the durable path are correct
  facts and may be left in place or nulled by an explicit governed procedure.
- `data/app.db`, `orchestration.db`, and `settlement_incident` were **never**
  written by S3 → **no authority rollback, no ORCA-S2 impact**.
- The `disposable-shadow-root.ts` split (shadow worktrees out of the disposable
  root) reverts by restoring shadow-worktree parentage if desired; the durable
  shadow worktree root is inert if unused.
- `EXECUTION_SCHEMA_VERSION` may remain at 4 (v4 is a strict superset of v3 —
  three tables, no column added to any prior table).

## 16. Relationship to future `ORCA_DELEGATED`

`ORCA_DELEGATED` (§G, §H) requires the delegation slice to, under its own frozen
contract and independent acceptance:

- **(a)** enumerate and prove the delegated execution-plane side-effect boundary
  — process/process-tree teardown, worktree finalization ownership, reap timing,
  `base_commit` / `candidate_head` capture, execution-attempt identity closure,
  terminal-event emission (§H); and
- **(b)** prove a terminal-projection path into `data/app.db` that **copies —
  never re-decides** — the authoritative terminal outcome and does **not**
  duplicate side effects (§G item 6).

**S3 delivers only the artifact facts of (a)** — `base_commit` / `candidate_head`
/ `files_changed` / `provenance_digest` — as proven, durable, convergence-safe
advisory facts under SHADOW. When the delegation slice arrives, those facts are
**already converged** and it can project them (target swap, per ORCA-S2 §0). S3
leaves **every lifecycle act** (teardown, worktree finalization ownership, reap
timing, filesystem removal, execution-attempt closure, terminal-event emission)
and **all of (b)** to the delegation slice or an intervening ORCA-S4. **Nothing
in S3 advances the authority ladder**; it makes the eventual cutover a
projection-target swap for the artifact facts rather than capture logic invented
at cutover time.

## 17. Predecessor facts consumed

**From ORCA-S1 (published `911b6679c2`):** `run_binding`
(`orca_dispatch_id` PK; `base_commit` NOT NULL — **the authority for the base**;
`candidate_head` nullable — **the latent column S3 fills via `IS NULL` CAS**),
`run_reservation`, `parity_observation` (**neither read nor written — S3 performs
no parity work**), `execution_meta`, `DisposableShadowRoot` (**`'auth'` worktrees
only** after the S3 split), `workload-git-runtime.ts` (`git()` helper pattern;
`filesChangedSet` — **reused** for canonical ordering), the ORCA-S1 gate-8
comparator (`domain/parity.ts`) — **not invoked by S3**.

**From ORCA-S2 (published `8eca5ddefc`):** `settlement_observation` (the
**trigger** — S3 acts only on `status ∈ {observed, observed_conflicted}`),
`withImmediateTransaction` + bounded `SQLITE_BUSY` → `EXECUTION_STORE_BUSY_RETRYABLE`,
the two-phase read → re-verify → commit pattern, the retryable-result vocabulary,
the versioned schema ladder (v3 → v4), the frozen-evidence-bundle pattern, the
`data/app.db` guard (`aicontrol-db-reader.ts`, `assertNoSqliteSidecars`,
`sha256File`), the separate-child-process restart harness pattern, and
`durable-shadow-orchestration-path.ts` (the **pattern S3 mirrors** for
`durable-shadow-worktree-root.ts` and the projection-rebuild helper).

**Explicitly NOT consumed:** `settlement_incident` (S3 has its own channel —
B1); `reconcileShadowExecutionState` (S3 is a sibling sweep, not a phase — no
modification); the `parity.ts` comparator / gate-8 (no parity work — B5).

## 18. Independent-acceptance attack surfaces

1. **Hidden authority transfer / lifecycle ownership** — does *any* S3 path write
   `data/app.db`, call `finalizeRunOnce`, mutate `agent_runs`, emit a client
   completion signal, touch queue/capacity/scheduler, or call `rm` / `rmSync` /
   `git worktree remove` / directory deletion?
2. **Incident isolation (B1)** — write a `worktree_missing` incident, then run
   `convergeSettlements` Phase A **and** Phase B and `reconcileIncompleteReservations`
   for the **same** binding: do they still run unblocked? Is
   `hasOpenWorktreeProvenanceIncident` ever consulted outside
   `convergeWorktreeProvenance`? Is `settlement_incident` ever written/altered by
   S3?
3. **Worktree identity (B2)** — seed a worktree at the recorded path with a
   **different** `.git/orca-provenance-identity.json`, or delete the file, or a
   copied/relocated tmp path; confirm `worktree_dispatch_mismatch` and **no
   row**. Can a path-only or `root_ref`-only match ever converge? Can
   `git cat-file -e <base_commit>` success alone converge?
4. **Fabrication under loss (PROV-1)** — can `worktree_missing` /
   `worktree_dispatch_mismatch` be coerced into writing a `worktree_provenance`
   with a synthesized `candidate_head` (empty-tree SHA, `base_commit` copied as
   head, sibling binding's head), or a sentinel row?
5. **Operational vs semantic git failure (R5)** — induce a git timeout / lock /
   IO error; confirm `WORKTREE_SOURCE_OPERATIONAL_RETRYABLE` (no incident, no
   block), **never** `worktree_missing`. Only a confirmed non-repository /
   absent directory is `worktree_missing`.
6. **Source-state durability (B3 / PROV-11)** — does a provenance-projection
   rebuild or rollback ever drop `dispatch_worktree` or delete the worktree
   files? Is `dispatch_worktree` written in the **same transaction** as
   `run_binding`?
7. **No "phase 2.5" (R7)** — is `reconcile-shadow-execution-state.ts`
   byte-unchanged? Is `convergeWorktreeProvenance` invoked strictly **after**
   `reconcileShadowExecutionState(...)` and never from inside it?
8. **No parity (B5)** — any `parity_observation` read / write / column? Any
   `files_changed` comparison? Any reopening of ORCA-S1 gate 8?
9. **`candidate_head` overwrite (R2)** — can an already-non-null value be
   rewritten by a later pass or a rebuild? A non-null disagreement must raise
   `worktree_dispatch_mismatch`, not overwrite and not silently no-op-with-a-row.
10. **Digest bypass** — can a stable differing Phase B worktree cause a silent
    re-record or artifact-column rewrite instead of a
    `provenance_snapshot_changed` incident + `conflicted`?
11. **Read-only Git (PROV-5)** — any `add` / `commit` / `checkout` / `config`
    (write) / ref update / `gc` / index-write reachable from the adapter? Is
    only the four-form whitelist ever spawned? Is the worktree's `HEAD` /
    `.git/index` mtime / object count provably unchanged across a sweep?
12. **Orca-type leak (PROV-8)** — any `DispatchContextRow` / `TaskRow` reaching
    `domain/` or `application/`?
13. **Local metadata / paths in identity (PROV-2)** — is `observed_at` /
    `first_seen_at` / incident `id` / `worktree_path_ref` / any absolute path
    prefix ever part of `provenance_digest`, a dedup key, or a
    replay-equivalence check?
14. **ORCA-S1 / ORCA-S2 regression** — both acceptance suites byte-unchanged and
    green despite the composition-seam edits; ORCA-S2 settlement convergence and
    Phase B re-verification still run for every binding regardless of S3 state;
    no separate unconditional abandon pass.

---

_State class: `ARCHITECTURE_DEFINITION_READY` (candidate — not frozen, not
independently accepted, not published)._
_Display verdict: `MAESTRO_ORCA_S3_ARCHITECTURE_CORRECTED_READY_FOR_FOCUSED_REREVIEW`._
