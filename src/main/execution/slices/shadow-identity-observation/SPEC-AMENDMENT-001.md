# ORCA-S1 SPEC AMENDMENT 001 — Focused-fix corrected acceptance semantics

> **Append-only.** Does not rewrite `SPEC.md`. Recorded **before** any
> product-code change in this focused-fix pass. Consumes the independent-review
> blockers for reviewed HEAD `6592731bdcbbaf6b53528fab65f5238c83fb7a50`.
>
> **Scope:** corrects ORCA-S1 acceptance semantics only. Does **not** broaden the
> slice, transfer authority, start M5/ORCA-S2, or touch the published
> `ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01`.
> Authority stays `AICONTROL_NATIVE`; Orca stays `ORCA_SHADOW / advisory only`.

**Normative source:** aiControlCenter `master`
`5978802f9f28ef94c21bbb6b5bacba3d0959dbad`, published amendment §S / §P / §I / §L.
aiControlCenter is READ-ONLY. `data/app.db` baseline
`13E6571177CD027D618AA294B7A26DA5C07C1370123C236E1706F6F235E65178`.

---

## 0. CONTRACT_CONFLICT check (published §S)

**No conflict.** Published §S delegates the parity strategy and sample size to
the slice spec:

- §S PARITY: *"Registrar parity entre aiControlCenter e Orca para um conjunto
  mínimo **definido na spec da slice**."*
- §S PARITY: *"Os valores N runs / M agents devem ser **definidos na spec
  ORCA-S1**, não inventados durante acceptance."*
- §S OBJECTIVE: *"Registrar os resultados Orca ao lado do resultado autoritativo
  do aiControlCenter para parity analysis"* — it requires the two results be
  recorded side by side; it does **not** require the authoritative result be
  produced by a live aiControl native run inside ORCA-S1.
- §S ALLOWED SCOPE explicitly excludes altering the six routes, the frozen state
  machine, `schema.ts`, `finalizeRunOnce`, scheduler, queue-pump, admission,
  capacity, authoritative recovery.

Standing up aiControlCenter's live native execution path inside ORCA-S1 (Next.js
server + mock/real provider CLI + cross-repo runtime import of
`src/lib/agent-runner` + `better-sqlite3` + `@/lib` path aliases) is a scope
broadening the slice is forbidden from doing, and would still not run against the
canonical `data/app.db` (read-only). Therefore this amendment defines the
smallest **truthful** same-workload strategy that §S permits. Migrating the
authoritative side onto aiControlCenter's real mock-provider execution path is
**deferred to a later slice** (a follow-on to ORCA-S1, or `ORCA_DELEGATED`
preparation), and is listed as a residual risk.

---

## 1. Why the previous sample definition was unsatisfiable

`SPEC.md` §10 (original + the GREEN-phase revision) drafted 6 slots against
"a real `agent_runs` row per (profile, status)". Two defects:

1. **Collision with the identity invariant.** Only 3 distinct `agent_id`s exist
   in real `data/app.db`; two slots per profile against `LIMIT 1` resolved to the
   *same* row, and `run_binding.aicontrol_run_id` UNIQUE (I3) correctly abandoned
   the duplicate — 3 of 6 runs were abandoned. The GREEN patch worked around this
   with a per-(agent, status) cursor, which is fine for *distinctness* but does
   not fix defect 2.
2. **Status-only rows are not a workload.** A historical `agent_runs` row records
   a terminal `status`, sometimes `files_changed`, `duration_ms`. It does **not**
   record the prompt/turn that produced it in a form ORCA-S1 can re-execute. The
   GREEN implementation compared `recordedOutcome(status)` against an *arbitrary*
   synthetic script and called a `completed` row "equivalent" to any exit-0
   script and a `failed` row "equivalent" to any non-zero script. That is a
   fabricated equivalence, not parity.

## 2. Why historical status-only rows cannot be treated as same-workload parity

Parity means: **the same replayable unit of work, executed two ways, compared.**
A historical row and a hand-written script are two different units of work; any
"match" between them is coincidence, and any "divergence" cannot be attributed.
The reviewer's blocker B7 is upheld: the status→static-script equivalence
assumption is **deleted** as acceptance evidence.

## 3. Corrected same-workload acceptance strategy

- ORCA-S1 defines a **`WorkloadSpec`** — a deterministic, side-effect-safe,
  repo-local unit of work: an ordered list of file effects (`write` / `delete`),
  an optional terminal `exit code`, and an optional `cancel(midFlight)`.
