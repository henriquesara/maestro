# ORCA-S1 — RED evidence 002 (focused-fix of reviewer blockers)

Captured `2026-09-08` on branch `orca-s1-shadow-identity-observation`
(Orca base `bf4e2705`, reviewed HEAD `6592731`). This is the RED record for the
**focused correction of the 10 reviewer blockers** — not a re-run of the ORCA-S1
slice RED (that is [`RED-EVIDENCE.md`](./RED-EVIDENCE.md)).

## Method — two RED sources, both honest

The focused fix replaced the Execution bounded-context API surface (durable
`run_reservation` lifecycle, `WorkloadSpec` same-workload parity, structured
adjudication, path confinement). The new regression tests cannot be _run_
against `6592731` — they would fail at module resolution, which is not
behavioural RED. So each blocker's RED is one of:

1. **MECHANICAL** — the fix is a self-contained guard. It was reverted on the
   _current_ tree (`RED-PROBE` marker), the targeted test(s) were run and
   observed to fail, then the guard was restored. These are real failing runs
   reproduced below.
2. **INSPECTION** — the fix is the _presence_ of durable state or a whole module
   that did not exist at `6592731`. RED is the reviewer's defect proof plus the
   exact reviewed-HEAD code (`git show 6592731:<file>`). A one-line revert cannot
   reproduce "there was no durability".

No RED run below was fabricated after the fact: the MECHANICAL captures are from
the working tree with the fix removed; the INSPECTION cites are `git show` of the
frozen reviewed commit.

---

## B1 / B2 — durable identity + idempotent reconciliation — INSPECTION

`git show 6592731:src/main/execution/infrastructure/orca-execution-plane.ts`:

```ts
export class OrcaExecutionPlane implements ExecutionPlane {
  private readonly runs = new Map<string, ShadowRunState>()   // sole dispatch↔state link
```

`git show 6592731:src/main/execution/domain/execution-identity.ts` — `RunBinding`
has **no `correlationId`**. `git show 6592731:src/main/execution/infrastructure/execution-schema.ts`
— **no `run_reservation` table**. `reconcile-incomplete-reservations.ts` **does
not exist** at `6592731`. A durable Orca Dispatch created in `openShadowRun`
followed by a crash before `store.recordBinding` leaves an orphan Dispatch with
nothing durable pointing at it — exactly the reviewer finding.

**GREEN lock:**

- `application/reconcile-incomplete-reservations.test.ts` — crash windows
  A/B/C/D/F via `driveTo(state)` + window E via a fresh adapter; each asserts the
  incomplete reservation is abandoned, reconcile is idempotent (`scanned === 0`
  on the 2nd pass), and a re-run creates exactly one fresh reservation, never a
  2nd orphan Dispatch.
- `infrastructure/orca-execution-plane.test.ts` → "B2: the correlation id is
  durable on the Orca side — findShadowRunByCorrelation resolves it".
- `slices/…/shadow-identity-observation.acceptance.test.ts` → "B2 — reconcile ran
  first and found nothing to recover on a clean pass".

---

## B3 — settleShadow must reject a valid Dispatch from another run — MECHANICAL

`git show 6592731:…/orca-execution-plane.ts` — `settleShadow` calls
`requireRun(input.orcaDispatchRef)` and checks `dispatchRow.task_id !== state.taskId`,
where `state` is itself looked up by `orcaDispatchRef`. `input.orcaRunRef` is
**never compared** to the Dispatch's `run_id`.

RED (guard reverted on the current tree — `requirePair` pair check removed):

```
corepack pnpm exec vitest run …/orca-execution-plane.test.ts -t "B3"

 FAIL  > B3: settling run A with a VALID Dispatch that belongs to run B is
         rejected on the production path
 AssertionError: expected undefined to be an instance of ExecutionPlaneError
   expect(thrown).toBeInstanceOf(ExecutionPlaneError)
 Tests  1 failed
```

**GREEN lock:** `requirePair(runRef, dispatchRef)` throws
`ExecutionPlaneError('run_dispatch_pair_mismatch')` when
`dispatchRow.run_id !== String(runRef)`, called on both `runShadowWorkload` and
`settleShadow` (the production path). Test passes with the guard restored.

---

## B4 — prevent authoritative-DB alias writes — MECHANICAL

`git show 6592731:…/slices/shadow-identity-observation/shadow-identity-observation.ts`
— `new SqliteExecutionStore(input.executionStorePath)` opens the writable store
with **no** pre-open check; only a post-run `sha256File` compare (detection).

