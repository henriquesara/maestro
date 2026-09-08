# ORCA-S1 — RED evidence (TDD, amendment §S gate 3 / §P.9)

Captured `2026-09-08` on branch `orca-s1-shadow-identity-observation`
(Orca base `bf4e2705`) **before** the behavior under each invariant was
implemented. Command:

```
corepack pnpm exec vitest run src/main/execution/ --reporter=verbose
```

Result: **Test Files 5 failed (5) · Tests 17 failed | 2 passed (19)**.
Every failure below is a genuine behavioral failure (a `NOT_IMPLEMENTED`
throw from the target function), not a missing-module error.

| Invariant                                        | Failing test(s)                                                                                                                                                                                                        | RED marker                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **I1 — zero authoritative write**                | `infrastructure/aicontrol-db-reader.test.ts` → "leaves data/app.db byte-identical after a full sample read and creates no -wal/-shm"                                                                                   | `NOT_IMPLEMENTED: I1 resolveSample`              |
| **I2 — unsafe workload rejected**                | `domain/shadow-safety-policy.test.ts` → all 7 cases (rejects mutating-external-api / network-mutation / external_effect-without-isolation / unaccepted-isolation; accepts synthetic / repo-local / accepted-isolation) | `NOT_IMPLEMENTED: I2 classifyShadowWorkload`     |
| **I2 — ineligible never reaches the plane**      | `application/shadow-observation-service.test.ts` → "an ineligible workload never reaches the ExecutionPlane (I2)"                                                                                                      | `NOT_IMPLEMENTED: I2/I5/I7 runShadowObservation` |
| **I3 — binding uniqueness**                      | `infrastructure/sqlite-execution-store.test.ts` → "rejects a second binding for the same orca_dispatch_id" / "…same non-null aicontrol_run_id" / "allows two null aicontrol_run_id" / round-trip                       | `NOT_IMPLEMENTED: I3 recordBinding`              |
| **I4 — wrong/stale Dispatch cannot bind/settle** | `domain/execution-identity.test.ts` → "rejects a Dispatch ref that is not the bound one" / "accepts the bound Dispatch ref"                                                                                            | `NOT_IMPLEMENTED: I4 assertBoundDispatch`        |
| **I5 — shadow crash isolation**                  | `application/shadow-observation-service.test.ts` → "contains a plane failure: resolves with the run abandoned, does not reject (I5)"                                                                                   | `NOT_IMPLEMENTED: I2/I5/I7 runShadowObservation` |
| **I7 — divergence root-caused**                  | `application/shadow-observation-service.test.ts` → "a mismatched ParityObservation carries a non-empty root cause (I7)"                                                                                                | `NOT_IMPLEMENTED: I2/I5/I7 runShadowObservation` |

The 2 tests that passed at RED are structural, not behavioral:
`execution-identity.test.ts` → "rejects an empty ref at construction" (ref
guard, written as scaffolding), and `aicontrol-db-reader.test.ts` → "exposes
no write-capable method" (prototype-shape assertion for I1).

GREEN + REFACTOR results are recorded in the slice report.
