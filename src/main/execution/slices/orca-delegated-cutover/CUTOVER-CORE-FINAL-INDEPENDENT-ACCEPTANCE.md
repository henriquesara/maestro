# CUTOVER-CORE FINAL INDEPENDENT ACCEPTANCE — ORCA-S5

Terminal, deliberately narrow acceptance of the Delegated Cutover-Core chain
before publication. Review-only: no code, test, schema, or existing-doc edit;
this file is the only addition. Nothing was published, amended, rebased or
squashed.

## 1. Independence

The reviewer is a fresh Claude Code session (id `8aac564b-…`) started for this
task with no working context from the session that authored `688d48a2ef`,
`635f672a7d` and `317aef85c0`. It did **not** author any of the three.

Caveat, stated plainly: every commit in the chain carries the same git identity
and the same `Co-Authored-By: Claude Sonnet 5` trailer, so commit metadata
cannot itself distinguish sessions. Independence rests on session separation.
At session start the ai-memory hook injected a short handoff header from the
authoring session; no conclusion in this document was taken from it — every
fact below was re-derived from the repository and fresh command output.

`635f672a7d` is **DIAGNOSTIC ONLY — NOT INDEPENDENT ACCEPTANCE**.

## 2. Anchor and lineage

No local ref protected `317aef85c0` at session start (only a detached-HEAD
worktree at `C:/mw-orca-s5-rereview`). Before any worktree work, this review
created `refs/anchors/orca-s5-317aef` → `317aef85c0a3e397962a27db813312cd16fbc105`
(a new ref only; no history touched). Review worktree:
`C:/mw-orca-s5-final-acceptance` on branch
`review/orca-s5-final-independent-acceptance`, created at `317aef85c0`.

Verified with `git log` / `git rev-list --parents b8fe7cb942..317aef85c0`:

```
b8fe7cb942 (published architecture base; on origin/main)
 → 7e03539e23 (Cutover-Core RED)
 → 67a36218c5 (Cutover-Core GREEN)
 → 5c75a7db28 (focused composition RED)
 → 326b11e4fc (focused composition GREEN)
 → dc304e5894 (independent composition review)
 → 688d48a2ef (mechanical production/evidence correction)   ← production candidate
 → 635f672a7d (same-agent diagnostic)
 → 317aef85c0 (docs-only evidence correction)
```

8 commits, each with exactly one parent, 0 merges, `b8fe7cb942` is an ancestor
of `317aef85c0`. No remote-tracking ref contains `7e03539e23`, `688d48a2ef` or
`317aef85c0` (local remote-tracking refs, no fetch performed) → unpublished.

## 3. Final docs-only diff (`635f672a7d` → `317aef85c0`)

`git diff --name-status`: exactly one path.

```
M  src/main/execution/slices/orca-delegated-cutover/CUTOVER-CORE-SITE5-COMPOSITION-FIX-EVIDENCE.md   (+50 / −6)
```

No TypeScript, test, schema, architecture or review artifact changed.
Verdict: FINAL_EVIDENCE_SCOPE respected.

## 4. Production byte identity (`688d48a2ef` vs `317aef85c0`)

- `git diff --name-only 688d48a2ef 317aef85c0` = the evidence doc + the
  `635f672a7d` diagnostic artifact (both `.md`) and nothing else.
- `git diff 688d48a2ef 317aef85c0 -- ':(exclude)*.md'` is empty: zero delta
  across every non-Markdown file (`*.ts *.tsx *.js *.mjs *.json *.sql …`,
  including schema/migration paths and the `config` tree).
- `git rev-parse …:config` identical at both commits; the production blob
  `src/main/runtime/orca-runtime-create-terminal.ts` is `192a04ec10c8…` at both.

Verdict: production is byte-identical to `688d48a2ef`. ZERO production delta.

## 5. Max-lines chronology (independently re-measured)

