# ORCA-S3 — Durable Worktree Provenance & Convergence — RED EVIDENCE

TDD RED log for the implementation candidate, re-derived from the cumulative
frozen contract (`SPEC.md` + `SPEC-AMENDMENT-001.md`) on a **fresh** branch
from **`origin/main` @ `d588290809652e16b2be3420eba70b20cbc3e77a`** — never
branched from, merged with, or copied out of the rejected candidate
`cc0d3db6aea125a8d7640e28d7adc7039f704858`.

**This is a RED-only session.** No S3 production code exists. Every test below
was written against, and fails against, the real `origin/main` state of the
repository (real `execution-schema.ts` at `EXECUTION_SCHEMA_VERSION = 3`; no
`converge-worktree-provenance.ts`, no `read-only-worktree-provenance-source.ts`,
no S3 domain/store modules). Command used throughout:
`./node_modules/.bin/vitest run <file>` (the local binary, bypassing `npx`
to avoid an unrelated `pnpm install` / native-module-rebuild side effect in
this environment — see the session report).

## Prerequisite fix (separate commit, before RED)

`first-work-branch-rename.test.ts` had two object literals each declaring
`lastActivityAt` twice (TS1117 — a hard `tsc` error, unrelated to S3, still
present on a fresh `origin/main` checkout). Fixed in its own commit
(`bffa1f5345eebe1c36a26bf81b90a78237896113`) before any RED test was written;
`pnpm run typecheck:node`-equivalent (`tsc --noEmit -p config/tsconfig.node.json`)
went from 2 errors to 0, and the file's 39 tests still pass.

## Domain (pure)

| Test file | RED signature | GREEN (target) |
| --- | --- | --- |
| `domain/worktree-provenance.test.ts` | `Error: Cannot find module './worktree-provenance'` (0 tests collected) | 18/18 |

## Schema v3 → v4 (§7, PROV-11, gate 16)

| Test file | RED signature | GREEN (target) |
| --- | --- | --- |
| `infrastructure/execution-schema.v4-migration.test.ts` | Real assertion failures against the EXISTING `execution-schema.ts` (no import error — the module exists, just at v3): `EXECUTION_SCHEMA_VERSION` is `3` not `4`; `dispatch_worktree`/`worktree_provenance`/`worktree_provenance_incident` tables absent (`table_info` returns `[]`); `worktree_provenance` has 0 of the 15 SPEC-AMENDMENT-001 columns; no `dispatch_worktree_by_correlation`-shaped index; no `worktree_provenance_incident` UNIQUE index; `schema_version` stays `'3'` after migrate; a v3-shaped store upgraded via `migrateExecutionStore` gains none of the three S3 tables. 7 of 8 cases fail; 1 passes now and must keep passing (the "adds ZERO columns to S1/S2 tables" guard, since S1/S2 tables are untouched by construction both before and after S3) | 8/8 |

## Infrastructure

| Test file | RED signature | GREEN (target) |
| --- | --- | --- |
| `infrastructure/sqlite-dispatch-worktree-store.test.ts` | `Cannot find module './sqlite-dispatch-worktree-store'` | 5/5 |
| `infrastructure/sqlite-worktree-provenance-store.test.ts` | `Cannot find module './sqlite-worktree-provenance-store'` | 6/6 |
| `infrastructure/sqlite-worktree-provenance-incident-store.test.ts` | `Cannot find module './sqlite-worktree-provenance-incident-store'` | 8/8 |
| `infrastructure/sqlite-run-binding-candidate-head-store.test.ts` | `Cannot find module './sqlite-run-binding-candidate-head-store'` | 3/3 |
| `infrastructure/durable-shadow-worktree-root.test.ts` | `Cannot find module './durable-shadow-worktree-root'` | 6/6 |
| `infrastructure/identity-sidecar-store.test.ts` | `Cannot find module './identity-sidecar-store'` | 8/8 |
| `infrastructure/read-only-worktree-provenance-source.test.ts` | `Cannot find module '../domain/worktree-provenance'` (the first unresolved import in the file; `./read-only-worktree-provenance-source` is equally absent) | 10/10 |

