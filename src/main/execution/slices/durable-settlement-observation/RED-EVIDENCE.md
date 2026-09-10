# ORCA-S2 — Durable Settlement Observation & Convergence — RED EVIDENCE

TDD RED → GREEN → REFACTOR log for the implementation candidate.
Frozen contract: `SPEC.md` (unmodified). Base: `origin/main` @
`6e8bd45226bfab9244b3ea30c97855af2d7dfc27`.

Each module below had its test(s) written and **watched fail** before the
production code existed. RED signature is the failure observed on first run;
GREEN is the passing count after minimal implementation.

## Domain (pure)

| Test file | RED signature | GREEN |
| --- | --- | --- |
| `domain/durable-settlement-snapshot.test.ts` | `Error: Cannot find module './durable-settlement-snapshot'` (0 tests collected) | 12/12 |
| `domain/durable-settlement-snapshot.ratchet.test.ts` | authored after `canonicalSerialize` unit-RED; pins the vendored Orca `canonicalPayload` source verbatim + a local reference (§6.1, §21) | 12/12 |
| `domain/settlement-observed-outcome.test.ts` | `Cannot find module './settlement-observed-outcome'` (0 tests) | 9/9 |
| `domain/settlement-observation.test.ts` | `Cannot find module './settlement-observation'` (0 tests) | 7/7 |
| `domain/settlement-incident.test.ts` | `Cannot find module './settlement-incident'` (0 tests) | 4/4 |

## Schema v2 → v3 (§11)

| Test file | RED signature | GREEN |
| --- | --- | --- |
| `infrastructure/execution-schema.migration.test.ts` | 6 failing assertions — `EXECUTION_SCHEMA_VERSION` still `2`; `settlement_observation` / `settlement_incident` tables absent; `settlement_incident_unique` index absent | 6/6 |

## Infrastructure

| Test file | RED signature | GREEN |
| --- | --- | --- |
| `infrastructure/with-immediate-transaction.test.ts` | `Cannot find module './with-immediate-transaction'` | 4/4 |
| `infrastructure/sqlite-settlement-observation-store.test.ts` | `Cannot find module './sqlite-settlement-observation-store'` | 6/6 |
| `infrastructure/sqlite-settlement-incident-store.test.ts` | `Cannot find module './sqlite-settlement-incident-store'` | 7/7 |
| `infrastructure/read-only-shadow-settlement-source.test.ts` | `Cannot find module './read-only-shadow-settlement-source'`; then 8/10 (sidecar-delta + latest-dispatch assertions) before the harness closed the WAL writer and used a raw `dispatch_contexts` insert | 10/10 |
| `infrastructure/shadow-orchestration-db-lifetime.test.ts` | `Cannot find module './durable-shadow-orchestration-path'` | 8/8 |

## Application

| Test file | RED signature | GREEN |
| --- | --- | --- |
| `application/converge-settlements.test.ts` | `Cannot find module './converge-settlements'` | 14/14 |
| `application/reconcile-shadow-execution-state.test.ts` | `Cannot find module './reconcile-shadow-execution-state'` (0 tests) | 6/6 |
| `application/reconcile-incomplete-reservations.test.ts` (modified) | window F changed from "abandons the incomplete reservation" (S1) to "LEAVES it for convergence, never abandons" (S2 §15.1) — the old assertion `expect(outcome.abandoned).toContain(...)` failed against the modified reconcile | 6/6 |

## Slice-level acceptance / adversarial

Integration tests over units already RED-first above; each was authored against
the frozen acceptance gates and asserts source-of-truth behaviour with the REAL
`ReadOnlyShadowSettlementSource` over a real shadow `orchestration.db`.

