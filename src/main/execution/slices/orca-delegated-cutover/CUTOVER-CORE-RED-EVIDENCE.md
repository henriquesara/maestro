# ORCA-S5 Delegated Cutover Core — Genuine RED Evidence

> Session scope: **RED baseline only**, against the FROZEN, PUBLISHED
> architecture (`SPEC.md` as accepted at
> `627b00b0b71a345783dbc37f9ebff99033e8dc80`, ratified at `caf1526729`,
> published at `b8fe7cb94285bb3b7c13f052fc541de8883de4c3`). No GREEN
> implementation, no production code, no schema/migration, no real fence
> acquisition, no live `ORCA_DELEGATED`. `ORCA_DELEGATED` remains `NOT
> STARTED`; fence acquisition remains `DISABLED`; R3/M5 untouched.

## 1. Pre-flight

- Canonical `origin/main` (fetched fresh this session):
  `b8fe7cb94285bb3b7c13f052fc541de8883de4c3` — matched exactly.
- Fresh worktree/branch created from `origin/main`:
  `impl/orca-s5-delegated-cutover-core`
  (`C:/Users/henrique/Documents/mw-orca-s5-cutover-core-red`).
- `node_modules` linked as a Windows directory junction to the main
  checkout's install (`mklink /J`), matching this repository's documented
  worktree convention — avoids re-triggering a native-module rebuild that
  failed transiently on first `pnpm install` in the fresh worktree (an
  unrelated `@vscode/windows-process-tree` FileTracker error, resolved by
  reusing the main checkout's already-built `node_modules` rather than
  rebuilding).
- `SPEC.md`, `ARCHITECTURE-INDEPENDENT-REVIEW-001.md`,
  `CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md`,
  `ARCHITECTURE-FOCUSED-REREVIEW-002.md`,
  `SPEC-STATUS-RATIFICATION-001.md`, `ARCHITECTURE-FREEZE-RATIFICATION-REVIEW-001.md`
  were all read this session. Not modified by this session (see §7).

## 2. PRE_IMPLEMENTATION baseline (rerun, no reliance on prior reports)

```
pnpm test \
  src/main/ipc/pty/runtime/spawn-execute-commit-propagation.test.ts \
  src/main/ipc/pty/runtime/spawn-execute-cross-alias-promise-convergence.test.ts \
  src/main/ipc/pty/runtime/spawn-options-commit-guard-async.test.ts \
  src/main/ipc/pty/runtime/spawn-options-delegated-cutover-capability-gate.test.ts \
  src/main/providers/local-pty-provider-delegated-command-delivery.test.ts \
  src/main/runtime/orca-runtime-report-pty-spawn-commit-async.test.ts \
  src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts
```

**Result: 7 test files, 38 tests, all passed.** No regression in: deferred
delegated command delivery, true async spawn-commit propagation, provider
capability gate (gate 52), fire-once semantics, sync throw/reentry
hardening, defer/callback pairing, gate 60, native timing/coalescing. This
is the exact same seam `PREIMPLEMENTATION-RED-EVIDENCE.md`/
`PREIMPLEMENTATION-GREEN-EVIDENCE.md` cover — confirmed still 100% green,
unmodified by this session (this session added zero production code).

## 3. Composition-root re-derivation (against current code, not prior reports)

| Claim | Re-verified this session |
| --- | --- |
| `OrcaRuntimeWithDelegatedCutoverCoordinator` does not exist | `ls src/main/runtime/orca-runtime-delegated-cutover-coordinator.ts` → "No such file or directory" |
| `delegation_cutover` absent from schema | `grep -c "delegation_cutover" src/main/execution/infrastructure/execution-schema.ts` → `0` |
| `AiControlFenceClientPort` absent from code | `grep -rl` under `src/main/execution/` → matches only the three `.md` evidence/spec files, zero `.ts` |
| `supportsDelegatedCutoverHold` real and load-bearing | `spawn-options.ts:168`, `local-pty-provider.ts:77`, `pty-provider-contract.ts:155` — all present, unmodified |
| Site #5 callback unchanged | `orca-runtime-create-agent-session.ts:225-227` — `onPtySpawnCommitted: () => { retainReplayFence = true }`, byte-identical to every prior round's citation |
| `RuntimeCreateAgentSessionRequest` has no `delegatedCutover` field yet | `src/shared/agent-session-host-authority.ts:122-135`, read in full — confirmed absent |
| `OrcaRuntimeWithFenceAutomationOwner`/`OrcaRuntimeWithCreateAgentSession` still on one linear mixin chain | Reused the prior session's programmatic chain-walk result (134 classes); no `orca-runtime.ts` chain-root edit since |
| `providers/*`, `ipc/pty/*` import nothing from `execution/*` | `grep -rl` for `execution/` imports under both directories → zero matches |

