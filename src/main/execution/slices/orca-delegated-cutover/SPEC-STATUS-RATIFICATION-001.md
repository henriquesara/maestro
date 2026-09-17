# ORCA-S5 Delegated Cutover — Architecture Status Ratification

> Lifecycle/freeze artifact only. Introduces no new architecture semantics.
> Does not modify `SPEC.md`, `ARCHITECTURE-INDEPENDENT-REVIEW-001.md`,
> `CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md`, or
> `ARCHITECTURE-FOCUSED-REREVIEW-002.md`. Implements no code, adds no test,
> adds no schema/migration, enables no fence acquisition, starts no
> `ORCA_DELEGATED`/R3/M5 work, and does not itself publish.

## 1. Architecture identity

- **Architecture family:** ORCA-S5 Delegated Cutover / Slice-B
  (`ORCA_DELEGATED` Cutover).
- **Accepted architecture content HEAD:** `627b00b0b71a345783dbc37f9ebff99033e8dc80`.
- **Original architecture lineage** (verified this session,
  `git log -1 --format="%H %s"` on each, `git merge-base --is-ancestor` for
  the endpoints):

  ```
  66dab64373942f58a6ddfccf71a99c94ff719bae  orca-s4(green): fix composition-root
                                             wiring gap -- thread the real durable
                                             shadow-lifecycle root through the
                                             sibling sweep  (orca-s4 base)
    → ef699e9fc29f8a9950234d1460907b435b86c87e  round 1 — corrected candidate SDD
      contract, ARCHITECTURE_READY_FOR_INDEPENDENT_REVIEW
    → 28b664fe0689c30041ea9eb824dcc646a2689c7a  round 2 — focused correction
      (real provider-specific PTY spawn-commit seam)
    → f0c3dfbe2707bb57625f9056580025fca250b818  round 3 — focused correction
      (deferred command delivery + true async propagation)
    → 7c1796e82c53de53f0a028123defbe53974eb652  round 4 — focused correction
      (complete call-graph tracing; architecture content HEAD entering the
      full independent review)
  ```

  `66dab643` confirmed an ancestor of `7c1796e8` this session.

- **Final focused correction:** `627b00b0b71a345783dbc37f9ebff99033e8dc80`
  (round 5 — composition-root wiring; the only SPEC.md-touching commit
  between `7c1796e8` and here, confirmed by per-commit `--stat` inspection
  in the prior focused-rereview session).

- **Independent acceptance evidence chain:**
  - `ARCHITECTURE-INDEPENDENT-REVIEW-001.md` (full independent review of
    `7c1796e8`; sole finding: the composition-root/`run_reservation` gap;
    verdict `ARCHITECTURE_CHANGES_REQUIRED`).
  - `CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md` (prerequisite technical
    discovery closing that gap against real code; no new blocker).
  - `ARCHITECTURE-FOCUSED-REREVIEW-002.md` (focused independent rereview of
    `627b00b0b7`'s correction against the review + discovery evidence;
    verdict `ARCHITECTURE_ACCEPTED_READY_TO_FREEZE`).

- **Terminal independent verdict, confirmed this session by reading
  `ARCHITECTURE-FOCUSED-REREVIEW-002.md` directly:**

  ```
  state_class: ARCHITECTURE_ACCEPTED_READY_TO_FREEZE
  display_verdict: ORCA_S5_DELEGATED_CUTOVER_FULL_ARCHITECTURE_ACCEPTED_READY_TO_FREEZE
  accepted_architecture_head: 627b00b0b71a345783dbc37f9ebff99033e8dc80
  ```

## 2. `SPEC.md` — unchanged, no further edit

`SPEC.md` at the current candidate lineage (this branch's `HEAD`, prior to
this ratification commit) is byte-identical to its content at
`627b00b0b71a345783dbc37f9ebff99033e8dc80` — confirmed this session via
`git diff 627b00b0b7 HEAD -- .../SPEC.md`, empty. This ratification makes
**no edit** to `SPEC.md`.

`SPEC.md`'s own header still reads, verbatim, as historical content written
at round 5:

> **State class:** `ARCHITECTURE_READY_FOR_FOCUSED_REREVIEW`.
>
> "Candidate — not frozen, not independently accepted, not published,
> authorizes no implementation."

**This text was correct when written** — round 5 was, at the time, awaiting
exactly the focused rereview `ARCHITECTURE-FOCUSED-REREVIEW-002.md` later
performed. It is not being retracted or corrected. **It is superseded**, as
of this ratification, by the acceptance verdict recorded in §1 above:
`ARCHITECTURE-FOCUSED-REREVIEW-002.md` is the artifact that changed the
lifecycle state from "awaiting rereview" to "independently accepted";
`SPEC.md`'s own header text was never mechanically updated to reflect that
outcome and is not required to be — the lifecycle state of the architecture
is authoritatively tracked by this evidence chain (§1), not by prose
re-editing of `SPEC.md`'s own historical header on every round.

