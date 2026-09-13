# ORCA-S4 — Delegated Side-Effect Boundary Enumeration & Shadow Proof — CANDIDATE SLICE SPEC

> SDD artifact. **Candidate — not frozen, not independently accepted, not
> published.** Produced by an architecture-definition task against the
> independently-accepted `GAP-ANALYSIS-ORCA-DELEGATED.md`. No code, schema,
> migration, test, dependency, or skill is changed by producing this document.
> When frozen it becomes the functional authority for the slice; code will not
> silently redefine it. A real conflict is `CONTRACT_CONFLICT` → architecture
> decision → amendment, never a silent edit here.
>
> This document is self-contained: a fresh implementation session consumes it
> without reconstructing architecture from chat history. It does **not**
> implement, does **not** transfer authority, does **not** start Slice B / the
> `ORCA_DELEGATED` cutover, and does **not** start M5.

**State class:** `ARCHITECTURE_DEFINITION_READY`.
**Display verdict:** `MAESTRO_ORCA_S4_ARCHITECTURE_CANDIDATE_READY_FOR_INDEPENDENT_REVIEW`.

---

## Artifact identity

| Field | Value |
| --- | --- |
| Proposed slice | **ORCA-S4 — Delegated Side-Effect Boundary Enumeration & Shadow Proof** |
| Bounded context owner | **Execution** |
| Migration authority ladder stage (before) | `AICONTROL_NATIVE` |
| Migration authority ladder stage (after) | `AICONTROL_NATIVE` — **unchanged** |
| Orca mode (before → after) | `ORCA_SHADOW_ADVISORY` → `ORCA_SHADOW_ADVISORY` — **unchanged** |
| Authority transfer | **None.** Does not stop with `AUTHORITY_TRANSFER_REQUIRES_NEW_CONTRACT`. |
| Orca coupling classification | `EXECUTION_OWNED_SCHEMA_COUPLED_READER` (unchanged coupling shape) + a **new** Execution-owned process-lifecycle primitive built on `src/shared/child-process/`. **No Orca core hook/API change. No `reconcileShadowExecutionState` change. No `convergeWorktreeProvenance` change.** |
| Candidate branch | `orca-s4-delegation-boundary-gap-analysis` (continues directly from the accepted gap analysis commit) |
| Maestro base / HEAD | `7a1f8388cb3edb680ba83b1cb15c99c2bee41261` (`origin/main` == ORCA-S3 published technical HEAD; ancestry verified, no drift) |
| Predecessor analysis | `GAP-ANALYSIS-ORCA-DELEGATED.md` (`8f063826116069e1fad9496c37bae658ddfbd5c9`), independently accepted, consumed in full — this SPEC does not re-derive its conclusions, only formalizes decisions 1–11 of its §5 into an implementation-ready contract |
| Predecessor slice | ORCA-S3 — Durable Worktree Provenance & Convergence (`src/main/execution/slices/durable-worktree-provenance/`), **CLOSED / PUBLISHED**, frozen contract = `SPEC.md` + `SPEC-AMENDMENT-001.md` |
| Candidate SPEC path | `src/main/execution/slices/delegated-side-effect-boundary/SPEC.md` |

**Normative source:** aiControlCenter external-plane amendment
`ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01` (amendment
canonical base `598c1f57def37746796a237380fad262e64aadd6`; amendment technical
HEAD `b84451f4303144a4759adfb711d9ac724a029479`). Governing sections: **§H**
(delegated execution side-effect ownership — process/process-tree teardown,
worktree finalization, `base_commit`/`candidate_head` capture, execution-attempt
identity closure, terminal-event emission — the boundary this slice enumerates
and proves under shadow, **never crosses into ownership of**), **§G**
(`ORCA_DELEGATED` terminal-transition semantics, esp. item 6, "copies — never
re-decides"), **§F** (reconciliation; **§F.7** "*reconciliation converge fatos
conhecidos. Não cria fatos*"), **§D** (authority matrix rows *"Recovery /
reaping"* — ORCA_SHADOW: *"Orca recupera somente workers shadow"* — and
*"Terminal side-effect owner"*), **§E** (single-authority invariant), **§I**
(`SHADOW_EXECUTION_SAFETY_POLICY`), **§L** (Identidade), and **§P** (architecture
style). aiControlCenter `origin/master` is **READ-ONLY** for this slice.

Per `GAP-ANALYSIS-ORCA-DELEGATED.md` §7: the full external amendment text is
**not** vendored into this repository; every §H/§G/§D citation above is a quote
already present in a frozen Maestro SPEC (ORCA-S3 §0/Artifact identity), never a
fresh read of the external document by this task. Before this SPEC is frozen,
an independent reviewer with access to the aiControlCenter checkout should
re-read the amendment directly rather than relying solely on these secondhand
quotes.

---

## 0. `CONTRACT_CONFLICT` check (published §H, §G, §F, §D, §E, §L)

**No conflict.** §H's delegated-side-effect ownership rules — process teardown,
worktree finalization, execution-attempt identity closure, terminal-event
emission — are written for the `ORCA_DELEGATED` stage, where Orca **owns** the
running→terminal transition for real delegated dispatches. At S4's stage
(`AICONTROL_NATIVE` / `ORCA_SHADOW_ADVISORY`) the §D authority matrix keeps
*Execution / settlement / recovery authority* with aiControl; Orca is
**advisory** and, per §D, *"recupera somente workers shadow"* — recovers only
its **own shadow** workers. S4 claims exactly that and nothing more: every
process it spawns, terminates, and reaps is a **synthetic, Execution-owned
shadow fixture**; every worktree it finalizes is a **durable shadow worktree**
already scoped to Execution by ORCA-S3 (§10, retention-by-storage-boundary).
S4 performs no side effect against any real user process, any real user
worktree, or `data/app.db`.

What S4 does is **build and prove, entirely under shadow, the mechanical
machinery §H requires of the eventual `ORCA_DELEGATED` owner** — process/process-
tree lifecycle tracking, worktree finalization, governed reap, an
execution-attempt-equivalent closure fact, and terminal-event emission
semantics — against Execution's own synthetic shadow resources, so that when a
future Slice B seeks the `ORCA_DELEGATED` cutover, the mechanism is **already
proven restart-safe and idempotent**, and Slice B's job narrows to (a) pointing
the mechanism at real delegated dispatches (a prerequisite this SPEC does
**not** claim to satisfy — see §5) and (b) adding the terminal-projection path
into `data/app.db` (§G item 6), which S4 explicitly does not touch. This mirrors
ORCA-S2 §0 and ORCA-S3 §0: *compliance, not relaxation.*

Per §F.7, S4's incidents are durable semantic contradictions only — recorded
and blocked for adjudication, never auto-resolved by inventing state. They live
in an S4-owned channel (`dispatch_lifecycle_incident`, §8.4) and gate only S4's
own sweep; they never touch ORCA-S2 or ORCA-S3 reconciliation (§14 LIFE-9).

---

## 1. Name / purpose

**ORCA-S4 — Delegated Side-Effect Boundary Enumeration & Shadow Proof.**

Give the Execution bounded context a **durable, idempotent, restart-safe**
mechanism for every mechanical act §H assigns to the eventual `ORCA_DELEGATED`
owner of a dispatch's running→terminal transition — process/process-tree
lifecycle tracking, worktree finalization ownership and governed reap,
execution-attempt-equivalent lifecycle closure, and terminal-event emission —
and **prove it under `ORCA_SHADOW_ADVISORY`**, against synthetic
Execution-owned shadow resources, before any authority stage moves.

### The gap being closed

`GAP-ANALYSIS-ORCA-DELEGATED.md` §4 enumerates eight items against real
repository state. Items 3 (artifact-capture target) and 8 (real-executor
parity) are **not** this slice's job — item 3 is already satisfied by ORCA-S3
(§16 there: *"already converged … it can project them"*) and item 8 is
orthogonal, deferred, and unaffected by who owns lifecycle mechanics (gap
analysis §6.2). **This slice closes items 1, 2, 4, 5 in full, and produces the
explicit written decisions §5 items 7 and 9 require** (the `onDispatchSettled`
hook question, and the "who decides outcome semantics" split) **without**
closing item 6 (terminal-projection into `data/app.db` — Slice B's job, §G item
6) or item 7's *implementation* (only its *decision*).

Concretely: today, `src/main/execution/` owns **no process**, **no worktree
teardown**, and **no lifecycle-closure fact** of any kind. `NativeResultsAuthoritativeExecutor`
replays a pre-recorded result and never spawns anything
(`native-results-authoritative-executor.ts:34-49`); the general-purpose
`signalProcessTree` / `admitProcessTreeKill` primitive
(`src/shared/child-process/process-tree-termination.ts`) has **zero** callers
under `src/main/execution/`; the durable shadow worktree root ORCA-S3 created
(`durable-shadow-worktree-root.ts`) has **no** finalization or reap path — S3
explicitly deferred that ownership here (S3 §10, §12 PROV-6, §13). S4 builds
exactly that missing machinery, and proves it restart-safe, idempotent, and
free of duplicate side effects — entirely against Execution's own synthetic
shadow processes and ORCA-S3's own durable shadow worktrees, never a real
resource, never `data/app.db`.

## 2. Bounded-context owner

**Execution** (amendment §L, §P.3, §P.13; ORCA-S1 §2, ORCA-S2 §2, ORCA-S3 §2).
The mechanical acts being tracked are Execution's own synthetic shadow
resources; §D assigns "recovery/reaping" of shadow workers to Orca/Execution
already. Delivery / Governance may consume a future public application contract
over this slice's facts; they never read or write S4's tables.

S4 adds, all Execution-owned (new files):

- the `dispatch_process_binding` aggregate (§8.1) and its SQLite store —
  durable **SOURCE** state, minted at the bind-time seam (§9.2), **never**
  projection-rebuilt;
- the `dispatch_termination` aggregate (§8.2) and its SQLite store — durable
  **SOURCE** state, the durable capture of an inherently non-replayable
  ephemeral OS event (§8.0), **never** projection-rebuilt;
- the `worktree_finalization` aggregate (§8.3) and its SQLite store — durable
  **SOURCE** state (the durable capture of an inherently non-replayable
  filesystem-deletion act), **never** projection-rebuilt;
- the `dispatch_lifecycle_incident` aggregate (§8.4) and its SQLite store — the
  **S4-only** incident channel (never `settlement_incident`, never
  `worktree_provenance_incident`) — **projection / evidence, rebuildable**;