- Each `WorkloadSpec` in the frozen sample is executed **twice against
  byte-identical disposable input worktrees**:
  1. by an **`AuthoritativeReferenceExecutor`** (Execution-owned, in
     `infrastructure/`) that applies the spec with aiControl-native *terminal
     semantics* — a `completed`/`failed`/`cancelled`/`timeout` classification and
     a **real `git diff --name-only base..HEAD`** files-changed set from its own
     disposable worktree. It is a bounded stand-in for aiControl's native
     executor, documented as such (§0, residual risk R1). It is **not** a
     historical row and **not** a fabricated `agent_runs` insert.
  2. by the **`OrcaExecutionPlane`** shadow adapter, through a real Orca Dispatch
     lifecycle in ORCA-S1's dedicated shadow orchestration DB, in its own
     disposable worktree, with the same real git-diff files-changed derivation.
- `parity_observation` compares the two **real, same-workload** `ExecutionOutcome`s
  on the four required dimensions (terminal outcome, files-changed set,
  non-zero-exit disposition, cancellation behavior).
- Real `agent_runs` rows are used only to (a) confirm ≥ 3 distinct authoritative
  agent profiles exist (seeds M = 3), and (b) attach a durable
  `authoritative_run_ref` on each `run_binding` for traceability. They never
  supply a parity outcome.

## 4. Exact N / M sample definition (frozen by this amendment)

**N = 6 `WorkloadSpec`s, M = 3 profiles (2 specs per profile).** Kept at 6/3
because the corrected strategy honestly produces it: each of the 3 real
authoritative agent profiles gets 2 distinct `WorkloadSpec`s, and each spec is a
real double execution — no fabricated rows, no invented count. The 6 specs
between them exercise all four comparison dimensions and include exactly two
**deliberate, genuinely-explained** divergences (see §7):

| # | Profile | `WorkloadSpec` | Deliberate divergence |
|---|---|---|---|
| 1 | A | write 2 files, `exit 0` | none — MATCH on all 4 |
| 2 | A | write 1 file, `exit 0`; shadow adapter seeded with an extra ignored file in its input worktree so the shadow git-diff set differs | **files_changed** — explained by `shadow_input_worktree_divergence` with the extra path as evidence |
| 3 | B | write 1 file, `exit 1` | none — MATCH `failed` / `non_zero_exit` |
| 4 | B | write 1 file + delete a file that **exists** in the seeded input, `exit 2` | none — MATCH; exercises a real deletion in the diff |
| 5 | C | write 1 file, `cancel(midFlight = false)` | none — MATCH `cancelled` / `cancelled_clean` |
| 6 | C | write 1 file, `cancel(midFlight = true)`; the reference executor treats cancellation granularity as coarse (`cancelled_clean`) | **cancellation** — explained by `reference_executor_cancellation_granularity_coarse` with both behaviors as evidence |

If, at run time, fewer than 3 distinct authoritative agent profiles are
available, the affected slots are recorded as `workload_exclusion` of code
`sample_source_unavailable` and the sample is reported partial — never
back-filled.

## 5. Corrected durable-binding lifecycle (blocker B2)

The reviewed HEAD created a durable Orca Dispatch and only then wrote the
binding, with an in-memory `Map` as the only correlation authority — a crash
between the two left an orphan Dispatch. Corrected lifecycle, all steps durable
in Execution-owned SQLite, with a correlation id that is **also durable on the
Orca side** (carried in the shadow task `spec` as a JSON marker — ADDITIVE, no
Orca core change):

```
1. RESERVE      INSERT run_reservation(correlation_id, slice_ref, authoritative_run_ref,
                workload_id, state='reserved', created_at)         [Execution DB]
2. ORCA CREATE  createRun + createTask(spec = {orcaS1CorrelationId, sliceRef}) + createDispatchContext
                → UPDATE run_reservation SET state='orca_created', orca_run_id, orca_dispatch_id, org_task_id
3. BIND         INSERT run_binding(...)  (I3 uniqueness)
                → UPDATE run_reservation SET state='bound'
4. EXECUTE      runShadowWorkload
                → UPDATE run_reservation SET state='executed'
5. SETTLE       settleShadow (validates run/dispatch pair, B3)
                → UPDATE run_reservation SET state='settled', candidate_head
6. OBSERVE      compareOutcomes + INSERT parity_observation
                → UPDATE run_reservation SET state='observed'
```

`reconcileIncompleteReservations()` runs at the start of every
`runShadowObservation` and is idempotent:

- `state='reserved'` → the Orca Dispatch was never created → mark `abandoned`.
- `state='orca_created'` / `'bound'` / `'executed'` / `'settled'` → look up the
  shadow task by `correlation_id` (durable, on the Orca side) → if the Dispatch
  exists and is unsettled, settle it as `abandoned` via `abandonShadow`; complete
  or roll the reservation to `abandoned`. **No heuristic log reconstruction.**