| Test file | Gate | GREEN |
| --- | --- | --- |
| `durable-settlement-observation.convergence.test.ts` | criterion 7 — no hook / no notification / no in-flight process / no Git | 4/4 |
| `durable-settlement-observation.two-phase-idempotency.test.ts` | criteria 8, 9; I-S2-1, I-S2-3 | 3/3 |
| `settlement-atomicity.test.ts` | criterion 13; I-S2-5 — two independent handle-sets, forced + real `SQLITE_BUSY` | 3/3 |
| `settlement-source-instability.test.ts` | §16.3, attack 3a — `SOURCE_UNSTABLE_RETRYABLE`, Phase A never `source_snapshot_changed` | 2/2 |
| `settlement-incident.adversarial.test.ts` | criterion 12 — each incident kind + non-overwriting `evidence_digest` + negatives | 5/5 |
| `durable-settlement-observation.restart.test.ts` + `settlement-converge-child.mjs` | criterion 10 — SIGKILLed separate child; windows **G1–G6** | 6/6 |
| `durable-settlement-observation.acceptance.test.ts` | §10 frozen N=3 sample; emits `__evidence__/settlement-evidence-bundle.json` | 2/2 |

## Invariant → test mapping

| Invariant | Covering test(s) |
| --- | --- |
| **I-S2-1** pure fixed point | `converge-settlements.test.ts` "is idempotent — run ×3"; `two-phase-idempotency.test.ts` "converge ×3" |
| **I-S2-2** write-once + only `observed → observed_conflicted` | `sqlite-settlement-observation-store.test.ts` "write-once", "markConflicted is the ONLY permitted mutation" |
| **I-S2-3** projection-rebuild semantic replay | `converge-settlements.test.ts` "settlement-projection rebuild"; `two-phase-idempotency.test.ts` "rebuild + re-run reproduces SEMANTICALLY equivalent" |
| **I-S2-4** duplicate `settleWorkerReport` → same digest | `read-only-shadow-settlement-source.test.ts` (Orca `duplicate: true` path); `convergence.test.ts` digest equality |
| **I-S2-5** concurrent sweeps ≤ 1 observation | `settlement-atomicity.test.ts` all three cases |
| **P-S2-1** `orca_dispatch_id` == bound, checked before insert | `settlement-observation.test.ts` `assertObservationConverged`; `acceptance.test.ts` per-case assert |
| **P-S2-2** non-empty provenance, `assertObservationConverged` throws on incomplete | `settlement-observation.test.ts`; `acceptance.test.ts` |
| **P-S2-3** identity only via the durable marker on both sides | `read-only-shadow-settlement-source.test.ts` marker resolution; `foreign` cases |
| **P-S2-4** foreign latest Dispatch → incident, never observed | `converge-settlements.test.ts` foreign case; `settlement-incident.adversarial.test.ts` |
| **P-S2-5 / P-S2-6** `agent_runs` semantics unchanged; AgentRun settled ≠ OrgTask completed | `acceptance.test.ts` "NO parity_observation row"; no `promoteReadyTasks`/`agent_runs` symbol anywhere in S2 (static) |

## Crash window → test mapping (criterion 10)

| Window | Test |
| --- | --- |
| **G1** durable settle, killed before any reconcile | `restart.test.ts` "G1" |
| **G2** killed mid-convergence, no commit | `restart.test.ts` "G2" |
| **G3** killed after observation commit, before reservation advanced | `restart.test.ts` "G3" + `converge-settlements.test.ts` "Phase B no-op heals a reservation" |
| **G4** killed after an incident commit | `restart.test.ts` "G4" |
| **G5** shadow DB re-settled to a different digest | `restart.test.ts` "G5" + `two-phase-idempotency.test.ts` criterion 9 |
| **G6** killed during a retryable loop (nothing committed) | `restart.test.ts` "G6" |

## Notes

- No production code was written before its failing test. Where a slice-level
  integration test "passed on first run", every unit it exercises had a prior
  unit RED recorded above.
- `settlement-test-harness.ts` is named to match the `dispatch-row-writer-boundary`
  ratchet's test-file exemption (it seeds a stale `dispatch_contexts` row for the
  foreign-dispatch fixture).
