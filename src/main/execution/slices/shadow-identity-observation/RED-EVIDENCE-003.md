# ORCA-S1 — RED evidence 003 (native aiControl parity)

Captured `2026-09-08` on branch `orca-s1-shadow-identity-observation`
(Orca base `bf4e2705`, reviewed candidate `c741ab4a9a`). RED for the ONE
remaining re-review blocker: **Gate 8's authoritative side was
`AuthoritativeReferenceExecutor`, a semantic re-implementation — not an actual
aiControlCenter native execution** (CONTRACT_CONFLICT).

See [`RED-EVIDENCE.md`](./RED-EVIDENCE.md) and
[`RED-EVIDENCE-002.md`](./RED-EVIDENCE-002.md) for the earlier RED records.

## What the reviewed candidate `c741ab4a9a` actually did — INSPECTION

`git show c741ab4a9a:src/main/execution/slices/shadow-identity-observation/shadow-identity-observation.ts`
— the composition root's authoritative side:

```ts
authoritativeExecutor: new AuthoritativeReferenceExecutor(),
```

`git show c741ab4a9a:src/main/execution/infrastructure/authoritative-reference-executor.ts`
— it `applyWorkload()`s the WorkloadSpec in a throwaway git worktree with
hand-written "aiControl-native terminal semantics" and even hand-coarsens
cancellation (`if (outcome.cancellationBehavior === 'cancelled_mid_flight')
outcome.cancellationBehavior = 'cancelled_clean'`). No aiControl code runs.

`git show c741ab4a9a:src/main/execution/slices/shadow-identity-observation/shadow-observation.test-support.ts`
— `writeFixtureAppDb` creates a **6-column toy** `agent_runs` table and
hand-`INSERT`s seven rows (`run_a_1 … run_c_2`). It is not the real Drizzle
schema, there is no `execution_attempts` table, no `providers`/`models`/`agents`
rows, and no run ever passes through `createRun → runAgent → executeClaimedRun →
finalizeRunOnce`.

So at `c741ab4a9a` the acceptance fixture:

- **does not produce genuine aiControl `agent_runs`** — the rows are hand-`INSERT`ed
  into a toy table, or (for the authoritative outcome) never persisted at all;
- **does not invoke the actual aiControl native execution lifecycle** — no claim,
  no allocation decision, no eligibility gate, no `execution_attempts`, no
  `getExecutor`, no `finalizeRunOnce` CAS;
- **cannot prove concurrent native-run crash isolation** — `shadow-crash-isolation.test.ts`
  at `c741ab4a9a` ran `new AuthoritativeReferenceExecutor().execute(...)`
  **synchronously to completion before** the shadow child was even spawned
  (`git show c741ab4a9a:…/shadow-crash-isolation.test.ts` lines 52-59), which
  the re-review explicitly called "not sufficient".

## MECHANICAL RED — the new gate rejects a fabricated terminal row

The new acceptance (`shadow-identity-observation.acceptance.test.ts`) drives the
REAL native lifecycle in a disposable env and asserts each of the six runs has a
real `execution_attempts` row and a read-back (not derived) terminal outcome. A
temporary probe (`ORCA_S1_RED_PROBE=1`) in the harness fabricates the terminal
`agent_runs` row directly — `db.update(agentRuns).set({status})` instead of
`createRun`+`runAgent` — exactly what AMENDMENT-002 §2 forbids:

```
ORCA_S1_RED_PROBE=1 vitest run …/shadow-identity-observation.acceptance.test.ts

 × produced six GENUINE disposable agent_runs across three controlled profiles
     AssertionError: expected null not to be null        (r.attemptStatus — no execution_attempts row)
 × the native terminal outcomes match the controlled workload shapes (read back, not derived)
     AssertionError: expected null to be 2               (no attempt exit code)
 × gate 5 — zero exclusions; zero abandoned
     AssertionError: expected 2 to be +0
 × gate 8 — all six naturally match; zero divergences
     AssertionError: expected 4 to be 6                  (2 runs abandoned)
 Tests  4 failed | 6 passed (10)
```

The probe was removed after capture; the suite is green again (68/68). This
proves the acceptance gate genuinely distinguishes a real native lifecycle from
a hand-inserted row.

## GREEN — the compliant path

`SPEC-AMENDMENT-002.md` (committed `d363412d9e`, before code). Then:

- **`infrastructure/aicontrol-native/disposable-aicontrol-env.ts`** — snapshots
  the canonical checkout's tracked tree at HEAD (`git ls-tree -r -z --name-only
HEAD` + `cpSync`, read-only), junctions its `node_modules`, deploys the harness,
  runs it as a **separate OS process** (vitest subprocess) inside the copy, reads
  the JSON result, tears the copy down.
- **`infrastructure/aicontrol-native/aicontrol-native-harness.mjs`** — inside the
  copy: `drizzle-kit push --force` against a fresh `file:` temp DB, then the REAL
  `createRun → runAgent → executeClaimedRun → getExecutor('mock') →
openExecutionAttempt → executor.execute → closeExecutionAttempt →
finalizeRunOnce` for each of the six workloads (cancel via
  `runCancellation.requestRunTermination` + `finalizeRunOnce`), and reads back
  the real `agent_runs` + `execution_attempts` rows + `git diff --name-only`.
- **`infrastructure/aicontrol-native/native-results-authoritative-executor.ts`** —
  serves those real terminal results verbatim as the Gate 8 authoritative side.
- **`shadow-identity-observation.acceptance.test.ts`** — six genuine disposable
  `agent_runs` across three controlled agent identities; all six match the Orca
  shadow naturally on all four dimensions; canonical `data/app.db` SHA verified
  unchanged before/after; no `-wal`/`-shm`.
- **`shadow-crash-isolation.test.ts`** — the authoritative side is now a real
  native run in its own OS process, SIGKILLed shadow child **while it is still
  running** (`expect(nativeSettled).toBe(false)` before the kill).
- **`native-parity-adjudication.adversarial.test.ts`** — the root-cause
  mechanism, clearly separated: induces a mismatch, proves `unresolved →
contained as abandoned → never recorded as parity`.

`AuthoritativeReferenceExecutor` is deleted.

## Test result

```
vitest run src/main/execution/   ->  Test Files 13 passed (13) · Tests 68 passed (68)
  (native acceptance ~17s, native crash-isolation ~2s; documented per-test
   timeout mirrors aiControlCenter's own queue-pump-real-db.test.ts)
```