## 3. Cumulative frozen contract

The canonical architecture contract, as of this ratification, is defined as:

**Normative architecture semantics — `SPEC.md`, exactly as it reads at
`627b00b0b71a345783dbc37f9ebff99033e8dc80`.** This is the only source of
architecture semantics. A real conflict between any other artifact and
`SPEC.md`'s content is `CONTRACT_CONFLICT` → architecture decision →
amendment, never a silent edit to any of the artifacts below.

**Lifecycle / evidence chain (non-normative — records how `SPEC.md` reached
its current state, and its current freeze status; introduces no
architecture semantics of its own):**

1. `ARCHITECTURE-INDEPENDENT-REVIEW-001.md` — review evidence.
2. `CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md` — technical discovery
   evidence.
3. `ARCHITECTURE-FOCUSED-REREVIEW-002.md` — acceptance verdict.
4. `SPEC-STATUS-RATIFICATION-001.md` — this document; freeze/lifecycle
   state only.

None of 1–4 defines a transaction shape, a schema, a state transition, an
authority rule, or any other normative claim not already present in
`SPEC.md` itself. Where any of 1–4 restates a `SPEC.md` claim for
evidentiary purposes, `SPEC.md`'s own text remains the controlling
statement.

## 4. Freeze state

**Architecture:**

```
FROZEN
INDEPENDENTLY ACCEPTED
IMPLEMENTATION-AUTHORIZED
```

**Publication:**

```
PENDING
```

Publication is pending until this ratification artifact itself is
independently checked and pushed. This document does **not** declare
itself `PUBLISHED`.

## 5. §18.1 PRE_IMPLEMENTATION prerequisite — satisfied

`SPEC.md` §18.1 required, before the remainder of Slice-B architecture could
be implemented:

- **Part A:** delegated deferred command delivery.
- **Part B:** true async spawn-commit propagation.

This prerequisite is:

```
IMPLEMENTED
INDEPENDENTLY ACCEPTED
PUBLISHED
```

at technical HEAD `eed09b3047db4f71d25763c215335a2f2db0b403`, with its own
publication/docs-closeout record at `6b84afce586c9ecf56837446fb0b2886161c3202`
(`origin/main`, confirmed matching via fresh `git fetch` this session).

**Therefore: the architectural prerequisite for beginning implementation of
the remaining Slice-B architecture is SATISFIED.**

## 6. Authorized next implementation

After this ratification is itself independently checked and published,
implementation **may** begin for the accepted remaining Slice-B
architecture.

**First intended implementation sub-slice:** ORCA-S5 Delegated Cutover Core.

**Conceptual path (pointer only — restates `SPEC.md`'s own accepted S0–S12
sequence and §4.8/§5.4 composition, encodes no new semantics):**

```
eligibility
  → aiControl fence (S1)
  → run_reservation (S2, DelegatedCutoverCoordinator's own first durable
    write, SPEC §5.2/§4.8)
  → prepare held execution (S3-S4)
  → stable process identity
  → atomic transaction (SPEC §5.4):
      run_binding
      + dispatch_worktree
      + dispatch_process_binding
      + delegation_cutover
  → durable COMMIT
  → spawn-commit callback resolves (site #5, SPEC §4.8.4)
  → release the SAME prepared execution.
```

This is a pointer to the already-accepted contract in `SPEC.md`, not a new
description of it. Any apparent discrepancy between this pointer and
`SPEC.md`'s own text is resolved in `SPEC.md`'s favor.

## 7. Sole authority transfer (reference only)

Restated here only as a reference to already-accepted `SPEC.md` content, not
redefined:

**The sole authority-transfer instant is the durable COMMIT of
`delegation_cutover`.**

Not:

- eligibility;
- fence acquisition;
- `run_reservation` (Execution-internal FK-anchor bookkeeping only, per
  `SPEC.md` §5.2/§16 as corrected by round 5);
- process preparation;
- binding (`dispatch_process_binding`) alone;
- spawn-commit callback invocation (as opposed to its resolution following
  the transaction's commit);
- workload release;
- aiControl acknowledgement (§6 Phase 4 — retried independently of Orca's
  own correctness, per `SPEC.md`).

## 8. Live activation is NOT authorized

```
ARCHITECTURE IMPLEMENTATION AUTHORIZATION IS NOT LIVE DELEGATION AUTHORIZATION.
```

Before real fence acquisition or production `ORCA_DELEGATED` activation, the
existing PRE_LIVE requirements remain in force, unaffected by this
ratification. At minimum:

- R3 completed and verified.
- Fence acquisition explicitly enabled only after fleet-safety proof.
- aiControl's terminal-projector `DIVERGENCE` gap (`SPEC.md` §17/§30,
  classified `PRE_LIVE_ACTIVATION`) fixed and published.
