# ORCA-S5 Delegated Cutover Core — Lint + Evidence Correction Rereview

Date: 2026-09-21. Scope: **only** the two blockers reported by `dc304e5894`
(max-lines failure in `orca-runtime-create-terminal.ts`; inaccurate claims in
`CUTOVER-CORE-SITE5-COMPOSITION-FIX-EVIDENCE.md`) and the correction commit
`688d48a2eff1138bd37c7d42c5345234d095d530`. The site #5 composition fix,
schema, coordinator, fence, and authority semantics were not re-reviewed
except to confirm this correction did not touch them.

No implementation, test, or documentation file under review was edited. No
amend, rebase, or publish. Reviewed in a fresh detached worktree
(`C:/mw-orca-s5-lint-rereview`, HEAD `688d48a2ef`, clean). Disposable scratch
worktrees at `688d48a2ef` and `dc304e5894` were used for test runs so this
worktree stayed pristine.

**Independence caveat.** This rereview was performed by the same agent, in the
same working session, that authored `688d48a2ef`. Every conclusion below rests
on raw git/tool output reproduced in this review, not on the author's earlier
narrative, and it found two errors in that narrative (§6, §9). It is still not
an independent-agent review; a second-agent confirmation of the verdict is
reasonable if the process requires one.

## 1. Lineage

```
326b11e4fc973afa7e23d03a1f0d310933915cd1   parents=[5c75a7db28190654834dd36f8894f3dac88c9bb9]
dc304e589479769e404423743210affd604767bb   parents=[326b11e4...]
688d48a2eff1138bd37c7d42c5345234d095d530   parents=[dc304e58...]
```

- Single parent at every step; no merge commit.
- `dc304e5894` is unchanged (its blob set is byte-identical, §7).
- `git branch -r --contains 688d48a2` and `git branch --contains 688d48a2` are
  both empty: the candidate is unpublished.
- **Reachability risk (not a blocker):** no branch or tag holds `688d48a2ef` or
  `dc304e5894` — both exist only as detached-HEAD worktree tips. Removing those
  worktrees and running `git gc` could lose them. Consider a local branch
  before any cleanup.
- The local amend that produced the final SHA is acceptable per the mission
  terms: only the final SHA matters, no earlier commit changed, and the final
  commit contains exactly the intended two files (§2).

**Verdict: lineage clean.**

## 2. Exact diff `dc304e5894 → 688d48a2ef`

```
M src/main/execution/slices/orca-delegated-cutover/CUTOVER-CORE-SITE5-COMPOSITION-FIX-EVIDENCE.md  +49 -9
M src/main/runtime/orca-runtime-create-terminal.ts                                                   +7 -13
```

Exactly the two expected paths. No rename, copy, mode change, or added file.
No `FOCUSED_CORRECTION_SCOPE_VIOLATION`.

## 3. Production diff — no logic change

One hunk pair in `orca-runtime-create-terminal.ts`:

```diff
+        const agentSessionEnsureField = launchOpts.agentSessionClaim && {
+          agentSessionEnsure: {
+            claim: launchOpts.agentSessionClaim,
+            surface: { worktreeId: workspace.id, tabId, leafId, terminalHandle: preAllocatedHandle }
+          }
+        }
         try {
           result = await this.ptyController.spawn({
 ...
-            ...(launchOpts.agentSessionClaim
-              ? { agentSessionEnsure: { claim: ..., surface: { ...4 fields } } }
-              : {}),
+            ...agentSessionEnsureField,
```

Independent verification of each requirement:

| Check | Result |
| --- | --- |
| Same condition | Yes: `launchOpts.agentSessionClaim` truthiness. |
| Same fields/values | Yes: `agentSessionEnsure.claim`, `.surface.{worktreeId,tabId,leafId,terminalHandle}` from the same expressions. |
| Same position in the spread list | Yes: between `terminalColorQueryReplies` and `agentSessionCreateOperationId`; no overlapping keys. |
| Falsy branch | Original spreads `{}`; new spreads the falsy claim value itself. Spreading `undefined`, `null`, `false`, `0`, `''`, `0n` into an object literal adds no properties, so the result is identical for every falsy value. The same `&&`-spread idiom already exists in this call for `preparedDelegatedProcessIdentityCapture`. |
| No intervening mutation | `tabId`, `leafId`, `preAllocatedHandle` are reassigned only at lines 34–44 (initial) and 186–194 (after the spawn result). `workspace` and `launchOpts` are `const` and never rebound. |
| Same synchronous flow | No `await` between the new declaration (line 126) and the old inline site (line 156). The only call evaluated in between is `mergeTerminalEnvDeletionKeys(a, b)`, which builds a fresh array from its two arguments and touches none of the referenced values (`runtime-agent-launch-resolution.ts:11-17`). |
| Promise/timing | The `await this.ptyController.spawn(...)` is unchanged and still evaluated after all argument expressions. |
| Exception/cleanup path | The new `const` sits outside the inner `try/finally`; if it could throw (it cannot — plain property reads on already-dereferenced objects), the outer `finally { releaseStablePaneCreate() }` still runs and that function is idempotent. |
| delegatedCutover / prepared identity | `preparedDelegatedProcessIdentityCapture` spread, `onPtySpawnCommitted` spread, and reporter wiring are untouched context lines. |

