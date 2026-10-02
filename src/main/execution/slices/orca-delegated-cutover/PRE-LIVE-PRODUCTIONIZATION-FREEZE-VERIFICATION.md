# ORCA-S5 — PRE_LIVE PRODUCTIONIZATION ARCHITECTURE — FRESH INDEPENDENT FREEZE VERIFICATION

```
state_class:     ARCHITECTURE_FROZEN_READY_FOR_PUBLICATION
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_FREEZE_VERIFIED_READY_FOR_PUBLICATION
normative_architecture_content_head: 743458076769911cfe1fa5193f7c38ec4610ffee
freeze_ratification_head:            5bc243d169201b71b7a02944ede8e141d7129c75
verified_on_base:                    1f70bdf4992ae920aed56de905edb0463faa8657 (origin/main, unchanged)
```

Freeze verification only. This document redesigns nothing, edits no candidate, review, ratification, or SPEC
text, authorizes no implementation by itself, and publishes nothing. It is the only file added by its commit.

| State | Value |
| --- | --- |
| PRE_LIVE architecture | **FROZEN / INDEPENDENTLY ACCEPTED** |
| P1 | **AUTHORIZED ONLY AFTER PUBLICATION** of this freeze lineage |
| Current implementation | **NOT STARTED** |
| Live activation | **NOT AUTHORIZED** |
| `ORCA_DELEGATED` | **NOT STARTED** |
| Fence acquisition | **DISABLED** |
| R3 | **NOT STARTED** |
| M5 | **NOT STARTED** |

---

## 1. Independence

- This verification ran in a new worktree, `C:/mw-orca-s5-freeze-verification`, on branch
  `review/orca-s5-prelive-freeze-verification`, created at `5bc243d1`.
- This session wrote none of the following: the discovery `dfb12356`, the review `8970df4a`, the correction
  `4a2cddc2`, the focused rereview `e0cb37e6`, the normative content `7434580`, the AD-2 final rereview `bded65ec`
  (a separate session, worktree `C:/mw-orca-s5-ad2-final-rereview`), or the ratification `5bc243d1`.
- The primary checkout is at `56a0a2ed` on `orca-s2-durable-settlement-observation`. It was not read as evidence
  and was not modified.
- Every claim below was re-derived with `git` (rev-list, ls-tree, diff, cat-file) and by reading the files. No
  conclusion is taken from an earlier document's self-description.

## 2. Lineage (re-derived)

```
1f70bdf4 (base, origin/main)
 └ dfb12356  discovery
   └ 8970df4a  independent review
     └ 4a2cddc2  correction
       └ e0cb37e6  focused rereview
         └ 74345807  AD-2 correction  ← normative content HEAD
           └ bded65ec  AD-2 final rereview (ACCEPTED_READY_TO_FREEZE)
             └ 5bc243d1  status ratification  ← freeze ratification HEAD
```

- `git rev-list --parents 1f70bdf4..5bc243d1` returns exactly 7 commits. Each has one parent and none is a merge.
- `origin/main` is still `1f70bdf4`, so the base has not moved.
- `5bc243d1` exists only on the local branch `review/orca-s5-prelive-ad2-final-rereview`. No remote branch
  contains it, so it is **unpublished**.
- Every commit's author is the repository owner.

## 3. Quarantine of `56a0a2ed` (INVALID review)

- `56a0a2ed` has parent `6e8bd452` and is **not** an ancestor of `5bc243d1`
  (`merge-base --is-ancestor` fails).
- No blob, citation, or verdict from it reaches the freeze lineage.
- **QUARANTINED: CONFIRMED.**

## 4. Freeze diff

| Range | Result |
| --- | --- |
| `bded65ec → 5bc243d1` | exactly 1 file added: `PRE-LIVE-PRODUCTIONIZATION-SPEC-STATUS-RATIFICATION-001.md` (+264 / −0). No modification, deletion, or rename. |
| `7434580 → 5bc243d1` | only 2 files added: `…-AD2-FINAL-REREVIEW.md` and `…-SPEC-STATUS-RATIFICATION-001.md`. |
| `1f70bdf4 → 5bc243d1` | only the 7 `PRE-LIVE-*` documents in `orca-delegated-cutover/`. Nothing outside that directory, and no source, test, schema, or SPEC change. |

The freeze is **strictly additive metadata** on top of the normative content.

## 5. Normative identity

The blob hashes below are identical at `7434580`, `bded65ec`, and `5bc243d1`:

