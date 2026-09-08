# ORCA-S1 — SPEC AMENDMENT 002

**Append-only.** Supersedes **only** the acceptance / parity-evidence portions of
[`SPEC-AMENDMENT-001.md`](./SPEC-AMENDMENT-001.md) that permitted
`AuthoritativeReferenceExecutor` to stand in for aiControlCenter native
execution. Everything else in AMENDMENT-001 and in the published contract
`ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01` (§A–§S) is
unchanged.

Branch `orca-s1-shadow-identity-observation`. Orca base `bf4e2705`. Reviewed
candidate `c741ab4a9a`. Authority stays `AICONTROL_NATIVE`; Orca stays
`ORCA_SHADOW` / advisory. M5 not started.

Canonical aiControlCenter: `C:\Users\henrique\Documents\aiControlCenter` at
`5978802f9f28ef94c21bbb6b5bacba3d0959dbad`. Canonical `data/app.db` SHA-256
`13E6571177CD027D618AA294B7A26DA5C07C1370123C236E1706F6F235E65178` — read-only,
verified before and after, never a `-wal`/`-shm`, never a schema change, never a
git commit.

---

## 1. What this amendment changes

Re-review closed every blocker from AMENDMENT-001 except one:

> **CONTRACT_CONFLICT** — ORCA-S1 Gate 8 compared the Orca shadow result against
> `AuthoritativeReferenceExecutor`, an aiControl-native *semantic re-implementation*,
> not an actual aiControlCenter native execution. Published §S requires the Orca
> result be recorded *beside the authoritative aiControlCenter result*; a
> hand-written stand-in is not that result.

The resolution is **compliance, not contract relaxation**:

- `AuthoritativeReferenceExecutor` is **deleted** and is **not** authoritative
  acceptance evidence for any dimension.
- ORCA-S1 Gate 8's authoritative side is now **an actual aiControlCenter native
  execution**, driven through the real `createRun → runAgent → executeClaimedRun
  → getExecutor → openExecutionAttempt → executor.execute → closeExecutionAttempt
  → finalizeRunOnce` lifecycle in a **disposable** aiControl environment.
- The **same** controlled, side-effect-safe workload is executed through
  aiControlCenter native execution **and** Orca shadow execution; the two
  observed results are compared.
- Published §S normative meaning is **not** changed. §S delegates the parity
  strategy and the N/M values to the slice spec (AMENDMENT-001 §1, unchanged);
  it requires the two results side by side, which is now literally satisfied.

No part of §A–§S is amended by this document.

## 2. The real native path — not a semantic clone

The authoritative side runs, unmodified, aiControlCenter's own code:

| Stage | aiControlCenter symbol |
|---|---|
| create the run | `createRun` (`src/lib/agent-runner/runner.ts`) — real `agent_runs` INSERT, status `pending` |
| claim + allocation + eligibility | `runAgent` → `claimRunForExecution`, `resolveAllocationSource`, `evaluateEligibility`, `insertAllocationDecision` |
| claimed execution | `executeClaimedRun` — provider identity resolution, `validateCommand`, `getGitDiff` before |
| provider boundary | `getExecutor(providerName, command)` → `MockExecutor` (the repo's own deterministic boundary, "used when command prefix is `mock`") |
| execution attempt | `openExecutionAttempt` → `executor.execute` → `classifyAttemptOutcome` → `closeExecutionAttempt` — real `execution_attempts` row with the real `exit_code` / `error_classification` |
| cancellation | `runCancellation.requestRunTermination` + `finalizeRunOnce({status:'cancelled'})` — the real CAS state transition |
| terminal write | `finalizeRunOnce` — the single terminal path; real terminal `agent_runs.status`, `git_diff_after`, duration |

Only the **leaf executor** is deterministic (`MockExecutor`), exactly as
aiControlCenter's own `src/lib/agent-runner/__tests__/queue-pump-real-db.test.ts`
does ("the provider is seeded with `type='mock'`, which real production code …
resolves to a fast, dependency-free in-process executor — never a `vi.mock`").
Every state transition, every persistence write, every classification is the
real one. A manually constructed terminal `agent_runs` row is **not** used and
is **forbidden** by this amendment.

## 3. Disposable acceptance environment

Built per run of the acceptance suite; destroyed afterward:

1. `git -C <canonical aiControlCenter> archive HEAD` → extracted to a temp dir
   (a read-only operation on the canonical checkout — no worktree registration,
   no ref change, no file touched).
2. The canonical `node_modules` is reused via a filesystem **junction** (read in
   place; never written).
3. A disposable SQLite DB is created with the **real schema** via
   `drizzle-kit push --force` against a fresh `file:` URL under the OS temp dir.
   aiControlCenter's own `src/lib/db/guard.ts` (`assertDbUrl`) refuses any URL
   that resolves to `data/app.db` without `ALLOW_REAL_DB_MIGRATION=1`, which is
   never set.
4. A harness runs **inside** the extracted copy under `vitest` (so `@/` and the
   real module graph resolve exactly as in-repo), drives the native runs, and
   writes a JSON result file.
5. The extracted copy and the disposable DB are removed.

Permitted, and done: temporary repo copy; disposable DB via real
schema/migrations/bootstrap; the repo's own `type:'mock'` deterministic executor
boundary; the real native agent-run lifecycle; capture of the real
`agent_runs` / `execution_attempts` rows.

Not done: no modification of the canonical checkout; no write to canonical
`data/app.db`; no canonical git state change; no external service, network, or
irreversible effect; no manual terminal-row insertion.

## 4. Same workload, both sides

Each parity slot is one controlled workload realised identically on both sides:

| Slot input | aiControl native | Orca shadow |
|---|---|---|
| `mock` | `createRun({command:'mock'})` → `runAgent` → terminal `completed`, attempt exit 0 | shadow dispatch, workload `exit 0` in a disposable git worktree |
| `mock exit=N` (N≠0) | `createRun({command:'mock exit=N'})` → terminal `failed`, attempt exit N, `NONZERO_EXIT` | shadow dispatch, workload `exit N` |
| `mock` + cancel | `runAgent` started, then `requestRunTermination('cancelled')` + `finalizeRunOnce` → terminal `cancelled` | shadow dispatch, workload `cancel` (clean) |

`files_changed` on the aiControl side is derived from **real repository
evidence**: `git -C <disposable workspace> diff --name-only` after the run (the
same workspace `runner.ts` captured `git_diff_after` from). `MockExecutor`
performs no file writes, so every slot's `files_changed` is `[]` — on **both**
sides — which is a natural match, not a manufactured one.

The workload input is never used to *derive* the expected authoritative status:
the status is read back from the real terminal `agent_runs` row. An observed
result is never overwritten to resemble legacy semantics.

## 5. N = 6 / M = 3 — kept

Six genuine disposable `agent_runs`, two per profile, across three legitimate
controlled agent identities (three distinct `agents` rows, each with its own
`type:'mock'` provider + model, in the disposable DB):

| # | Profile | Workload | Natural result (both sides) |
|---|---|---|---|
| s1 | agent-0 | `mock` | completed / zero_exit / not_cancelled / [] |
| s2 | agent-0 | `mock` | completed / zero_exit / not_cancelled / [] |
| s3 | agent-1 | `mock exit=2` | failed / non_zero_exit / not_cancelled / [] |
| s4 | agent-1 | `mock exit=5` | failed / non_zero_exit / not_cancelled / [] |
| s5 | agent-2 | `mock` + cancel | cancelled / no_exit / cancelled_clean / [] |
| s6 | agent-2 | `mock` + cancel | cancelled / no_exit / cancelled_clean / [] |

If fewer than three distinct controlled agent identities can be provisioned in
the disposable environment, the affected slots are recorded as
`workload_exclusion` (`code: 'sample_source_unavailable'`); N/M is **not**
silently lowered. There is no genuine technical impossibility here — three
`agents` rows are three INSERTs — so N=6/M=3 stands.

## 6. Divergences

The six acceptance slots are expected to **naturally match** on all four
dimensions. Gate 8 does **not** require a divergence.

- No slot injects extra shadow files, forces an authoritative status rewrite,
  induces an artificial cancellation-granularity mismatch, or perturbs input on
  one side only. AMENDMENT-001 §4's two deliberate divergences (`s2` shadow
  extra file, `s6` cancellation coarsening) are **removed from the acceptance
  sample** by this amendment.
- If a **natural** divergence is observed, a structured `RootCauseAdjudication`
  is persisted and genuinely investigated. An `unresolved` adjudication **fails**
  the acceptance sample (`assertObservationComplete` throws).

## 7. Root-cause mechanism — tested separately

The adjudication mechanism (mismatch → `explained` with evidence, or
`unresolved` → rejected) keeps dedicated **adversarial** tests that deliberately
induce a mismatch to prove the rejection path. Those tests are clearly labelled
and are **never** presented as observed aiControl↔Orca parity evidence. The real
parity acceptance sample (§5) and the root-cause mechanism tests are separate
files.

## 8. Crash isolation

The SIGKILL proof is upgraded so the authoritative side is an **actual aiControl
native execution running in its own OS process** (the disposable-env harness
subprocess), not an in-process reference call that finished before the shadow
spawned:

1. the aiControl native harness subprocess is started (disposable env, `mock`);
2. the Orca shadow child process is started and writes its durable
   `run_reservation` (`reserved`) + a READY marker, then hangs;
3. once READY, the shadow child is `SIGKILL`ed **while the authoritative harness
   subprocess is still running**;
4. the authoritative harness completes on its own and writes its real terminal
   `agent_runs` row to the disposable DB;
5. a restart runs `reconcileIncompleteReservations`.

Proven: authoritative run not cancelled/interrupted; authoritative terminal
state valid (`completed`); canonical `data/app.db` byte-identical, no sidecars;
disposable DB holds the real resulting `agent_run`; shadow reservation
reconciles to `abandoned`; no fabricated binding; no wrong settlement; authority
stays `AICONTROL_NATIVE`.

## 9. Closed blockers preserved

Unchanged and still covered by their existing tests (regression):
durable `run_reservation` before Dispatch; durable correlation on both sides;
restart reconciliation; wrong valid run/Dispatch rejection (`run_dispatch_pair_mismatch`);
DB-alias prevention before writable open; `acceptedBy:"self"` rejection; actor
separation; filesystem confinement; dedicated shadow `OrchestrationDb`; Git-derived
`files_changed`; structured root-cause adjudication.

## 10. Residual risks

- **R1 (revised)** — the authoritative leaf executor is `MockExecutor`, the
  repo's sanctioned deterministic boundary. A real CLI/LLM executor is not run
  (network, cost, non-determinism, irreversible effect). Every orchestration,
  persistence and state-transition step around it is the real native one. A
  future stage wanting real-executor parity must add a controlled real-executor
  fixture; out of ORCA-S1 scope.
- **R2** — `files_changed` is `[]` for every slot because `MockExecutor` edits
  nothing. The dimension is still compared from real `git diff` evidence; it is
  simply empty on both sides. A workload that produces real edits needs a
  file-editing executor (R1).
- **R3** — the acceptance suite requires the canonical aiControlCenter checkout
  to be resolvable locally with `node_modules` installed (it is the contract
  source). Absent that, the native suite skips with a clear message rather than
  passing vacuously; it never depends on network.
- **R4** — `drizzle-kit push` + a `vitest` subprocess make the native fixture
  slow (tens of seconds). It runs under a documented per-suite timeout, mirroring
  aiControlCenter's own `queue-pump-real-db.test.ts` (`120_000` ms `beforeAll`).

## 11. Coupling

**ADDITIVE.** No Orca core file is modified. No aiControlCenter file is modified
(the disposable environment is an extracted copy). The fork-orca changes are
confined to `src/main/execution/`.