- A re-execution of the same `(authoritative_run_ref, workload_id)` finds the
  prior reservation and reconciles it instead of creating a second Dispatch.

The in-memory `Map` in `OrcaExecutionPlane` is retained only as a within-call
cache; it is never the correctness authority — every lookup falls back to the
durable `run_reservation` + a `correlation_id` query against the shadow
`OrchestrationDb`.

Crash windows tested: **A** before Orca creation, **B** immediately after
durable Dispatch creation, **C** before binding completion, **D** after binding
before execution, **E** during execution, **F** after settlement before parity.

## 6. Corrected safety / confinement rules (blocker B5)

- **`acceptedBy: "self"` is not independent acceptance.** For ORCA-S1, only
  `synthetic` / `sandboxed` / `repo_local_code_only` workloads with **zero**
  declared prohibited capabilities are auto-admitted, **and** only when their
  file effects pass mechanical confinement (below).
- An `external_effect` workload, or any declared prohibited capability, is
  admitted **only** with an `IsolationDecision` that carries a durable
  `decisionRef`, an `authoredBy` and an `acceptedBy` that are **both non-empty,
  both ≠ `"self"`, and `authoredBy ≠ acceptedBy`** (actor separation). Absent
  that, the workload is excluded before any `ExecutionPlane` call.
- **Filesystem confinement, enforced before execution** (`assertWorkloadConfined`):
  every `write`/`delete` step path is rejected if it is absolute, contains a `..`
  segment, is empty, or — after resolving against the disposable shadow worktree
  and `realpath` — escapes the disposable shadow **root**. The composition root
  additionally `realpath`-checks that every worktree dir the factory yields is
  under a single disposable shadow root it created, and refuses a factory that
  points at a live repository root or the aiControl workspace.

## 7. Corrected root-cause evidence (blocker B9)

`parity_observation.root_cause` is replaced by a structured
`RootCauseAdjudication`:

```
{ status: 'explained' | 'unresolved',
  observedMismatch: string,          # what diverged, per dimension
  classifiedCause: string | null,    # null iff unresolved
  evidence: string[] }               # concrete references; non-empty iff explained
```

`assertObservationComplete` passes only if, for every divergence, the
adjudication is `explained` with a non-empty `evidence` array. An `unresolved`
adjudication **fails the acceptance gate** — it is never auto-converted to a
canned label. The two deliberate divergences in §4 carry real evidence (the
extra seeded path; both cancellation behaviors).

## 8. Corrected crash-isolation proof (blocker B10)

A caught `Promise` rejection is not the proof. The focused-fix adds a test that:

1. runs the `AuthoritativeReferenceExecutor` for a `WorkloadSpec` to completion
   in the parent process and records its `ExecutionOutcome` + the fixture
   `data/app.db` copy hash;
2. spawns the shadow observation in a **separate, separately-killable child
   process** (a small `.mjs` runner) and `SIGKILL`s it mid-run;
3. in the parent, after the kill: asserts the authoritative outcome is unchanged,
   the fixture DB hash is unchanged, no `-wal`/`-shm`;
4. runs `reconcileIncompleteReservations()` and asserts the shadow reservation is
   recoverable, no `parity_observation` was written for the killed run, no
   settlement landed on the wrong run, and authority is still `AICONTROL_NATIVE`.

Shadow cleanup failure may leave disposable shadow-only artifacts; it must never
alter authoritative execution.

## 9. Dedicated shadow Orca state (blocker B6)

ORCA-S1 no longer accepts a caller-provided `OrchestrationDb`. The composition
root **constructs its own** dedicated shadow `OrchestrationDb` (a disposable file
under the shadow root, or `:memory:`) and uses a **dedicated shadow coordinator
pane key** (`tab_orca_s1_shadow:*`) that no real run uses. It therefore cannot
`unbindOtherRunsForPane` a real run or mutate `orchestration.db`. Proven by an
integration test that seeds a *separate* real orchestration DB with an unrelated
bound run and asserts it is row-identical after ORCA-S1 runs.

## 10. Residual risks (carried, not fixed here)

- **R1 — authoritative side is a bounded reference executor, not aiControl's live
  native path.** Justified in §0. Migrating it onto aiControlCenter's real
  mock-provider execution path (disposable cloned schema + `agent-runner`) is a
  follow-on slice, not ORCA-S1.
- **R2 — symlink/junction adversarial tests are platform-gated.** On Windows,
  symlink creation may require privilege; those cases are skipped with a recorded
  reason where `fs.symlinkSync` throws `EPERM`, and the path-string checks
  (absolute, `..`) always run.
- **R3 — child-process crash test** depends on `SIGKILL` semantics; on Windows the
  runner uses `taskkill /F` equivalent via the shared child-process helper.