Measured with the repo's own rule settings (`max-lines`, `skipBlankLines`,
`skipComments`, run through the worktree's `oxlint` with `max:1` so the
effective count is reported) on `git cat-file` blobs of
`src/main/runtime/orca-runtime-create-terminal.ts`:

| Commit | Effective max-lines (limit 300) | Raw physical lines | Status |
| --- | --- | --- | --- |
| `5c75a7db28` focused RED | 299 | 305 | COMPLIANT |
| `326b11e4fc` focused GREEN | 303 | 309 | VIOLATION INTRODUCED BY THAT CHANGE |
| `688d48a2ef` mechanical fix | 297 | 303 | COMPLIANT |
| `317aef85c0` final | 297 | 303 | COMPLIANT |

The evidence doc (`…SITE5-COMPOSITION-FIX-EVIDENCE.md`, "Verified max-lines
chronology and historical notes") states exactly 299 → 303 → 297, marks the
violation as introduced by focused GREEN, and separately explains that 305 is
the raw `wc -l`-style count at focused RED and a different measurement from the
effective metric. Every remaining occurrence of "305" in the document is either
that raw-count explanation or a quoted historical phrase explicitly labelled
superseded. No occurrence asserts "305 effective lines at focused RED" as
current truth. The document also records that `dc304e5894` §30 called the
violation pre-existing; I confirmed that framing in that artifact's §30 (lines
465–467) and its "Summary of findings" (lines 552–556), so the supersession
note is accurate. Verdict: CHRONOLOGY
CORRECT; RAW-VS-EFFECTIVE DISTINCTION CORRECT.

## 6. `688d48a2ef` commit-message note

The doc records that the commit message contains the inaccurate
"303 effective lines vs. 300 limit; already 305 at focused RED" statement, that
it is historical metadata superseded by 299 → 303 → 297, and that the commit is
intentionally not amended. Confirmed against `git log -1 688d48a2ef`.

Extra clarification in the doc: the message "says no suite literally named
PRE_IMPLEMENTATION exists and reports only a 2-file / 12-test subset; the
accepted 7-file / 38-test set is recorded in `CUTOVER-CORE-GREEN-EVIDENCE.md`
§19 and passes." Checked: the message does say exactly that ("no suite
literally named PRE_IMPLEMENTATION exists in this tree … 2 files, 12 tests");
`CUTOVER-CORE-GREEN-EVIDENCE.md` §19 does list a 7-file / 38-test set under the
heading "PRE_IMPLEMENTATION regression"; and this review ran it (§9) and got
7/38 pass. The statement is precise (it says "literally named", it does not
deny the accepted set) and factually supported.

Verdict: **SUPPORTED_HISTORICAL_CORRECTION** (not a scope expansion, not
misleading). `688d48a2ef` not amended.

## 7. Regression-baseline wording

The doc preserves "15 failed / 864 passed / 5 skipped files, 30 failed / 8826
passed / 67 skipped tests" and "re-verified failure identities". The earlier
"all path-separator family" characterization stays struck through with a
correction that the set spans 15 files across unrelated areas and that none of
those files is in the fix's changed-file set. The doc does not claim the suite
is clean, does not attribute all failures to path separators, and does not claim
a single root cause. Verdict: WORDING ACCURATE.

Non-blocking observation (pre-existing text, not in the `317aef85c0` diff): the
execution-suite bullet says "82 files, 510 tests, all pass"; the precise figure
is 499 passed + 11 skipped = 510 (which this review reproduced). Not misleading
enough to block.

## 8. Same-agent diagnostic status

The doc's "Review status" paragraph identifies `635f672a7d` as authored by the
same agent as `688d48a2ef`, "diagnostic evidence only … not independent
acceptance; a fresh independent agent must still issue the terminal acceptance."
No language treats it as acceptance authority. Verdict: CORRECT.

## 9. Verification runs (all in the fresh worktree, HEAD `317aef85c0`)

