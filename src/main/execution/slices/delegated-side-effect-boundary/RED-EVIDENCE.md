# ORCA-S4 — RED-BEFORE-GREEN Evidence

**State class:** `RED_BASELINE_READY_FOR_IMPLEMENTATION`
**Display verdict:** `MAESTRO_ORCA_S4_GENUINE_RED_BASELINE_READY_FOR_GREEN_IMPLEMENTATION`

Frozen contract: [`SPEC.md`](./SPEC.md), HEAD `521fb80036b158518967948848517cbcfac113f5`
(unedited by this session — no production S4 implementation exists at this commit).

This document maps every material frozen requirement — LIFE-1..15, §12/§12.1
windows L1–L14, acceptance gates 1–25, and the mission's 33 required RED areas
— to the test file, test name, the command that runs it, and the **exact,
verified** failure reason, with an explicit call-out of why each failure is
behavioral (missing S4 implementation) rather than artificial (typo, broken
fixture, unrelated error).

## How to reproduce every failure in this document

```bash
pnpm test src/main/execution
```

Baseline check performed **before** any RED test was added (published base
`521fb80036b158518967948848517cbcfac113f5`, ORCA-S1/S2/S3 + everything else
under `src/main/execution`):

```
Test Files  49 passed | 2 skipped (51)
     Tests  313 passed | 11 skipped (324)
```

Full run **after** adding this RED baseline (20 new files, 0 modified files):

```
Test Files  20 failed | 49 passed | 2 skipped (71)
     Tests  9 failed | 314 passed | 11 skipped (334)
```

- The **313 pre-existing tests still pass, byte-for-byte unmodified** — the RED
  baseline regresses nothing.