**Classification: `BEHAVIOR_PRESERVING_EXTRACTION` for the hunk; zero
`FUNCTIONAL_CHANGE`.**

Precision note (non-blocking, see §10): the guard form changed from a
`? {...} : {}` ternary to `&& {...}`. That is behavior-equivalent under spread
as shown above, but the evidence doc and commit message describe the moved
expression as "unchanged", which slightly understates it.

## 4. Lint blocker

Effective lines are non-blank, non-comment lines (oxlint's `max-lines`
counting). The count script was calibrated against oxlint's own reported
figure (303 at `326b11e4` and `dc304e5894`, matching exactly).

| Commit | raw `wc -l` | effective | `oxlint` on the file |
| --- | --- | --- | --- |
| `5c75a7db28` (focused RED) | 305 | **299** | exit 0, `ok` |
| `326b11e4fc` (focused GREEN) | 309 | **303** | exit 1, `eslint(max-lines): File has too many lines (303)` |
| `dc304e5894` (blocker review) | 309 | **303** | exit 1, same error |
| `688d48a2ef` (candidate) | 303 | **297** | exit 0, `ok` |

- Original blocker reproduced at `dc304e5894`: 303 > 300.
- At `688d48a2ef`: max-lines passes with a 3-line margin.
- `oxlint --config config/oxlint-react-doctor.json` (second lint-staged step)
  on the file: exit 0.
- **The violation was introduced by `326b11e4`** (299 → 303), not pre-existing.
  See §6, finding E1: the correction text says otherwise.