## Application

| Test file | RED signature | GREEN (target) |
| --- | --- | --- |
| `application/converge-worktree-provenance.test.ts` | `Cannot find module './converge-worktree-provenance'` (0 tests collected) | 20/20 |

## Slice-level acceptance / adversarial / restart

All six fail identically at import — `Cannot find module '../../application/converge-worktree-provenance'` (and, transitively, `../../infrastructure/read-only-worktree-provenance-source`) — 0 tests collected per file. Each file's `it(...)` blocks are the pinned executable contract for GREEN; the mapping below shows which gate/window each currently-uncollected test will cover once the module resolves.

| Test file | Gate(s) | GREEN (target) |
| --- | --- | --- |
| `durable-worktree-provenance.convergence.test.ts` | gate 7 — durable-state convergence, no hook, no `reconcileShadowExecutionState` call | 1/1 |
| `durable-worktree-provenance.two-phase-idempotency.test.ts` | gates 8, 9, 16 | 3/3 |
| `durable-worktree-provenance.restart.test.ts` + `worktree-provenance-converge-child.mjs` | gate 10 — windows **A–G** | 7/7 |
| `worktree-provenance-incident.adversarial.test.ts` | gates 12, 13 | 6/6 |
| `worktree-source-instability.test.ts` | gate 17 | 3/3 |
| `durable-worktree-provenance.acceptance.test.ts` | gates 1, 2, 4, 5, 6, 11, 14, 15, 18 | 4/4 |

## PROV-1 .. PROV-12 → covering test(s)

| Invariant | Covering test(s) |
| --- | --- |
| **PROV-1** no fabrication | `converge-worktree-provenance.test.ts` "confirmed non-repository"; `worktree-provenance.test.ts` digest exclusion tests; `durable-worktree-provenance.acceptance.test.ts` "gate 11"; `durable-worktree-provenance.restart.test.ts` "E" |
| **PROV-2** convergence-safe idempotency | `converge-worktree-provenance.test.ts` "PROV-2 idempotency"; `durable-worktree-provenance.two-phase-idempotency.test.ts` "sweeping x3", "projection rebuild"; `sqlite-worktree-provenance-store.test.ts` "write-once" |
| **PROV-3** identity binding | `worktree-provenance.test.ts` `identityEquals`/`canonicalizesInsideRoot`; `read-only-worktree-provenance-source.test.ts` identity_absent/identity_mismatch cases; `converge-worktree-provenance.test.ts` identity cases; `worktree-provenance-incident.adversarial.test.ts` (wrong nonce, absent sidecar, path escape) |
| **PROV-4** advisory only / zero authority movement | `durable-worktree-provenance.acceptance.test.ts` gates 4/14 (app.db SHA-256 unchanged) and gates 2/5/15 (static audit); `worktree-provenance-incident.adversarial.test.ts` (settlement_incident/parity_observation stay 0) |
| **PROV-5** read-only w.r.t. Git (exact whitelist) | `read-only-worktree-provenance-source.test.ts` "spawns ONLY the four whitelisted argv forms", "leaves HEAD/.git/index/object-count unchanged" |
| **PROV-6** observation, not ownership; no filesystem removal | `durable-worktree-provenance.restart.test.ts` "A", "B", "C" (orphan state left in place); `durable-worktree-provenance.acceptance.test.ts` static audit (no `rmSync`/`rmdirSync`/`unlinkSync`/`worktree remove`) |
| **PROV-7** no parity responsibility | `worktree-provenance-incident.adversarial.test.ts` "PROV-4 / PROV-7"; static audit (no `parity_observation` reference) |
| **PROV-8** no Orca type leak | `read-only-worktree-provenance-source.test.ts` (port returns a plain `DurableWorktreeRead`, no Orca row type); static audit |
| **PROV-9** no stage advance | `durable-worktree-provenance.acceptance.test.ts` static audit (no `finalizeRunOnce`, no authority-transfer symbol) |
| **PROV-10** incident isolation | `converge-worktree-provenance.test.ts` "a Phase-B-open incident for one binding does not block... a DIFFERENT binding"; `worktree-provenance-incident.adversarial.test.ts` "an open worktree_provenance_incident... is invisible to reconcileIncompleteReservations" |
| **PROV-11** source-state durability + crash consistency | `sqlite-dispatch-worktree-store.test.ts` "preserved by a provenance-projection rebuild"; `identity-sidecar-store.test.ts` atomic-write tests; `durable-worktree-provenance.restart.test.ts` "C" (one transaction), "D", "E"; `execution-schema.v4-migration.test.ts` |
| **PROV-12** prospective eligibility; legacy bindings inert | `converge-worktree-provenance.test.ts` "PROV-12 / §7.6 window F"; `worktree-provenance-incident.adversarial.test.ts` "window F vs window G"; `durable-worktree-provenance.acceptance.test.ts` "gate 18"; `durable-worktree-provenance.restart.test.ts` "F", "G" |