| Check | Result |
| --- | --- |
| `oxlint src/main/runtime/orca-runtime-create-terminal.ts` (repo `.oxlintrc.json`) | exit 0, no diagnostics; effective count 297 |
| `oxlint` over all 31 non-Markdown `src/**` files changed b8fe→317aef | exit 0 |
| `node config/scripts/check-max-lines-ratchet.mjs` | `OK — 12 grandfathered suppression(s), no new bypasses` |
| Suppressions in the file (`eslint-disable`/`oxlint-disable`/`max-lines`) | none |
| Lint/format/package config changes b8fe→317aef (`.oxlintrc.json`, `.oxfmtrc.json`, `config/`, `package.json`) | none |
| Repo-wide `oxlint` | exit 1 — exactly the two known S4 `max-lines` errors: `application/shadow-observation-service.ts` (326) and `application/converge-delegation-boundary-lifecycle.ts` (329); both untouched by the chain; plus pre-existing warnings. Not a Cutover-Core blocker. |
| `tsc --noEmit -p config/tsconfig.node.json` | exit 0, empty output |
| Cutover-Core (`src/main/execution/slices/orca-delegated-cutover`) | **10 files / 46 tests, all pass** |
| Exact PRE_IMPLEMENTATION set, `CUTOVER-CORE-GREEN-EVIDENCE.md` §19 (7 named files, all present) | **7 files / 38 tests, all pass** |
| `src/main/execution` | 82 files, 510 tests: **499 passed / 11 skipped / 0 failed** — matches baseline exactly |
| Corroboration (beyond the required scope): `src/main/runtime` + `src/main/providers` + `src/main/ipc/pty` | 884 files: **15 failed / 869 not-failed (= 864 passed + 5 skipped)**; 8929 tests: **30 failed / 8826 passed / 67 skipped** — exactly the recorded baseline. The 15 failing files were re-run at the pre-fix commit `67a36218c5` in a temporary detached worktree (since removed): the failing-identity sets (30 failed assertions + 1 file-level "No test found" failure in `local-pty-shell-startup-command.node-pty.test.ts`) are **identical**, 0 only-in-base, 0 only-in-candidate. None of the failing files is in the chain's changed-file set. Not a clean suite; not one root cause (WSL/login-shell, exit-provenance, artifact-grant/symlink, skill discovery, structured-session, path-separator tests). The prose per-file counts in `dc304e5894` §28 (e.g. exit-provenance "×9") differ from the machine-extracted counts (11), but totals and file set agree; this review relies on the machine comparison. |

## 10. Formatter stability

Blob `688d48a2ef:src/main/runtime/orca-runtime-create-terminal.ts` (identical at
`317aef85c0`) is LF in the index. `oxfmt --check` on an LF copy of that exact
blob: **All matched files use the correct format** (exit 0). On the Windows
checkout (`core.autocrlf=true` materializes CRLF) `oxfmt --check` fails on that
file, but fails identically on untouched control files
(`shadow-observation-service.ts`, `spawn-state.ts`, `orca-runtime-create-agent-session.ts`),
and the CRLF file equals the committed blob modulo `\r`. This is a checkout
artifact, not a semantic defect. The committed blob will not be reformatted over
the 300 limit. Verdict: FORMATTER-STABLE.

## 11. Toolchain health

The fresh worktree had no `node_modules`. I created a directory **junction**
`C:/mw-orca-s5-final-acceptance/node_modules` → `C:/Users/henrique/Documents/maestro/node_modules`
(the same layout another worktree already uses). `package.json`, `pnpm-lock.yaml`
and `pnpm-workspace.yaml` blobs are identical between the candidate and the main
checkout that owns that `node_modules`. No dependency install, rebuild or
`ensure-native-runtime` was run, and no shared-`node_modules` content was
altered by me deliberately; vitest may have written its normal cache files
there. Resolved and ran: `oxlint 1.80.0`, `tsc 7.0.2`, `vitest 4.1.11`,
`oxfmt 0.65.0`, Node v24.19.0. Native modules loaded correctly (the sqlite-backed
Cutover-Core tests passed). Toolchain sufficient for reliable verification.
A second temporary worktree at `67a36218c5` used the same junction for the
baseline comparison in §9; it was removed (junction deleted with `rmdir`, target
untouched) and the shared `node_modules` was re-checked intact afterwards
(848 top-level entries, tools still resolve). No source was mutated to repair
tooling.