RED (guard reverted — `assertExecutionStorePathNotAlias` early-returns):

```
corepack pnpm exec vitest run …/execution-store-path-guard.test.ts

 FAIL  > rejects the identical path
 FAIL  > rejects a relative alias of the same path
 FAIL  > rejects a hard link to data/app.db (shared filesystem identity)
 FAIL  > END-TO-END: an aliased executionStorePath is rejected before any
         writable open — hash unchanged, zero Execution tables, no WAL/SHM
 Tests  4 failed | 2 passed
```

**GREEN lock:** `assertExecutionStorePathNotAlias` rejects on `resolve()`
equality, `realpath` canonical equality, and `dev:ino` filesystem identity
(hard link) — codes `identical_path | canonical_path | filesystem_identity` —
and the composition root calls it **before** the first writable `SyncDatabase`.
The END-TO-END test proves: alias → thrown before open → `app.db` hash unchanged
→ zero Execution tables created → no `-wal`/`-shm`. Uses a disposable copy;
the real `data/app.db` is never the alias target.

---

## B5 — shadow safety: `acceptedBy:"self"` is not acceptance; filesystem confinement — MECHANICAL

`git show 6592731:src/main/execution/domain/shadow-safety-policy.ts` — an
`external_effect` workload is admitted whenever `isolationDecision.accepted` is
truthy; `"self"` passes. No path validation exists anywhere in the reviewed slice.

RED — actor separation (guard reverted — `isActorSeparated` returns `true`):

```
corepack pnpm exec vitest run …/shadow-safety-policy.test.ts

 FAIL  > rejects acceptedBy "self" — not independent acceptance
 FAIL  > rejects when authoredBy === acceptedBy (no actor separation)
 Tests  2 failed | 6 passed
```

**GREEN lock:**

- `shadow-safety-policy.ts` — `PLACEHOLDER_ACTORS = {self, me, implementer,
caller, ""}`; `isActorSeparated` requires a non-empty `decisionRef`, neither
  actor a placeholder, and `authoredBy !== acceptedBy`. `classifyShadowWorkload`
  auto-admits **only** `synthetic | sandboxed | repo_local_code_only` with zero
  declared capabilities.
- `domain/path-confinement.ts` (new) + `domain/path-confinement.test.ts` (new) —
  rejects absolute paths, `..` traversal, empty paths, and any target whose
  `realpath` escapes the disposable shadow root, including a symlink escape where
  the platform supports symlinks. `assertWorkloadConfined` runs over the worktree
  dir + every write/delete step before any execution.

---

## B6 — dedicated shadow Orca state — INSPECTION

`git show 6592731:…/shadow-identity-observation.ts` — the composition root input
is `orchestration: OrchestrationDb` (an arbitrary live handle) and
`makeWorktreeDir: (runId) => string` (an arbitrary factory). Opening a shadow run
on a caller's live `OrchestrationDb` runs `createRun → unbindOtherRunsForPane`,
mutating pre-existing lifecycle state.

**GREEN lock:** the composition root takes **no** `orchestration` — it constructs
its own `new OrchestrationDb(shadowOrchestrationPath)` inside a
`DisposableShadowRoot`, with a dedicated `SHADOW_COORD_PANE_KEY`. All worktrees
come from `DisposableShadowRoot.worktreeDir(name)`. `reconcile-incomplete-reservations.test.ts`
seeds a _separate_ real orchestration DB with an unrelated bound run and asserts
it is row-identical after ORCA-S1 runs.

---

## B7 — same-workload parity, not status→static-script — INSPECTION

`git show 6592731:src/main/execution/infrastructure/aicontrol-db-reader.ts` —
`recordedOutcome(status, files_changed)` turns a historical `agent_runs.status`
into a synthetic `ExecutionOutcome`. `git show 6592731:…/shadow-observation-service.ts`
— `compareOutcomes(record.recordedOutcome, settled.outcome)` compares that
against an _arbitrary_ synthetic script's outcome and calls a `completed` row
"equivalent" to any exit-0 script. Fabricated equivalence.

**GREEN lock:** `frozen-sample.ts` defines 6 `WorkloadSpec`s (steps:
write/delete/exit/cancel). Each is executed **twice** on the same spec — by
`AuthoritativeReferenceExecutor` (aiControl-native terminal semantics, real
`git diff --name-only base..HEAD`; documented bounded stand-in, residual R1) and
by `OrcaExecutionPlane` — and compared on 4 dimensions. `aicontrol-db-reader.ts`
is reduced to `listProfiles()` (read-only identity only; `data/app.db` is never
a workload source). Locked by `shadow-observation-service.test.ts` →
"records a full binding + observation for a clean same-workload run" and the
acceptance gate-8 tests.

