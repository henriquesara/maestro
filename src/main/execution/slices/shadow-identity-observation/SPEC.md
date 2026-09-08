# ORCA-S1 — Shadow Identity & Observation — FROZEN SLICE SPEC

> SDD artifact. Frozen before implementation. The functional authority for this
> slice. Code does not silently redefine it. A real conflict is `CONTRACT_CONFLICT`
> → architecture decision → amendment (amendment §P.8), never a silent edit here.

**Normative source:** aiControlCenter `master` `5978802f9f28ef94c21bbb6b5bacba3d0959dbad`,
`docs/roadmap/phase-m-model-governance-workforce-allocation.md`, amendment
`ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01`, sections **S**
(ORCA-S1), **P** (Architecture Style), **I** (`SHADOW_EXECUTION_SAFETY_POLICY`),
**L** (Identidade). aiControlCenter is READ-ONLY for this slice.

**Orca base:** `bf4e2705046cf9ef9c915929a9646da85717af07` (fork `stablyai/orca`).
**Branch:** `orca-s1-shadow-identity-observation`.

---

## 1. Objective

Establish a durable, unambiguous, idempotent cross-reference between the current
authoritative execution identity (aiControlCenter `agent_runs.id`) and an
advisory-only Orca **shadow** observation of an equivalent workload, and record
execution **parity** for a small, spec-declared sample of workloads that are
proven side-effect-safe under `SHADOW_EXECUTION_SAFETY_POLICY`.

No authority is transferred. `ORCA_SHADOW` exists only as an observation mode.
Orca is strictly advisory.

## 2. Bounded context owner

**Execution** (amendment §S, §P.3, §P.13). Execution owns: the `ExecutionPlane`
port, the Orca adapter, execution identity translation, `run_binding`,
`parity_observation`, and this slice's own persistence + migration. Delivery /
Governance may reference a governed AgentRun only through a public application
contract; they never read or write Execution's private tables.

## 3. Ubiquitous / domain language

| Term                 | Meaning in this slice                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative run    | An aiControlCenter `agent_runs` row. The sole correctness authority for its execution. Read-only here.                                                                            |
| Shadow run           | An Orca dispatch created by this slice purely to observe. Advisory only. Never influences an authoritative run.                                                                   |
| `RunBinding`         | The durable identity map between an authoritative run, its governed AgentRun handle, and its Orca shadow refs. Persisted by the owning module; never reconstructed heuristically. |
| `SyntheticWorkload`  | A deterministic, repo-local, code-only sequence of file mutations (+ optional exit / cancel markers). The only kind of workload this slice dispatches.                            |
| `WorkloadDescriptor` | Declared kind + declared capabilities + optional isolation strategy. Input to the safety policy.                                                                                  |
| `ExecutionOutcome`   | `{ terminalOutcome, exitDisposition, cancellationBehavior, filesChanged }`. Computed for both sides.                                                                              |
| `ParityObservation`  | `{ binding, authoritative outcome, shadow outcome, parity result, rootCause }`. Complete only when every divergence has a non-empty root cause.                                   |
| `WorkloadExclusion`  | A record that an ineligible workload was refused **before** any `ExecutionPlane` call.                                                                                            |
| Opaque ref           | `OrcaRunRef` / `OrcaDispatchRef` / `AiControlRunRef` / `GovernanceAgentRunRef` / `OrgTaskRef` — branded strings. No Orca row type crosses the port.                               |

## 4. Invariants

- **I1 — Zero authoritative writes.** Nothing this slice runs — the reader, the
  service, the Orca adapter, or anything they call — writes `data/app.db`. The
  reader exposes no write method; it opens the file read-only.
- **I2 — Zero prohibited external side effects.** Only workloads classified
  eligible by `SHADOW_EXECUTION_SAFETY_POLICY` are dispatched. Ineligible
  workloads are recorded as exclusions and never reach the `ExecutionPlane`.
