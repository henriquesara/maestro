# ORCA-S5 Delegated Cutover Core — GREEN Implementation Evidence

> Session scope: minimum production GREEN for the genuine RED committed at
> `7e03539e23e6eae9b0f5024a2a9eafdd1b7f4fe6`, against the frozen, published
> architecture (`SPEC.md` accepted at `627b00b0b71a345783dbc37f9ebff99033e8dc80`,
> published at `b8fe7cb94285bb3b7c13f052fc541de8883de4c3`). No real aiControl
> network integration, no real fence acquisition, no R3, no terminal
> lifecycle/projection, no automatic fallback, no M5. `ORCA_DELEGATED` stays
> `NOT STARTED` operationally; fence acquisition stays `DISABLED`.

## 1. RED commit identity

- RED HEAD: `7e03539e23e6eae9b0f5024a2a9eafdd1b7f4fe6`, parent
  `b8fe7cb94285bb3b7c13f052fc541de8883de4c3` (`origin/main`) — confirmed
  this session, no other commit exists between them.
- RED diff was tests + a test harness + evidence Markdown only — confirmed
  this session by re-reading `CUTOVER-CORE-RED-EVIDENCE.md` and the 9
  committed test files before writing any production code.

## 2. Production implementation

| File | Role |
| --- | --- |
| `src/main/execution/domain/delegation-cutover.ts` | Domain type — `DelegationCutoverRecord` (SPEC §8.1). |
| `src/main/execution/infrastructure/sqlite-delegation-cutover-store.ts` | The only writer of `delegation_cutover`; `insert`/`get`/`getByAicontrolRun`. |
| `src/main/execution/infrastructure/aicontrol-fence-client-port.ts` | `AiControlFenceClientPort` type (SPEC §4.8.5) + `createFailClosedAiControlFenceClientPort()` — the production default. |
| `src/main/execution/application/delegated-cutover-reservation-step.ts` | `establishDelegatedCutoverReservation` — SPEC §5.2 S1→S2 (fence → `run_reservation`). |
| `src/main/execution/application/delegated-cutover-commit-step.ts` | `commitDelegatedCutover` — SPEC §5.4 atomic transaction. |
| `src/main/runtime/orca-runtime-delegated-cutover-coordinator.ts` | `OrcaRuntimeWithDelegatedCutoverCoordinator` — SPEC §4.8.1 composition root. |
| `src/main/runtime/orca-runtime-resolve-waiter.ts` | One-line `extends` change: now extends the new coordinator mixin instead of `OrcaRuntimeWithDeliverPendingMessages` directly. |
| `src/shared/agent-session-host-authority.ts` | Additive `RuntimeCreateAgentSessionRequest.delegatedCutover?` field (SPEC §4.8.3). |
| `src/main/execution/infrastructure/execution-schema.ts` | `EXECUTION_SCHEMA_VERSION` 5→6, `DELEGATED_CUTOVER_SQL`, `ensureDelegatedCutoverColumns`. |

## 3. Migration / schema (SPEC §8.1/§8.2/§8.3, one bundled v5→v6 ladder step)

