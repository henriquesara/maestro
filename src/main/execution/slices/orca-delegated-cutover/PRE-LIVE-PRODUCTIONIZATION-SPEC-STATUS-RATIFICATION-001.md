# ORCA-S5 PRE_LIVE Productionization — Architecture Status Ratification (Freeze)

> Lifecycle / freeze / errata artifact only. Introduces no new architecture semantics and is not a new
> architecture version. Does not modify `PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md`,
> `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md`, `PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md`, `SPEC.md`, or any
> review artifact. Implements no code, adds no test, schema or migration, does not touch aiControl, does not
> start P1 or any other P-slice, enables no fence acquisition, starts no `ORCA_DELEGATED`/R3/M5 work, and is
> not itself published. Follows the precedent of `SPEC-STATUS-RATIFICATION-001.md` (`caf1526729`).

```
state_class:     ARCHITECTURE_FROZEN_READY_FOR_INDEPENDENT_FREEZE_VERIFICATION
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_FROZEN_READY_FOR_REVIEW
```

## 1. Architecture identity

- **Namespace / title:** ORCA-S5 PRE_LIVE Productionization — Architecture & Slice Plan
  (`PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md`), with its companion gap analysis
  (`PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md`) and amendment candidate
  (`PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md`, items `S5-PL-A1…A8`).
- **Normative PRE_LIVE architecture content HEAD:** `743458076769911cfe1fa5193f7c38ec4610ffee`.
  This is the exact semantic content independently accepted. The three normative documents are read **as
  they are at that commit**.
- `bded65ec343ccc509ff5ef7feb0eefe22373ee99` (and this ratification commit after it) contain review evidence
  and lifecycle metadata only. Being later in Git history does **not** move the semantic-content identity.

## 2. Accepted lineage (verified this session)

Every hop single-parent, no merge, no rewritten commit (`git log -1 --format="%H %P"` on each):

```
1f70bdf4992ae920aed56de905edb0463faa8657  canonical public base (origin/main)
→ dfb1235673cba63242d2bd15a347415a86e678c4  discovery: gap analysis, slice plan, amendment candidate
→ 8970df4affaf80227a819a1efe2ae9b0f9945213  valid independent architecture review (ARCHITECTURE_CHANGES_REQUIRED)
→ 4a2cddc2825c3ee150a4b4ef0493905755e16277  corrected architecture
→ e0cb37e6ebd734b7b827fea8fd386567e89f17f8  valid focused rereview (3 of 4 closed; AD-2 a′ open)
→ 743458076769911cfe1fa5193f7c38ec4610ffee  AD-2 (a′) correction — NORMATIVE CONTENT HEAD
→ bded65ec343ccc509ff5ef7feb0eefe22373ee99  final independent AD-2 rereview (acceptance)
→ (this commit)                             status ratification / freeze
```

No remote branch contains `743458076769911cfe1fa5193f7c38ec4610ffee` or `bded65ec…` (unpublished).

**Quarantine.** `56a0a2ed79f323fa2223f5c1f549ac3c15b4e60d` remains **INVALID_REVIEW_LINEAGE /
NON_AUTHORITATIVE / SUPERSEDED**. It is not an ancestor of `bded65ec…` (`git merge-base --is-ancestor`
false), is not part of the normative review chain, and no architecture rule is derived from it.

## 3. Acceptance authority

Final acceptance artifact: `PRE-LIVE-PRODUCTIONIZATION-AD2-FINAL-REREVIEW.md` at
`bded65ec343ccc509ff5ef7feb0eefe22373ee99` (blob `be22a0f4400a21108b92d777e47762f1cd7cc4e1`), read directly
this session. It records:

```
state_class:                          ARCHITECTURE_ACCEPTED_READY_TO_FREEZE
display_verdict:                      ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_ACCEPTED_READY_TO_FREEZE
accepted_architecture_candidate_head: 743458076769911cfe1fa5193f7c38ec4610ffee
AD-2 marker-capture blocker:          CLOSED
all four findings of valid review:    CLOSED (AD-1/H1, D-7/P7b+PL-1, A-7, AD-2 a′)
Implementation:                       NOT AUTHORIZED YET
```