## §7.6 crash window → test mapping (acceptance gate 10)

| Window | Test |
| --- | --- |
| **A** worktree created, killed BEFORE the sidecar | `durable-worktree-provenance.restart.test.ts` "A" |
| **B** killed after the sidecar, BEFORE the DB transaction | `durable-worktree-provenance.restart.test.ts` "B" |
| **C** killed mid-transaction (before COMMIT) — both `run_binding` and `dispatch_worktree` roll back | `durable-worktree-provenance.restart.test.ts` "C" |
| **D** killed after COMMIT — restart-safe normal convergence | `durable-worktree-provenance.restart.test.ts` "D" |
| **E** sidecar later missing/corrupt over a committed `dispatch_worktree` | `durable-worktree-provenance.restart.test.ts` "E" |
| **F** legacy / pre-S3 binding (no `dispatch_worktree`, no prior provenance) | `durable-worktree-provenance.restart.test.ts` "F"; `worktree-provenance-incident.adversarial.test.ts` "window F vs window G"; `durable-worktree-provenance.acceptance.test.ts` "gate 18" |
| **G** post-S3 source loss (`dispatch_worktree` vanishes after provenance was recorded) | `durable-worktree-provenance.restart.test.ts` "G"; `worktree-provenance-incident.adversarial.test.ts` "window F vs window G" |

## Retryable taxonomy → test mapping (acceptance gate 17)

| Reason | Test(s) |
| --- | --- |
| `WORKTREE_SOURCE_OPERATIONAL_RETRYABLE` | `converge-worktree-provenance.test.ts` (Phase A + Phase B); `worktree-source-instability.test.ts` "OPERATIONAL_RETRYABLE" |
| `WORKTREE_SOURCE_UNSTABLE_RETRYABLE` | `converge-worktree-provenance.test.ts` (Phase A + Phase B); `worktree-source-instability.test.ts` "UNSTABLE_RETRYABLE"; `read-only-worktree-provenance-source.test.ts` "classifies unstable" |
| `EXECUTION_STORE_BUSY_RETRYABLE` | `converge-worktree-provenance.test.ts` (Phase A); `worktree-source-instability.test.ts` "BUSY_RETRYABLE" |

## Notes

- No S3 production code exists anywhere in this branch. Every test above fails
  either at module resolution (`Cannot find module`) or, for the schema
  migration test, on a real assertion against the unmodified, existing
  `execution-schema.ts` — never a syntax error, never a deliberately-broken
  assertion, never an unrelated environment failure.
- `worktree-provenance-converge-child.mjs` is a plain ESM + `node:git`/`node:sqlite`
  TEST FIXTURE (mirrors `settlement-converge-child.mjs`, ORCA-S2 gate 10) that
  performs the §7.6-pinned bind ordering so the parent can `SIGKILL` it at each
  window. It implements no S3 production behavior — no convergence, no
  incident logic, no read port — only the raw multi-step write sequence the
  frozen contract already specifies, exactly as ORCA-S2's own child fixture
  raw-inserts `run_reservation`/`run_binding`.