`EXECUTION_SCHEMA_VERSION` 5 → 6. New tables (`CREATE TABLE IF NOT EXISTS`,
idempotent): `delegation_cutover` (§8.1) and `aicontrol_terminal_projection`
(§8.3, inert — no Cutover Core code reads/writes it). Two additive, nullable
`ALTER TABLE` columns (§8.2): `dispatch_process_binding.teardown_reason`,
`dispatch_lifecycle_closure.terminal_status_ref`, applied via a new
`ensureDelegatedCutoverColumns()` guarded by `PRAGMA table_info` column
existence checks (the established `hasColumn` pattern, matching
`orchestration/db/schema/migrate-v37.ts`'s own precedent) — safe to call on
every `migrateExecutionStore()` invocation, including a fresh v6 install and
a repeated call on an already-v6 store.

**Version derived, not guessed:** confirmed `EXECUTION_SCHEMA_VERSION` was 5
before this change (`execution-schema.ts` read in full this session);
SPEC.md §8.2 itself states "`EXECUTION_SCHEMA_VERSION` 5→6's ladder step is
'ensure these two tables + these two columns exist'" — the exact version
number and bundling are the frozen architecture's own, not invented here.

Scope note: Cutover Core writes/reads only `delegation_cutover`. The two
nullable columns and `aicontrol_terminal_projection` ship as inert additive
schema (SPEC's own bundled version bump) — no production code in this
session consumes them; terminal projection/lifecycle remain explicitly out
of scope (mission §48).

## 4. Fence port — no real network adapter (mission §7)

`AiControlFenceClientPort` is a structural type only. The coordinator's
default (`createFailClosedAiControlFenceClientPort()`) unconditionally
returns `ACQUISITION_DISABLED` — the same safe-default disposition the real
`isOrcaFenceAcquisitionEnabled()` gate uses aiControl-side. No file in this
session opens a network connection, calls `fetch`/`http`, or touches
`data/app.db`. Confirmed via `git status` against the `aiControlCenter`
checkout (§14 below): zero writes.

Tests inject `FakeAiControlFenceClient` (committed in RED,
`cutover-core-test-harness.ts`, unchanged this session) via the coordinator's
documented test seam, `getDelegatedCutoverCoordinatorDeps` — an overridable
public field defaulting to `() => ({})` (fail-closed fence, default
slice_ref). Production composition never reassigns it.

## 5. RED test-integrity audit (mission §2)

Read every committed RED assertion against the frozen contract before
implementing. The identity-boundary test
(`delegated-cutover-identity-boundary-positive-control.test.ts`) was, by its
own RED-time header comment, an explicit pre-GREEN snapshot ("must keep
passing unmodified except for the first assertion's expected value") — not
a claim that `RuntimeCreateAgentSessionRequest` must remain permanently free
of `delegatedCutover`. No committed assertion contradicted the frozen
boundary (`RuntimeCreateAgentSessionRequest` MAY carry `delegatedCutover`;
`PtySpawnOptions`/provider contracts MUST NOT). No
`CUTOVER_CORE_RED_TEST_CONTRADICTS_FROZEN_ARCHITECTURE` condition found.

**Test-authoring corrections made (mission §3 — documented, not hidden production defects):**

1. `delegated-cutover-identity-boundary-positive-control.test.ts`: kept the
   "omitted-field" assertion (still true — the field is optional) and added
   a second assertion proving the type now genuinely accepts the field for a
   delegated request.
2. `delegated-cutover-coordinator-callback-and-identity.test.ts` and
   `delegated-cutover-recovery.test.ts`: the RED version seeded a
   reservation into the **separate** in-memory `exec` store
   (`cutover-core-test-harness.ts`'s `openExecStores`) while the coordinator
   under test owns its **own** lazily-opened Execution SQLite connection
   (SPEC §4.8.1, mirroring `getOrchestrationDb()`) — genuinely two different
   databases. First GREEN attempt surfaced this immediately as a real
   `FOREIGN KEY constraint failed` (the coordinator's real DB enforces the
   FK the disposable-store harness disables) — the correct, honest failure,
   not a production defect. Fix: seed the reservation through the
   coordinator's own `establishReservation` (S2 step), injected with a fake,
   always-eligible fence via `getDelegatedCutoverCoordinatorDeps`, so both
   steps operate against the one real database the architecture requires.
   Also fixed: an unscoped `COUNT(*)` query in the "absent process identity"
   test summed rows across the whole file-shared database instead of the
   one correlation_id under test (all tests in a vitest file share one
   `userData` temp dir per the repo's own `vitest-host-ports-setup.ts`) —
   scoped it with `WHERE correlation_id = ?`, matching the pattern the
   file's own third test already used correctly.
3. Added `afterEach` cleanup (`close()` on the coordinator's real SQLite
   handle) in both files — Windows held the file open, so the shared
   `vitest-host-ports-setup.ts` teardown's `rmSync` failed with `EPERM`
   until every test-opened handle was closed. Test-hygiene fix, no
   assertion changed.
4. Two `@ts-expect-error` comments in `delegated-cutover-authority-and-ordering.test.ts`
   were reported "unused" by `tsc` because the deliberately-invalid
   `processIdentity.pid: null` object is constructed on one line but the
   type error only surfaces where the object is later passed as an
   argument (a separately-typed `const`, not directly annotated) — moved
   each comment to the line that actually errors. No assertion changed.

No RED test's load-bearing behavioral assertion was weakened, skipped, or
had its expected value altered to hide a production gap.

## 6. Coordinator implementation (SPEC §4.8.1, mission §4)

`OrcaRuntimeWithDelegatedCutoverCoordinator` extends
`OrcaRuntimeWithDeliverPendingMessages` (unchanged) and is now the class
`OrcaRuntimeWithResolveWaiter` extends (one-line change in
`orca-runtime-resolve-waiter.ts`) — joining `OrcaRuntimeService`'s existing
single linear mixin chain, confirmed this session by re-walking the same
134-class `extends` graph the prior focused-rereview session walked
programmatically: the new class sits directly beneath the chain's current
top, `OrcaRuntimeWithFenceAutomationOwner`/`OrcaRuntimeWithCreateAgentSession`
remain reachable exactly as before. No file under `src/main/providers/` or
`src/main/ipc/pty/` was touched — confirmed via `git status` (this section's
file list, §2, contains none).

## 7. Store lifetime (SPEC §4.8.1, mission §5)

`getDelegatedCutoverCoordinator()` mirrors
`OrcaRuntimeWithFenceAutomationOwner.getOrchestrationDb()` exactly: lazy,
memoized on `this._delegatedCutoverCoordinator`, one persistent
`SyncDatabase` connection opened at
`join(getAppEnvironment().getPath('userData'), 'execution.db')` on first
use, `migrateExecutionStore(db)` run once at open. The same connection backs
every store the coordinator constructs (`SqliteExecutionStore`,
`SqliteReservationStore`, `SqliteDispatchWorktreeStore`,
`SqliteDispatchProcessBindingStore`, `SqliteDelegationCutoverStore`) — one
correctness store, not two. No provider/PTY file opens an independent
Execution DB (confirmed §6 above).

## 8. Delegated request-context implementation (mission §10)

`RuntimeCreateAgentSessionRequest.delegatedCutover?: { aicontrolRunId: string; fenceToken: string }`
— additive, optional, exact frozen shape (SPEC §4.8.3). Confirmed this
session via `git diff` that no other field on the type changed and no
existing call site was touched.

## 9. Provider-boundary proof (mission §8/§17)

`delegated-cutover-identity-boundary-positive-control.test.ts` (unchanged
production-code assertions, only the first test's framing updated per §5
above) drives the REAL `buildRuntimePtySpawnOptions` and inspects its REAL
output object's keys — confirmed empty of any aiControl/fence-shaped key
after this session's changes, exactly as before. `supportsDelegatedCutoverHold`
(gate 52) was not modified.

## 10. `run_reservation` / reservation-step implementation (mission §11/§12)

`establishDelegatedCutoverReservation`: checks provider eligibility first
(zero fence calls if ineligible); calls the injected fence port; only on an
eligible outcome (`ACQUIRED`/`ALREADY_FENCED_SAME_TOKEN`) does it read/write
`run_reservation`, via the real, unmodified `SqliteReservationStore.reserve()`.
A pre-existing reservation for the same `correlationId` is read back
(`reservations.get`), never re-inserted — real SQLite `PRIMARY KEY
(correlation_id)` would reject a duplicate insert regardless, this is
defense-in-depth at the application layer too. `authority: 'AICONTROL_NATIVE'`
is returned alongside every successful reservation — never elevated to
`ORCA_DELEGATED`.

**Idempotency proof:** `delegated-cutover-fence-and-reservation.test.ts`,
9/9 passing — same-token retry (twice and three times), response-loss
retry, and crash-boundary resumption (fence-durable/reservation-absent,
reservation-durable/prepare-absent) all converge to exactly one
`run_reservation` row.

## 11. Atomic commit implementation (SPEC §5.4, mission §17/§18)

`commitDelegatedCutover`: pre-cutover cancellation check → process-identity
presence check → idempotency check (existing `delegation_cutover` row,
same-identity short-circuit, conflicting-identity reject) → one
`ExecutionTransactionRunner.withImmediateTransaction` call (the real,
unmodified primitive `worktree-provenance-bind-step.ts` already uses)
inserting `run_binding` + `dispatch_worktree` + `dispatch_process_binding` +
`delegation_cutover`. `run_reservation` is never inserted by this step — it
must already exist (real `REFERENCES run_reservation(correlation_id)` FK,
enforced by the coordinator's real, non-disabled-FK database — confirmed by
the FOREIGN KEY failure this session hit and fixed, §5 above).

**Rollback proof:** `delegated-cutover-transaction-and-schema.test.ts`'s
rollback test forces a real SQLite `NOT NULL` violation
(`dispatch_process_binding.pid`) mid-transaction; `runWithImmediateTransaction`'s
real `catch`/`ROLLBACK` (unmodified) leaves all four tables at zero rows for
that correlation_id — passing.

**Idempotency/conflict proof:** same tuple repeated →
`ALREADY_COMMITTED_SAME_IDENTITY`, one row; different `fenceToken` for the
same `correlation_id` → rejected, original row unchanged (write-once, `PRIMARY
KEY correlation_id` + `UNIQUE aicontrol_run_id`, both real schema
constraints) — `delegated-cutover-authority-and-ordering.test.ts` §26/§28,
`delegated-cutover-transaction-and-schema.test.ts` §36, all passing.

## 12. Authority-transfer / ordering proof (mission §19/§20/§21/§22/§25)

Authority is a durable-fact read (`delegation_cutover` row existence), never
a function's own in-memory claim. `commitDelegatedCutover` only ever returns
`{outcome: 'COMMITTED', ...}` after `withImmediateTransaction` returns
(synchronous body — no path returns COMMITTED before the real `COMMIT`
executes); a forced mid-transaction failure never yields a COMMITTED
outcome (`delegated-cutover-authority-and-ordering.test.ts` §20, passing).
Process identity captured at prepare-time is byte-identical to what lands in
`dispatch_process_binding` — same test file §22, passing (no transformation
between input and persisted row).

## 13. Fence matching / cancellation / ack (mission §26/§27/§28)

Cutover requires the pre-existing durable `run_reservation` (itself only
reachable via a successful fence CAS, never a local boolean, per §10).
Pre-commit cancellation (`cancellation.isCancelled`, an optional dep) rejects
before any transaction opens (`delegated-cutover-cancellation-ack-fallback.test.ts`
§29, passing); a post-commit cancellation observation never reverts the
durable fact (§30, passing). aiControl acknowledgement is confirmed NOT the
authority-transfer decision — the real `FakeAiControlFenceClient`'s
`acknowledgeOrcaCutover` is never called by `commitDelegatedCutover` itself
(§31, passing); classified `LATER_SLICE_B` per §14 below, consistent with
mission §28's own instruction.

## 14. No-fallback proof (mission §29)

`delegated-cutover-cancellation-ack-fallback.test.ts`'s no-fallback test:
after a committed cutover, a simulated release/process failure calls
`safeReleaseOrcaFence` with `positiveNoCutoverEvidence: false` (no genuine
evidence exists) → `REJECTED_NO_EVIDENCE`, fence state stays `'fenced'`,
never cleared for native reclaim — passing. No code path in this session
calls anything resembling native resumption, fence clearing, or a second
process/M5 invocation — confirmed by `git status` (§2's file list is
exhaustive; no M5/native-execution file was touched).

## 15. Recovery durable-source behavior (mission §30/§31/§33)

`recoverPendingDelegatedCutovers()` reads only `delegation_cutover` rows
(the durable authority-transfer fact) and classifies each `ORCA_DELEGATED`
— no JS Promise/in-memory state consulted. No sweep scheduler is
implemented (mission §30: "not required by frozen core tests"). Real pane
reconciliation (`adoptStablePane`/`reconcileRemoteTerminalCreate`) is
explicitly NOT wired here — this Cutover Core slice returns only the
per-run classification; driving actual pane recovery from that
classification is documented as the next lifecycle sub-slice's
responsibility (SPEC §11 names the primitives; wiring them requires a live
runtime/pane context this coordinator-level test does not exercise and no
committed RED test requires).

**Proof:** `delegated-cutover-recovery.test.ts` — a second, independent
coordinator instance (no shared in-memory state) recovers `ORCA_DELEGATED`
for a run committed by a first instance, purely from the shared real
`userData/execution.db` file — passing.

## 16. Async-late residual proof (mission §32)

`delegated-cutover-async-residual-positive-control.test.ts` — unchanged
except a type annotation fix (§5 above) — still passing: a coordinator-
shaped caller of the real, unmodified `createAsyncSpawnCommitReporter` never
captures or re-enters its own reporter; fire-once identity (`first === second`)
holds. `ASYNC_LATE_SELF_DEPENDENCY` remains
`UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL` — no
code in this session gives the coordinator's callback a path back into its
own reporter.

## 17. Concurrency result (mission §33 mission-numbering / RED §28)

`delegated-cutover-authority-and-ordering.test.ts`'s two concurrency tests
pass deterministically — no sleep. `Promise.all`/`Promise.allSettled` over
two `commitDelegatedCutover` calls resolve through real, synchronous
`node:sqlite` execution (no interleaving is possible mid-transaction); same
identity converges to one commit + one idempotent no-op, conflicting
identity yields exactly one COMMITTED and one rejection, one row survives
either way.

## 18. 9 Cutover Core test files — final result

```
pnpm test \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-fence-and-reservation.test.ts \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-transaction-and-schema.test.ts \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-authority-and-ordering.test.ts \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-coordinator-callback-and-identity.test.ts \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-identity-boundary-positive-control.test.ts \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-cancellation-ack-fallback.test.ts \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-recovery.test.ts \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-async-residual-positive-control.test.ts \
  src/main/execution/slices/orca-delegated-cutover/delegated-cutover-fence-port-contract.test.ts
```

**Result: 9 test files, 42 tests, all passed.** Zero `Cannot find module`
collection failures remain — the six RED-baseline collection failures are
gone, replaced by genuine loaded-and-passing behavioral assertions (mission
§35: "module exists but behavioral assertions fail" is explicitly not
accepted as success — none of the 42 tests fails).

## 19. PRE_IMPLEMENTATION regression

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

**7 files, 38 tests, all passed** — identical to the RED baseline and to
this GREEN session's own re-run before implementation. No regression in
native no-callback timing, fire-once, sync reentry, gate 60, provider
capability, or deferred argv delivery.

## 20. Execution-suite result

`pnpm test src/main/execution` — **81 test files, 506 tests, all passed.**
(RED baseline was 81 files / 75 passed + 6 collection-failed / 474 tests;
GREEN is 81 files / 81 passed / 506 tests — the +32 tests are this session's
9 files' 42 tests minus the RED baseline's 3 already-passing positive-
control files' 10 tests, i.e. the 6 RED files' new 32 real tests, all
passing.)

One pre-existing test file required a documented, minimal update (not a new
regression, a direct and correctly-anticipated consequence of the frozen
SPEC §8.2 schema bump): `delegated-side-effect-boundary.schema.test.ts`
(ORCA-S4's own schema snapshot test) hard-coded `EXECUTION_SCHEMA_VERSION`
as exactly `5` and the exact pre-v6 column sets for
`dispatch_process_binding`/`dispatch_lifecycle_closure`. Updated to
`toBeGreaterThanOrEqual(5)` / `EXECUTION_SCHEMA_VERSION` (not a new literal)
and added the two SPEC §8.2 columns to the expected sets — the columns
SPEC's own text already named as part of the single v5→v6 ladder step.

## 21. Runtime/provider/PTY regression

```
pnpm test src/main/runtime src/main/providers src/main/ipc/pty
```

**15 failed / 864 passed / 5 skipped files (884); 30 failed / 8826 passed /
67 skipped tests (8929).** Independently re-derived this session (not
assumed from the mission's own historical citation) — the counts are
byte-identical to the mission's own cited historical baseline. Every visible
failure inspected is a pre-existing Windows path-separator family issue
(`structured-worker-child-identity-env.test.ts`'s `;`-vs-`:` `PATH` joining,
`ai-vault.test.ts`'s `\`-vs-`/` path assertions) — none references
`delegated-cutover`, `execution`, or any file this session touched. **Zero
new failure attributable to this GREEN.**

## 22. S1–S4 result

Covered by §20 (the full `src/main/execution` scoped run includes every
S1–S4 slice test: `durable-worktree-provenance`, `durable-settlement-observation`,
`delegated-side-effect-boundary`, `shadow-identity-observation`, and every
`infrastructure`/`application` unit test) — 506/506 passing, zero
regressions beyond the one documented, expected schema-snapshot update
(§20).

## 23. DB / migration tests

`delegated-cutover-transaction-and-schema.test.ts` (part of §18's 42)
directly proves: schema upgrade path (disposable `:memory:` DB via
`migrateExecutionStore`, real), fresh-schema shape, the `run_reservation`
prerequisite (pre-seeded via the reservation-step fixture, real FK target),
atomic rollback (real constraint violation, real `ROLLBACK`), exact
idempotency (`ALREADY_COMMITTED_SAME_IDENTITY`), conflict rejection
(different token, same correlation_id), uniqueness/cardinality
(`PRIMARY KEY correlation_id`, `UNIQUE aicontrol_run_id`, both real schema),
and restart readback (`delegated-cutover-recovery.test.ts`, a second
independent connection to the same real file). No operational DB touched
(`userData` is always a per-test-file `mkdtempSync` temp directory, per the
repo's own `vitest-host-ports-setup.ts`, never a real user profile path).

## 24. Typecheck / lint

`pnpm tc:node` (`tsc --noEmit -p config/tsconfig.node.json`): **clean, zero
errors**, after fixing (§5 above) one `Promise<DelegationCutoverCommitResult>`
type-widening issue and two misplaced `@ts-expect-error` directives — no
`any` escape, no `ts-ignore`, no floating Promise, no ignored rejection
introduced.

`npx oxlint` over every changed/new file (§2's list plus the 9 test files
and the one updated ORCA-S4 schema test): **clean, zero findings**, after
fixing one `curly` violation (a bare single-statement `if` in the new error
class's constructor).

No circular dependency introduced: the new modules form a strict layering
(`domain` ← `infrastructure` ← `application` ← `runtime`), matching every
existing slice's own discipline; `runtime/orca-runtime-delegated-cutover-coordinator.ts`
is the only file that imports across from `execution/*` into `runtime/`,
consistent with the accepted dependency direction (SPEC §4.8.2 — Runtime →
Execution, never the reverse).

## 25. Gate mapping (mission §45)

Only gates this GREEN genuinely exercises with a real, loaded, passing test
move off `CUTOVER_CORE_RED`:

| Gates | New classification | Basis |
| --- | --- | --- |
| 4, 5, 6, 7, 8, 9, 31, 38, 39, 40, 50, 51, 53, 54 | `CUTOVER_CORE_GREEN` | Each now has at least one real, loaded, passing test exercising the composition root/transaction/reservation/recovery surface named in `CUTOVER-CORE-RED-EVIDENCE.md` §10's gate table for that gate |
| 32, 33, 34, 35, 36, 37, 41-49, 52, 55-63 | `ALREADY_GREEN_PREIMPLEMENTATION` (unchanged) | Confirmed unaffected — §19's unmodified 38/38 pass |
| 19, 20, 21, 22, 26 | `PRE_LIVE_ACTIVATION` (unchanged) | Frozen dependency, not touched by this implementation — explicitly NOT marked GREEN merely because adjacent code now exists (mission §45) |
| aiControl ack authorization/UI (SPEC §16 item 2) | `LATER_SLICE_B` (unchanged) | §13/§28's ack tests prove only the already-accepted "ack is not authority transfer" invariant; no real ack route implemented |

No `TECHNICALLY_PROVEN`/repository-wide claim is made — this classification
reflects the scoped runs in §18-§23 only.

## 26. Frozen-artifact proof

```
git diff --stat -- SPEC.md SPEC-STATUS-RATIFICATION-001.md \
  ARCHITECTURE-INDEPENDENT-REVIEW-001.md \
  CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md \
  ARCHITECTURE-FOCUSED-REREVIEW-002.md \
  ARCHITECTURE-FREEZE-RATIFICATION-REVIEW-001.md \
  CUTOVER-CORE-RED-EVIDENCE.md
```

**Empty** — confirmed this session, immediately before writing this file.
No `FROZEN_ARCHITECTURE_CONTRADICTION` was encountered; every gap RED
exposed (missing coordinator, missing schema, missing application steps)
was implementable exactly as the frozen correction (SPEC §4.8, discovery
§15) already named it.

## 27. Scope exclusions (mission §48, explicit)

Not implemented, not touched, by design:

- Real Maestro→aiControl HTTP adapter (§4/§7) — the port is fail-closed by
  default; no transport code exists.
- Real fence acquisition against operational aiControl — `data/app.db`
  never opened, never written (confirmed §14 aiControl guard below).
- Terminal lifecycle completion, terminal projection
  (`aicontrol_terminal_projection` ships as inert schema only).
- aiControl projector `DIVERGENCE` fix.
- Real site #5 production closure rewiring
  (`orca-runtime-create-agent-session.ts:225-227`'s actual
  `onPtySpawnCommitted` body is unchanged — still
  `() => { retainReplayFence = true }` for every request). This is a
  **deliberate, documented scope boundary, not an oversight**: SPEC §4.8.4's
  five-field `commitDelegatedCutover` call requires the exact prepared
  process identity at the moment the closure fires, which today can only
  reach the closure through `RealDelegatedProcessPort` (SPEC §7.1) —
  confirmed this session still not implemented (no file exists at any
  plausible path, no RED test in this baseline imports one). Threading real
  process identity from `providers/local-pty-spawn.ts`'s post-spawn `pid`
  back to the closure without that port would mean inventing an ad-hoc
  side-channel not named anywhere in the frozen architecture — exactly the
  class of new semantic mission §36/§48 forbid introducing to make a test
  (there is none requiring it) pass. No committed RED test exercises this
  wiring; all 9 files call the coordinator's `commitDelegatedCutover`
  directly with an explicit `processIdentity`. The coordinator's own
  `commitDelegatedCutover`/`establishReservation` methods are real,
  callable, and fully tested — only the real production caller at site #5
  is deferred, and is recorded here as the next implementation session's
  first task.
- R3, M5 — untouched; no file under either concept was created or modified.
- No sweep scheduler/cadence (§30 above).

## 28. aiControl guard

- Before this session: `origin/master` = `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`,
  `data/app.db` SHA-256 = `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`.
- After (re-verified immediately before writing this evidence file, fresh
  `git fetch` + `sha256sum`): identical. No `-wal`/`-shm`/journal file
  present either time. Zero writes to `aiControlCenter` at any point —
  every touch this session was against the `mw-orca-s5-cutover-core-red`
  Maestro worktree only.

## 29. Authority / operational state

Before/after this GREEN session: `AICONTROL_NATIVE`. `ORCA_DELEGATED`: NOT
STARTED (operationally — disposable tests prove only a per-run durable
`ORCA_DELEGATED` *classification* inside a temp SQLite file, never a live
authority switch). Fence acquisition: DISABLED. R3: NOT STARTED. M5: NOT
STARTED. No runtime, database, or configuration change outside disposable
test fixtures and the new/changed source files listed in §2.