- the `dispatch_lifecycle_closure` aggregate (§8.5) and its SQLite store — the
  Maestro-native **execution-attempt-equivalent lifecycle closure** fact
  (explicitly **not** aiControlCenter's `execution_attempts` — §4) —
  **projection, rebuildable** from the four SOURCE/incident facts above plus
  ORCA-S2/S3's own durable facts;
- the `dispatch_lifecycle_event` aggregate (§8.6) and its SQLite store — the
  durable, idempotent record that a terminal event **would be** emitted exactly
  once under shadow — **projection, rebuildable** from `dispatch_lifecycle_closure`;
  **no real external delivery** (§4, §11);
- a `ShadowLifecycleProcessPort` (application) + one infrastructure adapter
  that spawns, observes, and tears down the **synthetic shadow lifecycle
  process** (§9) — extends, never duplicates, `src/shared/child-process/`;
- a `WorktreeFinalizer` (application) + one infrastructure adapter that
  performs the governed reap of a durable ORCA-S3 shadow worktree once
  eligible (§10);
- the `convergeDelegationBoundaryLifecycle` application service — a **third
  sibling** sweep, invoked by the composition boundary **after**
  `convergeWorktreeProvenance(...)` (ORCA-S3) returns (§11);
- a `reconcileOrphanShadowState` application service — a **separate**,
  explicitly-labeled orphan sweep that reaps ORCA-S3 window-A–C filesystem
  orphans (never given a durable Execution-store identity, because none was
  ever committed for them) and S4's own pre-commit process-spawn orphans
  (§10.3, §12 window L7);
- a `durable-shadow-lifecycle-root.ts` infrastructure helper (Execution-owned)
  that resolves / persists the process-identity-sidecar subtree under the
  **same** durable shadow-worktree root ORCA-S3 already resolves (no new
  top-level durable root — see §9.2), mirroring
  `durable-shadow-worktree-root.ts`;
- the schema **v4 → v5** upgrade — **six new tables + zero column added to any
  ORCA-S1/S2/S3 table** (§8).

S4 also **extends** these existing ORCA-S1/S3 Execution files at the
composition / application seam (no authority transfer):

- `application/shadow-observation-service.ts` — at the **same** bind-time seam
  ORCA-S3 §7.6 already established (steps 1–6: create worktree → write worktree
  identity sidecar → `BEGIN IMMEDIATE` → insert `run_binding` → insert
  `dispatch_worktree` → `COMMIT`), S4 inserts **two more pre-transaction steps**
  (write the process identity sidecar; spawn the synthetic shadow lifecycle
  process) and **one more insert inside the same transaction**
  (`dispatch_process_binding`) — see §9.2's full ordering. It also invokes
  `convergeDelegationBoundaryLifecycle(...)` as a **sibling sweep immediately
  after** `convergeWorktreeProvenance(...)` returns.
- `slices/shadow-identity-observation/shadow-identity-observation.ts` — the
  single composition boundary constructs the process-lifecycle port/adapter,
  the worktree-finalizer port/adapter, and the four new S4 stores, **only**
  when ORCA-S3's `worktreeProvenance` block is itself composed (S4 depends on
  S3's durable shadow-worktree root and on `worktree_provenance` truth — it
  cannot run without them), and owns invoking `reconcileOrphanShadowState`
  once per composition-root run, **before** the main sweep chain.

S4 does **not** modify:

- `application/reconcile-shadow-execution-state.ts` — **byte-unchanged.**
- `application/converge-worktree-provenance*.ts` — **byte-unchanged.** S4 is a
  sibling sweep to ORCA-S3, never a phase inside it. There is **no "phase
  3.5."**
- `infrastructure/orca-execution-plane.ts` — **byte-unchanged.**
- `infrastructure/settlement-incident-store.ts` / `settlement_incident` —
  **byte-unchanged.**
- `infrastructure/sqlite-worktree-provenance*.ts` / `worktree_provenance` /
  `worktree_provenance_incident` / `dispatch_worktree` — **byte-unchanged.** S4
  reads these; it never writes them.
- `domain/parity.ts` / `parity_observation` — **byte-unchanged.**
- `infrastructure/aicontrol-db-reader.ts` — **byte-unchanged** (still the read-only
  guard; still no write method).
- `infrastructure/native-results-authoritative-executor.ts` — **byte-unchanged.**
  The shadow lifecycle process is a **separate, additional** synthetic fixture;
  it never replaces or wraps the native-results replay.

ORCA-S1/S2/S3's **accepted authority and reconciliation semantics remain valid
and unchanged**; there is **no** authority transfer.

## 3. Objective (one paragraph)