Suppression / config audit: `git diff dc304e5894 688d48a2ef` adds no
`eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, or
`@ts-nocheck` in code (the only textual hit is prose in the evidence doc).
`git diff 67a36218..688d48a2 -- package.json pnpm-lock.yaml config/
.oxlintrc.json .oxfmtrc.json .husky` is empty: no ignored path, override, or
config change. `check-max-lines-ratchet`: OK, 12 grandfathered, no new bypass.

## 5. Formatter / hook stability

The correction author reported the pre-commit hook (`lint-staged` runs
`oxlint` **then** `oxfmt --write`) re-expanded a first attempt back over budget.
The final content was tested against exactly that hazard.

- In this fresh checkout `oxfmt --check` on the file **fails** — but so do
  three untouched control files (`orca-runtime-create-terminal-dependencies.ts`,
  `orca-runtime-delegated-cutover-callback.ts`,
  `orca-runtime-create-agent-session.ts`). Cause: `core.autocrlf=true` writes
  CRLF into the working copy (303 CRs in the file; **0 CRs in the git blob**),
  and `.oxfmtrc.json` sets no `endOfLine`. This is a Windows checkout artifact
  affecting every file, not an instability of this change.
- Tested the exact committed blob instead (written LF-only into a scratch
  worktree; sha256 equal to the blob):
  - `oxfmt --check`: exit 0, "All matched files use the correct format."
  - `oxfmt --write`: output sha256 identical to the blob (idempotent).
  - After the formatter write: 297 effective lines, `oxlint` exit 0.

**Verdict: the final `688d48a2ef` content is formatter-stable; the hook cannot
re-inflate it.**

## 6. Evidence document (`CUTOVER-CORE-SITE5-COMPOSITION-FIX-EVIDENCE.md`)

### Lint claim — history preserved (PASS)

The false "`oxlint`: clean" bullet is struck through and immediately followed by
a bolded **Correction (independent rereview)**. A top-of-document notice says
the record is not rewritten to claim `326b11e4` originally passed lint, and the
correction states current post-fix lint is clean (verified, §4). Struck text
followed at once by bold correction text is unambiguous when read raw or
rendered.

### Regression baseline — wording (PASS)

The two-path-separator-file characterization is struck through and corrected to
a 15-file baseline across several areas, `structured-worker-child-identity-env`
and `ai-vault` described as part of it, not the whole. The doc concludes "zero
new failures attributable to this fix" and does not claim a clean suite or a
single root cause. Numbers preserved: 15 failed / 864 passed / 5 skipped files;
30 failed / 8826 passed / 67 skipped tests. (The area list in the correction
omits a few of the 15 files' areas — e.g. path-case normalization in
`agent-session-claim-identity` — but says "not just", so this is imprecise,
not false.)

### Finding E1 — the correction introduces a new false statement (BLOCKER)

Evidence doc line 244, inside the lint correction:

> "(already 305 effective lines at focused RED, before this diff touched it;
> this diff added 4 more)"

This is false:

- Effective lines at focused RED were **299** (under the limit); **305 is the
  raw `wc -l`**, the figure the `dc304e5894` artifact quoted before it
  self-corrected its own fix-size estimate.
- The sentence is internally inconsistent: 305 + 4 ≠ 303.
- It misstates causation. The 300-line violation did not pre-exist; `326b11e4`
  pushed a compliant file (299) over the limit (303) **and** its own evidence
  claimed lint was clean. That is a stronger defect than "pre-existing
  violation made marginally worse", which is how `dc304e5894` §30 and this
  document present it.

The same inaccurate claim is in the `688d48a2ef` commit message
("already 305 at focused RED, +4 from this diff"). A commit message cannot be
corrected without an amend; this rereview records the correct figures instead.
`dc304e5894` (immutable) contains the original "pre-existing" framing; that
artifact is left untouched and superseded on this point by §4 above.

The mission requires the evidence to be truthful. An evidence correction that
adds a new false lint statement about the exact file at issue does not meet
that bar.

## 7. Immutability

`git diff dc304e5894 688d48a2ef` against `SPEC.md`,
`SPEC-STATUS-RATIFICATION-001.md`, all `ARCHITECTURE*.md`,
`CUTOVER-CORE-RED-EVIDENCE.md`, `CUTOVER-CORE-GREEN-EVIDENCE.md`, and
`CUTOVER-CORE-COMPOSITION-FIX-REREVIEW.md`: **empty**. The `dc304e5894`
review artifact is byte-identical at `688d48a2ef`. Only the composition-fix
evidence document differs.

## 8. Regression results (all at `688d48a2ef` unless noted)

| Suite | Result |
| --- | --- |
| Cutover-Core `src/main/execution/slices/orca-delegated-cutover` | 10 files, 46 tests, all pass |
| PRE_IMPLEMENTATION, exact accepted 7-file set (§9) | 7 files, 38 tests, all pass |
| `src/main/execution` | 82 files; 499 passed, 11 skipped, 0 failed (510). Test-identity sets equal to `dc304e5894`: 499 = 499 passed, 0 = 0 failed |
| `src/main/runtime` + `providers` + `ipc/pty` | 884 files, 15 failing; 30 failed / 8826 passed / 67 skipped (8929) |
| `tsc --noEmit -p config/tsconfig.node.json` | exit 0, no output |
| `check-max-lines-ratchet`, `check-ts-nocheck-ratchet`, `check-runtime-electron-ratchet`, `check-reliability-gates` | all exit 0 |

**Runtime/provider/pty identity comparison** against `dc304e5894`, run
concurrently in separate worktrees with JSON reports: the failing-test set is
identical (30 common, 0 only-in-either), the failing-file set is identical (15
files), and the passing-test identity sets are equal (8811 unique names each;
the count of 8826 includes repeated titles). **No new failure identity is
attributable to `688d48a2ef`.** This is "no new candidate-caused regression",
not "suite clean" and not a single root cause: the 15 files fail from unrelated
causes visible in their messages (Windows path separators and drive-case
normalization, EPERM on symlink creation and temp-dir cleanup, shell-wrapper
path joins, and a `cancelled:false` mismatch in
`structured-agent-session-integration`).

Repo-wide `oxlint` (default config) is **not** green at `688d48a2ef`: 2 errors,
both `max-lines`, in `src/main/execution/application/converge-delegation-
boundary-lifecycle.ts` (329) and `.../shadow-observation-service.ts` (326).
Both are identical at `dc304e5894`, were last touched by the earlier S4 commit
`66dab64373`, and are not in this lineage's diff. At `dc304e5894` the count is
3 — the third being the target file, now gone. Warnings (7) are identical. This
is out of scope for the two blockers but means "the target file passes" and
"the repository lint passes" are different statements; only the first is true.

## 9. PRE_IMPLEMENTATION regression — count discrepancy resolved

The accepted set is documented, contrary to the `dc304e5894` artifact's
statement that no artifact names it: `CUTOVER-CORE-GREEN-EVIDENCE.md` §19 (and
`RED-EVIDENCE.md`) list exactly these seven files:

```
src/main/ipc/pty/runtime/spawn-execute-commit-propagation.test.ts
src/main/ipc/pty/runtime/spawn-execute-cross-alias-promise-convergence.test.ts
src/main/ipc/pty/runtime/spawn-options-commit-guard-async.test.ts
src/main/ipc/pty/runtime/spawn-options-delegated-cutover-capability-gate.test.ts
src/main/providers/local-pty-provider-delegated-command-delivery.test.ts
src/main/runtime/orca-runtime-report-pty-spawn-commit-async.test.ts
src/shared/async-spawn-commit-reporter-synchronous-safety.test.ts
```

Run at `688d48a2ef`: **7 files, 38 tests, all pass.** The correction author's
2-file / 12-test run was a strict subset of this set (two of the seven files).
Classification: `INCOMPLETE_REGRESSION_EVIDENCE` for that report, and the
`688d48a2ef` commit message's statement that "no suite literally named
PRE_IMPLEMENTATION exists" is inaccurate. Not a code blocker: the full accepted
set passes.

## 10. Non-blocking observations

- Guard form change (`? :` → `&&`) is described as "unchanged expression" in
  the doc and commit message; equivalent, but say so precisely when correcting
  E1.
- `688d48a2ef` commit message carries two inaccurate statements (§6 E1, §9).
  Prefer recording corrections in the follow-up commit over amending again.
- Reachability of the detached tips (§1).

## 11. aiControl guard

`AICONTROL_GUARD_NOT_VERIFIABLE_IN_THIS_WORKTREE`. No `data/app.db` exists in
any Maestro tree, and no aiControl checkout was found at the conventional paths
checked (`Documents/aiControl`, `aicontrol`, `ai-control`, `C:/aiControl`,
`~/aiControl`). Nothing was converted to a pass. This review performed no
write to any aiControl path or any `.db`/WAL/SHM/journal file.

## 12. Environment incident (disclosed)

While setting up the scratch worktrees (whose `node_modules` were junctions to
the authoring worktree's install), two `pnpm exec` invocations triggered
pnpm's implicit dependency check, which tried to re-link inside the shared
`node_modules` and failed with `ERR_PNPM_PACKAGE_MANAGER_SYMLINK_FAILED`. Some
top-level entries there have a 2026-09-21 mtime as a result. Integrity was
checked afterwards: 1187 links inspected, 0 dangling, all 128 declared
dependencies present, `.pnpm` untouched (2026-09-18), authoring worktree clean.
All test runs used in this review invoked `node_modules/vitest/vitest.mjs`
directly. No source, test, or doc file was affected.

## 13. Operational state

Unchanged before and after: Authority `AICONTROL_NATIVE`; `ORCA_DELEGATED` NOT
STARTED; fence acquisition DISABLED; R3 NOT STARTED; M5 NOT STARTED. No live
fence acquisition; live `ORCA_DELEGATED` activation NOT AUTHORIZED.

## Verdict

```
state_class: BLOCKERS_FOUND
display_verdict: ORCA_S5_DELEGATED_CUTOVER_CORE_LINT_EVIDENCE_BLOCKER_REMAINS
```

What is closed:

- Lint blocker: `orca-runtime-create-terminal.ts` now passes max-lines (297
  effective), no suppression or config change, formatter-stable.
- Production change: `BEHAVIOR_PRESERVING_EXTRACTION`, zero `FUNCTIONAL_CHANGE`.
- Regression-baseline wording: corrected, no overclaim.
- Diff scope, immutability, Cutover-Core (46), full PRE_IMPLEMENTATION set
  (38), execution (499/11), runtime/provider/pty identity, typecheck: all pass.

What remains — **the smallest exact correction:**

In `CUTOVER-CORE-SITE5-COMPOSITION-FIX-EVIDENCE.md` line 244, replace the
parenthetical

> (already 305 effective lines at focused RED, before this diff touched it;
> this diff added 4 more)

with a statement equivalent to

> (299 effective non-blank, non-comment lines at focused RED — under the
> limit; `326b11e4` added 4, taking it to 303, so that diff introduced the
> violation. The 305 → 309 figures quoted elsewhere are raw `wc -l` counts.)

Nothing else in the two-file correction needs to change for acceptance. Because
`688d48a2ef` is unpublished the author may fold this into a new commit or an
amend; either way the new SHA must be re-verified, including
`oxfmt --check` on the LF blob (§5) if the `.ts` file is touched again. The
`accepted_technical_head` is therefore **not set**.

```
Previous site #5 composition blocker: CLOSED
Previous lint blocker (max-lines in orca-runtime-create-terminal.ts): CLOSED
Previous evidence blocker: NOT YET CLOSED (one new inaccuracy, E1)
Cutover-Core: NOT YET TECHNICALLY ACCEPTED (evidence wording outstanding only)
Live ORCA_DELEGATED activation: NOT AUTHORIZED
Authority: AICONTROL_NATIVE
Fence acquisition: DISABLED
R3: NOT STARTED
M5: NOT STARTED
```