Test-run side effects, disclosed: running the wide suites rewrote two tracked
files in this review worktree — the S2 `settlement-evidence-bundle.json`
(per-run dispatch IDs/digests regenerate on every run) and
`orchestration/__snapshots__/preamble.test.ts.snap` (line endings only). Both
belong to slices outside this chain, were reverted with `git restore` in this
disposable worktree, and are not part of the review commit.

## 12. Frozen / review artifact immutability

`git diff` between `688d48a2ef` and `317aef85c0` for `SPEC.md`,
`SPEC-STATUS-RATIFICATION-001.md`, `CUTOVER-CORE-RED-EVIDENCE.md`,
`CUTOVER-CORE-GREEN-EVIDENCE.md`, `CUTOVER-CORE-COMPOSITION-FIX-REREVIEW.md`
(`dc304e5894`) and all `ARCHITECTURE*.md`: empty. `git diff 635f672a7d 317aef85c0`
for `CUTOVER-CORE-LINT-EVIDENCE-FIX-REREVIEW.md` (the `635f672a7d` diagnostic):
empty. After `635f672a7d`, only the composition-fix evidence doc differs.

## 13. aiControl guard (read-only)

Canonical checkout found at `C:/Users/henrique/Documents/aiControlCenter`
(branch `master`). Read-only checks, no fetch, no DB open:

- `refs/remotes/origin/master` = `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` ✓
  (local remote-tracking ref, not re-fetched)
- `data/app.db` SHA-256 = `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` ✓
- no `-wal` / `-shm` / `-journal` files in `data/` ✓

Notes: local `master` HEAD is `c2d404a541`, not `ab5967bd`, and that checkout has
an unrelated modified `AGENTS.md` and untracked `.agents/` — neither touches the
guarded state. Guard: PASS, informational, no mutation/drift observed.

## 14. Operational state (unchanged)

Authority: `AICONTROL_NATIVE`. `ORCA_DELEGATED`: NOT STARTED operationally.
Fence acquisition: DISABLED. R3: NOT STARTED. M5: NOT STARTED. This review
enabled nothing and started nothing.

## 15. Verdict

All four questions answered affirmatively:

1. `317aef85c0` correctly repairs the remaining historical evidence error.
2. Production is byte-identical to `688d48a2ef`.
3. The production candidate passes targeted max-lines/oxlint, ratchet, typecheck,
   Cutover-Core (46), and the exact accepted PRE_IMPLEMENTATION set (38).
4. The chain is suitable for publication.

```
state_class:     ACCEPTED_READY_FOR_PUBLICATION
display_verdict: ORCA_S5_DELEGATED_CUTOVER_CORE_ACCEPTED_READY_FOR_PUBLICATION

accepted_production_head:            688d48a2eff1138bd37c7d42c5345234d095d530
accepted_chain_head_before_review:   317aef85c0a3e397962a27db813312cd16fbc105
publication chain HEAD:              the commit that adds this file

Site #5 composition blocker:   CLOSED
Lint blocker:                  CLOSED
Evidence-history blocker:      CLOSED
Cutover-Core:                  TECHNICALLY ACCEPTED
Live ORCA_DELEGATED activation: NOT AUTHORIZED
Authority:                     AICONTROL_NATIVE
Fence acquisition:             DISABLED
R3:                            NOT STARTED
M5:                            NOT STARTED
```
