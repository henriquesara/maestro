# ORCA-S5 PRE_LIVE PRODUCTIONIZATION — FOCUSED INDEPENDENT REREVIEW OF CORRECTIONS

Focused (not from-scratch) rereview of the correction commit `4a2cddc2825c3ee150a4b4ef0493905755e16277`
against its sole authoritative source of required changes: the independent architecture review at
`8970df4affaf80227a819a1efe2ae9b0f9945213` (`PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE-REVIEW.md`). Architecture
review only — no production code, test, schema, or aiControl file was touched by this rereview; fence
acquisition, R3, `ORCA_DELEGATED`, and M5 remain untouched throughout.

```
state_class:     ARCHITECTURE_CHANGES_REQUIRED
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_FOCUSED_REREVIEW_CHANGES_REQUIRED
```

## 1. Independence statement

I am an independent reviewer with no prior involvement in the review commit (`8970df4aff...`) or the
correction commit (`4a2cddc282...`) that this rereview evaluates. Every claim below was derived in this
session from git commands, file reads, and source-code reads I performed myself; nothing is carried over from
either commit's prose except where explicitly quoted and cited as their claim.

## 2. Lineage verification — PASSED

- `origin/main` (after `git fetch origin`) == `1f70bdf4992ae920aed56de905edb0463faa8657`, exact match.
- Direct-parent chain confirmed with `git log --format='%P'`, not just reachability: `4a2cddc282`'s sole
  parent is `8970df4aff`; `8970df4aff`'s sole parent is `dfb1235673`; `dfb1235673`'s sole parent is
  `1f70bdf499`. This is a linear, non-merged, non-rebased chain (no evidence of reconstruction).
- `git merge-base --is-ancestor` succeeded for all three hops (`1f70bdf499→dfb1235673`,
  `dfb1235673→8970df4aff`, `8970df4aff→4a2cddc282`).
- `56a0a2ed79f323fa2223f5c1f549ac3c15b4e60d` is confirmed **not** an ancestor of `8970df4aff` or of
  `4a2cddc282`, and `dfb1235673` is confirmed **not** an ancestor of `56a0a2ed...` either (fully disjoint
  history) — consistent with the review's own §Note-on-provenance claim that the first attempt was built on a
  branch that diverged before the `orca-delegated-cutover` slice existed. I found no citation of `56a0a2ed...`
  as authority anywhere in the three corrected docs or the review artifact.
- Lineage result: `PRELIVE_CORRECTION_LINEAGE_VALID` — proceeded to the rest of the review.

## 3. Source-snapshot verification — PASSED

`src/main/execution/slices/orca-delegated-cutover/` contains a real `SPEC.md` (178K), 25 `.ts` files including
extensive test suites (`delegated-cutover-*.test.ts`, `post-cutover-lifecycle-*.test.ts`) and fixtures/harnesses,
plus prior GREEN/RED/acceptance evidence docs. `src/main/execution/` additionally contains real
`application/`, `domain/`, and `infrastructure/` directories (the latter including
`infrastructure/aicontrol-native/`), and the specific files the review cites
(`orca-runtime-delegated-cutover-callback.ts`, `local-pty-spawn.ts`, `lifecycle-process-termination.ts`,
`restart-recovered-identity-verification.ts`, `process-instance-discriminator.ts`) all exist with the content
the review and the corrected docs describe. This worktree is not docs-only. Result:
`PRELIVE_REREVIEW_SOURCE_SNAPSHOT_VALID`.

## 4. Required-correction matrix, extracted from `8970df4aff...` itself