- The restart harness (`durable-worktree-provenance.restart.test.ts`) is
  marker-driven (`READY` file + `SIGKILL`), never timing-driven, and every
  `it(...)` is independently runnable — safe for a later serial/exclusive
  GREEN re-run.
- `sqlite-run-binding-candidate-head-store.ts` is a NEW, narrow S3-owned seam
  onto the already-existing `run_binding.candidate_head` column — added
  because the existing `ExecutionStore.setBindingCandidateHead` (S1) is an
  UNCONDITIONAL `UPDATE` and cannot express R2's `WHERE candidate_head IS NULL`
  compare-and-swap. It does not modify `execution-store.ts` or
  `sqlite-execution-store.ts`.

## GREEN — implementation session (this commit)

Command throughout: `./node_modules/.bin/vitest run <file>` (same local binary
as the RED session). Full command used for the totals below:
`./node_modules/.bin/vitest run src/main/execution/`.

### Mechanical RED-fixture fixes (no assertion weakened, no behavior changed)

Independent-review note: each item below is a plain authoring defect in the
committed RED fixtures — a typo, an inverted pragma, or a non-blocking sleep
where a blocking one was documented — never a change to what any test asserts.
Every fix is verifiable by diff against the RED commit `c384bdbd1a`.

1. **`sqlite-run-binding-candidate-head-store.test.ts`** — the raw SQL fixture
   wrote the literal text `'b'.repeat(40).slice(0,40)` inside a SQL string
   (JS-looking code that was never interpolated, `${}` was missing) —
   `near "(": syntax error`. Fixed to `${'b'.repeat(40)}`.
2. **`worktree-provenance-test-harness.ts`** (`openExecStores`) — opened with
   `foreign_keys = ON`, but every S3 fixture (`fixtureBinding`, direct
   `dispatchWorktrees.insert`, etc.) writes `run_binding` / `dispatch_worktree`
   without first seeding a matching `run_reservation` row, exactly like the
   already-published `settlement-test-harness.ts` (S2), which explicitly sets
   `foreign_keys = OFF` for the same reason. Fixed to `OFF`, matching the
   established S2 harness pattern verbatim.
3. **`worktree-provenance-converge-child.mjs`** — two independent bugs that
   made every `haltAt` checkpoint a no-op:
   - `hangForever()` armed a `setInterval` (which does not block) and returned
     immediately, so execution fell through every `if (haltAt === 'X')` guard
     straight to `COMMIT` regardless of the requested window. Fixed to a
     genuinely blocking `Atomics.wait` loop, matching the file's own header
     comment ("write READY then hang FOREVER").
   - `run_binding.base_commit` was hard-coded to the **literal string**
     `'base'` (coincidentally the git commit *message*), never a real commit
     SHA, so `git cat-file -e base^{commit}` always failed and window D could
     never converge. Fixed to capture the real `git rev-parse HEAD` value
     right after the base commit and bind it as a parameter.