- **I3 — Binding uniqueness.** `run_binding.orca_dispatch_id` is UNIQUE.
  `run_binding.aicontrol_run_id` is UNIQUE when present. One Dispatch is bound to
  at most one AgentRun. No orphan bindings.
- **I4 — Dispatch identity integrity.** An AgentRun cannot be settled through a
  wrong / stale Dispatch ref. A settlement carrying a Dispatch ref that is not
  the one bound for that run is rejected (adapter guard + Orca's own
  `task_dispatch_mismatch`).
- **I5 — Crash isolation.** A failure in the shadow adapter or the shadow
  observation service is contained: it is caught, recorded as a failed
  observation, and cannot propagate to, mutate, or interrupt any authoritative
  execution. `data/app.db` is byte-identical before and after, including on the
  crash path.
- **I6 — No Orca types in the domain / application contracts.** Orca row types
  (`DispatchContextRow`, `TaskRow`, `WorkerDispatchRow`, `RunRow`) live only in
  `infrastructure/`. Only opaque refs / value objects cross the `ExecutionPlane`
  port.
- **I7 — Divergence is root-caused.** A `ParityObservation` whose parity result
  is `match: false` is incomplete until `rootCause` is a non-empty string.
- **I8 — Module persistence ownership.** This slice writes only Execution-owned
  tables (`run_binding`, `parity_observation`, `workload_exclusion`,
  `execution_meta`) in an Execution-owned SQLite file. It reads `data/app.db`
  (read-only) and, when driven with a live Orca runtime, `orchestration.db`.

## 5. Allowed state transitions

Per shadow run:

```
(none) --openShadowRun--> BOUND            [run_binding row written]
BOUND  --runShadowWorkload--> EXECUTED     [synthetic workload applied in a disposable worktree]
EXECUTED --settleShadow--> SETTLED         [Orca dispatch settled; ExecutionOutcome computed]
SETTLED --compare+recordParity--> OBSERVED [parity_observation row written; divergences root-caused]

BOUND|EXECUTED --abandonShadow--> ABANDONED  [adapter/service failure; recorded; authoritative untouched]
```

Per ineligible workload:

```
(none) --classify=ineligible--> EXCLUDED   [workload_exclusion row written; ExecutionPlane never called]
```

## 6. Forbidden state transitions

- Any transition that writes `data/app.db`.
- `EXCLUDED --> BOUND` (an ineligible workload is never dispatched).
- Settling a shadow run through a Dispatch ref other than the one bound for it.
- A second `run_binding` row for the same `orca_dispatch_id` or the same
  non-null `aicontrol_run_id`.
- Completing a `ParityObservation` with `match: false` and an empty `rootCause`.
- Any transition on the authoritative side at all — this slice has no
  authoritative-mutation transition, by construction.

## 7. Inputs

- `aicontrolDbPath` — path to aiControlCenter `data/app.db` (opened read-only).
- `executionStorePath` — path (or `:memory:`) for the Execution-owned SQLite store.
- `orchestration` — an `OrchestrationDb` instance for the shadow plane (a
  dedicated `:memory:` or dedicated file — never the real user `orchestration.db`
  in tests).
- `worktreeRoot` — a disposable directory root for shadow worktrees.
- `PARITY_SAMPLE` — the frozen sample (§10).

## 8. Outputs

- `run_binding` rows (one per eligible shadow run).
- `parity_observation` rows (one per settled shadow run).
- `workload_exclusion` rows (one per refused ineligible workload).
- A `ShadowObservationReport` value: `{ bindings, observations, exclusions,
divergences, dbGuard: { pathHashBefore, pathHashAfter, sidecarsPresent } }`.

## 9. Failure semantics

- **Ineligible workload** → `WorkloadExclusion` recorded, `ExecutionPlane` not
  called, slice continues with the next sample entry. Not an error.
- **Wrong / stale Dispatch ref at settle** → `ExecutionPlaneError('dispatch_mismatch')`;
  Orca's `settleWorkerReport` independently returns `task_dispatch_mismatch`. The
  shadow run is abandoned and recorded; no `parity_observation` is written for it.