| Document | Blob |
| --- | --- |
| `PRE-LIVE-PRODUCTIONIZATION-GAP-ANALYSIS.md` | `3f2f6e95…` |
| `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md` | `b539dc87…` |
| `PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md` | `d65e9b1c…` |
| `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE-REVIEW.md` | `fcd05305…` |
| `PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE-FOCUSED-REREVIEW.md` | `2ce9b4d8…` |

Because these blobs are byte-identical, the normative architecture content is exactly the content at
`743458076769911cfe1fa5193f7c38ec4610ffee`. **NORMATIVE IDENTITY: PROVEN.**

## 6. Acceptance authority

- `PRE-LIVE-PRODUCTIONIZATION-AD2-FINAL-REREVIEW.md` (`bded65ec`, blob `be22a0f4…`, unchanged at `5bc243d1`)
  records `ARCHITECTURE_ACCEPTED_READY_TO_FREEZE` /
  `ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_ACCEPTED_READY_TO_FREEZE` with
  `accepted_architecture_candidate_head 7434580…`.
- It closes the AD-2 `(a′)` blocker that the focused rereview `e0cb37e6` had left open (`ARCHITECTURE_CHANGES_REQUIRED`).
  That rereview had already closed #2 (the AD-1/H1 restart boundary), #3 (the P7b/PL-1 ratchet), and #4 (the A-7
  clock-jump sentence).
- The acceptance came from a session that did not author `7434580`, and it names exactly the content proven in §5.
- **ACCEPTANCE AUTHORITY: VALID.**

## 7. Ratification semantics

- The ratification states only what the evidence supports: that the normative HEAD is `7434580` and that
  later commits are metadata. It quotes the acceptance verdict. It also says that the `7434580` text controls,
  and that any conflict between it and the ratification is a `CONTRACT_CONFLICT`.
- It does **not** add behaviour. Its §6 N-items only resolve how existing wording is read (see §9 below), and
  each one either restates frozen text or defers to it.
- Its self-declared state, `ARCHITECTURE_FROZEN_READY_FOR_INDEPENDENT_FREEZE_VERIFICATION`, correctly withholds
  publication and implementation authority until this verification passes.
- **Reading note (not a defect).** Ratification §5 says "IMPLEMENTATION-AUTHORIZED AFTER FREEZE PUBLICATION".
  Its §8 and §9 bound that phrase to **P1 only**, and this verification adopts that reading (see §12).

## 8. Candidate headers

GAP, ARCH, and AMD still carry their "Candidate. Not frozen …" headers. Ratification §4 declares those headers
**superseded, not edited**, which is exactly what the "do not modify accepted docs" rule requires. Editing them
would itself break blob identity (§5).

**HEADER VERDICT: ACCEPTABLE.** The freeze status lives in the ratification and in this verification. The
header text is historical, and no reader should take it as the current state.

## 9. N-1 … N-5 classifications