Evidence chain (non-normative; records how the content reached acceptance):
1. `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE-REVIEW.md` (`8970df4a…`) — review evidence.
2. `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE-FOCUSED-REREVIEW.md` (`e0cb37e6…`) — focused rereview evidence.
3. `PRE-LIVE-PRODUCTIONIZATION-AD2-FINAL-REREVIEW.md` (`bded65ec…`) — acceptance verdict.
4. This document — freeze/lifecycle state and errata only.

None of 1–4 is a source of architecture semantics. Where any restates the architecture, the text at
`743458076769911cfe1fa5193f7c38ec4610ffee` controls. A real conflict is `CONTRACT_CONFLICT` → architecture
correction, never a silent edit.

## 4. Candidate headers — superseded, not edited

`PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md` still opens with "Candidate architecture; **not frozen, not
independently reviewed, authorizes no implementation.**" and a `state_class:
ARCHITECTURE_CORRECTED_READY_FOR_FOCUSED_REREVIEW` block. That text was accurate when written and is not
retracted; as with the S5 Delegated Cutover freeze (`SPEC-STATUS-RATIFICATION-001.md` §2), it is
**superseded** by the acceptance chain in §3 and this ratification. Lifecycle state is tracked by this
evidence chain, not by re-editing candidate headers, so no accepted-content mutation is required
(no `FREEZE_REQUIRES_ACCEPTED_CONTENT_MUTATION`).

**Byte identity (verified, `git rev-parse <commit>:<path>`):** at this ratification's parent, each file below
has the identical blob to `743458076769911cfe1fa5193f7c38ec4610ffee`, and this commit does not touch them:

| File | Blob | vs `7434580767` |
| --- | --- | --- |
| `PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md` | `3f2f6e95fb6af6d255e3f7138ad2e2f2dab49c0a` | identical |
| `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md` | `b539dc8769ffc32389b60b44bf6d545ce955da3a` | identical |
| `PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md` | `d65e9b1cd645ab4cadd3e797f274b422b1a92c86` | identical |
| `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE-REVIEW.md` | `fcd0530526af15b71c77366c49f845a93f3c73dc` | identical |
| `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE-FOCUSED-REREVIEW.md` | `2ce9b4d8b3de8f19e774bbb84138da746d3f7f47` | identical |
| `SPEC.md` (frozen S5 Delegated Cutover) | `f155a909e661ec96a929e05884ddda393fedad2e` | identical; last changed `627b00b0b7` |

## 5. Freeze state

```
PRE_LIVE productionization architecture:
  FROZEN
  INDEPENDENTLY ACCEPTED
  IMPLEMENTATION-AUTHORIZED AFTER FREEZE PUBLICATION