**Verdict: no drift, no `PREIMPLEMENTATION_RUNTIME_DRIFT`.** Every missing
piece this session's RED relies on is confirmed genuinely missing, not
assumed.

## 4. Execution store contract re-derivation

Confirmed present and unchanged, real, generic, reusable as-is (no
production writer added by this session):

- `run_reservation` (`execution-schema.ts:25-44`), `SqliteReservationStore.reserve()`.
- `run_binding`, `SqliteExecutionStore.recordBinding()` /
  `.withImmediateTransaction()` (wraps the real `runWithImmediateTransaction`,
  `with-immediate-transaction.ts`).
- `dispatch_worktree`, `SqliteDispatchWorktreeStore.insert()`.
- `dispatch_process_binding` (`pid INTEGER NOT NULL`, confirmed), `SqliteDispatchProcessBindingStore.insert()`.
- `ExecutionTransactionRunner` (`execution-transaction-runner.ts`) — the
  exact primitive `worktree-provenance-bind-step.ts`'s real
  `bindDispatchWorktree` already uses.

**Confirmed missing** (legitimate RED causes, not created this session):

- `delegation_cutover` table/migration.
- `SqliteDelegationCutoverStore` (or equivalent writer).
- `src/main/execution/application/delegated-cutover-reservation-step.ts`
  (the future S1→S2 fence+reservation step).
- `src/main/execution/application/delegated-cutover-commit-step.ts` (the
  future S5.4 atomic transaction step).

## 5. aiControl fence contract re-derivation

Read `orca-fence.ts` in full, this session, via
`git show origin/master:src/lib/agent-runner/orca-fence.ts` against
aiControlCenter `origin/master` (`ab5967bdde5115afe6673e8b520a73cfb29f0eaf`,
fresh `git fetch`) — **never the local working-tree checkout**, which is
confirmed behind (`HEAD` = `c2d404a541a...`, an ancestor of `origin/master`).

Derived, byte-accurate, into `FakeAiControlFenceClient`
(`cutover-core-test-harness.ts`):