- **Adapter / service throw mid-run** → caught by the service; the shadow run is
  recorded as `ABANDONED` with the sanitized error; the loop continues; the
  authoritative side and `data/app.db` are provably untouched (I5).
- **Duplicate binding** → `RunBindingError('duplicate_dispatch' | 'duplicate_aicontrol_run')`
  from the store's uniqueness constraint; the shadow run is abandoned; not
  retried in this slice.
- **`data/app.db` missing / has a `-wal` or `-shm` sidecar at start** →
  `DbGuardError`; the slice does not run. (The baseline is a clean, sidecar-free
  file.)

## 10. Parity sample — frozen (N runs / M agents)

**N = 6 shadow runs across M = 3 synthetic agent profiles (2 runs per profile).**

Justification: 6 is the smallest sample that exercises **all four** required
comparison dimensions (terminal outcome, files-changed set, non-zero-exit
disposition, cancellation behavior) with at least one deliberate divergence to
prove divergence detection + mandatory root-causing, while staying fast and
fully deterministic. 3 profiles mirror the 3 distinct `agent_id`s actually
present in the real `data/app.db` (verified: `select count(distinct agent_id)
from agent_runs` = 3), so the authoritative side of the sample is drawn from
real authoritative rows, not invented.

Each of the 6 slots binds to a **distinct** real `agent_runs` row (the reader
advances a per-(agent, status) cursor), so `aicontrol_run_id` is unique across
the whole sample — a second slot for the same (agent, status) reads the next
row, never the same one.

| #   | Profile | Authoritative source (real `agent_runs`)                                   | Synthetic shadow workload               | Expected parity                                                                                                                                                                                         |
| --- | ------- | -------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A       | 1st real `completed` row for agent A (`files_changed` null)                | write 2 files, `exit 0`                 | MATCH on all _comparable_ dimensions (`files_changed` = `not_comparable`)                                                                                                                               |
| 2   | A       | 2nd real `completed` row for agent A — **with a recorded `files_changed`** | write 1 file, delete 1 file, `exit 0`   | MATCH terminal/exit/cancel; **deliberate `files_changed` divergence** (recorded set ≠ shadow synthetic set) → root cause `shadow_synthetic_workload_not_replayable`                                     |
| 3   | B       | 1st real `failed` row for agent B                                          | write 1 file, `exit 1`                  | MATCH: `failed` / `non_zero_exit` (`files_changed` = `not_comparable`)                                                                                                                                  |
| 4   | B       | 2nd real `failed` row for agent B                                          | write 1 file, `exit 2`                  | MATCH: `failed` / `non_zero_exit` (`files_changed` = `not_comparable`)                                                                                                                                  |
| 5   | C       | 1st real `cancelled` row for agent C                                       | write 1 file, `cancel(midFlight=false)` | MATCH: `cancelled` / `cancelled_clean` (`files_changed` = `not_comparable`)                                                                                                                             |
| 6   | C       | 2nd real `cancelled` row for agent C                                       | write 1 file, `cancel(midFlight=true)`  | MATCH terminal (`cancelled`); **deliberate cancellation-behavior divergence** (`cancelled_mid_flight` vs recorded `cancelled_clean`) → root cause `authoritative_cancellation_granularity_not_recorded` |

Divergences in rows 2 and 6 are **expected** and prove I7. Any _other_ divergence
is a slice failure and must be root-caused before acceptance.

`files_changed` is compared **only when the authoritative side recorded it**
(non-null). When the recorded value is null (legacy rows), that dimension is
`not_comparable` for that run — reported on the observation, but not a
`match: false` divergence. This is why row 2's fixture row carries a recorded
`files_changed`: without it there is no _comparable_ files-changed dimension to
exercise.

If the real `data/app.db` lacks enough distinct rows for a required
(profile, status, occurrence) triple, the slice records a `WorkloadExclusion` of
kind `sample_source_unavailable` and the parity sample is reported as partial —
never silently back-filled with an invented authoritative outcome.