NOT  LIVE-AUTHORIZED
NOT  PRE_LIVE-COMPLETE
NOT  ORCA_DELEGATED-ACTIVE
```

Implementation authorization state **now**: **NOT AUTHORIZED**. It becomes authorized only after (1) this
freeze is independently verified and (2) the accepted freeze chain is published.

## 6. Non-blocking errata and obligations (from the final rereview §20)

None changes AD-2 or any other accepted semantics. None reopens Mechanism A/B, permits pid-only signalling,
dual execution, or a cutover after a pre-commit failure.

### N-1 — Marker-capture wording — NON_SEMANTIC SOURCE-ACCURACY CLARIFICATION

AD-2 says the cutover callback "does the marker capture that can throw". At the content HEAD,
`captureOsStartMarkerSync` (`process-instance-discriminator.ts:36-62`) catches its internal errors on every
platform and returns `{ osStartMarker: null, osStartMarkerSource: 'unavailable' }`.

- A **soft** `unavailable` result is the frozen S4 **L13** window: commit is legal, and restart verification
  is unconditionally `identity_unverifiable`. It follows that already-defined soft-failure path.
- AD-2 state **(a′)** applies only when a **real exception escapes** in the pre-commit window after spawn —
  e.g. from the surrounding callback/composition path (such as the P1-introduced sidecar rewrite) or the fault
  injection P1 RED (3) mandates.
- **soft `unavailable` ≠ escaping exception.** Ordinary marker-unavailable is **not** state (a′) and must not
  be reinterpreted as such. AD-2 semantics are unchanged; Mechanism A remains the disposition for any escaping
  pre-commit exception.

### N-2 — "§12 below" — EDITORIAL CROSS-REFERENCE ERRATUM

AD-2 "Cleanup failure" calls the unresolved pre-cutover cleanup failure "a P1 `LIVE_PROOF_REQUIRED`/
observability obligation (§12 below)". §12 of the architecture is **M5**, which is unrelated. The accepted
text does not name the intended target unambiguously: the final rereview offered §11 row 1 / §9 as plausible
readings, which is two candidates, not one. Therefore **no target is asserted**: the cross-reference is
recorded as **invalid**, and P1 must rely on the explicit cleanup-failure semantics in AD-2 itself
(`delegation_cutover` uncommitted; workload unreleased; fail closed; no `ORCA_DELEGATED`; no pid-only retry;
no native fallback; no new persisted incident kind or table). The paragraph's operative content is complete
without the reference. No semantic change.

### N-3 — Break-glass paraphrase — NORMATIVE WORDING CLARIFICATION

AD-2 "Break-glass consistency (§11)" quotes `"Signal without reconstructed identity: Forbidden"`. That is
explanatory paraphrase. The exact accepted wording is:

- §11 table, row "After cutover the process identity becomes unverifiable", column *Operators MUST NOT*:
  **"signal by pid"** (also quoted verbatim in AD-2 at line 97: "(§11) already lists as **Forbidden** ("signal
  by pid")").
- AD-2 crash-matrix row (b), forbidden column: **"signal without identity verification"**.

The normative prohibition is the exact accepted §11 rule. This clarification neither broadens nor narrows
break-glass semantics; Mechanism A is still not an exception to it.

### N-4 — node-pty live-handle teardown — P1 IMPLEMENTATION / RED OBLIGATION (non-blocking to freeze)

`pty.IPty` is not a Node `ChildProcess`, so P1 must not assume S4's existing `ChildProcess` teardown helper
(`signalProcessTree(handle)`) can be reused unchanged. P1 must independently prove:

1. the exact API invoked on the live `IPty` handle;
2. exact same-object continuity from `spawnShellWithFallback` → `spawnResult.process` to the teardown call;
3. no pid rediscovery;
4. the operation happens only while the process has not already exited (gated on the handle's own state);
5. no signal can reach a recycled pid;
6. the platform behaviour needed for the first workload (Windows, Linux).

The final rereview did not verify node-pty internals. If `kill()` internally signals by pid, P1 must prove why
live-handle continuity and timing still make the AD-2 safety claim valid, or **stop for architecture
correction**. This freeze does not resolve that question.

### N-5 — "cleanup uncertain → block retry" durability — H2 / PRE_LIVE MEASUREMENT AND ARCHITECTURE-REVALIDATION OBLIGATION

The retry block for an uncertain Mechanism-A cleanup is not durably stored (AD-2: "not a new persisted
incident kind or table"), and the placeholder sidecar carries no pid. Across a host restart this relies on the
H1 assumption that in-process node-pty children die with the host (architecture §13 item 5,
`[UNVERIFIED]`).

- For the **first controlled workload** the accepted narrow H1 boundary (§10,
  `FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE`) is preserved unchanged.
- Before H2 / `GENERAL_DELEGATED_RESTART_CONVERGENCE`, proof or additional architecture is required for:
  process survival after host crash; orphan detection; durable retry blocking if a child may survive the host;
  safe recovery without pid-only control.
- **N-5 is not solved by this freeze.**

### Matrix

| # | Type | Freeze impact | Owner / next slice | Required before |
| --- | --- | --- | --- | --- |
| N-1 | NON_SEMANTIC_CLARIFICATION | freeze allowed | P1 | any P1 implementation or RED assertion that depends on the soft-`unavailable` vs escaping-exception distinction |
| N-2 | EDITORIAL_ERRATUM | freeze allowed | P1 / docs | any implementation that relies on the cross-reference (use AD-2's explicit text instead) |
| N-3 | NORMATIVE_WORDING_CLARIFICATION | freeze allowed | P1 | P1 static/dynamic no-pid-signal checks — use the exact §11 rule ("signal by pid") |
| N-4 | P1_IMPLEMENTATION_OBLIGATION | freeze allowed | P1 | P1 acceptance |
| N-5 | H2_PRELIVE_MEASUREMENT_OBLIGATION | freeze allowed under the first-workload H1 boundary | later productionization / H2 | general delegated restart readiness (`GENERAL_DELEGATED_RESTART_CONVERGENCE`) |

## 7. Amendment disposition (ratified as accepted; semantics unchanged)

Per the valid review's disposition table (`8970df4a…` `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE-REVIEW.md`
§"A-n" table) and the A-7 closure in `e0cb37e6…` (#4, AMD A-7 clause (vii), clock-jump):

| Item | Disposition |
| --- | --- |
| A-1 termination confirmation | REQUIRED — FROZEN AS ACCEPTED |
| A-2 settlement not-applicable (delegated) | REQUIRED — FROZEN AS ACCEPTED |
| A-3 provenance / run-identity binding | REQUIRED — FROZEN AS ACCEPTED |
| A-4(a) identity producer clarification | REQUIRED — FROZEN AS ACCEPTED (§6 crash-window work in P1 scope, not the amendment text) |
| A-4(b) recycled pid ⇒ original gone | **NOT_REQUIRED for the first workload; correctly optional** (liveness refinement, no signal path; P1 ships without it) |
| A-4(c) macOS signal-grade | **DEFERRED** (first workload excludes macOS) |
| A-5 exit evidence source | REQUIRED — FROZEN AS ACCEPTED |
| A-6 transport / ack gating | REQUIRED — FROZEN AS ACCEPTED |
| A-7 timeout policy | REQUIRED — FROZEN AS CORRECTED (clause (vii) clock-jump) |
| A-8 provider/host scope | REQUIRED — FROZEN AS ACCEPTED (with the §10 restart-boundary sentence) |

The amendment candidate is frozen at the content HEAD. The frozen S5 `SPEC.md` is not edited; where an
amendment changes frozen S5/S4 text, the amendment document as of `7434580767` is the controlling statement
for that delta.

## 8. DAG / slice plan

The dependency DAG (§3), critical path (§4) and slice plan P0…P12 (§5) at the content HEAD are accepted as
**implementation-sequencing architecture**, unchanged. P1 — Real Process Identity Production — is the first
implementation slice after freeze publication. **No P-slice is started by this commit.**

Note for the freeze verifier (recorded, not resolved): the plan lists P1's prereq as "P0", and P0 is
"Decisions & amendments ratification" whose outputs include product decisions §13 lists as still open
(timeout owner/value, `G`/`H`, AD-9 host-quit, ingress / fence-token generator). This ratification covers
P0's architecture-and-amendment output (the accepted AD set, A-1…A-8 disposition above); it decides **no**
product value. Those product decisions gate their consuming slices (P3, P6b, P10 per the plan) and remain
open.

## 9. P1 authorization boundary

After this freeze is independently verified **and** the accepted freeze chain is published, P1 may begin.
P1 must carry every accepted RED obligation in its §5 entry, including the ten AD-2 (a′) cases (1)–(10), and
must additionally account for N-1, N-2, N-3 and N-4 (§6). N-5 remains a later H2 / general-restart
obligation unless P1 evidence changes its classification. P1 keeps fence acquisition disabled (R-4).

## 10. Authority invariant (restated, unchanged)

- Before `delegation_cutover` COMMIT: `AICONTROL_NATIVE`.
- After COMMIT, for the delegated run: `ORCA_DELEGATED`.
- aiControl after delegated cutover: copy / projection only.
- No fallback. No dual execution authority. No dual terminal authority.

## 11. PRE_LIVE / LIVE distinction

This freeze is **not** `PRE_LIVE_COMPLETE` and **not** `LIVE_READY`. Outstanding per the accepted
architecture: implementation and deployment slices P1…P12, and the PL-1…PL-20 PRE_LIVE checklist (§9), none of
which is satisfied by this commit. Fence acquisition remains **DISABLED**.

## 12. Docs-only proof

This commit's diff against `bded65ec343ccc509ff5ef7feb0eefe22373ee99` adds exactly this file. Zero `.ts`,
`.tsx`, `.js`, `.mjs`, JSON schema, test, migration or production changes. No accepted document or review
artifact is modified.

## 13. aiControl guard (read-only)

`origin/master == ab5967bdde5115afe6673e8b520a73cfb29f0eaf`; `data/app.db` SHA-256
`2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`; no `-wal`/`-shm`/`-journal`. Nothing under
aiControl and no unrelated AGENTS/ai-memory state was modified.

## 14. Operational state — unchanged before and after

Authority `AICONTROL_NATIVE` · `ORCA_DELEGATED` **NOT STARTED** · Fence acquisition **DISABLED** · R3 **NOT
STARTED** · M5 **NOT STARTED** · P1 **NOT STARTED** · Publication: **NOT PUBLISHED**.