See [`SPEC-AMENDMENT-001.md`](./SPEC-AMENDMENT-001.md) §3 for why the reviewed
sample was unsatisfiable and why status-only rows are not a workload.

---

## B8 — files_changed from a real effect, not an attempted no-op delete — INSPECTION

`git show 6592731:…/orca-execution-plane.ts`, `runShadowWorkload`:

```ts
} else if (step.op === 'delete') {
  rmSync(join(state.worktreeDir, step.path), { force: true })
  touched.push(step.path)                       // pushed unconditionally
}
…
filesChanged: filesChangedSet([...touched, ...filesChanged])   // synthetic union
```

An attempted delete of a path that never existed is added to `touched` and
unioned into `filesChanged`. INSPECTION rather than MECHANICAL because the fix
was to delete the whole `touched` synthetic union (part of the
`workload-git-runtime.ts` rewrite), not a revertible one-liner.

**GREEN lock:** `workload-git-runtime.ts` — `delete` runs `rmSync` only
`if (existsSync(...))`; `filesChanged` is **purely** `git diff --name-only
base..HEAD`. Locked by `orca-execution-plane.test.ts` → "B8: an attempted delete
of a nonexistent path is NOT counted as a changed file" and acceptance gate-8 →
"files_changed comes from a real diff: s4 records the real deletion".

---

## B9 — structured root-cause evidence, unresolved fails the gate — MECHANICAL

`git show 6592731:…/shadow-observation-service.ts` — `rootCauseFor` always
returns a non-empty string (the `unexpected_divergence:` fallback), and the old
`assertObservationComplete` only checked `rootCause` was non-null. Mismatch →
canned label → accepted.

RED (`assertObservationComplete` reduced to "any one adjudication is enough"):

```
corepack pnpm exec vitest run …/parity.test.ts …/shadow-observation-service.test.ts

 FAIL  > assertObservationComplete (blocker B9) > throws when a divergence has
         an unresolved adjudication
 FAIL  > assertObservationComplete (blocker B9) > throws when a divergence has
         an explained adjudication but no evidence
 FAIL  > runShadowObservation … > B9 — an unexplained mismatch throws inside the
         run and is contained as abandoned (never accepted)
 Tests  6 failed | 8 passed
```

**GREEN lock:** `parity.ts` — `RootCauseAdjudication = { status: 'explained' |
'unresolved', dimension, observedMismatch, classifiedCause: string | null,
evidence: string[] }`. `assertObservationComplete` throws `ParityObservationError`
if any adjudication is `unresolved`, or a divergence has no matching `explained`
adjudication with non-empty evidence. `adjudicate()` explains only the two frozen
divergences (`s2` files_changed via `shadowInputExtras`; `s6` cancellation via
reference-executor coarsening); anything else stays `unresolved` and the run is
contained as `abandoned`, never recorded.

---

## B10 — hard-crash isolation with a separately killable process — INSPECTION + executable proof

No separate process existed anywhere in the reviewed slice; the reviewer's own
finding is the RED ("a caught Promise rejection is not the required proof").

**GREEN lock:** `slices/…/shadow-crash-isolation.test.ts` — spawns
`shadow-run-child.mjs` (raw `node:sqlite`, no TS imports) which writes a durable
`run_reservation` row (`reserved`) + a READY marker and then hangs; the parent
`SIGKILL`s it; the authoritative `AuthoritativeReferenceExecutor` run is shown to
complete independently; a restart runs `reconcileIncompleteReservations` and the
reservation is recovered as `abandoned` with no wrong settlement and no authority
transition. `data/app.db` is never in scope for this test. Crash windows B–F are
additionally covered in-process by `reconcile-incomplete-reservations.test.ts`.

---

## Spec-integrity gate (task §1)

`SPEC-AMENDMENT-001.md` was committed (`98c6015`) **before** any product-code
change in this focused fix. It records: no `CONTRACT_CONFLICT` (published §S
delegates the parity strategy and N/M to the slice spec); why the reviewed
sample was unsatisfiable; why historical status-only rows are not a workload;
the corrected durable-binding lifecycle, safety/confinement, same-workload
strategy, structured root-cause, and hard-crash proof; N = 6 / M = 3 retained
with executable same-workload evidence.

## GREEN summary

```
corepack pnpm exec vitest run src/main/execution/
 Test Files  12 passed (12)
      Tests  63 passed (63)          # default 5s timeout, no per-test override
```