- `acquireOrcaFence`'s CAS (`status IN ('pending','queued') AND
  orca_fence_state='none'`) and its five outcomes (`ACQUIRED`,
  `ALREADY_FENCED_SAME_TOKEN`, `CONFLICT_DIFFERENT_TOKEN`,
  `ALREADY_CUTOVER`, `NOT_ELIGIBLE`) plus the `ACQUISITION_DISABLED` gate.
- `safeReleaseOrcaFence`'s evidence-gated CAS
  (`positiveNoCutoverEvidence` required; `orca_fence_state='fenced' AND
  orca_fence_token=token`) and its three outcomes.
- `acknowledgeOrcaCutover`'s CAS and its three outcomes, including the
  idempotent-same-token-already-cutover case.

The fake's own fidelity to these real semantics is verified directly in
`delegated-cutover-fence-port-contract.test.ts` (§35) — **6 tests, all
pass** (positive control on the fixture itself, not production code). No
network adapter, no real HTTP call, `data/app.db` never touched (§8 below).

## 6. New RED test files

| File | Mission §§ | Missing import (RED cause) | Result |
| --- | --- | --- | --- |
| `delegated-cutover-fence-and-reservation.test.ts` | 6, 7, 9, 10, 11, 12, 27 | `application/delegated-cutover-reservation-step` | Collection FAIL — module not found |
| `delegated-cutover-transaction-and-schema.test.ts` | 18, 36, 37 | `application/delegated-cutover-commit-step` | Collection FAIL — module not found |
| `delegated-cutover-authority-and-ordering.test.ts` | 19, 20, 21, 22, 23, 24, 25, 26, 28 | `application/delegated-cutover-commit-step` | Collection FAIL — module not found |
| `delegated-cutover-coordinator-callback-and-identity.test.ts` | 13, 15, 16 | `runtime/orca-runtime-delegated-cutover-coordinator` | Collection FAIL — module not found |
| `delegated-cutover-cancellation-ack-fallback.test.ts` | 29, 30, 31, 32 | `application/delegated-cutover-commit-step` | Collection FAIL — module not found |
| `delegated-cutover-recovery.test.ts` | 33 | `runtime/orca-runtime-delegated-cutover-coordinator` | Collection FAIL — module not found |
| `delegated-cutover-identity-boundary-positive-control.test.ts` | 17 (positive control) | none — real code only | **2/2 pass** |
| `delegated-cutover-async-residual-positive-control.test.ts` | 34 (positive control) | none — real code only | **1/1 pass** |
| `delegated-cutover-fence-port-contract.test.ts` | 35 (fixture self-test) | none — fixture only | **6/6 pass** |

**§14** (prepare held execution using the real deferred-delivery seam) is
not a separately new-RED file: the mechanism it depends on
(`deferDelegatedCommandDelivery`, Part A) is already `GREEN` and covered by
§2's baseline; the ordering constraint it adds (workload withheld until
durable commit) is covered by `delegated-cutover-authority-and-ordering.test.ts`'s
commit-before-callback test and the async-residual positive control's
fire-once proof, not duplicated here.

**§5** (aiControl fence contract derivation) is the fixture itself (§5
above), exercised by §35's file.

Two files import the SAME missing module deliberately (mission §42: "do not
require every RED test to fail independently if one missing coordinator
causes a coherent cluster to fail") — `delegated-cutover-transaction-and-schema.test.ts`,
`delegated-cutover-authority-and-ordering.test.ts`, and
`delegated-cutover-cancellation-ack-fallback.test.ts` all share
`delegated-cutover-commit-step`; `delegated-cutover-recovery.test.ts` and
`delegated-cutover-coordinator-callback-and-identity.test.ts` share
`orca-runtime-delegated-cutover-coordinator`. Each file's header comment
names its exact mission subsections and RED cause individually.

## 7. Valid RED / invalid RED self-check

Every RED failure above is `Cannot find module '<path>' imported from
<file>` — exactly mission §40's listed valid causes ("missing
DelegatedCutoverCoordinator", "missing S5 run_reservation creation path" via
its dedicated step module, "missing atomic transaction operation", "missing
recovery API", "current callback not invoking coordinator" — the
coordinator test file is the closest expressible proxy for this, since the
real callback body cannot be edited without a production change). None of
the invalid causes apply: no syntax errors (positive-control files in the
same directories, same transform pipeline, run clean), no bogus imports
solely to fail (every import path is the exact path SPEC.md/`
CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md` names for that future module),
no fake "production" implementation was written under any production path,
no test persistence pre-implements the transaction (the harness reuses only
already-real, already-published stores), and the real `orca-fence.ts` /
`data/app.db` were never called or touched.

**No production edit was required to make any test load up to its own
import statement.** The `@ts-expect-error` comment immediately preceding
each missing import is itself evidence the import is expected and intended
to fail at the type level too, not merely at runtime resolution.

## 8. Frozen architecture immutability

`SPEC.md`, `SPEC-STATUS-RATIFICATION-001.md`,
`ARCHITECTURE-INDEPENDENT-REVIEW-001.md`,
`CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md`,
`ARCHITECTURE-FOCUSED-REREVIEW-002.md`,
`ARCHITECTURE-FREEZE-RATIFICATION-REVIEW-001.md`: **zero edits this
session** (confirmed: `git status --short` shows only new files under §6/§9
below; no existing file in this diff). RED exposed no genuine frozen
contradiction — every gap found (missing coordinator, missing schema,
missing application steps) was already named and expected by the frozen
correction itself (SPEC §4.8, discovery §15's eight-point list).

## 9. Crash-matrix core mapping (mission §38)

| Row | Durable facts | Authority | Process state | Legal next action | Forbidden | Test evidence |
| --- | --- | --- | --- | --- | --- | --- |
| C0 fence acquired, reservation absent | aiControl `'fenced'` only | `AICONTROL_NATIVE` | none | resume same protocol/token | infer cutover, second delegation identity | `delegated-cutover-fence-and-reservation.test.ts` §11 test |
| C1 reservation exists, prepare absent | `run_reservation` only | `AICONTROL_NATIVE` | none | resume same protocol identity | treat reservation as authority | `delegated-cutover-fence-and-reservation.test.ts` §12 test |
| C2 process prepared, cutover absent | `run_reservation` only | `AICONTROL_NATIVE` | real process, unbound | §5.6 identity-recovery-then-fail-closed (already accepted, Parts A/B) | unconditional second spawn | Execution-store side covered by the "transaction failure" test (`delegated-cutover-authority-and-ordering.test.ts` §23); the real-process side is the ALREADY-GREEN Parts A/B seam (§2), not re-tested here |
| C3 atomic transaction in flight | none durable (not yet committed) | `AICONTROL_NATIVE` | real process, unbound | atomic — all four inserts or none | assume partial transaction state | `delegated-cutover-transaction-and-schema.test.ts` §37 rollback test |
| C4 cutover committed, callback not returned | `delegation_cutover` + siblings all durable | `ORCA_DELEGATED` | real process, bound | callback may resolve | reporting success before commit | `delegated-cutover-authority-and-ordering.test.ts` §20 test + async-residual fire-once proof |
| C5 callback resolved, release pending | same as C4 | `ORCA_DELEGATED` | same | proceed to release | second release channel | structurally implied by §21's ordering (commit → callback → release, never reordered); release mechanism itself is outside this core slice's scope (not implemented, not separately RED-tested) |
| C6 release uncertain/fails | same as C4 | `ORCA_DELEGATED` (unchanged) | same, now activating or uncertain | fail-closed later reconciliation | resume native, clear fence, second process | `delegated-cutover-cancellation-ack-fallback.test.ts` §32 test (fence never cleared without positive evidence) |
| C7 duplicate same-identity cutover | one `delegation_cutover` row | `ORCA_DELEGATED` | same | idempotent no-op | duplicate row, duplicate release authorization | `delegated-cutover-authority-and-ordering.test.ts` §26/§28 tests |
| C8 conflicting-token cutover | one `delegation_cutover` row (the first) | `ORCA_DELEGATED` for the first identity only | same | reject the conflicting attempt | overwrite, dual authority | `delegated-cutover-transaction-and-schema.test.ts` §36 write-once test + `delegated-cutover-authority-and-ordering.test.ts` §26/§28 conflict tests |

## 10. Gate mapping (mission §39)

Using exact current gate numbering/text from
`ARCHITECTURE-INDEPENDENT-REVIEW-001.md` §30, as reclassified by round 5
(`SPEC.md`, `ARCHITECTURE-FOCUSED-REREVIEW-002.md` §29):

| Gates | Prior classification | This session's classification | Basis |
| --- | --- | --- | --- |
| 4, 5, 6, 7, 8, 9, 38, 39, 40, 50, 51, 53, 54 | `ARCHITECTURE_SOUND_IMPLEMENTABLE` (round 5) | `CUTOVER_CORE_RED` | Each requires invoking the now-named composition root (§4.8) this session's RED files target; none is proven/GREEN yet |
| 31 | `ARCHITECTURE_SOUND_IMPLEMENTABLE` (re-exercised once the seam exists) | `CUTOVER_CORE_RED` | Re-exercised against the real seam once it exists — this session's RED is exactly that re-exercise, not yet passing |
| 32, 33, 34, 35, 36, 37, 41-49, 52, 55-63 | `ALREADY_TECHNICALLY_PROVEN_PREIMPLEMENTATION` | `ALREADY_GREEN_PREIMPLEMENTATION` | Unaffected by this session — confirmed via §2's unmodified 38/38 baseline pass |
| 19, 20, 21, 22, 26 | `PRE_LIVE_ACTIVATION` | `PRE_LIVE_ACTIVATION` (unchanged) | Frozen dependency, not an architecture or implementation defect — out of this core slice's scope |
| aiControl-side ack authorization/UI (SPEC §16 item 2, break-glass) | not a numbered Maestro gate | `LATER_SLICE_B` | Mission §31's own instruction: classify explicitly, do not invent — this session's ack tests prove only the already-accepted "ack is not authority transfer" invariant, never a new ack route |

## 11. Baseline / regression

- **New RED test files:** 9 (6 genuine RED + 3 positive controls), 0
  production files.
- **Full `src/main/execution` scoped run, this session (includes all 9 new
  files):** 81 test files, 75 passed / 6 failed-to-collect (exactly the 6
  RED files, each for its single documented missing-module reason); **474
  tests passed, 0 tests failed** (the 6 RED files contribute 0 executed
  tests — they fail before any `it()` runs, per vitest's collection-error
  semantics for an unresolved top-level import).
- **PRE_IMPLEMENTATION baseline (§2):** 7 files, 38 tests, unaffected,
  rerun this session, still 100% green.
- Arithmetic: 81 total = 72 pre-existing execution-slice files (unaffected,
  all still passing) + 9 new files (3 pass, 6 collection-fail). No
  pre-existing file's pass/fail status changed.
- **Known unrelated failures:** none observed in this scoped run;
  repository-wide suite success is not claimed (only `src/main/execution`
  plus the seven explicit PRE_IMPLEMENTATION files were run this session).

## 12. aiControl guard

- Before this session's RED work: `origin/master` =
  `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`, `data/app.db` SHA-256 =
  `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`.
- After: identical, re-verified via fresh `git fetch` + `sha256sum`
  immediately before this commit. No `-wal`/`-shm`/journal file present
  either time. Zero writes to `aiControlCenter` at any point — every read
  used `git show origin/master:<path>` or `git fetch`/`git rev-parse`
  only.

## 13. Authority

Before/after this session: `AICONTROL_NATIVE`. `ORCA_DELEGATED`: NOT
STARTED. Fence acquisition: DISABLED. R3: NOT STARTED. M5: NOT STARTED.
Zero code, test-target, schema, or migration changes to any production
file; only new test files and this evidence document were added.