Extracted from the review's §0 verdict summary, §6, §7, §9/§10, and §11 (A-7), and its Final section, which is
the only place the count and scope of required corrections is stated authoritatively ("Three corrections
required before freeze ... one amendment needs one added sentence"):

| # | Review §/finding | Exact requirement (paraphrase of review text, sourced to the section) | Where it must land per the review |
| --- | --- | --- | --- |
| 1 | §6 — B-1/AD-2 crash-window | Add a 4th legal durable state `(a′)` to AD-2's crash matrix: placeholder sidecar + live, untracked process when `captureOsStartMarkerSync` throws after spawn. Legal next action: "the process must be torn down through the identity-verified path using the in-memory pid the callback already holds ... before the exception is allowed to propagate, and only then rethrown." P1-scope, not a new slice, not a P9 dependency. | ARCH AD-2 crash matrix + genuine-RED bullet for P1 |
| 2 | §7 — AD-1/H1 restart-scope boundary | Add one explicit, standalone, verbatim-testable sentence: "This restart acceptance is scoped to `FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` only. It does not establish, and must not be cited as establishing, `GENERAL_DELEGATED_RESTART_CONVERGENCE`." Plus the H2/gates-7-38-50 milestone that removes the boundary. One paragraph, in ARCH §10 or AMD A-8 — not a new amendment, not a reopening of H1/H2. | ARCH §10 (first controlled workload) and/or AMD A-8 |
| 3 | §9/§10 — D-7/P7b terminal-writer audit scope | Rewrite P7b's acceptance criterion from "classify the one cited `runner.ts:195-200` writer" to a static, CI-enforced ratchet over **all** `agentRuns.status` writers in the aiControl tree (the review found 12 in `runner.ts` alone), each proven `FENCE_GUARDED`, `PROVEN_UNREACHABLE_FOR_FENCED_RUN`, or `ROUTED_THROUGH_CANONICAL_PROJECTION`; zero tolerance for `[UNVERIFIED]`; gates 11/12 stay `PRE_LIVE_REQUIRED` (not closed) until the ratchet exists. Also: fold this into PL-1's wording so PL-1 references the ratchet's pass/fail, not just "P7/P7b code" (§24). | ARCH P7b slice text, ARCH PL-1, GAP D-7 row, GAP gate-table row 11/12 |
| 4 | §11 (A-7) — clock-jump behavior | AD-8/A-7 must record, in one sentence, what happens on a wall-clock jump: since the deadline (`cutover_at + timeout_ms`) is recomputed fresh each lifecycle pass from durable UTC timestamps, a jump can only move the computed comparison, never the durable inputs. | AMD A-7 (or ARCH, review says "record this reasoning as one sentence in A-7") |

Note: the review lists PL-1's rewording as "folded into PL-1" under the §9/§10 correction rather than as a
fifth independent item, and I have treated it that way (part of item 3) rather than double-counting it.

## 5. Per-correction closed/not-closed verdict

**#1 (§6, B-1/AD-2 crash matrix) — PARTIALLY CLOSED. Real, adversarially-found gap remains.**

The ARCH doc's AD-2 section was edited to add exactly the `(a′)` row and supporting prose the review
prescribed (`PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md:77-98`), essentially transcribing the review's own §6
required-correction language ("terminate via the identity-verified path, using the in-scope pid the callback
already holds ... then rethrow"). Textually, this matches what the review asked for almost verbatim, and the
GAP doc's D-1/D-2 discussion and RED bullet (`ARCHITECTURE.md:378-386`) were updated to match. As a *textual*
match to the review's prescribed wording, this is closed.

As a *substantive* fix, it is not. I checked the real identity-verification mechanism this phrase points to
(`resolveProcessTermination` → `verifyRestartRecoveredIdentity` in
`src/main/execution/domain/restart-recovered-identity-verification.ts`, and
`src/main/execution/application/lifecycle-process-termination.ts`). That function requires, in order: (1) a
sidecar snapshot that matches the durable binding's `correlationId`/`orcaRunId`/`orcaDispatchId`/`processNonce`,
(2) `pidExists`, and (3) a non-null `durable.osStartMarker` that equals a freshly re-read
`currentOsStartMarker` — its own code comment states "Sidecar-plus-pid-exists alone is never sufficient on any
platform." In state `(a′)`, by construction, the sidecar is still at placeholder (never rewritten — that is
the entire premise of the crash window) and no `osStartMarker` was ever captured (that is what threw). Fed
through the real function, this would immediately fail check 1 (sidecar mismatch) or check 3 (null marker) and
return `identity_unverifiable` — an incident, not a termination. The corrected text does not name any
alternative mechanism that actually verifies identity in this specific window; "using the in-scope pid the
callback already holds" is, as written, bare-pid signaling with no marker to check it against, which is the
exact class of action the system's own break-glass table (unchanged by this correction,
`ARCHITECTURE.md:643`) lists as **Forbidden** ("signal by pid") in an analogous post-cutover ambiguous-identity
situation. Separately, `local-pty-spawn.ts:111-120` shows a live process handle (`spawnResult.process`) exists
in scope one call frame above the callback at the exact moment `onPtySpawnCommitted` is awaited and could
throw — a handle-based kill (direct object reference, no OS-level identity lookup needed at all) would be
trivially identity-safe and is architecturally available today, but the correction does not propose threading
it through, and does not otherwise reconcile why pid-only signaling is safe here despite `verifyRestartRecoveredIdentity`'s
own "never sufficient" rule. This is precisely the gap the mission asked me to hunt for: the phrase "identity-verified
path" is reused from the general D-5/P9 case (where a marker *was* successfully captured and stored, so the
phrase is meaningful there — see `ARCHITECTURE.md:484`) without acknowledging that `(a′)` is defined by the
marker's absence. **Not closed as a safety-complete correction; the corrected text inherits an underspecified
mechanism from the review's own §6 prescription rather than resolving it.**

**#2 (§7, AD-1/H1 restart-scope boundary) — CLOSED.**