For every `run_binding` bound **after S4 is composed** (prospective eligibility,
mirroring ORCA-S3 C3 — §8.7) whose Orca shadow Dispatch has been durably
observed as settled by ORCA-S2 **and** whose worktree artifacts have reached a
terminal ORCA-S3 state (`worktree_provenance.status ∈ {recorded, conflicted}`
or ORCA-S3's own `LEGACY_BINDING_NOT_CONVERGEABLE`), S4 durably (a) tracks the
lifecycle of one **synthetic, Execution-spawned shadow process** bound to that
dispatch's identity from spawn (`dispatch_process_binding`, SOURCE) through
observed termination (`dispatch_termination`, SOURCE) with **fail-closed
identity verification** before any signal is sent and **never** a bare-pid
kill; (b) governs the finalization (reap) of that dispatch's durable ORCA-S3
shadow worktree exactly once, recording durable intent **before** the
filesystem act and durable result **after** it
(`worktree_finalization`, SOURCE), tolerant of a crash at any point between; (c)
records **at most one** `dispatch_lifecycle_closure` row per `correlation_id` —
the Maestro-native, Execution-owned, advisory analogue of "execution-attempt
closure" — that **copies references to, and never re-decides**, the settlement,
provenance, termination, and finalization facts it closes over; (d) records
**at most one** `dispatch_lifecycle_event` row per `correlation_id` proving
terminal-event emission is idempotent under shadow, with **no real external
delivery**; (e) raises a **blocking `dispatch_lifecycle_incident`** (S4's own
channel) on any process-identity mismatch, unverifiable orphan, or
finalization-eligibility digest conflict — **never** a fabricated termination,
finalization, or closure fact; and (f) separately reaps ORCA-S3's own
window-A–C filesystem orphans and S4's own pre-commit process-spawn orphans,
governed by a bounded grace period and identity re-verification, **never** by a
bare-pid or bare-path guess. **No `data/app.db` write, no `finalizeRunOnce`, no
`agent_runs` write, no `settlement_incident` write, no `worktree_provenance` /
`worktree_provenance_incident` write, no `reconcileShadowExecutionState`
change, no `convergeWorktreeProvenance` change, no Orca-core change, no real
process or real worktree touched**; authority stays `AICONTROL_NATIVE`.

## 4. Ubiquitous / domain language

| Term | Meaning in this slice |
| --- | --- |
| Shadow lifecycle process | A synthetic, Execution-spawned Node child process — **not** a workload executor, **not** proof of production process-handle acquisition — whose sole purpose is to give S4 a real OS process/process-group to durably bind, observe, and tear down. Spawned via `spawnProcess` (`src/shared/child-process/`), `detached: true` (own POSIX process group). |
| Process identity | `{ correlationId, orcaRunId, orcaDispatchId, processNonce }` — Execution-minted at spawn time, written to a process identity sidecar **before** spawning, persisted verbatim on `dispatch_process_binding`. `pid` is corroborating only — **never** identity by itself (pids recycle). |
| Termination fact | `dispatch_termination` — the durable, one-time capture of an **ephemeral, non-replayable** OS event (a process's exit). Unlike ORCA-S3's Git-derived facts, once the process is reaped there is **no durable source left to re-derive this from** — see §8.0. |
| Worktree finalization | The governed act of reaping (deleting) a durable ORCA-S3 shadow worktree once it is provably no longer needed by any future provenance read. Intent is recorded **before** the filesystem act; result **after** it (§10). |
| Dispatch lifecycle closure | `dispatch_lifecycle_closure` — the Maestro-native, Execution-owned, advisory analogue of "execution-attempt closure." **Not** aiControlCenter's `execution_attempts` table (that table does not exist in this repository — `GAP-ANALYSIS-ORCA-DELEGATED.md` §3). A write-once reference aggregate over already-durable facts; it **copies, never re-decides**, what those facts already say. |
| Terminal-event emission | The durable, idempotent record (`dispatch_lifecycle_event`) that a terminal event **would** fire exactly once for a closed dispatch. Under S4 there is **no real delivery target** — no webhook, no IPC broadcast, no `data/app.db` write. It exists to prove the **idempotency contract** a future real emitter must satisfy, not to perform real emission. |
| Governed reap | Deletion of a durable shadow resource (worktree or orphaned process) gated by an explicit eligibility check and a durable intent record — never an unconditional or time-only sweep. |
| Orphan (worktree) | A durable shadow worktree directory / identity sidecar with **no matching committed `dispatch_worktree` row** — ORCA-S3 crash windows A–C, which S3 explicitly declined to reap (S3 §7.6, §12 PROV-6). No `correlation_id` was ever committed for it; S4 reaps it as an **audit-logged, non-DB-row** fact (§10.3) — asserting a durable Execution-store identity for it would fabricate identity that was never proven. |
| Orphan (process) | A shadow lifecycle process whose identity sidecar was written and the process spawned, but whose `dispatch_process_binding` row never committed (a **new** S4 crash window, §12 window L7) — same audit-logged, non-DB-row treatment. |
| Prospective eligibility | Mirrors ORCA-S3's C3: S4 acts **only** on bindings created after S4 is composed. A pre-S4 binding that already settled and converged without ever having a shadow lifecycle process is `LEGACY_BINDING_NOT_LIFECYCLE_MANAGED` — no row, no incident, no block, no retroactive spawn (§8.7). |
| Retryable lifecycle result | `LIFECYCLE_STORE_BUSY_RETRYABLE` (SQLite write-txn contention), `LIFECYCLE_FS_OPERATIONAL_RETRYABLE` (transient filesystem error during finalization), `LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE` (transient error querying/signalling a process, distinct from genuine identity uncertainty). **None** writes a durable row, raises an incident, or blocks the binding. |
| Fail-closed identity uncertainty | When S4 cannot durably prove which live OS process (if any) corresponds to a `dispatch_process_binding` row, it **never** guesses via bare pid. It raises `dispatch_lifecycle_incident(kind='orphan_process_unverifiable')`, attempts **no** signal, and leaves the binding for operator adjudication. |
| Opaque ref | `OrcaDispatchRef` / `OrcaRunRef` — branded strings, unchanged from ORCA-S1–S3. No Orca row type crosses any S4 port. |

## 5. Mandatory process-handle provenance decision

`GAP-ANALYSIS-ORCA-DELEGATED.md` §3 and repository evidence are unambiguous:
Maestro has **no production path that owns a real workload PID or process
handle** today. `NativeResultsAuthoritativeExecutor` never spawns anything; the
only child processes anywhere under `src/main/execution/` are the disposable
SIGKILL-harness fixtures used by ORCA-S1/S2/S3's own restart tests
(`shadow-run-child.mjs`); `signalProcessTree` / `admitProcessTreeKill`
(`src/shared/child-process/process-tree-termination.ts`) exist and are proven
elsewhere (PTY sessions, Codex accounts, skill-update runs) but have **zero**
callers under Execution.

**Decision: Shape A.** ORCA-S4 proves the lifecycle/teardown machinery using an
**explicitly synthetic, Execution-spawned shadow lifecycle process**
(§4, §9) — structurally sufficient to exercise every crash window in §12,
every idempotency property in §14, and a real `signalProcessTree` /
`admitProcessTreeKill` code path under Execution for the first time. **This
slice does NOT prove, and explicitly does not claim to prove, production
process-handle acquisition** — attaching to, or being handed, the PID of a
*real* delegated workload's execution. No such seam exists in this repository
today (`GAP-ANALYSIS-ORCA-DELEGATED.md` §3), and this SPEC invents none.

Consequently, **production process-handle acquisition is added, explicitly and
normatively, to the `ORCA_DELEGATED` entry-criteria list** (§18): Slice B
cannot claim §H process-teardown ownership for real delegated dispatches until
it defines and proves, under its own frozen contract, how Orca acquires a real
workload's process/process-tree handle. This slice's `ShadowLifecycleProcessPort`
(§9) is written so that a real handle, if and when one becomes available, can
be substituted **behind the same port** without changing the durable model
(§8) or the sweep (§11) — but that substitution, and the evidence that it is
safe, is Slice B's job, not this slice's claim.

Real (non-`MockExecutor`) executor parity (ORCA-S1 residual R1) remains
separate and orthogonal — Slice B may need production process-handle
acquisition without ever needing real executor parity, and vice versa; neither
is assumed to imply the other (`GAP-ANALYSIS-ORCA-DELEGATED.md` §6.2).

## 6. Inputs / outputs

**Inputs (read-only to the sweep, except where §9/§10 note a real side
effect):**

- Execution store: `run_binding`, `run_reservation`, `settlement_observation`
  (ORCA-S2), `worktree_provenance`, `dispatch_worktree` (ORCA-S3), and the four
  new S4 SOURCE/incident tables.
- The durable ORCA-S3 shadow-worktree root's `worktrees/` and `identity/`
  subtrees (read, and — only when eligible, §10 — deleted).
- The durable shadow-lifecycle-root's `process/` subtree (the S4 process
  identity sidecars — read, written at spawn time, deleted at reap time).
- Live `ChildProcess` handles for shadow lifecycle processes spawned by the
  **current** composition-root instance (in-memory only — lost across a
  restart, §9.3).
- `now()` clock; bounded retry budgets (spec constants, §13).

**Outputs (all Execution-owned, advisory):**

- `dispatch_process_binding` rows (write-once per `orca_dispatch_id`, at bind
  time — §9.2).
- `dispatch_termination` rows (write-once per `correlation_id`).
- `worktree_finalization` rows (write-once intent, then one permitted
  `status` transition to `finalized` / `skipped_not_eligible` / `conflicted`).
- `dispatch_lifecycle_incident` rows for the four S4 `kind`s (blocking,
  non-fabricating) — **never** `settlement_incident` or
  `worktree_provenance_incident`.
- `dispatch_lifecycle_closure` rows (write-once per `correlation_id`).
- `dispatch_lifecycle_event` rows (write-once per `(correlation_id,
  event_kind)`).
- A real, verified termination of the synthetic shadow lifecycle process
  (§9.3) and a real deletion of the eligible durable shadow worktree (§10.2) —
  the **actual side effects** this slice exists to prove safe, both scoped
  exclusively to Execution's own shadow resources.
- A `DelegationBoundaryLifecycleReport` + frozen evidence bundle (JSON),
  analogous to ORCA-S2/S3's evidence bundles, carrying the closed set, the
  legacy / non-lifecycle-managed set, incidents, the retryable list (each with
  attempt counts), and the orphan-reap audit log (§10.3) — never a silent
  skip.

**Not an output:** any `data/app.db` write; any `agent_runs` write; any
`settlement_incident` or `worktree_provenance_incident` row; any real external
terminal-event delivery; any termination or deletion of a resource S4 did not
itself spawn/create under Execution's own shadow roots.

## 7. Allowed / forbidden state transitions

**Allowed:**

- `dispatch_process_binding: (absent) → present` — **only** at the bind-time
  seam (§9.2), in the same Execution transaction as `run_binding` and
  `dispatch_worktree`.
- `dispatch_termination: (absent) → present` — **once**, on confirmed
  self-exit or confirmed, identity-verified signalled termination (§9.3).
  Every column immutable thereafter.
- `worktree_finalization: (absent) → status='intent_recorded'` — once, before
  any filesystem deletion is attempted (§10.2).
- `worktree_finalization.status: 'intent_recorded' → 'finalized'` — after a
  successful (or idempotently-already-done) deletion.
- `worktree_finalization.status: 'intent_recorded' → 'skipped_not_eligible'` —
  for a legacy / pre-S3 binding with no durable worktree to finalize at all
  (mirrors ORCA-S3 `LEGACY_BINDING_NOT_CONVERGEABLE`, one level up).
- `worktree_finalization.status: 'intent_recorded' → 'conflicted'` (+
  `conflicted_at`) — Phase-B re-verify finds the eligibility digest changed
  between intent and act (§10.2, §13 window L-conflict); the filesystem act is
  **not** attempted in this pass.
- `dispatch_lifecycle_incident: (absent) → present (blocked=1)` — a stable
  semantic contradiction (§8.4), never fabricated.
- `dispatch_lifecycle_closure: (absent) → present` — **once**, after
  termination and finalization both reach a terminal status, referencing
  (never re-deciding) the constituent facts.
- `dispatch_lifecycle_event: (absent) → present` — **once** per
  `(correlation_id, event_kind)`, after closure.
- `(no state change) — LEGACY_BINDING_NOT_LIFECYCLE_MANAGED` — a pre-S4
  binding. Reported only; no row anywhere.
- Orphan reap (§10.3) — filesystem/process deletion **without** a
  corresponding Execution-store row, because none was ever committed;
  recorded only in the evidence-bundle audit log, never as a fabricated
  `correlation_id`-keyed row.

**Forbidden:**

- Any `dispatch_process_binding` for a binding not created after S4 is
  composed (no retroactive spawn for a legacy binding).
- Signalling any process by bare pid without a durable, sidecar-verified
  identity match — **for both** the live-handle and the restart-recovered
  path.
- Deleting any filesystem path that does not canonicalize **inside** the
  configured durable shadow-worktree root or durable shadow-lifecycle root
  (`isInside` guard, mirrors ORCA-S3 §7.2/§9).
- Any `worktree_finalization` filesystem act before its `intent_recorded` row
  is committed.
- Any `dispatch_lifecycle_closure` or `dispatch_lifecycle_event` row written
  from anything other than already-durable constituent facts (no synthesized
  termination outcome, no synthesized finalization outcome).
- Any write to `data/app.db`, `agent_runs`, `settlement_incident`,
  `worktree_provenance`, `worktree_provenance_incident`, `parity_observation`;
  any `finalizeRunOnce` call in any mode; any real external terminal-event
  delivery.
- **Any modification of `reconcile-shadow-execution-state.ts` or
  `converge-worktree-provenance*.ts`; any insertion of an S4 phase into either
  coordinator.**
- **Any modification of `orca-execution-plane.ts` or
  `native-results-authoritative-executor.ts`.**
- Terminating or deleting any resource S4 did not itself spawn/create under
  Execution's own durable shadow roots (no real user process, no real user
  worktree, no other slice's fixture).
- Any queue / capacity / admission / scheduler / `promoteReadyTasks` /
  `OrganizationalTask` completion effect (§J, §K).
- Any transition in `AICONTROL_NATIVE → ORCA_SHADOW → ORCA_DELEGATED →
  ORCA_AUTHORITATIVE`.

## 8. Durable model (Execution-owned, schema v4 → v5 — additive only)

Schema `EXECUTION_SCHEMA_VERSION` 4 → 5. **Six new tables + their indexes; zero
column added to any ORCA-S1/S2/S3 table.** The versioned ladder in
`execution-schema.ts` gets a `current < 5` step whose body is only "ensure the
six S4 tables + indexes exist" (no `ALTER`).

### 8.0 A new SOURCE/PROJECTION wrinkle: ephemeral origin

ORCA-S2's `settlement_observation` and ORCA-S3's `worktree_provenance` are both
classified **PROJECTION** — durable, but *rebuildable*, because their content
is re-derived from a **persistent** external source (Orca's durable shadow
`orchestration.db`; the durable shadow worktree's Git objects) that remains
readable after the fact. **S4 introduces the first Execution-owned fact whose
origin is genuinely ephemeral**: a live process's exit, and a filesystem
deletion. Once a process is reaped, the OS has nothing left to re-read; once a
worktree is deleted, there is no Git object left to re-derive `base_commit`
from. **`dispatch_process_binding`, `dispatch_termination`, and
`worktree_finalization` are therefore SOURCE, not PROJECTION** — they are the
**only** durable record of an event that cannot be re-observed, and a
projection rebuild must never drop them (§8.8). `dispatch_lifecycle_incident`,
`dispatch_lifecycle_closure`, and `dispatch_lifecycle_event` remain
**PROJECTION**: each is a pure, deterministic function of already-durable
SOURCE facts (S4's own, plus ORCA-S2/S3's), so a projection rebuild may safely
drop and regenerate them.

### 8.1 `dispatch_process_binding` — durable SOURCE state (spawn-time identity)

```
dispatch_process_binding (
  orca_dispatch_id  TEXT PRIMARY KEY,
  correlation_id    TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  orca_run_id       TEXT NOT NULL,
  process_nonce     TEXT NOT NULL,      -- immutable Execution-minted random id
  pid               INTEGER NOT NULL,   -- corroborating only; never identity by itself
  kill_scope        TEXT NOT NULL,      -- 'posix-process-group' | 'win-taskkill-tree'
  spawned_at        TEXT NOT NULL,
  teardown_requested_at TEXT            -- set durably BEFORE signalProcessTree is called (§9.3, window L6)
)
CREATE INDEX IF NOT EXISTS dispatch_process_binding_by_correlation ON dispatch_process_binding(correlation_id);
```

- Written **once**, at the bind-time seam (§9.2), in the **same** SQLite
  transaction as `run_binding` and `dispatch_worktree`. The matching **process
  identity sidecar** (`<durableShadowLifecycleRoot>/process/<orcaDispatchId>.json`
  = `{ correlationId, orcaRunId, orcaDispatchId, processNonce, spawnedAt }`) is
  written atomically (temp + `rename`) **before** the process is spawned and
  **before** the transaction opens (§9.2).
- `teardown_requested_at` is the **one** permitted post-insert mutation — set
  in its own small update **before** `signalProcessTree` is called, so a crash
  during signalling can still be honestly classified on restart (§12 window
  L6) rather than reported as "unknown cause."
- SOURCE. Never dropped by a projection rebuild (§8.8).

### 8.2 `dispatch_termination` — durable SOURCE state (ephemeral capture)

```
dispatch_termination (
  correlation_id      TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id    TEXT NOT NULL,
  termination_method  TEXT NOT NULL,   -- self_exit | signalled | confirmed_dead_unknown_cause
  exit_code           INTEGER,         -- NULL when unknown (confirmed_dead_unknown_cause)
  exit_signal         TEXT,            -- NULL when unknown
  tree_verified       INTEGER NOT NULL,-- 1 = signalProcessTree / self-exit confirmed; 0 = root-only confirmation (§9.3)
  observed_at         TEXT NOT NULL
)
```

- Written **once**. Every column immutable thereafter — there is **no** Phase-B
  re-verify for a termination fact, because the source event cannot recur
  (§8.0). A duplicate observation attempt is a PK-collision no-op (§14 LIFE-6).
- `termination_method='confirmed_dead_unknown_cause'` is the honest outcome
  for the case where S4 lost its live `ChildProcess` handle across a restart
  **and** finds the process no longer live, but holds no durable
  `teardown_requested_at` marker proving *S4* asked for the death (§12 window
  L1). It is **not** an error and **not** an incident — it is the truthful
  limit of what a durable record can prove about an already-vanished OS
  process. `exit_code` / `exit_signal` are `NULL` in this case; **never**
  invented.
- SOURCE. Never dropped by a projection rebuild.

### 8.3 `worktree_finalization` — durable SOURCE state (irreversible act)

```
worktree_finalization (
  correlation_id       TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id     TEXT NOT NULL,
  slice_ref            TEXT NOT NULL,
  eligibility_digest   TEXT NOT NULL,   -- SHA-256 over the inputs that established eligibility (§10.1)
  intent_recorded_at   TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'intent_recorded', -- intent_recorded | finalized | skipped_not_eligible | conflicted
  finalized_at         TEXT,
  outcome_detail_json  TEXT,
  conflicted_at        TEXT
)
```

- `status: 'intent_recorded'` is written **before** any filesystem deletion is
  attempted (§10.2). The filesystem act itself is **idempotent by
  construction** (deletion tolerates "already gone"), so `'intent_recorded' →
  'finalized'` is safe to retry from either side of the act (§12 windows
  L3–L5).
- `status: 'intent_recorded' → 'conflicted'` fires only if a **Phase-B
  re-verify**, run immediately before the filesystem act on a *retried* pass,
  finds the `eligibility_digest` no longer matches current durable state (an
  extremely narrow window, since ORCA-S2/S3 facts are immutable once written —
  §10.2 documents the one way this can still legitimately occur).
- SOURCE. Never dropped by a projection rebuild — the deletion, once done,
  cannot be re-derived from anything else.

### 8.4 `dispatch_lifecycle_incident` — S4-only incident channel (PROJECTION)

```
dispatch_lifecycle_incident (
  id               TEXT PRIMARY KEY,
  correlation_id   TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  orca_dispatch_id TEXT,
  slice_ref        TEXT NOT NULL,
  kind             TEXT NOT NULL,      -- process_identity_mismatch | orphan_process_unverifiable | worktree_finalization_conflict | orphan_worktree_unverifiable
  evidence_digest  TEXT NOT NULL,
  detail_json      TEXT NOT NULL,      -- observed durable facts only; NO invented state
  blocked          INTEGER NOT NULL DEFAULT 1,
  resolved_at      TEXT,
  resolution_note  TEXT,
  raised_at        TEXT NOT NULL
)
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_lifecycle_incident_unique
  ON dispatch_lifecycle_incident(correlation_id, kind, evidence_digest);
CREATE INDEX IF NOT EXISTS dispatch_lifecycle_incident_by_slice
  ON dispatch_lifecycle_incident(slice_ref);
```

- **Open-incident predicate** `hasOpenLifecycleIncident(correlationId)` is
  consulted **only** by `convergeDelegationBoundaryLifecycle`. It **never**
  suppresses ORCA-S2's `convergeSettlements`, ORCA-S3's
  `convergeWorktreeProvenance`, or ORCA-S1's abandon semantics — mirrors
  ORCA-S3 PROV-10 one level up (§14 LIFE-9).
- Rules mirror ORCA-S2 §13 / ORCA-S3 §7.3: a retry on the same evidence is a
  UNIQUE-index no-op; genuinely different evidence is a new row; **never**
  auto-resolved. `detail_json` contains only what was observed.
- **Classified PROJECTION** (not SOURCE): a re-sweep against the **same**
  underlying SOURCE contradiction reliably re-raises the same
  `evidence_digest` — the contradiction, not the incident row, is what's
  durable. A projection rebuild drops and regenerates it exactly like ORCA-S3
  §7.5 drops `worktree_provenance_incident`.

### 8.5 `dispatch_lifecycle_closure` — the closure fact (PROJECTION)

```
dispatch_lifecycle_closure (
  correlation_id          TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id        TEXT NOT NULL,
  orca_run_id             TEXT NOT NULL,
  slice_ref               TEXT NOT NULL,
  settlement_status_ref   TEXT NOT NULL,   -- copy of settlement_observation.status at closure time
  worktree_provenance_ref TEXT NOT NULL,   -- 'recorded' | 'conflicted' | 'legacy_not_convergeable'
  termination_method_ref  TEXT NOT NULL,   -- copy of dispatch_termination.termination_method
  finalization_status_ref TEXT NOT NULL,   -- copy of worktree_finalization.status
  closure_digest          TEXT NOT NULL,   -- SHA-256 over the four *_ref columns only
  closed_at               TEXT NOT NULL
)
```

- Written **once** per `correlation_id`, after `dispatch_termination` exists
  and `worktree_finalization.status ∈ {finalized, skipped_not_eligible}`.
  Every column immutable thereafter — this is the row Slice B will one day
  **copy, never re-decide**, into `data/app.db` (§18).
- `closure_digest` excludes `closed_at` and every id — mirrors ORCA-S3
  PROV-2's exclusion discipline exactly.
- **PROJECTION**: rebuildable, because all four `*_ref` inputs are themselves
  already-durable facts (three S4 SOURCE rows' terminal columns, plus ORCA-S2's
  `settlement_observation.status` and ORCA-S3's `worktree_provenance.status`),
  none of which requires re-reading anything ephemeral. A rebuild + re-sweep
  reproduces a byte-for-byte-equivalent row (excluding `closed_at`).
- **This is NOT aiControlCenter's `execution_attempts` table.** It is a
  Maestro-native, Execution-owned, advisory reference aggregate. It never
  copies or infers *outcome semantics* — `settlement_status_ref` is a plain
  copy of a status string ORCA-S2 already decided; S4 never reinterprets what
  a terminal outcome *means* (§G item 6 discipline, one level up — see §14
  LIFE-11).

### 8.6 `dispatch_lifecycle_event` — idempotent emission record (PROJECTION)

```
dispatch_lifecycle_event (
  correlation_id      TEXT NOT NULL REFERENCES run_reservation(correlation_id),
  event_kind          TEXT NOT NULL,       -- 'shadow_delegated_boundary_closed' — the only kind S4 defines
  closure_digest_ref  TEXT NOT NULL,       -- copy of dispatch_lifecycle_closure.closure_digest
  emitted_at          TEXT NOT NULL,
  PRIMARY KEY (correlation_id, event_kind)
)
```

- Written **once** per `(correlation_id, event_kind)`, after
  `dispatch_lifecycle_closure` exists. The composite PK is the idempotency
  mechanism: a duplicate emission attempt (from a retried sweep pass, or a
  duplicate hook/callback — §12 window L9) is a no-op.
- **No real delivery.** This row exists to prove the *contract* a future real
  emitter must satisfy — write-once, idempotent, deterministic from an
  already-immutable closure — not to perform real emission. A future Slice B
  emitter is a **separate, additive** decision under its own contract; this
  table is not it.
- **PROJECTION**: a pure function of `dispatch_lifecycle_closure`; rebuildable.

### 8.7 Prospective eligibility (mirrors ORCA-S3 C3)

Just as ORCA-S3 refused to fabricate provenance for bindings that predate its
own bind-time contract (`LEGACY_BINDING_NOT_CONVERGEABLE`, S3 §7.6 window F),
S4 refuses to fabricate a process/lifecycle history for bindings that predate
**S4's own** bind-time contract. A `run_binding` with a `settlement_observation`
and a terminal `worktree_provenance` state but **no `dispatch_process_binding`
row and no S4 fact that ever existed** is `LEGACY_BINDING_NOT_LIFECYCLE_MANAGED`:
`convergeDelegationBoundaryLifecycle` reports it and moves on — **no row in
any S4 table, no incident, no block, no retroactive spawn.** First S4
activation over N historical ORCA-S1/S2/S3 bindings therefore produces **0**
S4 rows and **0** S4 incidents, exactly mirroring ORCA-S3's own first-activation
proof (S3 gate 18).

### 8.8 Source state vs projection (summary)

- **SOURCE — never dropped by a projection rebuild:** `dispatch_process_binding`,
  `dispatch_termination`, `worktree_finalization`, plus everything ORCA-S1–S3
  already classify SOURCE (`run_binding`, `dispatch_worktree`, `execution_meta`,
  the durable shadow worktree files, the durable process identity sidecars).
- **PROJECTION — the only tables an S4 projection rebuild drops + recreates:**
  `dispatch_lifecycle_incident`, `dispatch_lifecycle_closure`,
  `dispatch_lifecycle_event`. The rebuild helper mirrors ORCA-S3's: `DROP TABLE
  IF EXISTS dispatch_lifecycle_event; DROP TABLE IF EXISTS
  dispatch_lifecycle_incident; DROP TABLE IF EXISTS dispatch_lifecycle_closure;
  <PROJECTION_SQL>` — it never touches the three SOURCE tables above, the
  durable shadow worktree files, or the process identity sidecars.
- After a rebuild + a fresh `convergeDelegationBoundaryLifecycle` against the
  **same** durable SOURCE state, every regenerated `dispatch_lifecycle_closure`
  matches the pre-rebuild row on every `*_ref` column and `closure_digest`;
  every regenerated `dispatch_lifecycle_event` matches on
  `closure_digest_ref`; every regenerated incident matches on `{correlation_id,
  kind, evidence_digest, detail_json, blocked}`. Local metadata (`closed_at`,
  `emitted_at`, `raised_at`, incident `id`) is excluded from the comparison.

## 9. Process lifecycle — port, adapter, and bind-time ordering

### 9.1 `ShadowLifecycleProcessPort`

```
ShadowLifecycleProcessPort {
  spawn(input: {
    correlationId: string; orcaRunId: string; orcaDispatchId: string
    processNonce: string; identitySidecarPath: string
  }): { pid: number; killScope: 'posix-process-group' | 'win-taskkill-tree'; handle: ChildProcessHandle }

  observe(handle: ChildProcessHandle | null, durable: {
    pid: number; processNonce: string; identitySidecarPath: string; teardownRequestedAt: string | null
  }): Promise<ProcessLifecycleObservation>

  requestTermination(handle: ChildProcessHandle): Promise<{ verified: boolean }>
}

type ProcessLifecycleObservation =
  | { kind: 'still_running' }
  | { kind: 'self_exit'; exitCode: number | null; exitSignal: NodeJS.Signals | null }
  | { kind: 'confirmed_dead_unknown_cause' }             // handle lost across restart, no teardownRequestedAt, process no longer live
  | { kind: 'identity_unverifiable' }                    // restart-recovered pid exists but sidecar/nonce cannot confirm it is the same process
```

**Adapter (infrastructure, Execution-owned):** wraps `spawnProcess` /
`signalProcessTree` / `admitProcessTreeKill` from
`src/shared/child-process/process-tree-termination.ts` and
`process-tree-kill-gate.ts` — **reused, not reimplemented**, per AGENTS.md
"Reuse Before Reimplementing." Two call shapes:

1. **Same-process-instance path** (the common case — the composition root that
   spawned the child is still the one sweeping): S4 holds the live
   `ChildProcess` handle in memory. `requestTermination` calls the **existing**
   `signalProcessTree(handle, 'SIGTERM')` unchanged, which already fails
   closed on a reaped-pid race (the primitive's own documented POSIX/Windows
   discipline) and already reports `verified: boolean`.
2. **Restart-recovered path** (the host process restarted; no live handle
   survives): S4 has only the durable `pid` + `processNonce` + the identity
   sidecar. **This path requires one new, narrow addition** — a
   pid-addressed sibling entry point built on the **same**
   `admitProcessTreeKill` gate and the **same** platform branches
   `process-tree-termination.ts` already implements, because the existing
   public API is `ChildProcess`-shaped only and there is no Node primitive to
   "re-attach" a `ChildProcess` object to an unrelated pid after a restart.
   Before ever calling it, the adapter re-verifies identity: the process
   identity sidecar must still exist, parse, and exactly equal the durable
   `dispatch_process_binding` row (`correlationId`, `orcaRunId`,
   `orcaDispatchId`, `processNonce`), **and** the target pid must currently
   exist. Either check failing → `{ kind: 'identity_unverifiable' }` — **no
   signal is ever sent**, and the adapter fails closed exactly like ORCA-S3's
   identity check (§9.3).

### 9.2 Bind-time ordering (extends ORCA-S3 §7.6, DB ↔ filesystem ↔ process)

S4 **extends** the existing ORCA-S3 bind-time transaction with two more
pre-transaction steps and one more insert — the same discipline, the same
transaction, one seam:

1. create the durable shadow worktree (ORCA-S3 step 1);
2. atomically write the worktree identity sidecar (ORCA-S3 step 2);
3. **atomically write the process identity sidecar**
   `<durableShadowLifecycleRoot>/process/<orcaDispatchId>.json` = `{
   correlationId, orcaRunId, orcaDispatchId, processNonce, spawnedAt: null }`
   — temp file + `rename`, **before** the process exists (§4 new);
4. **spawn** the shadow lifecycle process (`spawnProcess`, `detached: true`) →
   obtain `pid`; **rewrite** the sidecar's `spawnedAt` in place (same
   temp+rename discipline) now that spawn succeeded (§4 new);
5. `BEGIN IMMEDIATE`;
6. `INSERT run_binding` (ORCA-S1);
7. `INSERT dispatch_worktree` (ORCA-S3);
8. `INSERT dispatch_process_binding` (§4 new);
9. `COMMIT`.

Steps 6–8 are **one** SQLite transaction. Both sidecars (steps 2 and 3/4) are
written **before** that transaction opens. **Required invariant, extended:** a
committed `dispatch_process_binding` row ⇒ the process identity sidecar was
written before the DB commit, **and** the process was actually spawned before
the commit (never the reverse). Crash windows across this extended ordering
are enumerated in §12 — the ORCA-S3 windows A–G are **unchanged** by this
extension (this SPEC adds no filesystem/DB interaction to S3's own steps 1–2
and 6–7); S4 adds its own windows on top (§12 L-prefixed).

### 9.3 Termination — fail-closed identity, no bare-pid kill

`convergeDelegationBoundaryLifecycle`'s Phase 1 (§11) calls `observe(...)` for
every `dispatch_process_binding` with no `dispatch_termination` yet:

- **Live handle present, process already exited on its own** (no
  `teardown_requested_at` set) → `{ kind: 'self_exit', exitCode, exitSignal }`
  → `INSERT dispatch_termination(termination_method='self_exit',
  tree_verified=1)`.
- **Live handle present, still running** → S4's teardown policy for a
  synthetic proof fixture is **immediate**: it has no real work to wait for.
  `UPDATE dispatch_process_binding SET teardown_requested_at = now WHERE
  orca_dispatch_id = ? AND teardown_requested_at IS NULL` (durable intent
  **before** signalling — closes the honesty gap for window L6), then call
  `requestTermination(handle)` → the **existing** `signalProcessTree`. On
  settle: `INSERT dispatch_termination(termination_method='signalled',
  tree_verified=<returned boolean>)`. A `tree_verified=0` result (the
  documented Windows reaped-pid / POSIX-gate-refusal case) is **not** an
  incident — the primitive's own contract guarantees the root died through its
  handle regardless (`process-tree-termination.ts`'s own doc comment: *"a
  refusal is never a leak"*); S4's shadow lifecycle process is, by
  construction, a single leaf process with no descendants, so root-only
  confirmation is sufficient here. **If a future revision ever gives the
  shadow lifecycle process real descendants, `tree_verified=0` must be
  revisited before it can still be treated as sufficient — flagged explicitly
  as a scope boundary, not silently assumed safe.**
- **No live handle (restart-recovered), `teardown_requested_at` already set,
  process no longer live** → `identity_unverifiable` is skipped (sidecar
  still confirms identity, and durable intent to kill was already recorded);
  classify `{ kind: 'signalled' }`-equivalent:
  `INSERT dispatch_termination(termination_method='signalled',
  tree_verified=0)` — honestly labeled unverified-by-tree but attributable to
  a durably-recorded S4 request, never `confirmed_dead_unknown_cause`.
- **No live handle, no `teardown_requested_at`, process no longer live** →
  `{ kind: 'confirmed_dead_unknown_cause' }` →
  `INSERT dispatch_termination(termination_method='confirmed_dead_unknown_cause',
  exit_code=NULL, exit_signal=NULL, tree_verified=0)` (§8.2, §12 window L1).
- **No live handle, process still live, identity sidecar + nonce confirm it**
  → restart-recovered termination path (§9.1.2): re-verify, then the
  pid-addressed sibling entry point, then record exactly as the live-handle
  branch above.
- **Identity cannot be confirmed** (sidecar missing/corrupt/mismatched, or a
  live pid that the sidecar does not corroborate) →
  `dispatch_lifecycle_incident(kind='process_identity_mismatch'` or
  `'orphan_process_unverifiable')`, **blocked**, **no termination fact, no
  signal ever sent** (§7 forbidden; §14 LIFE-2).

## 10. Worktree finalization — governed reap

### 10.1 Eligibility

A binding's durable ORCA-S3 shadow worktree becomes eligible for finalization
only when **all** of:

1. `settlement_observation.status ∈ {observed, observed_conflicted}` (ORCA-S2
   terminal);
2. `worktree_provenance.status ∈ {recorded, conflicted}` **or** ORCA-S3
   reported `LEGACY_BINDING_NOT_CONVERGEABLE` for this binding — either way,
   **no future ORCA-S3 provenance read will ever need this worktree again**
   (a `recorded`/`conflicted` row is immutable per ORCA-S3 §7.1/§12 PROV-2; a
   legacy binding never had a `dispatch_worktree` row to begin with, so there
   is nothing S3 could still read);
3. `dispatch_termination` exists for this `correlation_id` (the shadow
   process, if any was ever spawned for it, is confirmed gone);
4. **no** open `dispatch_lifecycle_incident` for this binding;
5. **no** open `worktree_provenance_incident` for this binding (never override
   an ORCA-S3 block — mirrors PROV-10 the other direction).

`eligibility_digest = SHA-256(settlement_observation.status ‖
worktree_provenance.status-or-'legacy' ‖ dispatch_termination.termination_method)`.
Because every one of these three inputs is immutable once written (ORCA-S2
§7.1 / ORCA-S3 §7.1 / S4 §8.2 all forbid mutation after Phase A), the digest
**cannot legitimately change** once eligibility is first established — the
`conflicted` transition (§10.2) exists only to catch a genuine implementation
defect or an out-of-band data mutation, never an expected runtime path.

### 10.2 Two-step act: intent, then filesystem, then result

1. `BEGIN IMMEDIATE; INSERT worktree_finalization(status='intent_recorded',
   eligibility_digest, intent_recorded_at=now); COMMIT` — durable intent
   **before** any deletion.
2. **Re-verify** the digest against current durable state (defensive; should
   always match per §10.1). Mismatch → `UPDATE … SET status='conflicted',
   conflicted_at=now`; **no deletion attempted**; surfaced as a
   `worktree_finalization_conflict` incident (this is the one path that DOES
   raise an S4 incident from this table, because a genuine digest mismatch
   here means an S2/S3 immutability invariant was violated elsewhere — a
   signal worth blocking on, not silently retrying).
3. On match: delete the durable shadow worktree directory
   (`rmSync(worktreeDir, { recursive: true, force: true })` — `force: true`
   makes "already gone" a success, not an error) **and** its ORCA-S3 identity
   sidecar, guarded by `isInside(target, durableShadowWorktreeRoot)` before
   every deletion (fail closed on any path that would escape the configured
   root — mirrors ORCA-S3 §7.2/§9's own confinement discipline).
4. `UPDATE worktree_finalization SET status='finalized', finalized_at=now,
   outcome_detail_json=... WHERE correlation_id=? AND status='intent_recorded'`.

A crash between any two of these steps leaves `status='intent_recorded'`
durable; the next sweep pass **retries from step 2** — safe because step 3 is
idempotent by construction (deletion of an already-absent path is a success,
never an error) and step 1 never runs twice (its own PK forbids a second
`INSERT`). This collapses what the mission brief lists as three separate
scenarios — "finalization succeeds before durable acknowledgement," "cleanup
intent persists before side effect," and "side effect occurs before result
persistence" — into **one** recovery code path, because the act performed in
step 3 is deliberately designed to be safely repeatable (§12 windows L3–L5).

A legacy / pre-S3 binding (`worktree_provenance_ref = 'legacy_not_convergeable'`,
never had a durable worktree at all) records `status='skipped_not_eligible'`
directly from `intent_recorded` — no filesystem act, nothing to delete.

### 10.3 Orphan reconciliation (separate sweep, no fabricated identity)

`reconcileOrphanShadowState`, invoked **once per composition-root run before**
the main sweep chain, handles two classes S3/S4's bind-time transactions can
leave behind — **neither ever received a committed Execution-store row**, so
neither gets a `correlation_id`-keyed durable fact; both are audit-logged only
(evidence bundle, never a fabricated DB identity):

- **ORCA-S3 windows A–C orphans** (worktree created and/or worktree identity
  sidecar written, but the ORCA-S3 transaction never committed — S3 §7.6,
  explicitly deferred here). Scan the durable shadow-worktree root's
  `worktrees/` and `identity/` subtrees for entries with **no** matching
  committed `dispatch_worktree` row. Reap only entries older than a bounded,
  configured `orphanGraceMs` (defends against racing an in-flight bind that
  has not committed yet). Deletion uses the same `isInside`-guarded,
  idempotent act as §10.2.
- **S4's own pre-commit process-spawn orphans** (§9.2 steps 3–4 ran, the
  process identity sidecar exists and the process may still be **live**, but
  the `dispatch_process_binding` transaction never committed — a window
  ORCA-S3's own ordering did not have, because S3 never spawns anything).
  Scan the durable shadow-lifecycle root's `process/` subtree for sidecars
  with **no** matching committed `dispatch_process_binding` row, older than
  `orphanGraceMs`. For each: re-verify liveness + identity via the sidecar
  (same discipline as §9.3's restart-recovered path); if live and verifiable,
  terminate it through the same pid-addressed entry point; either way, delete
  the orphan sidecar once the process is confirmed gone. **Identity-unverifiable
  → skip, log, do not touch** — fail closed exactly as §9.3 requires; an
  orphan sweep is not exempt from the identity discipline the main sweep
  observes.

Both classes are logged in the `DelegationBoundaryLifecycleReport`'s
`orphanReapAudit` list (`{ kind, path-or-pid-fingerprint (never a raw absolute
path — hashed), observedAt, action }`) — **never** a silent skip, and never a
durable row asserting an Execution-store identity that was never actually
committed.

## 11. Convergence design — third sibling sweep

`convergeDelegationBoundaryLifecycle(sliceRef, now)` is invoked by the
composition boundary **after** `convergeWorktreeProvenance(...)` (ORCA-S3)
returns. It reads `run_binding` + `settlement_observation` +
`worktree_provenance` + `dispatch_worktree` + the four S4 tables, and performs
the real side effects of §9/§10. **Never** a phase inside ORCA-S2 or ORCA-S3's
own coordinators.

**Phase 1 — Observe & tear down** (§9.3): for every `dispatch_process_binding`
with no `dispatch_termination` and no open `process_identity_mismatch` /
`orphan_process_unverifiable` incident, resolve and act as §9.3 describes.

**Phase 2 — Finalize** (§10.1–10.2): for every binding with
`dispatch_termination` recorded, eligible per §10.1, and no
`worktree_finalization` row yet, perform the two-step act.

**Phase 3 — Close**: for every binding with `dispatch_termination` recorded and
`worktree_finalization.status ∈ {finalized, skipped_not_eligible}` and no
`dispatch_lifecycle_closure` row yet, compute the four `*_ref` values and the
`closure_digest`, then `INSERT dispatch_lifecycle_closure`.

**Phase 4 — Emit**: for every `dispatch_lifecycle_closure` with no
`dispatch_lifecycle_event` row of `event_kind='shadow_delegated_boundary_closed'`,
`INSERT` it (composite-PK idempotent).

**Prospective skip**: a `run_binding` with a `settlement_observation` and a
terminal `worktree_provenance` state but no `dispatch_process_binding` and no
S4 fact that ever existed → `LEGACY_BINDING_NOT_LIFECYCLE_MANAGED` (§8.7),
reported only.

**Fixed-point property (LIFE-fixed-point):** running Phases 1–4 N times on
unchanged durable state ≡ running them once. A retryable result
(`LIFECYCLE_STORE_BUSY_RETRYABLE`, `LIFECYCLE_FS_OPERATIONAL_RETRYABLE`,
`LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE`) writes **nothing** durable and
performs **no** real side effect, leaving the binding for the next pass. This
holds **per binding, independently** — a host restart mid-batch (some bindings
fully advanced through Phase 4, others stalled at Phase 1) resumes correctly
because every phase's precondition is a durable fact, never in-memory
sweep-loop state (§12 window L11).

## 12. Crash / restart window table

**SQLite, filesystem, and OS process state are three independently-crashable
media; nothing commits them atomically together.** Windows are lettered `L1`–`L11`
to avoid collision with ORCA-S3's `A`–`G` (unchanged, unaffected — S4 adds no
interaction with S3's own steps).

| # | Crash / classification point | Durable DB state | Process / filesystem state | S4 behaviour |
| --- | --- | --- | --- | --- |
| **L1** | shadow lifecycle process exits (or the whole host restarts across its death) **before** `dispatch_termination` is written, **and** `teardown_requested_at` was never set | `dispatch_process_binding` committed, no `dispatch_termination` | process gone; sidecar present | `termination_method='confirmed_dead_unknown_cause'`, `exit_code`/`exit_signal` NULL, `tree_verified=0` — the honest limit of what can be proven about a vanished, un-requested exit. **Not** an incident. |
| **L2** | `dispatch_termination` committed, `worktree_finalization` not yet attempted | `dispatch_termination` present, no `worktree_finalization` | durable shadow worktree still present | Legitimate intermediate state — next sweep pass proceeds to Phase 2 normally; not a crash-recovery path, a sequencing proof. |
| **L3** | filesystem deletion **succeeds**, host crashes before the `status='finalized'` `UPDATE` commits | `worktree_finalization.status='intent_recorded'` | worktree already deleted | Next pass re-attempts deletion (already-absent → success, `force: true`) → `UPDATE … 'finalized'`. Idempotent by construction. |
| **L4** | `intent_recorded` commits, host crashes **before** the filesystem act ever runs | `worktree_finalization.status='intent_recorded'` | worktree still present, untouched | Next pass retries the act from scratch — same code path as L3. |
| **L5** | (mission brief lists this as a distinct scenario — "side effect occurs before result persistence") | identical shape to L3 | identical shape to L3 | **Same recovery path as L3** — the act's idempotency collapses L3 and L5 into one proof, documented explicitly rather than duplicated (§10.2). |
| **L6** | host crashes while `signalProcessTree` is in flight (signal sent, verification not yet observed) | `dispatch_process_binding.teardown_requested_at` **set** (written durably before the signal, §9.3), no `dispatch_termination` | process dead, dying, or (rarely) still alive | Next pass: if now confirmed dead → `termination_method='signalled'` (attributable, because `teardown_requested_at` proves S4 asked), `tree_verified=0`. If still alive → resume from the restart-recovered termination path (§9.3), request again — idempotent (a second `SIGTERM`/`SIGKILL` to an already-signalled process is not an error). |
| **L7** | host crashes between §9.2 step 3/4 (process identity sidecar written, process spawned) and step 9 (`COMMIT`) | no `run_binding`, no `dispatch_worktree`, no `dispatch_process_binding` | orphan **live or dead** process + orphan process identity sidecar | `reconcileOrphanShadowState` (§10.3) discovers it via the sidecar (past the grace period), re-verifies identity/liveness, terminates if live and verifiable, deletes the sidecar. **Not** classified as corruption; not a fabricated DB row. |
| **L8** | two sweep passes (a retried pass and a fresh one) both reach Phase 2 for the **same** `correlation_id` | `worktree_finalization` PK forbids a second `INSERT`; the second pass's insert attempt is a no-op | — | Duplicate finalization request is a no-op, not a double-delete, not an error (§14 LIFE-7). |
| **L9** | a duplicate callback/hook (e.g. a future `onChildTerminated`-style wake-up) fires twice for the same process exit | `dispatch_termination` PK forbids a second `INSERT`; `dispatch_lifecycle_event` composite PK forbids a second row | — | The hook is a **wake-up hint only, never a correctness source** (mirrors ORCA-S2 Appendix C's `onDispatchSettled` framing) — the sweep's own durable-state re-verification is authoritative regardless of how many times any callback fires (§14 LIFE-8). |
| **L10** | an S4 write-transaction cannot acquire the SQLite write lock within the bounded busy-retry budget, or a projection rebuild is in progress against the three PROJECTION tables | no partial state | — | `LIFECYCLE_STORE_BUSY_RETRYABLE` — no durable row, no incident, not blocked, surfaced in the report, retried next sweep (mirrors ORCA-S2 §16.1 / ORCA-S3 gate 17 exactly). |
| **L11** | host restarts mid-batch, with some bindings in the same sweep call already advanced through Phase 4 and others still at Phase 1 | mixed, per-binding | mixed, per-binding | Every phase's precondition is a durable fact (§11 fixed-point property) — the next sweep resumes each binding independently from wherever its own durable state left it; no binding is re-processed past its already-committed terminal fact, no binding is skipped. |

## 13. Failure semantics

| Situation | S4 behaviour |
| --- | --- |
| No `settlement_observation`, or `worktree_provenance` still absent-and-not-legacy | Skipped this pass — not yet eligible (§10.1). |
| Open `worktree_provenance_incident` or `settlement_incident` for the binding | Skipped in all phases — S4 never overrides an upstream block (§14 LIFE-9). |
| Open `dispatch_lifecycle_incident` for the binding | Skipped in all phases — S4-only block. |
| `run_binding` predates S4 composition, no S4 fact ever existed | `LEGACY_BINDING_NOT_LIFECYCLE_MANAGED` — no row, no incident, no block, no retroactive spawn (§8.7). |
| Process identity cannot be confirmed (sidecar absent/corrupt/mismatched) | `dispatch_lifecycle_incident(kind='process_identity_mismatch')`; blocked; **no termination fact, no signal**. |
| Restart-recovered pid exists but the sidecar cannot corroborate it | `dispatch_lifecycle_incident(kind='orphan_process_unverifiable')`; blocked; **no signal sent**. |
| Transient error querying/signalling a process (not an identity question) | `LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE` — no row, no incident, not blocked, retried next sweep. |
| Transient filesystem error during finalization (lock/EBUSY/EPERM) | `LIFECYCLE_FS_OPERATIONAL_RETRYABLE` — no row mutation beyond `intent_recorded` (already durable), no incident, retried. |
| Finalization eligibility digest mismatch on re-verify | `worktree_finalization.status → 'conflicted'`; `dispatch_lifecycle_incident(kind='worktree_finalization_conflict')`; **no deletion attempted**. |
| Execution write-txn not acquired within the busy budget | `LIFECYCLE_STORE_BUSY_RETRYABLE` — no durable row, no incident, not blocked. |
| Any exception for one binding | Caught; `sweepError` in the report; sweep continues; `data/app.db` provably untouched; authority still `AICONTROL_NATIVE`. |
| `data/app.db` missing / has a `-wal`/`-shm` sidecar at start | `DbGuardError`; S4 does not run (ORCA-S1 gate 9 inherited). |

## 14. Invariants

- **LIFE-1 — no fabrication.** `dispatch_termination`, `worktree_finalization`,
  `dispatch_lifecycle_closure`, and `dispatch_lifecycle_event` are written only
  from already-durable, already-observed facts. An unresolvable case is
  incident-only or retryable-only — **never** a synthesized exit code, a
  synthesized finalization outcome, or a synthesized closure.
- **LIFE-2 — fail-closed identity, no bare-pid kill.** No process is ever
  signalled by pid alone. Every signal — live-handle or restart-recovered — is
  preceded by a durable identity match against the process identity sidecar.
  Identity uncertainty is **always** an incident or a skip, never a guess.
- **LIFE-3 — no premature or unconfined deletion.** `worktree_finalization`'s
  filesystem act runs only after `status='intent_recorded'` is durably
  committed, and only against a path `isInside` the configured durable
  shadow-worktree root. Orphan reap (§10.3) is bounded by `orphanGraceMs` and
  the same confinement guard.
- **LIFE-4 — SOURCE facts are never rebuilt.**
  `dispatch_process_binding` / `dispatch_termination` / `worktree_finalization`
  are excluded from every projection-rebuild DROP list (§8.8). Only
  `dispatch_lifecycle_incident` / `dispatch_lifecycle_closure` /
  `dispatch_lifecycle_event` are ever dropped and regenerated.
- **LIFE-5 — closure copies, never re-decides.** `dispatch_lifecycle_closure`'s
  `*_ref` columns are verbatim copies of already-decided statuses. S4 never
  reinterprets what an ORCA-S2 settlement outcome or an ORCA-S3 provenance
  status *means* — mirrors §G item 6's "copies — never re-decides," one level
  early, one level advisory (§8.5).
- **LIFE-6 — termination is write-once.** No Phase-B re-verify exists for
  `dispatch_termination`, because the source event cannot recur (§8.0). A
  duplicate observation is a PK-collision no-op.
- **LIFE-7 — no duplicate side effects.** A retried finalization is a no-op on
  the DB (PK) and a no-op in effect (idempotent deletion). A retried
  termination request against an already-dead process is a no-op (signalling
  a reaped/refused pid never re-executes a kill it already performed — the
  existing primitive's own contract). A retried emission is a no-op (composite
  PK).
- **LIFE-8 — hooks are wake-up hints, never correctness sources.** Any future
  process-exit callback (`onChildTerminated` or equivalent) may trigger the
  sweep to run sooner; it **never** substitutes for the sweep's own
  durable-state re-verification, and a callback firing zero, one, or many
  times produces identical durable results (§12 window L9).
- **LIFE-9 — incident isolation.** `dispatch_lifecycle_incident`'s
  open-incident predicate gates **only** `convergeDelegationBoundaryLifecycle`.
  It never suppresses ORCA-S1/S2/S3 reconciliation. S4 never writes, alters, or
  schema-changes `settlement_incident` or `worktree_provenance_incident`.
- **LIFE-10 — advisory only / zero authority movement.** No `data/app.db`
  write; no `finalizeRunOnce` (any mode); no `agent_runs` write; no client
  signal; no real external terminal-event delivery. `data/app.db` SHA-256 ==
  the operational baseline before and after, including every incident and
  crash-window path. Authority before == after == `AICONTROL_NATIVE`; Orca
  mode == `ORCA_SHADOW_ADVISORY`.
- **LIFE-11 — one correctness authority per fact, no dual write.** Each of the
  six S4 tables has exactly **one** writer: `convergeDelegationBoundaryLifecycle`
  (or the bind-time seam for `dispatch_process_binding`). S4 never writes an
  ORCA-S1/S2/S3 table. No two components ever decide the same fact
  concurrently.
- **LIFE-12 — prospective eligibility; legacy bindings are inert.** A pre-S4
  binding is `LEGACY_BINDING_NOT_LIFECYCLE_MANAGED` — no row, no incident, no
  block, no retroactive spawn (§8.7).
- **LIFE-13 — scoped to Execution's own shadow resources.** Every process S4
  terminates and every worktree S4 deletes was spawned/created by Execution
  itself under a durable shadow root it controls. S4 never touches a real user
  process or a real user worktree.
- **LIFE-14 — no stage advance.** No transition in `AICONTROL_NATIVE →
  ORCA_SHADOW → ORCA_DELEGATED → ORCA_AUTHORITATIVE` occurs.

## 15. Out of scope (explicit)

- **Production process-handle acquisition** for a real delegated workload —
  explicitly not proven here (§5); added as an `ORCA_DELEGATED` entry
  criterion (§18).
- **Real (non-`MockExecutor`) executor parity** (ORCA-S1 residual R1) — still
  deferred, orthogonal to lifecycle ownership (§6.2 gap analysis).
- **Any terminal-projection path into `data/app.db`** (§G item 6) — Slice B's
  job; S4 writes no S4 table's content there and adds no code path that could.
- **Any real external terminal-event delivery** — `dispatch_lifecycle_event`
  proves idempotency semantics only; a real emitter is a separate, additive
  Slice B (or later) decision.
- **Any authority transfer / cutover** (`ORCA_DELEGATED` / `ORCA_AUTHORITATIVE`).
- **Capacity / admission / FIFO / `QUEUE_FULL` / scheduler semantics** —
  `ORCA_AUTHORITATIVE`, untouched (§J, §K, gap analysis §5.2).
- **Retirement of `NativeResultsAuthoritativeExecutor` or the disposable
  aiControl-env gate-8 harness** — a Slice-B-or-later candidate per the gap
  analysis §5 decision 10; not this slice's job.
- **Retirement of any aiControlCenter-owned code** — lives in a different
  repository under its own amendment process.
- **Any modification of ORCA-S2/S3's own coordinators, incident channels, or
  tables** — read-only inputs to S4, never written.
- **Upstream Orca integration; any Orca-core modification.**
- **Reads or side effects against the user's real / production
  `orchestration.db` or real worktrees** — S4 acts only on Execution's own
  durable shadow resources.

## 16. Acceptance gates (all mandatory; independent acceptance in a fresh session)

1. **Spec satisfied** — implementation matches the frozen spec; no silent
   redefinition; a real conflict → `CONTRACT_CONFLICT` → amendment.
2. **Module / authority boundary** — no forbidden cross-module import; no Orca
   row type in `domain/` or `application/`; all six S4 tables Execution-owned;
   **no `settlement_incident` / `worktree_provenance_incident` /
   `worktree_provenance` / `dispatch_worktree` write anywhere**;
   `reconcile-shadow-execution-state.ts`, `converge-worktree-provenance*.ts`,
   `orca-execution-plane.ts`, and `native-results-authoritative-executor.ts`
   byte-unchanged.
3. **Genuine RED-before-GREEN** — for LIFE-1..14 and each §12 window (L1–L11),
   a failing test captured **before** the behaviour it checks. Evidence:
   `slices/delegated-side-effect-boundary/RED-EVIDENCE.md`.
4. **Durable lifecycle SOURCE facts** — a test asserts `dispatch_process_binding`,
   `dispatch_termination`, and `worktree_finalization` survive a projection
   rebuild untouched (§8.8), and that only the three PROJECTION tables are
   ever dropped by it.
5. **Terminal-fact immutability** — `dispatch_termination` accepts no
   post-insert mutation of any column, under a direct write attempt and under
   a duplicate-observation race.
6. **Worktree finalization safety** — no filesystem deletion occurs before its
   `intent_recorded` row commits; every deletion target is asserted
   `isInside` the configured durable root; a confirmed-absent target is
   treated as success, not an error.
7. **Process identity safety** — no signal is ever sent without a prior,
   sidecar-verified identity match, on both the live-handle and
   restart-recovered paths; a mismatched or corrupt sidecar always incidents,
   never fabricates a kill.
8. **Idempotent replay** — the sweep run ×3 back-to-back, and again after a
   projection rebuild, produces a semantically-equivalent closed set: zero
   duplicate rows, zero extra incidents, zero duplicate real side effects
   (LIFE-fixed-point, §11).
9. **Crash/restart windows (§12 L1–L11)** — a separate-child-process harness
   (mirrors ORCA-S1/S2/S3's own pattern) proves each window's documented
   recovery behaviour, including that L3/L4/L5 converge on one shared
   recovery path and that L1 never fabricates an exit code or signal.
10. **Orphan reconciliation** — seed both orphan classes (§10.3: an
    ORCA-S3-window orphan worktree with no `dispatch_worktree` row; an
    S4-window orphan process with no `dispatch_process_binding` row), each
    younger than `orphanGraceMs`; prove neither is touched. Age each past the
    grace period; prove each is safely reaped, logged in the audit list, and
    **no** Execution-store row is fabricated for either.
11. **No duplicate side effects** — a retried finalization never double-deletes
    (observably, via a spy on the deletion call plus a filesystem-state
    assertion); a retried termination request never double-signals an
    already-confirmed-dead process; a retried or duplicate-hook-triggered
    emission never produces a second `dispatch_lifecycle_event` row.
12. **No premature worktree removal** — a worktree is never deleted while
    `worktree_provenance` is still absent-and-not-legacy, while a
    `worktree_provenance_incident` is open, or before `dispatch_termination`
    exists for its binding.
13. **Retryables never become semantic incidents** — induce each of
    `LIFECYCLE_STORE_BUSY_RETRYABLE`, `LIFECYCLE_FS_OPERATIONAL_RETRYABLE`,
    `LIFECYCLE_PROCESS_OPERATIONAL_RETRYABLE`; confirm none writes a durable
    row, raises an incident, or blocks the binding, and each is surfaced with
    an attempt count.
14. **Hooks not correctness-critical** — wire a synthetic duplicate
    process-exit callback firing 0, 1, and many times across otherwise
    identical runs; confirm identical durable results in all three cases
    (LIFE-8, window L9).
15. **Zero `data/app.db` authoritative writes** — call-site audit + runtime
    test: the whole slice writes nothing to `data/app.db` (SHA-256 unchanged,
    no sidecars), including on every incident, retryable, and crash-window
    path.
16. **Zero authority transfer** — static audit: no `finalizeRunOnce` import,
    no `agent_runs` write, no queue/capacity/scheduler/`promoteReadyTasks`
    touch, no real external emission call anywhere in S4. Authority before ==
    after == `AICONTROL_NATIVE`; Orca mode == `ORCA_SHADOW_ADVISORY`.
17. **ORCA-S1 regression** — S1 acceptance suite green and byte-unchanged
    despite the extended bind-time seam (§9.2).
18. **ORCA-S2 regression** — S2 acceptance suite green and byte-unchanged;
    `convergeSettlements` Phase A/B and `reconcileIncompleteReservations` run
    unaffected by any open `dispatch_lifecycle_incident`.
19. **ORCA-S3 regression** — S3 acceptance suite (incl. `SPEC-AMENDMENT-001`'s
    `provenance_json` column) green and byte-unchanged;
    `convergeWorktreeProvenance` runs unaffected by any open S4 incident, and
    S4 never finalizes a worktree while an open `worktree_provenance_incident`
    blocks it.
20. **Operational aiControl DB guard** — `data/app.db` SHA-256 == the
    operational baseline before and after; no `-wal`/`-shm` residual.
21. **Synthetic-process labeling** — the acceptance evidence explicitly labels
    the shadow lifecycle process as synthetic/self-spawned and states, in the
    same evidence artifact, that production process-handle acquisition is
    **not** proven by this slice (§5) — no report language claims
    real-executor or real-process parity.
22. **Scoped-deletion audit** — a test enumerates every filesystem path S4 ever
    deletes across a full acceptance run and asserts each one resolves inside
    an Execution-owned durable shadow root; none resolves to a real user path.

## 17. Rollback

Advisory + additive. To roll back: stop the composition boundary from invoking
`convergeDelegationBoundaryLifecycle` and `reconcileOrphanShadowState`; revert
the bind-time seam extension in `shadow-observation-service.ts` (S4's three
added steps + one insert) back to the ORCA-S3-only ordering; drop **only** the
three PROJECTION tables (`dispatch_lifecycle_incident`,
`dispatch_lifecycle_closure`, `dispatch_lifecycle_event`), or leave them —
inert.

- **`dispatch_process_binding`, `dispatch_termination`, `worktree_finalization`,
  and the process identity sidecars are SOURCE state — NEVER deleted by
  rollback.** They may be retained as evidence and removed only by an explicit
  later governed procedure.
- Any shadow lifecycle process still alive at rollback time should be torn
  down once, by the same identity-verified path (§9.3), as part of the
  rollback procedure itself — rollback is not a license to leave a live
  synthetic process orphaned.
- `data/app.db`, `settlement_incident`, and `worktree_provenance_incident`
  were never written by S4 → no authority rollback, no ORCA-S2/S3 impact.
- `EXECUTION_SCHEMA_VERSION` may remain at 5 (v5 is a strict superset of v4 —
  six tables, no column added to any prior table).

## 18. Slice B boundary — `ORCA_DELEGATED` entry criteria

Explicitly deferred to the future `ORCA_DELEGATED` cutover contract, under its
own frozen SPEC and its own independent acceptance:

- **Authority transfer itself** — the only slice permitted to move the
  authority ladder.
- **Production process-handle acquisition** — added as a **hard prerequisite**
  by this SPEC (§5): Slice B must define and prove, under its own contract,
  how Orca acquires a real delegated workload's process/process-tree handle,
  because this slice explicitly does not.
- **The terminal-projection path into `data/app.db`** (§G item 6) — must
  **copy, never re-decide**, exactly the discipline `dispatch_lifecycle_closure`
  already models one level advisory (§8.5, LIFE-5).
- **Real (non-`MockExecutor`) executor parity** — orthogonal; may proceed in
  parallel or not at all before cutover (gap analysis §6.2).
- **A real terminal-event emitter** — this slice proves only the idempotency
  contract (`dispatch_lifecycle_event`); real delivery is additive, Slice-B-or-later.
- **Retirement of any legacy execution code** (`NativeResultsAuthoritativeExecutor`,
  the disposable-aicontrol-env gate-8 harness, or any aiControlCenter-owned
  path) — only after Slice B's own independent acceptance, per gap analysis §5
  decision 10.
- **Queue / admission / capacity / scheduler / `ORCA_AUTHORITATIVE`
  responsibilities** — untouched by both this slice and Slice B.
- **Explicit, reviewed resolution of the `onDispatchSettled` hook question**
  for the *real* (non-synthetic) case — this SPEC resolves it for S4's own
  synthetic fixture only (LIFE-8: hooks are wake-up hints, never correctness
  sources); Slice B must make and record the same decision for whatever real
  process-exit signal a production executor eventually provides.
- **Zero-dual-write-authority proof across the cutover instant itself** — this
  slice proves single-writer discipline for its own six tables under shadow
  (LIFE-11); Slice B must extend that proof across the actual authority flip.

## 19. Predecessor facts consumed

**From ORCA-S1 (published `911b6679c2`):** `run_binding`, `run_reservation`,
`execution_meta`, the bind-time composition seam in
`shadow-observation-service.ts` (extended, not replaced, by §9.2).

**From ORCA-S2 (published `8eca5ddefc`):** `settlement_observation` (a
read-only eligibility input, §10.1), the `withImmediateTransaction` + bounded
`SQLITE_BUSY` → retryable pattern, the two-phase read → re-verify → commit
shape (adapted for real side effects, §10.2), the versioned schema ladder, the
frozen-evidence-bundle pattern, the `data/app.db` guard, the separate-child-process
restart-harness pattern, and the `onDispatchSettled`-is-optional framing
(Appendix C) — reused directly for LIFE-8.

**From ORCA-S3 (published `7a1f8388cb` + `SPEC-AMENDMENT-001`):**
`worktree_provenance` / `dispatch_worktree` (read-only eligibility inputs,
§10.1), the durable shadow-worktree root and its identity-sidecar pattern
(directly extended for the process identity sidecar, §9.2), the sibling-sweep
placement discipline ("no phase N.5"), the exact bind-time transaction
ordering (extended, §9.2), the `LEGACY_BINDING_NOT_CONVERGEABLE` / prospective-
eligibility pattern (mirrored as `LEGACY_BINDING_NOT_LIFECYCLE_MANAGED`, §8.7),
and the explicit deferral of worktree finalization/reap ownership to "a later
lifecycle / delegation-preparation slice (provisionally ORCA-S4)" (S3 §10,
§12 PROV-6, §13) — **this is precisely the ownership S4 now claims.**

**From `GAP-ANALYSIS-ORCA-DELEGATED.md` (accepted `8f063826`):** the full §4
gap enumeration, the §5 decisions (this SPEC formalizes decisions 1, 2, 4, 5,
7, 9, and the split-slice decision 3–4; decisions 6, 8, 10 are explicitly
carried forward to Slice B per §18 above), and the mandatory process-handle
provenance framing (§7 caveat about the unvendored external amendment,
preserved verbatim in this SPEC's header).

**Explicitly NOT consumed:** `parity_observation` / `parity.ts` (no parity
work, mirrors ORCA-S3 B5); `settlement_incident` / `worktree_provenance_incident`
(S4 has its own channel); `reconcile-shadow-execution-state.ts` /
`converge-worktree-provenance*.ts` (sibling, never modified).

## 20. Independent-acceptance attack surfaces

1. **Hidden authority transfer** — does *any* S4 path write `data/app.db`,
   call `finalizeRunOnce`, mutate `agent_runs`, touch queue/capacity/scheduler,
   or perform a real external terminal-event delivery?
2. **Bare-pid kill** — can any code path signal a process without first
   re-verifying the process identity sidecar? Is a live-handle kill and a
   restart-recovered kill both gated by the *same* identity discipline?
3. **Fabrication under uncertainty** — can `process_identity_mismatch`,
   `orphan_process_unverifiable`, or a finalization conflict be coerced into
   writing a `dispatch_termination`, `worktree_finalization`, or
   `dispatch_lifecycle_closure` row with a synthesized value?
4. **Deletion confinement** — can any deletion target (worktree finalization or
   orphan reap) resolve outside its configured durable root? Is `isInside`
   checked immediately before every deletion, not just at composition time?
5. **Real-resource leakage** — does any test or the composition root ever let
   S4 spawn against, observe, or delete a resource it did not itself create
   under an Execution-owned durable shadow root?
6. **Ephemeral-fact honesty (§8.0)** — can `dispatch_termination.exit_code` /
   `exit_signal` ever be non-NULL when `termination_method =
   'confirmed_dead_unknown_cause'`? Is `teardown_requested_at` genuinely
   written *before* every signal, never after or never at all?
7. **SOURCE vs PROJECTION discipline (§8.8)** — does a projection rebuild ever
   drop `dispatch_process_binding`, `dispatch_termination`, or
   `worktree_finalization`? Does regenerating the three PROJECTION tables from
   unchanged SOURCE state reproduce byte-for-byte-equivalent rows (excluding
   local metadata)?
8. **No "phase 3.5"** — is `converge-worktree-provenance*.ts` byte-unchanged?
   Is `convergeDelegationBoundaryLifecycle` invoked strictly **after**
   `convergeWorktreeProvenance(...)` and never from inside it?
9. **Incident isolation (LIFE-9)** — write a `dispatch_lifecycle_incident`,
   then run ORCA-S2's and ORCA-S3's sweeps for the same binding: do they still
   run unblocked? Is `hasOpenLifecycleIncident` ever consulted outside
   `convergeDelegationBoundaryLifecycle`?
10. **Orphan identity fabrication (§10.3)** — does either orphan-reap path ever
    write a `correlation_id`-keyed Execution-store row for a fact that was
    never actually committed? Is the grace period genuinely enforced (an
    in-flight bind younger than `orphanGraceMs` is never touched)?
11. **Duplicate-side-effect proof (LIFE-7)** — run the sweep concurrently /
    repeatedly / after a partial write; assert exactly-one real deletion,
    exactly-one real termination request per process, and exactly-one
    `dispatch_lifecycle_event` row per `(correlation_id, event_kind)`.
12. **Hook independence (LIFE-8, window L9)** — fire a synthetic duplicate
    exit callback; confirm the durable result is identical to the
    zero-callback and single-callback cases.
13. **Closure honesty (LIFE-5)** — does `dispatch_lifecycle_closure` ever
    reinterpret (rather than copy) a settlement or provenance status? Does its
    digest ever include a local-metadata timestamp or id?
14. **Synthetic-process claim boundary (§5, gate 21)** — does any test,
    report, or doc comment introduced by this slice claim real-executor parity
    or production process-handle acquisition?
15. **ORCA-S1 / S2 / S3 regression** — all three acceptance suites
    byte-unchanged and green despite the extended bind-time seam; ORCA-S2/S3
    convergence and re-verification still run for every binding regardless of
    S4 state; no separate unconditional pass introduced anywhere.

---

_State class: `ARCHITECTURE_DEFINITION_READY` (candidate — not frozen, not
independently accepted, not published)._
_Display verdict: `MAESTRO_ORCA_S4_ARCHITECTURE_CANDIDATE_READY_FOR_INDEPENDENT_REVIEW`._