| N | Subject | Classification | Verified against |
| --- | --- | --- | --- |
| N-1 | A soft `unavailable` result from `captureOsStartMarkerSync` (L13) is not the escaping exception of `(a′)` | **NON_SEMANTIC_CLARIFICATION**. It restates the frozen distinction and adds no state. | ARCH AD-2 table and Mechanism A/B prose; AD2-FINAL-REREVIEW §20 |
| N-2 | ARCH AD-2's "(§12 below)" cleanup-failure cross-reference has no valid target | **EDITORIAL_ERRATUM**. AD-2's explicit text governs, and no behaviour depends on the reference. | ARCH line ~133; §12 is the M5 section |
| N-3 | Break-glass wording | **Exact §11 wording preserved**: row 2's MUST NOT entry "signal by pid", together with AD-2's "signal without identity verification", is normative. The paraphrase "Signal without reconstructed identity: Forbidden" does not replace it. (The ratification's matrix label NORMATIVE_WORDING_CLARIFICATION is compatible.) | ARCH §11 table; ARCH line ~97, ~150 |
| N-4 | node-pty `kill()` must be proven not to signal a bare, unverified pid | **P1_IMPLEMENTATION_OBLIGATION**. P1 must carry the proof. If it cannot be shown safe, P1 stops for an architecture correction and does not improvise. | AD2-FINAL-REREVIEW §20 ("not re-verified"); ratification §6 N-4 |
| N-5 | Host-exit survival, orphan detection, durable retry blocking, and safe recovery under H2 | **H2 / GENERAL-RESTART PRE_LIVE OBLIGATION**. The H1 / `FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` boundary stays as frozen, and this freeze does not solve N-5. (Ratification label: H2_PRELIVE_MEASUREMENT_OBLIGATION.) | ARCH §10, §13 [UNVERIFIED]; REVIEW §27/§42 |

None of the five changes frozen semantics, so **N-1…N-5: PASS**.

## 10. Amendment disposition

| Amendment | Frozen disposition | Gates |
| --- | --- | --- |
| A-1 termination confirmation | REQUIRED, as accepted | P3 (needs G/H values) |
| A-2 settlement not applicable | REQUIRED, as accepted | P5 |
| A-3 provenance / run-identity binding | REQUIRED, as accepted | P4, P5 |
| A-4(a) identity sidecar producer | REQUIRED, as accepted | **P1** |
| A-4(b) recycled pid ⇒ `confirmed_dead_unknown_cause` | **NOT_REQUIRED / optional.** P1 ships without it, and the frozen `identity_unverifiable` mapping applies. | — |
| A-4(c) macOS signal-grade proof | **DEFERRED.** macOS is excluded from the first workload. | later |
| A-5 exit evidence source | REQUIRED, as accepted | P2 |
| A-6 aiControl delegation API / ack gating | REQUIRED, as accepted | P8s, P8c (auth mechanism) |
| A-7 timeout policy | REQUIRED, **as corrected** (clause vii, clock-jump) | P6b (value + owner) |
| A-8 provider/host scope | REQUIRED, as accepted (H1) | P0 / AD-1 |

**Observation O-1 (non-blocking).** The AMD summary table's "Blocks" column lists A-4 as "P1 (a, b)". The A-4(b)
body says "(optional …)". Both the REVIEW §41 disposition and ratification §7 freeze (b) as not required for P1.
The accepted disposition controls, so P1's frozen baseline excludes A-4(b). If P1 chose to implement (b), it
would change frozen S4 §9.3 behaviour and would need its own accepted amendment. No docs change is needed.

**AMENDMENTS: CONSISTENT.**

## 11. DAG and the P0 → P1 dependency audit

The DAG at ARCH §3 is unchanged. REVIEW §20–21 found it correct, and P1 is the first slice after publication.

In the ARCH §5 P0 row, P0 is the set of decisions and amendments, and it "blocks every other slice". The audit
below splits P0's outputs by what each one actually gates, using each slice's own prereq column:

**P0_REQUIRED_BEFORE_P1 — all SATISFIED by this freeze:**

| Output | Status |
| --- | --- |
| AD-1 host = H1 (A-8) | Accepted as sound (REVIEW §5); H1 boundary closed (e0cb37e6 #2) |
| AD-2 crash matrix incl. `(a′)`, Mechanisms A/B | Accepted (bded65ec) |
| A-4(a) producer | REQUIRED_AS_WRITTEN |
| A-4(b) disposition | NOT_REQUIRED; P1 asserts `identity_unverifiable` |
| Superseded-RED list (R-2) as it touches P1 | Frozen in ARCH P1 RED list (the ten `(a′)` obligations) plus N-1…N-4 |

P1's inputs (ARCH §5) are pid, ptyId, incarnationId, the start marker, correlationId, orcaDispatchId, and the
nonce. **No timeout, G/H, quit, ingress, or token input appears among them.**

**P0_REQUIRED_ONLY_BEFORE_LATER_SLICE — OPEN, and correctly not decided by this freeze:**

| Output | Gates (ARCH §5 prereq column) |
| --- | --- |
| G/H escalation values (AD-4 / A-1) | P3. REVIEW: "frozen before P3's RED, not before P0" |
| Timeout owner and value (AD-8 / A-7) | P6b. With no default, ingress refuses a delegated run |
| Quit policy (AD-9) | later product decision |
| Ingress shape and fence-token generator owner (D-2) | P10 |
| A-6 auth mechanism | P8s / P8c |
| stdout/stderr product choice | later |
| [UNVERIFIED] platform measurements (node-pty host-exit survival, etc.) | PL-4 / PL-14. REVIEW §27/§42: not load-bearing for P0 |

Ratification §8 records exactly this: no product value is decided here, and each one gates its consuming slice.
**`P0_PARTIAL_FOR_P1`: SATISFIED. `P0_GLOBAL`: NOT COMPLETE.** This is consistent with the frozen text and is not
a reinterpretation of it.

## 12. P1 authorization boundary

- **P1 VERDICT: AUTHORIZED ONLY AFTER PUBLICATION** of `5bc243d1` plus this verification. P1 is not authorized
  before publication.
- P1 scope is A-4(a) sidecar production. It carries the ten AD-2 `(a′)` RED obligations and N-1…N-4, uses
  H1 only, and excludes A-4(b) and A-4(c).
- N-4 is a stop condition. If node-pty `kill()` signals a bare pid and that cannot be shown safe, P1 halts for
  an architecture correction.
- P1 does not enable fence acquisition, does not supply production ingress, does not activate `ORCA_DELEGATED`,
  and does not touch aiControl.

## 13. No later-slice authorization

P2…P12 (including P3, P5, P6b, P7b, P8s/P8c, P9, and P10) are **NOT AUTHORIZED** by this freeze or by its
publication. Each one stays governed by its own ARCH §5 prereqs, its product inputs (§11), and the ARCH §1 rules.
Neither the ratification's §5 phrase nor this document widens that.

## 14. PRE_LIVE state

PL-1 … PL-20 (ARCH §9) are all **UNSATISFIED**. PL-1 now references the P7b all-writers ratchet, and gates 11/12
stay `PRE_LIVE_REQUIRED`. N-5 adds an H2 obligation to the PRE_LIVE / general-restart work. The architecture is
**NOT PRE_LIVE_COMPLETE** and **NOT LIVE**.

## 15. Authority invariant (unchanged)

| Window | Run authority | aiControl role |
| --- | --- | --- |
| Before the `delegation_cutover` COMMIT | `AICONTROL_NATIVE` | owner |
| After it | `ORCA_DELEGATED` (Orca) | **projection only** |

There is no dual authority and no fallback. Rollback or fallback belongs to M5, which is not started.

## 16. M5

ARCH §12 records M5 as **NOT STARTED**. Nothing in the freeze lineage starts it or designs it.

## 17. Frozen SPEC

`SPEC.md` has blob `f155a909…` at both `1f70bdf4` and `5bc243d1`, last changed at `627b00b0b7` (the accepted S5
architecture HEAD). No S1–S4 SPEC was touched. Amendments remain *candidates for adoption* as
`SPEC-AMENDMENT-001.md`. They do not edit the SPEC in place. **FROZEN SPEC: UNCHANGED.**

## 18. aiControl guard (read-only)

All checks ran in `C:/Users/henrique/Documents/aiControlCenter`:

| Check | Expected | Observed |
| --- | --- | --- |
| `origin/master` (after fetch) | `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` | `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` ✔ |
| `data/app.db` SHA-256 | `2dc6f32a…0a45088` | `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` ✔ |
| WAL / SHM / journal | none | none ✔ |
| `ORCA_FENCE_ACQUISITION_ENABLED` in `.env*` | absent/disabled | absent ✔ |

Nothing in aiControl was written. Its pre-existing local working-tree state was left untouched.

## 19. Operational state

- **Publication:** NOT PUBLISHED. `5bc243d1` and this commit are local only, and nothing was pushed.
- **Implementation:** NOT STARTED.
- **Live:** NOT AUTHORIZED.
- **`ORCA_DELEGATED`:** NOT STARTED.
- **Fence:** DISABLED.
- **R3:** NOT STARTED.
- **M5:** NOT STARTED.

## 20. Verdict

All checks pass:

- lineage is linear and verified
- `56a0a2ed` is quarantined
- the freeze diff is additive
- normative identity is pinned to `7434580`
- acceptance authority is valid
- the ratification adds no semantics
- the candidate headers are superseded rather than edited, which is acceptable
- N-1…N-5 are classified as expected
- amendments are consistent (O-1 is non-blocking)
- the DAG is unchanged
- P0 is complete for P1 and correctly open for later slices
- P1 is bounded, and no later slice is authorized
- PRE_LIVE is not complete
- the authority invariant holds
- M5 is not started
- the SPEC is unchanged
- the aiControl guard holds

```
state_class:     ARCHITECTURE_FROZEN_READY_FOR_PUBLICATION
display_verdict: ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_FREEZE_VERIFIED_READY_FOR_PUBLICATION
normative_architecture_content_head: 743458076769911cfe1fa5193f7c38ec4610ffee
freeze_ratification_head:            5bc243d169201b71b7a02944ede8e141d7129c75
```