`ARCHITECTURE.md` §10 (the first-controlled-workload section) now contains the exact standalone,
verbatim-testable sentence the review specified: "This restart acceptance is scoped to
`FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` only. It does not establish, and must not be cited as establishing,
`GENERAL_DELEGATED_RESTART_CONVERGENCE`," followed by the H2/gates-7-38-50 milestone sentence
(`ARCHITECTURE.md:612-618`). It is also cross-referenced from AD-1 (`:61`) and mirrored into
`PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md` A-8 (`:198-203`) with matching terminology
(`FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` / `GENERAL_DELEGATED_RESTART_CONVERGENCE`). No reopening of the
H1/H2 split, no new amendment introduced — matches the review's "one paragraph addition ... not a new
amendment" instruction. Fully closed, present in both places the review said it could go, and cited
consistently.

**#3 (§9/§10, D-7/P7b terminal-writer audit) — CLOSED.**

`ARCHITECTURE.md` P7b (`:455-470`) was rewritten from "classify the one cited writer" to the exact ratchet
described by the review: enumerate every `agentRuns.status` writer, all 12 `runner.ts` sites named explicitly
with line numbers, classification into `FENCE_GUARDED` / `PROVEN_UNREACHABLE_FOR_FENCED_RUN` /
`ROUTED_THROUGH_CANONICAL_PROJECTION`, "zero tolerance for `[UNVERIFIED]`," CI-enforced against future writers,
and gates 11/12 explicitly changed from "→ `PRE_LIVE` closed" to "→ `PRE_LIVE_REQUIRED` (not closed) until the
ratchet exists." PL-1 (`:566-571`) was correctly updated to require "a passing result from the P7b
terminal-writer ratchet's classification of every `agentRuns.status` writer," citing the review's §9/§24
distinction between a fence-aware *process* and a fence-aware *every writer in that process* — this is exactly
what the review's §24 asked to have "folded into PL-1." GAP's D-7 row, its narrative prose, and its gate-11/12
table row were all updated to the corrected "12 sites, structurally proven unreachable, ratchet obligation"
framing (`GAP-ANALYSIS.md:107-118, 314-323, 345, 387`). No stale "starting with `runner.ts:195-200`" or
"classify each writer" (singular) language remains in any of the three docs. Fully and consistently closed
across all three documents.

**#4 (§11, A-7 clock-jump sentence) — CLOSED.**

`PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md` A-7 gained clause (vii) (`:178-187`) stating the deadline is
recomputed fresh each pass from durable UTC timestamps, so a wall-clock jump moves only the computed
comparison, never the durable inputs, with the forward/backward cases spelled out and "neither corrupts
durable state or produces a spurious timeout write." This matches the review's required reasoning exactly and
lands where the review said it could ("one sentence in A-7"). Closed.

## 6. Diff-minimality classification

`git diff --stat 8970df4aff... 4a2cddc282...` touches exactly three files, all inside
`src/main/execution/slices/orca-delegated-cutover/`: `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md` (+90/-14 by
stat), `PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md` (+40/-9 by stat), `PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md`
(+14/-1 by stat). No production code, test, schema, or aiControl file appears anywhere in the diff. Every
hunk I read falls into one of:

- **Required correction** — the `(a′)` crash-matrix row and prose (§6/#1), the restart-scope-boundary
  paragraph (§7/#2), the P7b acceptance-criterion rewrite and PL-1 wording (§9/#3), the A-7 clock-jump clause
  (§11/#4).
- **Cross-document consistency propagation** — the header `state_class`/`display_verdict` change on ARCH and
  GAP (both moved from `..._READY_FOR_REVIEW` to `..._CORRECTED_READY_FOR_FOCUSED_REREVIEW`), the
  "Correction provenance" notes added to the top of ARCH and GAP citing `8970df4aff...` by SHA, GAP's mirrored
  D-1/D-2 crash-window mention, GAP's D-7 row/prose/gate-11-12-table rewrite mirroring ARCH's P7b rewrite, and
  AMD's A-8 restart-boundary cross-reference mirroring ARCH §10.
- **Editorial/provenance support** — none beyond what's already counted above; I found no header note or
  cosmetic change that isn't tied to one of the four corrections or its cross-document propagation.

I found zero hunks that constitute an unrelated architecture change. Diff-minimality holds.

## 7. Cross-document consistency findings

All three docs agree, after the correction, on: the AD-2 crash-matrix (5 rows, with `(a′)` present only in
ARCH but referenced consistently from GAP); the P7b acceptance criterion and the 12 `runner.ts` sites (ARCH
and GAP use identical line numbers: 198, 253, 272, 343, 358, 371, 554, 568, 619, 638, 665, 817); gates 11/12 as
`PRE_LIVE_REQUIRED` in both ARCH's P7b block and GAP's gate table; the restart-scope-boundary terminology
(`FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` / `GENERAL_DELEGATED_RESTART_CONVERGENCE`) verbatim in both ARCH §10
and AMD A-8; the A-7 clock-jump reasoning present only in AMD (as the review specified) with ARCH's own A-7
references unchanged and not contradicting it; the DAG, slice plan, R3 definition, activation checklist
(beyond the PL-1 edit), first-controlled-workload scenarios, break-glass table, gate-status matrix, and
single-authority invariant are all untouched by the diff and I found no hunk that silently altered any of them.
I found no stale pre-correction wording left in any of the three docs that now contradicts a corrected section
(explicitly checked for "three durable states"/"three-state"/"classify each writer" residue — none found
outside of the one place ARCH itself uses "three-state enumeration" to correctly describe what it superseded).
The one substantive inconsistency I did find is not a *cross-document* disagreement but an *internal* one
within the corrected AD-2 text itself, detailed in §5/#1 above: the `(a′)` row's own "Forbidden" column
("signal without identity verification") is in tension with its "Legal next action" column (bare-pid signaling
with no marker to verify against), and this tension is not resolved anywhere in any of the three docs.

## 8. Guard re-verification

- `git -C aiControlCenter rev-parse origin/master` == `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`, matching the
  pinned SHA; nothing under that repository was touched (confirmed no `aiControlCenter` path appears in
  `git diff --stat 1f70bdf499... 4a2cddc282...`).
- Operational-state markers (`AICONTROL_NATIVE` / `ORCA_DELEGATED` NOT STARTED / fence acquisition DISABLED /
  R3 NOT STARTED / M5 NOT STARTED) are present, unchanged, and mutually consistent across all three corrected
  docs (verified by direct grep of all three files).
- No frozen prior SPEC document (anything outside the three candidate docs and the review artifact) was
  modified by the correction commit — the diff's file list is exactly the three candidate docs.

## 9. Verdict

Three of the four corrections identified in `8970df4aff...` (#2 restart-scope boundary, #3 P7b terminal-writer
audit, #4 A-7 clock-jump) are fully and correctly closed, consistently across all three documents, with no
unintended changes and full diff-minimality. Correction #1 (§6, the B-1/AD-2 crash-window fix — the one
correction that is explicitly about safe process/identity teardown) is only textually closed: the corrected
AD-2 `(a′)` row reproduces the review's own prescribed language almost verbatim, but that language, checked
against the real `verifyRestartRecoveredIdentity`/`resolveProcessTermination` mechanism it invokes by name,
describes an identity check that cannot succeed in the exact window it is meant to cover (no sidecar rewrite,
no OS start marker exist at that point by construction), and the corrected text does not name any alternative,
actually-identity-safe mechanism (e.g., a live process-handle reference, available one call frame away in
`local-pty-spawn.ts`, that would not depend on the marker at all). This is a genuine, code-verified gap, not a
nitpick: the system's own unrelated break-glass table already treats "signal by pid" as Forbidden elsewhere,
underscoring that pid-only signaling is not a mechanism this design otherwise accepts as identity-safe.

```
state_class:     ARCHITECTURE_CHANGES_REQUIRED
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_FOCUSED_REREVIEW_CHANGES_REQUIRED
```

**Smallest required delta** (to close correction #1 completely): in
`PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md`'s AD-2 `(a′)` row and its supporting prose (§ "Legal durable
states" table and the paragraph beginning "`(a′)` is a real, reachable window"), replace "terminate the
process via the identity-verified path, using the in-scope pid the callback already holds" with a mechanism
that is actually well-defined at that point in the flow — for example: (a) explicitly state that `(a′)`
termination uses a **live process-handle reference** (not an OS pid lookup), threaded from `local-pty-spawn.ts`'s
`spawnResult.process` into the capture box or callback closure alongside the pid, so no marker/sidecar
comparison is needed at all (identity-safe by direct object reference); or (b) if pid-only signaling is
intentionally accepted for this narrow, same-process, sub-second-to-3-second window, say so explicitly, name
the specific reasoning that makes it safe despite the codebase's general "pid alone is never sufficient" rule
recorded in `restart-recovered-identity-verification.ts`, and reconcile it with the same `(a′)` row's own
"Forbidden: signal without identity verification" language, which as currently worded contradicts the row's own
"Legal next action." Either fix is a docs-only, few-sentence change confined to AD-2; it does not require
reopening the DAG, the slice plan, or any other amendment.

Do not freeze until this is resolved. Do not enable fence acquisition, start R3, or activate `ORCA_DELEGATED`
regardless of this verdict — those remain separate, later authorizations. `ORCA_DELEGATED` NOT STARTED. Fence
acquisition DISABLED. R3 NOT STARTED. M5 NOT STARTED.

STOP.