- A compatible Maestro + aiControl deployment.
- All `PRE_LIVE_ACTIVATION`-classified gates (19, 20, 21, 22, 26 per
  `ARCHITECTURE-INDEPENDENT-REVIEW-001.md` §30, unchanged by round 5)
  satisfied.

## 9. Accepted residuals (carried forward, unchanged)

- **`ASYNC_LATE_SELF_DEPENDENCY`** — classification
  `UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL`,
  confirmed still unreachable by both
  `ARCHITECTURE-INDEPENDENT-REVIEW-001.md` §31 and
  `ARCHITECTURE-FOCUSED-REREVIEW-002.md` §27. **Future trigger:** if a
  future production change introduces async self-reentry of the spawn-commit
  reporter, this residual must be revisited before that path is accepted.
- **PRE_IMPLEMENTATION evidence-baseline documentation clarification** —
  the round-5 correction's own note (`SPEC.md`, open-questions item 7) that
  the delegated-cutover coordinator's recovery-sweep trigger/cadence is an
  explicit, deliberately unresolved implementation-time decision, not a
  correctness gap (confirmed, `ARCHITECTURE-FOCUSED-REREVIEW-002.md` §23).

Neither residual blocks implementation of the accepted architecture.

## 10. Current operational state

```
Authority:          AICONTROL_NATIVE
ORCA_DELEGATED:      NOT STARTED
Fence acquisition:   DISABLED
R3:                  NOT STARTED
M5:                  NOT STARTED
```

No operational state changes as a result of this architecture freeze
ratification. This document is a lifecycle/paperwork artifact; it performs
no runtime, database, or configuration change.

## 11. aiControl guard

Verified read-only, this session, against the real `aiControlCenter`
checkout:

- `origin/master`, fresh `git fetch`: `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` — matches exactly.
- `data/app.db` SHA-256: `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` — matches exactly.
- No `-wal`/`-shm`/journal file present.
- No mutation performed.

## 12. Zero-new-semantics audit

Every substantive statement in this document, classified:

| § | Statement | Classification |
| --- | --- | --- |
| 1 | Architecture family, accepted HEAD, lineage, evidence chain, terminal verdict | ACCEPTED_STATE_REFERENCE / REVIEW_EVIDENCE_REFERENCE |
| 2 | `SPEC.md` unchanged; historical header text superseded, not retracted | LIFECYCLE_RATIFICATION |
| 3 | Cumulative frozen contract definition (`SPEC.md` normative; evidence chain non-normative) | LIFECYCLE_RATIFICATION |
| 4 | Freeze state (FROZEN/ACCEPTED/AUTHORIZED; publication PENDING) | LIFECYCLE_RATIFICATION |
| 5 | §18.1 prerequisite status (implemented/accepted/published) | ACCEPTED_STATE_REFERENCE |
| 6 | Authorized next implementation + conceptual path pointer | IMPLEMENTATION_AUTHORIZATION |
| 7 | Sole authority-transfer instant (restated, not redefined) | ACCEPTED_STATE_REFERENCE |
| 8 | Live activation not authorized; PRE_LIVE requirements | PRE_LIVE_RESTRICTION |
| 9 | `ASYNC_LATE_SELF_DEPENDENCY` + cadence-clarification residuals | ACCEPTED_RESIDUAL_REFERENCE |
| 10 | Current operational state, unchanged | ACCEPTED_STATE_REFERENCE |
| 11 | aiControl guard result | REVIEW_EVIDENCE_REFERENCE |

**Zero `NEW_ARCHITECTURE_SEMANTIC` statements found.** No statement in this
document asserts a transaction shape, schema, state, authority rule,
dependency direction, or crash disposition not already present in `SPEC.md`
as accepted at `627b00b0b71a345783dbc37f9ebff99033e8dc80`. §6 and §7 are
explicit pointers, not restatements that could drift from `SPEC.md`'s own
wording; §7 states `SPEC.md` controls on any discrepancy.

## 13. Diff scope (self-check)

This commit's only change: this file
(`SPEC-STATUS-RATIFICATION-001.md`, new). No edit to `SPEC.md`, no edit to
`ARCHITECTURE-INDEPENDENT-REVIEW-001.md`,
`CUTOVER-COMPOSITION-ROOT-DISCOVERY-001.md`, or
`ARCHITECTURE-FOCUSED-REREVIEW-002.md`. No production code, test, schema, or
migration file touched.

---

```
state_class: ARCHITECTURE_FREEZE_RATIFICATION_READY_FOR_REVIEW
display_verdict: ORCA_S5_DELEGATED_CUTOVER_FREEZE_RATIFICATION_READY_FOR_REVIEW
```

This ratification is a candidate, not yet published. It records the freeze
state; it does not itself constitute publication, independent review of
itself, or implementation authorization beyond what §6 already states as
conditional on this document's own future independent check and publication.