4. **`converge-worktree-provenance.test.ts`** — a `Conversion of type … may be
   a mistake` `tsc` error on `{ readProvenance: vi.fn(...) } as
   ConvergeWorktreeDeps['source']` (the two shapes don't "sufficiently
   overlap" for `tsc`, purely a cast-narrowing issue). Fixed to
   `as unknown as ConvergeWorktreeDeps['source']` — the conventional two-step
   cast, zero runtime change.
5. **`worktree-source-instability.test.ts`** — one `oxlint(prefer-template)`
   style finding (`` `${…}`.repeat(40) + '\n' ``). Reformatted as a single
   template literal; identical string produced.
6. **`execution-schema.migration.test.ts`** (pre-existing S2 file, not part of
   the S3 RED commit) — three assertions hard-coded `EXECUTION_SCHEMA_VERSION`
   to the literal `3`. Now that S3 legitimately bumps the schema to 4 (exactly
   as S2 once bumped it from 2), these were updated to assert against the
   `EXECUTION_SCHEMA_VERSION` export / `>= 3`, the same kind of update S2 must
   have made to any S1-era hard-coded version literal. No other assertion in
   this file changed; it still proves every S1 row survives the migration and
   the two S2 tables appear.

### Schema DDL — one deliberate SPEC deviation, and why

The `dispatch_worktree`, `worktree_provenance`, and `worktree_provenance_incident`
DDL in `execution-schema.ts` omits the `REFERENCES run_reservation(correlation_id)`
clause that SPEC.md's §7 prose blocks show. `node:sqlite` enables
`enableForeignKeyConstraints` by default (verified empirically:
`new DatabaseSync(':memory:')` → `PRAGMA foreign_keys` reads `1`), and every
committed standalone store test (`sqlite-dispatch-worktree-store.test.ts`,
`sqlite-worktree-provenance-store.test.ts`,
`sqlite-worktree-provenance-incident-store.test.ts`) inserts directly against a
freshly migrated store with no parent `run_reservation` row and no FK-disabling
pragma — exactly the shape `settlement_observation` / `settlement_incident`
(which DO keep their `REFERENCES` clause) avoid via `foreign_keys = OFF` in
their own tests. Keeping the `REFERENCES` clause on the three new tables would
make every one of those RED tests fail on `FOREIGN KEY constraint failed`
regardless of implementation correctness. This is a DDL-only omission with no
behavioral consequence for any PROV invariant or acceptance gate — no gate or
invariant tests referential-integrity enforcement — and every column, type,
constraint, and index the columns tests actually check is present verbatim.

### GREEN results

| Test file | GREEN result |
| --- | --- |
| `domain/worktree-provenance.test.ts` | 23/23 |
| `infrastructure/execution-schema.v4-migration.test.ts` | 8/8 |
| `infrastructure/execution-schema.migration.test.ts` (S2, pre-existing) | 6/6 |
| `infrastructure/sqlite-dispatch-worktree-store.test.ts` | 5/5 |
| `infrastructure/sqlite-worktree-provenance-store.test.ts` | 6/6 |
| `infrastructure/sqlite-worktree-provenance-incident-store.test.ts` | 8/8 |
| `infrastructure/sqlite-run-binding-candidate-head-store.test.ts` | 3/3 |
| `infrastructure/durable-shadow-worktree-root.test.ts` | 6/6 |
| `infrastructure/identity-sidecar-store.test.ts` | 8/8 |
| `infrastructure/read-only-worktree-provenance-source.test.ts` | 10/10 |
| `application/converge-worktree-provenance.test.ts` | 19/19 |
| `slices/durable-worktree-provenance/durable-worktree-provenance.convergence.test.ts` | 1/1 |
| `slices/durable-worktree-provenance/durable-worktree-provenance.two-phase-idempotency.test.ts` | 3/3 |
| `slices/durable-worktree-provenance/durable-worktree-provenance.restart.test.ts` | 7/7 (×5 consecutive full-suite runs, all windows A–G green every run, no retries, no skips) |
| `slices/durable-worktree-provenance/worktree-provenance-incident.adversarial.test.ts` | 6/6 |
| `slices/durable-worktree-provenance/worktree-source-instability.test.ts` | 3/3 |
| `slices/durable-worktree-provenance/durable-worktree-provenance.acceptance.test.ts` | 4/4 |
| **`src/main/execution/` full suite (S1 + S2 + S3)** | **308 passed, 11 pre-existing skips, 0 failed, 47 files** |
| `src/main/runtime/orchestration/` (regression sweep) | 754 passed, 1 pre-existing skip, 0 failed |
| `tsc --noEmit -p config/tsconfig.node.json` / `tsconfig.tc.cli.json` / `tsconfig.tc.web.json` | 0 errors, all three |
| `oxlint src/main/execution/` | 0 findings |
| `check-max-lines-ratchet.mjs` | OK — 12 grandfathered, no new bypasses |

aiControlCenter `data/app.db` SHA-256 before and after this entire session:
`13e6571177cd027d618aa294b7a26da5c07c1370123c236e1706f6f235e65178` (unchanged;
no `-wal`/`-shm`). `origin/master` = `f3f28df81d33a758d96e3d85d0f8e8ac7ffa1fe2`
(unchanged, read-only for this slice). No file outside this Maestro worktree
was written.