- **+1 newly-passing test** — a schema guard ("zero column added to any
  ORCA-S1/S2/S3 table") that is legitimately already true against the real,
  unmodified `execution-schema.ts` and must stay true through GREEN; it is not
  RED evidence, it is a regression tripwire (same convention as ORCA-S3's own
  "byte-unchanged" acceptance-gate assertions).
- **9 genuinely failing assertions**, all in one file
  (`delegated-side-effect-boundary.schema.test.ts`) that targets the **real,
  unmodified** `execution-schema.ts` directly — no import of a not-yet-existing
  module. These are true "missing schema/table" RED per the RED-validity rules.
- **19 other new files fail entirely at collection** with `Cannot find module
  './...'` / `'../...'` — every one of them names an S4 module (domain type,
  application service, or infrastructure store/adapter) that this session
  **deliberately did not create**, per the RED-only mandate. This is the
  "missing module/port/store" class of valid RED the mission specifies
  explicitly, and it is the **same convention this codebase's own ORCA-S2/S3
  RED phases used** — e.g. `durable-worktree-provenance.acceptance.test.ts`'s
  own header comment: *"RED: `convergeWorktreeProvenance` /
  `ReadOnlyWorktreeProvenanceSource` do not exist yet."*

No test in this baseline fails on a syntax error, a deliberately false
assertion, an unrelated type error, a timeout, a broken fixture, or an
unavailable external dependency. Every failure traces to one specific,
named, not-yet-implemented piece of the frozen contract.

## Files added (test-only — zero production S4 implementation)

```
src/main/execution/domain/restart-recovered-identity-verification.test.ts
src/main/execution/domain/macos-argv-identity-proof.test.ts
src/main/execution/domain/worktree-finalization.test.ts
src/main/execution/domain/dispatch-lifecycle-closure.test.ts
src/main/execution/infrastructure/sqlite-dispatch-process-binding-store.test.ts
src/main/execution/infrastructure/sqlite-dispatch-termination-store.test.ts
src/main/execution/infrastructure/sqlite-worktree-finalization-store.test.ts
src/main/execution/infrastructure/sqlite-dispatch-lifecycle-closure-store.test.ts
src/main/execution/infrastructure/sqlite-dispatch-lifecycle-event-store.test.ts
src/main/execution/infrastructure/sqlite-dispatch-lifecycle-incident-store.test.ts
src/main/execution/infrastructure/shadow-lifecycle-process-adapter.test.ts
src/main/execution/infrastructure/shadow-lifecycle-process-adapter.restart-recovered.test.ts
src/main/execution/application/worktree-finalizer.test.ts
src/main/execution/application/converge-delegation-boundary-lifecycle.test.ts
src/main/execution/application/converge-delegation-boundary-lifecycle.process-identity-safety.test.ts
src/main/execution/application/converge-delegation-boundary-lifecycle.late-conflict.test.ts
src/main/execution/application/reconcile-orphan-shadow-state.test.ts
src/main/execution/slices/delegated-side-effect-boundary/delegated-side-effect-boundary-test-harness.ts   (test fixture helper — no production behavior)
src/main/execution/slices/delegated-side-effect-boundary/shadow-lifecycle-child.mjs                        (disposable killable-child fixture — no production behavior)
src/main/execution/slices/delegated-side-effect-boundary/delegated-side-effect-boundary.schema.test.ts
src/main/execution/slices/delegated-side-effect-boundary/delegated-side-effect-boundary.crash-windows.test.ts
src/main/execution/slices/delegated-side-effect-boundary/delegated-side-effect-boundary.acceptance.test.ts
src/main/execution/slices/delegated-side-effect-boundary/RED-EVIDENCE.md                                   (this file)
```

**Zero** production files were created or modified: no `execution-schema.ts`
edit, no new store/service/port/adapter implementation, no composition-root
wiring. `git diff --stat` against `521fb80036b...` touches only the files
listed above.

---

## Target module surface this RED baseline assumes (not yet implemented)

So GREEN implementation has one unambiguous list to satisfy — every path below
is imported by at least one test above and currently resolves to
`Cannot find module`:

| Path | Kind |
| --- | --- |
| `domain/restart-recovered-identity-verification.ts` | pure fn — §9.1/§9.1.2 checks 1-3 |
| `domain/macos-argv-identity-proof.ts` | pure fn — §9.1.3 compound proof |
| `domain/worktree-finalization.ts` | pure fn — §10.1 eligibility digest, + `WorktreeFinalizationRecord` type |
| `domain/dispatch-lifecycle-closure.ts` | pure fn — §8.5 closure digest, + `DispatchLifecycleClosureRecord` type |
| `domain/dispatch-process-binding.ts` | `DispatchProcessBindingRecord` type (§8.1) |
| `domain/dispatch-termination.ts` | `DispatchTerminationRecord` type (§8.2) |
| `domain/dispatch-lifecycle-event.ts` | `DispatchLifecycleEventRecord` type (§8.6) |
| `domain/dispatch-lifecycle-incident.ts` | `DispatchLifecycleIncidentRecord` type (§8.4) |
| `infrastructure/sqlite-dispatch-process-binding-store.ts` | `SqliteDispatchProcessBindingStore` |
| `infrastructure/sqlite-dispatch-termination-store.ts` | `SqliteDispatchTerminationStore` |
| `infrastructure/sqlite-worktree-finalization-store.ts` | `SqliteWorktreeFinalizationStore` |
| `infrastructure/sqlite-dispatch-lifecycle-closure-store.ts` | `SqliteDispatchLifecycleClosureStore` |
| `infrastructure/sqlite-dispatch-lifecycle-event-store.ts` | `SqliteDispatchLifecycleEventStore` |
| `infrastructure/sqlite-dispatch-lifecycle-incident-store.ts` | `SqliteDispatchLifecycleIncidentStore` |
| `infrastructure/shadow-lifecycle-process-adapter.ts` | `ShadowLifecycleProcessAdapter` (§9.1) — `spawn`/`observe`/`requestTermination`/`requestTerminationByPid` |
| `application/worktree-finalizer.ts` | `advanceWorktreeFinalization` (§10.2) |
| `application/reconcile-orphan-shadow-state.ts` | `reconcileOrphanShadowState` (§10.3) |
| `application/converge-delegation-boundary-lifecycle.ts` | `convergeDelegationBoundaryLifecycle` (§11, Phases 1-5) |
| `infrastructure/execution-schema.ts` | **extended, not new** — `EXECUTION_SCHEMA_VERSION` 4→5 + six-table `DELEGATION_BOUNDARY_LIFECYCLE_SQL` (§8) |

GREEN implementation is also expected to add the bind-time seam extension to
`application/shadow-observation-service.ts` and the composition wiring in
`slices/shadow-identity-observation/shadow-identity-observation.ts` (§9.2,
§2) — **no test in this RED baseline imports either file**, by design: the RED
session's own FORBIDDEN list bars composition-root wiring, so those two
extension points have no RED test of their own yet. GREEN implementation adds
them; the existing `delegated-side-effect-boundary.acceptance.test.ts` "byte-
unchanged sibling coordinators" check will catch any premature or incorrect
wiring the moment it lands, and a follow-up composition-level acceptance test
is expected once the bind-time seam exists.

---

## Requirement -> test mapping

### Schema (§8, gate 2)

| Requirement | Test file | Test name | Failure |
| --- | --- | --- | --- |
| `EXECUTION_SCHEMA_VERSION` bumped 4→5 | `delegated-side-effect-boundary.schema.test.ts` | `EXECUTION_SCHEMA_VERSION must be bumped to 5` | `AssertionError: expected 4 to be 5` |
| Six new tables exist | same file | `a fresh store migrated to current version has all six S4 tables` | `expected false to be true` (table missing) x6 |
| Exact column sets §8.1-§8.6 | same file | `dispatch_process_binding has the exact §8.1 column set` (+5 siblings) | `expected [] to deeply equal [10 columns]` — table doesn't exist, `PRAGMA table_info` returns empty |
| `dispatch_lifecycle_event` composite PK | same file | `...with a COMPOSITE primary key` | same — table absent |
| Gate 2 "zero column added to S1/2/3 tables" | same file | `ZERO column is added to any ORCA-S1/S2/S3 table` | **currently PASSES** (real code, nothing to violate yet) — kept as a regression tripwire, not RED |
| v4→v5 idempotent upgrade | same file | `an existing v4 store upgrades to v5 in place` | `expected 4 to be 5` |

### §8.1 `dispatch_process_binding` (SOURCE, area 2, area 9)

`infrastructure/sqlite-dispatch-process-binding-store.test.ts` — **all 7
tests fail at collection**: `Cannot find module
'./sqlite-dispatch-process-binding-store'`. Covers: insert/read-back,
write-once PK, `os_start_marker=NULL`+`'unavailable'` (L13), the ONE permitted
`teardown_requested_at` mutation + its idempotency (L6), survival across a
projection rebuild (LIFE-4).

### §8.2 `dispatch_termination` (SOURCE, area 3, LIFE-6, gate 5)

`infrastructure/sqlite-dispatch-termination-store.test.ts` — **all 6 tests
fail at collection**: `Cannot find module
'./sqlite-dispatch-termination-store'`. Covers: write-once PK-collision no-op,
**no update method exists on the store surface at all** (immutability by
construction, gate 5), honest `confirmed_dead_unknown_cause` NULLs, projection-
rebuild survival.

### §8.3 `worktree_finalization` (SOURCE, area 4)

`infrastructure/sqlite-worktree-finalization-store.test.ts` — **all 8 tests
fail at collection**: `Cannot find module './sqlite-worktree-finalization-
store'`. Covers all four status transitions (§7 allowed list), PK write-once
intent, idempotent `markFinalized` retry, projection-rebuild survival.

### §8.4 `dispatch_lifecycle_incident` (PROJECTION, area 7)

`infrastructure/sqlite-dispatch-lifecycle-incident-store.test.ts` — **all 7
tests fail at collection**: `Cannot find module
'./sqlite-dispatch-lifecycle-incident-store'`. Covers UNIQUE-index no-op-on-
retry, new-evidence-is-a-new-row, `hasOpenLifecycleIncident`, manual-only
`resolve`, all five `kind`s, and that it is the table a rebuild actually drops.

### §8.5 `dispatch_lifecycle_closure` (SOURCE — corrected, area 5, LIFE-5/15)

`infrastructure/sqlite-dispatch-lifecycle-closure-store.test.ts` — **all 6
tests fail at collection**: `Cannot find module
'./sqlite-dispatch-lifecycle-closure-store'`. Covers write-once PK (structurally
forbids a replacement row), the ONE permitted
`post_closure_settlement_conflict_detected_at` mutation leaving every `*_ref`
+ `closure_digest` untouched, that mutation's idempotency, **no
update/rewrite/replace method exists on the store's own prototype**, and
NOT-regenerated-by-rebuild (contrast with the incident table).

### §8.6 `dispatch_lifecycle_event` (SOURCE — corrected, area 6, LIFE-7)

`infrastructure/sqlite-dispatch-lifecycle-event-store.test.ts` — **all 5
tests fail at collection**: `Cannot find module
'./sqlite-dispatch-lifecycle-event-store'`. Covers the composite-PK
idempotency mechanism directly (window L9), a distinct `event_kind` being a
distinct row, NOT-regenerated-by-rebuild.

### Digest purity (§8.5, §10.1)

`domain/worktree-finalization.test.ts` (6 tests) and
`domain/dispatch-lifecycle-closure.test.ts` (3 tests) — **all fail at
collection**: `Cannot find module './worktree-finalization'` /
`'./dispatch-lifecycle-closure'`. Covers determinism, exact 64-hex-char SHA-256
shape, sensitivity to every input field, and — critically for the closure
digest — that it **ignores** `correlationId`/`closedAt`/the post-closure
marker, mirroring ORCA-S3 PROV-2's exclusion discipline exactly.

### §9.1/§9.1.2 restart-recovered identity, checks 1-3 (areas 9-11, 13, LIFE-2, gates 7/24)

`domain/restart-recovered-identity-verification.test.ts` — **all 15 tests
fail at collection**: `Cannot find module
'./restart-recovered-identity-verification'`. Pure-function coverage,
platform-independent (fakeable inputs): sidecar mismatch, pid-absent, OS-
marker-unreadable, **§12 window L12** (OS-marker disagreement = PID reuse by
an unrelated process B), **§12 window L13** (`'unavailable'` source =
unconditional `identity_unverifiable`), and the explicit proof that Windows
(`windows_creation_time`) / Linux (`posix_proc_stat_starttime`) sources are
SUFFICIENT alone — no macOS escalation required — while a `posix_ps_lstart`
source is REQUIRED to escalate to the macOS branch (6 sub-cases), including the
"macOS observation entirely omitted" fail-closed case.

### §9.1.3 macOS compound identity proof, pure function (macOS hardening section, gate 25)

`domain/macos-argv-identity-proof.test.ts` — **all 10 tests fail at
collection**: `Cannot find module './macos-argv-identity-proof'`. Directly
implements gate 25's four bullet requirements at the pure-function level:
same-second-collision-alone-insufficient, exact-nonce-required (with the
sharper "another genuine S4 process" sub-case), positive control, mismatch/
unreadability fail-closed (unreadable argv, argv missing the nonce token
entirely), **plus the mission's residual #2 hardening** — exact,
boundary-anchored token match, not substring: a nonce that is a substring of a
longer live token must NOT verify, and the reverse (expected nonce longer than
the live token) must also not verify.

### §9.1/§9.2 real adapter (areas 8, 17)

`infrastructure/shadow-lifecycle-process-adapter.test.ts` — **all 5 tests
fail at collection**: `Cannot find module './shadow-lifecycle-process-
adapter'`. Exercises a REAL spawned child process (via `spawn()`'s contract):
pid/killScope/osStartMarker shape, verbatim `processNonce` in argv (the
foundation §9.1.3 depends on), `observe()` live vs self-exit, and a REAL
`requestTermination(handle)` verified-kill.

`infrastructure/shadow-lifecycle-process-adapter.restart-recovered.test.ts` —
**all 3 tests fail at collection**: same missing module. Gate 24's positive
control with a REAL process: spawn, drop the in-memory handle (simulated
restart), terminate through the pid-addressed sibling entry point
(`requestTerminationByPid`) and verify it actually died; asserts the two call
shapes are genuinely distinct methods; already-dead-pid safety.

### §10 governed reap (areas 21-26, gates 6/11/12/22)

`application/worktree-finalizer.test.ts` — **all 7 tests fail at collection**:
`Cannot find module './worktree-finalizer'`. Real filesystem, real SQLite:
intent-before-deletion ordering (gate 6), digest match → delete + finalize,
digest MISMATCH on retry → `conflicted` with **no deletion attempted**,
idempotent already-absent-is-success (L3/L4/L5), legacy →
`skipped_not_eligible` with no filesystem act, **`isInside` confinement**
refusing a path outside the durable root (gate 22, LIFE-3).

### §10.3 orphan reconciliation (gate 10)

`application/reconcile-orphan-shadow-state.test.ts` — **all 7 tests fail at
collection**: `Cannot find module './reconcile-orphan-shadow-state'`. Both
orphan classes (worktree windows A-C; S4's own pre-commit process window L7),
each: untouched inside `orphanGraceMs`, reaped + audit-logged past it, **never
a fabricated `correlation_id`-keyed row**, and the process class's identity-
unverifiable (corrupt sidecar) fail-closed skip-log-don't-touch path.

### §11 the sweep — orchestration (areas 30-31, gates 8/9/13/14, LIFE-8/9/11/12, §8.7)

`application/converge-delegation-boundary-lifecycle.test.ts` — **all 8 tests
fail at collection**: `Cannot find module
'../infrastructure/sqlite-dispatch-lifecycle-closure-store'` (the sweep's own
first missing dependency). Covers: §8.7 prospective eligibility (`LEGACY_
BINDING_NOT_LIFECYCLE_MANAGED`, 0-rows-0-incidents-on-first-activation
mirroring S3 gate 18), Phases 1→4 happy path, closure-copies-never-decides
(LIFE-5), **LIFE-9 incident isolation** (an S4 incident blocks only S4, never
touches `settlement_incident`/`worktree_provenance_incident`), both
`_RETRYABLE` codes writing nothing/no-incident/not-blocked (§13), **gate 8
fixed-point** (3x replay → identical durable counts), and **gate 14 / LIFE-8**
(a duplicate hook firing 0/1/5 times produces byte-identical durable results).

### §9.3/§14 LIFE-2 bare-pid-kill prevention (area 14-15, 17-20, gates 7/24/25, §20 #2)

`application/converge-delegation-boundary-lifecycle.process-identity-safety.test.ts`
— **all 9 tests fail at collection**: same missing dependency. **The decisive
assertion in every test is a spy on `requestTerminationByPid`'s call count**,
per gate 25's explicit text ("so a bug that classifies correctly but signals
anyway would still fail the gate") — not merely the returned classification.
Covers L12 (pid-reuse-by-unrelated-process → 0 calls + blocking incident), L13
(marker unavailable → 0 calls), a sidecar-mismatch case, a positive control
(exactly 1 call on genuine match), and the full gate-25 macOS matrix
(same-second-collision-insufficient, different-processNonce-never-signalled,
positive control, nonce-missing-never-signalled, and an evidence-boundary
check that no incident's `detail_json` ever claims production/remote parity).

### §11 Phase 5 / §12 window L14 / gate 23 / LIFE-15 (areas 28-29)

`application/converge-delegation-boundary-lifecycle.late-conflict.test.ts` —
**all 3 tests fail at collection**: same missing dependency. The first test is
gate 23's exact six-step scenario end-to-end: close while `'observed'` →
durable closure+event → an **independent, later** write moves
`settlement_observation.status` to `'observed_conflicted'` (modeling S2's own
frozen contract, never performed by S4 itself) → closure/event proven
byte-for-byte unchanged → the **next** sweep's Phase 5 sets the one permitted
marker + raises a blocking incident whose `detail_json` names both statuses →
a (test-only) future-projection-consumer helper proves it refuses to copy a
marked closure. The other two tests prove Phase 5 runs on every sweep for
every closure (not just newly-eligible ones) with idempotent mutation +
incident, and that a non-divergent case is a true no-op.

### §12 crash/restart window table (area: CRASH WINDOWS, gate 9)

`delegated-side-effect-boundary.crash-windows.test.ts` — **9 of 9 `it` blocks
in this file's scope fail at collection**: `Cannot find module
'../../application/converge-delegation-boundary-lifecycle'`. Windows L9, L12,
L13, L14 have their **own dedicated, more exhaustive** coverage elsewhere
(cross-referenced below) rather than being duplicated here.

| Window | Mechanism used | What it proves |
| --- | --- | --- |
| L1 | **REAL** spawned+self-exited child process, no live handle tracked, no `teardown_requested_at` | `confirmed_dead_unknown_cause`, NULL exit fields, NOT an incident |
| L2 | Direct durable-state seeding | legitimate intermediate state, sweep proceeds normally |
| L3 | Direct durable-state + real filesystem (worktree pre-deleted) | idempotent re-attempt → `finalized` |
| L4 | Direct durable-state + real filesystem (worktree present) | retry-from-scratch, same path as L3 |
| L5 | *(documented as collapsing into the same L3/L4 path per §10.2 — see `worktree-finalizer.test.ts`'s idempotent-deletion test)* | — |
| L6 | **REAL** spawned hung child, `markTeardownRequested` called, then a REAL `SIGKILL` | `'signalled'`, `tree_verified=false`, attributable not `confirmed_dead_unknown_cause` |
| L7 | Sentinel (full behavioral proof lives in `reconcile-orphan-shadow-state.test.ts`) | no committed row anywhere for the orphan shape |
| L8 | Direct durable-state + double sweep call | second `worktree_finalization` insert is a no-op, not a double-delete |
| L9 | *(full proof in `converge-delegation-boundary-lifecycle.test.ts`'s LIFE-8 test)* | 0/1/5 hook fires → identical durable result |
| L10 | Fake port throwing `LIFECYCLE_STORE_BUSY_RETRYABLE` | no row, no incident, surfaced as retryable |
| L11 | Two bindings, staggered process-binding seeding across two sweep calls | the already-closed binding's closure is byte-identical after the second sweep — never re-processed |
| L12 | *(full proof in `...process-identity-safety.test.ts`)* | unrelated process B never signalled |
| L13 | *(full proof in `...process-identity-safety.test.ts`)* | marker-less binding always `identity_unverifiable` |
| L14 | *(full proof in `...late-conflict.test.ts`)* | gate 23's exact scenario |

### Acceptance / cross-cutting (gates 1, 2, 4, 15, 16, 20, 21, 22, §20 attack surfaces #1/#6/#7/#14/#18)

`delegated-side-effect-boundary.acceptance.test.ts`:

| Test | Failure | Gate/surface |
| --- | --- | --- |
| `data/app.db` untouched across a full sweep incl. incident path | `Cannot find module '../../application/converge-delegation-boundary-lifecycle'` | 15, 20 |
| Static audit: no `finalizeRunOnce`/`agent_runs`/scheduler/webhook token in any S4 file | `expected false to be true` — **the audited files themselves don't exist yet** (`existsSync(file)` fails first, mirroring ORCA-S3's own acceptance-gate audit convention exactly: *"must exist for the static audit to run"*) | 16, §20 #1 |
| Sibling coordinators byte-unchanged (no "phase N.5") | currently PASSES (nothing has touched them yet) — regression tripwire | 2, §20 #8 |
| Gate 4 — five SOURCE tables survive a projection rebuild byte-for-byte | `Cannot find module` (six S4 stores) | 4, LIFE-4, §20 #7 |
| Gate 21 — `DelegationBoundaryLifecycleReport.syntheticProcessDisclaimer` exists and reads as a genuine non-parity disclaimer | `Cannot find module` | 21, §20 #14 |
| §20 #18 — no test file in this slice claims remote/SSH parity | currently PASSES (guard, scans the slice's own `.test.ts` files) | §20 #18 |

### Synthetic-only boundary / SSH boundary (§5.1, §20 #14, #18)

Enforced structurally, not just asserted: every process-lifecycle test in this
baseline spawns/observes/terminates **only** the disposable
`shadow-lifecycle-child.mjs` fixture under a test-owned temp directory: no
test targets a real user process or a real user worktree. The acceptance
file's two guard tests (above) keep this true as GREEN lands.

---

## LIFE-1..15 cross-reference

| Invariant | Primary evidence |
| --- | --- |
| LIFE-1 no fabrication | `converge-delegation-boundary-lifecycle.test.ts` retryable tests (writes nothing on uncertainty); `reconcile-orphan-shadow-state.test.ts` (never fabricates a row) |
| LIFE-2 fail-closed identity, no bare-pid kill | `restart-recovered-identity-verification.test.ts`, `macos-argv-identity-proof.test.ts`, `converge-delegation-boundary-lifecycle.process-identity-safety.test.ts` (spy-based) |
| LIFE-3 no premature/unconfined deletion | `worktree-finalizer.test.ts` (`isInside` guard, intent-before-deletion) |
| LIFE-4 SOURCE never rebuilt | every store test's "preserved by a projection rebuild" case + `delegated-side-effect-boundary.acceptance.test.ts` gate-4 test |
| LIFE-5 closure copies, never re-decides | `converge-delegation-boundary-lifecycle.test.ts` ("verbatim copies" test); `converge-delegation-boundary-lifecycle.late-conflict.test.ts` |
| LIFE-6 termination write-once | `sqlite-dispatch-termination-store.test.ts` |
| LIFE-7 no duplicate side effects | `sqlite-worktree-finalization-store.test.ts`, `sqlite-dispatch-lifecycle-event-store.test.ts`, crash-windows L8 |
| LIFE-8 hooks are wake-up hints only | `converge-delegation-boundary-lifecycle.test.ts` LIFE-8 test, crash-windows L9 cross-ref |
| LIFE-9 incident isolation | `converge-delegation-boundary-lifecycle.test.ts` incident-isolation test |
| LIFE-10 advisory only / zero authority | `delegated-side-effect-boundary.acceptance.test.ts` DB-guard + static-audit tests |
| LIFE-11 one writer per fact | structural — each store has exactly one insert path in its own test file; no test writes an S1-S3 table |
| LIFE-12 prospective eligibility | `converge-delegation-boundary-lifecycle.test.ts` §8.7 tests |
| LIFE-13 scoped to Execution's own shadow resources | every fixture spawns/creates only under a test-owned temp dir; `worktree-finalizer.test.ts`'s `isInside` test |
| LIFE-14 no stage advance | `delegated-side-effect-boundary.acceptance.test.ts` static audit (no queue/scheduler/authority token) |
| LIFE-15 closure frozen, late contradiction surfaced | `converge-delegation-boundary-lifecycle.late-conflict.test.ts` |

## Acceptance gates 1-25 cross-reference

1 (spec satisfied) — this whole baseline is derived clause-by-clause from the
frozen SPEC; no fixture reinterprets a term. 2 — acceptance static audit +
byte-unchanged checks. 3 — this document. 4 — acceptance gate-4 test. 5 —
`sqlite-dispatch-termination-store.test.ts`. 6 —
`worktree-finalizer.test.ts`. 7 — `process-identity-safety.test.ts` +
`restart-recovered-identity-verification.test.ts`. 8 — `converge-...test.ts`
fixed-point test. 9 — `crash-windows.test.ts` + cross-referenced files. 10 —
`reconcile-orphan-shadow-state.test.ts`. 11 —
`sqlite-worktree-finalization-store.test.ts` + `sqlite-dispatch-lifecycle-
event-store.test.ts`. 12 — `worktree-finalizer.test.ts` eligibility tests. 13
— `converge-...test.ts` retryable tests. 14 — `converge-...test.ts` LIFE-8
test. 15/16/20 — acceptance file. 17/18/19 — the unmodified 313 pre-existing
tests (baseline run above) stand as the regression proof; GREEN implementation
must keep them green. 21 — acceptance gate-21 test. 22 —
`worktree-finalizer.test.ts` confinement test. 23 — `late-conflict.test.ts`.
24 — `process-identity-safety.test.ts` positive/negative controls +
`shadow-lifecycle-process-adapter.restart-recovered.test.ts`'s real-process
positive control. 25 — `macos-argv-identity-proof.test.ts` (pure function) +
`process-identity-safety.test.ts` (spy-based, service level).

## Mission's 33 REQUIRED RED AREAS -> primary file

1 schema/state ownership → schema.test.ts. 2 `dispatch_process_binding` SOURCE
→ sqlite-dispatch-process-binding-store.test.ts. 3 `dispatch_termination`
SOURCE → sqlite-dispatch-termination-store.test.ts. 4 `worktree_finalization`
SOURCE → sqlite-worktree-finalization-store.test.ts. 5
`dispatch_lifecycle_closure` SOURCE → sqlite-dispatch-lifecycle-closure-
store.test.ts. 6 `dispatch_lifecycle_event` SOURCE → sqlite-dispatch-
lifecycle-event-store.test.ts. 7 `dispatch_lifecycle_incident` projection →
sqlite-dispatch-lifecycle-incident-store.test.ts. 8 synthetic shadow lifecycle
process → shadow-lifecycle-process-adapter.test.ts. 9 processNonce
generation/persistence → shadow-lifecycle-process-adapter.test.ts +
restart-recovered-identity-verification.test.ts. 10 PID+OS-marker
corroboration → restart-recovered-identity-verification.test.ts. 11 Windows
identity path → restart-recovered-identity-verification.test.ts (sufficiency
test). 12 Linux identity path → same file. 13 macOS compound identity →
macos-argv-identity-proof.test.ts. 14 PID reuse fail-closed → process-
identity-safety.test.ts (L12). 15 macOS same-second reuse → macos-argv-
identity-proof.test.ts + process-identity-safety.test.ts. 16 pre-commit
orphan recovery → reconcile-orphan-shadow-state.test.ts. 17 process-tree
termination intent/observation/ack → shadow-lifecycle-process-
adapter.test.ts + restart-recovered variant. 18 already-dead process →
shadow-lifecycle-process-adapter.restart-recovered.test.ts. 19
identity_unverifiable=>no signal → process-identity-safety.test.ts
(spy-based, every scenario). 20 duplicate termination idempotency →
sqlite-dispatch-termination-store.test.ts + crash-windows L6/L8. 21 worktree
finalization eligibility → worktree-finalizer.test.ts. 22 finalization
intent/fs/ack → worktree-finalizer.test.ts. 23 no premature deletion →
worktree-finalizer.test.ts. 24 orphan worktree reconciliation → reconcile-
orphan-shadow-state.test.ts. 25 duplicate finalization prevention →
sqlite-worktree-finalization-store.test.ts + crash-windows L8. 26 immutable
lifecycle closure → sqlite-dispatch-lifecycle-closure-store.test.ts. 27
immutable lifecycle event → sqlite-dispatch-lifecycle-event-store.test.ts. 28
late S2 observed->observed_conflicted after closure → late-conflict.test.ts.
29 late conflict never rewrites, blocks reconciliation, blocks future
delegation → late-conflict.test.ts. 30 restart/reconciliation idempotency →
converge-delegation-boundary-lifecycle.test.ts fixed-point test + crash-
windows L11. 31 hooks not required for correctness → converge-delegation-
boundary-lifecycle.test.ts LIFE-8 test. 32 zero authoritative data/app.db
writes → acceptance.test.ts DB-guard test. 33 zero authority transfer →
acceptance.test.ts static audit.

---

## Synthetic process proof vs. production executor / process-handle parity

Every test in this baseline that spawns a real OS process spawns **only**
`shadow-lifecycle-child.mjs` — an explicitly synthetic, disposable, test-owned
fixture (mirrors `shadow-run-child.mjs`, S1-S3's own established pattern).
**None of it proves:**

- production process-handle acquisition for a real delegated workload (§5) —
  no such seam exists in this repository yet, and this RED baseline invents
  none;
- SSH / remote execution identity (§5.1) — every OS read in this baseline
  (`getPsProcessIdentity`-shaped calls, Windows creation-time, `/proc/<pid>/
  stat`) is local-host only, and no test claims otherwise (enforced by the
  acceptance file's own guard scan of this slice's test files);
- real executor parity (ORCA-S1 residual R1) — orthogonal, untouched.

`delegated-side-effect-boundary.acceptance.test.ts`'s gate-21 test requires
the **implementation's own evidence report** (`DelegationBoundaryLifecycleReport
.syntheticProcessDisclaimer`) to state this explicitly — not merely the SPEC
prose — so the disclaimer is proven present in the actual GREEN artifact, not
only in this document.

---

## Do NOT

This RED baseline contains **zero** production S4 implementation: no schema
edit, no store/service/port/adapter implementation, no composition-root
wiring, no SPEC edit. `ORCA_DELEGATED` and M5 are untouched and unmentioned
outside quoted SPEC citations.