**Assumption, declared (not silent):** at `AICONTROL_NATIVE` the aiControlCenter
web app is not running and is read-only, so a shadow run cannot replay a real
coding-agent turn. The authoritative side of the parity comparison is the
**recorded outcome** of a real `agent_runs` row (terminal status → terminal
outcome + exit disposition + cancellation behavior; `files_changed` only when
recorded), and the shadow side runs a **synthetic equivalent** workload.
Replaying real agent turns belongs to a later stage, not ORCA-S1.

> **Spec revision 2026-09-08 (pre-acceptance, recorded).** The original §10
> drafted 6 slots against "a real row per (profile, status)" (3 rows), which
> collides with the `aicontrol_run_id` UNIQUE constraint on the 2nd slot of each
> profile, and drafted `files_changed` as always-diverging on legacy nulls
> (contradicting the row-1 "MATCH on all 4 dimensions" line). Revised — while the
> slice is still `READY_FOR_REVIEW`, not yet independently accepted — to: (a) one
> **distinct** authoritative row per slot via a per-(agent, status) cursor;
> (b) `files_changed` compared only when recorded, else `not_comparable`;
> (c) row 2's fixture row carries a recorded `files_changed` so the deliberate
> files-changed divergence is a _comparable_ one. N = 6 / M = 3 unchanged.

## 11. Acceptance criteria (mirrors amendment §S gates 1–9)

1. **Spec satisfied** — implementation matches this frozen spec; no silent
   redefinition.
2. **Module boundary preserved** — no forbidden cross-module import; no lateral
   persistence access; no Orca row type in `domain/` or `application/`.
3. **TDD / RED evidence** — for I1–I5, a failing test captured before the
   implementation of the behavior it checks. Evidence file:
   `slices/shadow-identity-observation/RED-EVIDENCE.md`.
4. **Zero authoritative writes** — call-site audit + a runtime test proving the
   whole slice writes nothing to `data/app.db` (hash unchanged, no sidecars, no
   write method on the reader).
5. **Zero prohibited external side effects** — every dispatched workload proven
   `synthetic` / `repo_local_code_only`; ineligible workloads proven excluded
   before dispatch (spy asserts 0 `ExecutionPlane` calls).
6. **Identity** — each eligible shadow run has exactly one binding; no orphans;
   `aicontrol_run_id` and `orca_dispatch_id` uniqueness enforced; wrong Dispatch
   cannot settle / associate the wrong AgentRun.
7. **Crash isolation** — an injected adapter/service crash is contained;
   `data/app.db` byte-identical; authoritative side untouched.
8. **Parity** — the frozen N=6 / M=3 sample compared on terminal outcome,
   files-changed set, non-zero-exit disposition, cancellation behavior; every
   divergence (expected or not) root-caused.
9. **Operational DB guard** — `data/app.db` SHA-256 ==
   `13E6571177CD027D618AA294B7A26DA5C07C1370123C236E1706F6F235E65178` before and
   after; no `-wal` / `-shm` residual.

## 12. Out of scope (explicit)

- Any authority transfer (`ORCA_DELEGATED` / `ORCA_AUTHORITATIVE`).
- Any change to the six production routes, the frozen state machine,
  `data/app.db` `schema.ts`, `finalizeRunOnce`, the scheduler, `queue-pump`,
  queue admission, capacity, authoritative recovery.
- M5 / Controlled Fallback (Allocation context; parallel track; does not block).
- Governed-DAG work; delegated settlement; `onDispatchSettled` hook wiring;
  durable reconciliation sweep (later slices).
- Replaying real coding-agent turns in shadow.
- The architecture-boundary enforcement tool (amendment §P.11 — later slice).
- Any modification of Orca core beyond ADDITIVE new files under `src/main/execution/`.

## 13. Rollback

Disable the shadow adapter, stop the shadow observation service, delete the
shadow worktrees. `data/app.db` was never written, so no authority rollback is
needed. `parity_observation` rows may be retained as evidence, or the Execution
store file deleted.
