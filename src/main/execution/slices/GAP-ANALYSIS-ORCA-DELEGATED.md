# Pre-`ORCA_DELEGATED` Architecture Gap Analysis

> **Analysis artifact — not an SDD candidate SPEC, not frozen, not independently
> accepted, not published, authorizes no implementation.** Produced by an
> architecture-analysis task against the ORCA-S3-published repository state. No
> code, schema, migration, test, dependency, or skill is changed by producing
> this document. It does **not** start M5, does **not** start ORCA-S4, and does
> **not** assume the next slice is named ORCA-S4 merely because S3 exists — the
> provisional name below is carried forward **only** because it already appears,
> verbatim, in three independently-accepted frozen contracts (cited in §2).
>
> This document answers one question: *given the repository exactly as
> published through ORCA-S3, what is the smallest, evidence-grounded remaining
> gap between here and a safe `ORCA_DELEGATED` transition, and how should it be
> sliced?* Every claim below is sourced to a real file or a real absence,
> verified by reading the repository directly (not by trusting prior handoffs).

**State class:** `GAP_ANALYSIS_READY_FOR_REVIEW`.
**Display verdict:** `MAESTRO_PRE_DELEGATION_GAP_ANALYSIS_READY_FOR_INDEPENDENT_REVIEW`.

---

## 0. Canonical base

| Field | Value |
| --- | --- |
| Repository | Maestro |
| Analysis base (`origin/main`) | `7a1f8388cb3edb680ba83b1cb15c99c2bee41261` — ORCA-S3, `CLOSED / PUBLISHED` |
| Predecessor slices consumed | ORCA-S1 (`911b6679c2`), ORCA-S2 (`8eca5ddefc2`), ORCA-S3 (`7a1f8388cb`) — all `CLOSED / PUBLISHED` |
| Authority before this analysis | `AICONTROL_NATIVE` |
| Orca mode before this analysis | `ORCA_SHADOW_ADVISORY` |
| Authority after this analysis | **Unchanged.** This is analysis, not implementation; it moves no stage. |
| Target milestone under study | `ORCA_DELEGATED` |
| Normative source | aiControlCenter external-plane amendment `ORCA_EXECUTION_AUTHORITY_EXTERNAL_PLANE_AMENDMENT_20260907_01`, §§D, E, F, G, H, I, L, P (quoted only where already cited by a frozen Maestro SPEC — the amendment document itself is **not** vendored into this repo; see §7). |

---

## 1. Method

Every claim in §§2–4 was verified against the repository, not inferred from
prior conversation state:

- Read in full: `durable-worktree-provenance/SPEC.md` (all 18 sections),
  `durable-worktree-provenance/SPEC-AMENDMENT-001.md`,
  `durable-settlement-observation/SPEC.md` (Appendix C, §18, §23, §24),
  `shadow-identity-observation/SPEC-AMENDMENT-002.md`.
- Repo-wide search (not doc-only) for: `MockExecutor`, `execution_attempt(s)`,
  `orphan`, `process-tree`/`processTree`, `teardown`, `reap`, `app.db`,
  `projection`, `AICONTROL_NATIVE`, `ORCA_SHADOW_ADVISORY`, `ORCA_DELEGATED`,
  `ORCA_AUTHORITATIVE`, `ORCA-S4`, `M5`.
- Cross-checked `src/main/execution/infrastructure/execution-schema.ts` (the
  actual migration source) against every table name any SPEC claims exists.

Where a SPEC's prose and the actual schema/code agreed, that is stated as
fact. Where a mission-brief term (e.g. "execution_attempt") turned out **not**
to name anything this repository owns, that is stated explicitly rather than
silently reinterpreted.

---

## 2. What already exists (do not re-derive, do not re-build)

- **Durable settlement observation** (ORCA-S2) — `settlement_observation`,
  `settlement_incident`; write-once, digest-pinned, restart-safe. Owns *no*
  Git capture, *no* `data/app.db` write, *no* teardown
  (`durable-settlement-observation/SPEC.md` §18).
- **Durable worktree provenance & convergence** (ORCA-S3) —
  `worktree_provenance`, `dispatch_worktree` (SOURCE), `worktree_provenance_incident`;
  converges real `base_commit`/`candidate_head`/`files_changed` from durable
  Git state, restart-safe across crash windows A–G
  (`durable-worktree-provenance/SPEC.md` §7.6). Owns *no* filesystem removal,
  *no* process teardown, *no* `data/app.db` write (PROV-4, PROV-6).
- **A read-only aiControl guard**: `infrastructure/aicontrol-db-reader.ts` has
  **no write method at all** — `listProfiles()` and `close()` only. `data/app.db`
  SHA-256 identity is asserted unchanged as an acceptance gate in every slice.
- **A generic process-tree-kill utility already exists** —
  `src/shared/child-process/process-tree-termination.ts`
  (`signalProcessTree`, gated by `admitProcessTreeKill`) — used today by PTY
  sessions, Codex accounts, and skill-update runs. **Zero usage under
  `src/main/execution/`.** This is a reusable primitive for the future
  finalization slice, not something it must invent from scratch — but it is
  not wired into Execution and has never been proven against Execution's
  crash-safety discipline (write-ordering, idempotent retry, restart harness).
- **The single production composition root** for all three slices is
  `shadow-identity-observation.ts` (`executeShadowIdentityObservationSlice`),
  proven reachable-only by dedicated composition-root tests
  (`durable-worktree-provenance.composition-root.test.ts`). Any future slice
  extends this same seam; it does not invent a parallel dispatch path.
- **The authority-ladder vocabulary** (`AICONTROL_NATIVE` →
  `ORCA_SHADOW_ADVISORY` → `ORCA_DELEGATED` → `ORCA_AUTHORITATIVE`) is defined
  by the external aiControlCenter amendment and only ever *quoted* inside the
  three slice SPECs — there is no Maestro-owned canonical authority-ladder
  document. This gap analysis does not create one; it notes the absence.

## 3. What the mission brief named that does not exist in this repository

Stated explicitly, per the instruction to report absence rather than infer it:

- **`execution_attempt` / `execution_attempts` is not a Maestro table.**
  `execution-schema.ts` defines exactly ten tables: `run_reservation`,
  `run_binding`, `parity_observation`, `workload_exclusion`, `execution_meta`,
  `settlement_observation`, `settlement_incident`, `dispatch_worktree`,
  `worktree_provenance`, `worktree_provenance_incident`. `execution_attempts`
  is aiControlCenter's **own** schema table, read only inside the disposable
  acceptance harness (`aicontrol-native-harness.mjs`) for gate-8-style parity
  proof. Maestro has never owned, and does not today own, an "execution
  attempt closure" write. **This means "execution_attempt closure" as a
  `ORCA_DELEGATED` responsibility is not "finish a half-built Maestro
  mechanism" — it is "decide whether, and how, Orca will ever perform (or
  merely trigger) the equivalent of aiControl's `closeExecutionAttempt` once
  it owns the running→terminal transition."** That is a real open design
  question, not an implementation gap in existing Maestro code.
- **`MockExecutor` is not a Maestro class.** It is aiControlCenter's own
  deterministic leaf-executor boundary. Maestro's own stand-in,
  `NativeResultsAuthoritativeExecutor`, **never executes anything** — it
  replays a pre-recorded native result verbatim
  (`native-results-authoritative-executor.ts:6-11`). "Real executor parity
  beyond MockExecutor" is therefore a question about aiControlCenter's
  production executor fidelity, which Maestro does not control and has
  explicitly, repeatedly deferred (ORCA-S1 residual R1, carried unchanged
  through S2 Appendix C and S3 §13).
- **Governed cleanup / orphan recovery / process-tree teardown for Execution
  does not exist as code** — only as a repeatedly-deferred forward reference
  (S3 §7.6 windows A–C, §10, §12 PROV-6, §13, §16). The general-purpose
  primitive exists (see §2) but has zero wiring, zero tests, and zero
  crash-window proof inside `src/main/execution/`.
- **No terminal-projection path into `data/app.db` exists**, not even a
  stub — only the explicit forward reference in S3 §16(b) / PROV-4's "no
  `data/app.db` write" invariant.
- **No cross-slice architecture/roadmap document exists in this repository.**
  All milestone language (`ORCA-S4`, `M5`, `ORCA_DELEGATED`) lives only inside
  the three slice SPEC files. There is no `docs/` roadmap; the referenced
  external roadmap (`phase-m-model-governance-workforce-allocation.md`) lives
  in aiControlCenter, not here.

## 4. The genuine remaining gap (§H enumeration, restated against real code)

Cross-referencing `durable-worktree-provenance/SPEC.md` §16's own definition
of what `ORCA_DELEGATED` requires against §§2–3 above, the remaining gap is:

1. **Process / process-tree teardown ownership** — undesigned, unwired,
   unproven inside Execution (primitive exists elsewhere; §2).
2. **Worktree finalization ownership + reap timing** — undesigned; S3 explicitly
   left the durable shadow worktree root's lifetime (including orphan bind
   state from crash windows A–C) to this future slice.
3. **`base_commit` / `candidate_head` capture at the delegated boundary** —
   **already solved** by S3 as an *advisory* artifact; §H only requires this
   capture become the delegated act's *input*, not that it be rebuilt (S3 §16:
   "already converged... it can project them (target swap)"). This is the one
   §H item that is **not** a gap — it is a dependency already satisfied.
4. **Execution-attempt identity closure** — undesigned; not even a concept
   Maestro owns today (§3).
5. **Terminal-event emission** — undesigned; no such mechanism exists.
6. **Terminal-projection path into `data/app.db`** (§G item 6, "copies — never
   re-decides") — undesigned; the only DB-access code today
   (`aicontrol-db-reader.ts`) is read-only.
7. **The `onDispatchSettled` hook decision** — explicitly recorded as
   unresolved by S2 ("should be resolved before or within the
   `ORCA_DELEGATED` slice. S2 explicitly does not close them.") and never
   revisited by S3.
8. **Real (non-`MockExecutor`) executor parity** — explicitly deferred by S1,
   carried unchanged through S2 and S3, and orthogonal to who owns lifecycle
   authority (see §6, question 2).

---

## 5. Required decisions

**1. What capabilities are still missing before `ORCA_DELEGATED`?**
Items 1, 2, 4, 5, 6, 7 in §4 above. Item 3 (artifact capture) is already
satisfied by S3. Item 8 (executor parity) is missing but not blocking (§6.2).

**2. Prerequisites for delegation vs. safe to leave until after?**

*Prerequisites (must exist and be proven before the authority flip):*
- Items 1, 2, 4, 5, 6 (§4) — the §H side-effect boundary itself, proven under
  shadow first, exactly as S1→S2→S3 each proved their mechanism under
  `ORCA_SHADOW_ADVISORY` before any authority stage moved.
- Resolution of item 7 (the `onDispatchSettled` hook question) — even if the
  resolution is "still not needed, here is why," it must be an explicit,
  reviewed decision, not silence carried a fourth time.
- A restart/crash-window proof for every new non-atomic write this
  introduces, in the same enumerated-table discipline as S3 §7.6.
- A "copies-never-decides" proof for the terminal-projection path (§G item 6)
  — structurally the same shape as S3's PROV-1 "no fabrication" proof, applied
  to terminal outcome content instead of Git artifacts.
- Proof of **zero dual-write correctness**: at every instant during and after
  cutover, exactly one component may be the terminal-outcome decision
  authority for a given dispatch — never both aiControl-native and Orca
  simultaneously for the same run.

*Safe to leave until after delegation (per the user's own stated constraint
and confirmed by S3's own exclusion boundary):*
- Item 8, real-executor parity — orthogonal; delegating *who tears down and
  reports* does not require delegating *what runs*. `MockExecutor` fidelity is
  aiControlCenter's own concern.
- Queue / capacity / admission / scheduler / FIFO / `QUEUE_FULL` transfer —
  explicitly reserved by the user's brief for a later `ORCA_AUTHORITATIVE`
  stage; S3 §13 independently confirms this was never in scope for any prior
  slice either.
- Retiring aiControlCenter's own native execution-attempt lifecycle code for
  delegated dispatches — this lives in a different repository under its own
  amendment process; Maestro cannot unilaterally retire it, and should not
  attempt to until the new path has independent acceptance evidence.

**3. Can the missing work form one vertical slice, or must it be split?**
**It must be split into (at least) two.** Reasons:
- **Authority-boundary discipline.** Every prior slice (S1, S2, S3) built and
  proved its mechanism *entirely under existing authority* before any
  authority stage moved, and each did so as an independently-frozen,
  independently-accepted contract. Combining "build and prove the §H
  mechanism" with "flip the authority stage" in one slice would let an
  authority transfer ride on undifferentiated evidence — exactly the failure
  mode ORCA-S2's own §0 discipline ("compliance, not relaxation") exists to
  prevent.
- **The docs already anticipate exactly this split.** S3 §16 itself says: "S3
  leaves every lifecycle act ... and all of (b) to the delegation slice **or
  an intervening ORCA-S4**." That is not this analysis inventing a slice
  count; it is the frozen S3 contract already naming two possible landing
  points.
- **Different independent-acceptance shape.** A shadow-side proof slice is
  accepted the way S1–S3 were (RED/GREEN evidence, restart harness, zero
  authoritative writes, `data/app.db` byte-identical). An authority-transfer
  slice is accepted against a wholly different bar — the very definition of
  §G/§H compliance, cutover safety, and no-dual-write proof — which is not a
  vertical-slice acceptance gate at all, and mixing the two would blur which
  bar a reviewer is applying to which claim.

**4. If split, what is the dependency order?**
1. **Slice A — provisionally "ORCA-S4 — Delegated Side-Effect Boundary
   Enumeration & Shadow Proof"** (name already used verbatim in
   `durable-worktree-provenance/SPEC.md:931` and Appendix C of S2 — carried
   forward here, not invented). Builds and proves items 1, 2, 4, 5 of §4
   **entirely under `AICONTROL_NATIVE` / `ORCA_SHADOW_ADVISORY`** — no
   authority movement, mirroring every prior slice.
2. **Slice B — the `ORCA_DELEGATED` cutover slice**, under its own frozen
   contract. Consumes Slice A's proven mechanism as its authoritative
   implementation, adds the terminal-projection path (item 6), resolves the
   `onDispatchSettled` question (item 7) as part of its own §0
   `CONTRACT_CONFLICT` check, and is the **only** slice that moves the
   authority ladder.

Item 8 (executor parity) has no dependency edge to either slice and may
proceed in parallel or not at all before cutover.

**5. Exact responsibility transfers at each slice?**
- **Slice A:** none. Authority and Orca mode identical before and after,
  exactly like S1/S2/S3's own artifact-identity tables state for themselves.
- **Slice B:** transfers ownership of the *mechanical* running→terminal
  side-effect acts — process/process-tree teardown, worktree finalization
  timing, execution-attempt-equivalent closure, terminal-event emission — from
  aiControl-native to Orca, for delegated dispatches. Terminal-*outcome
  content* authority is explicitly **not** transferred (see decision 9).

**6. What authority remains with aiControl at each point?**
- Through Slice A: all of it — unchanged from today.
- At Slice B: admission/capacity/queue/scheduler (per the user's constraint,
  reserved for `ORCA_AUTHORITATIVE`), and — per §G item 6's "copies, never
  re-decides" — the *decision* of what a terminal outcome means. Orca becomes
  authoritative only for the *fact that* teardown/finalization occurred and
  *when*, never for reinterpreting what the run's result was.

**7. What durable facts constitute completion/finalization?**
Not yet defined by any frozen contract — this is Slice A's job to specify,
under the same discipline as `worktree_provenance` (write-once per
correlation, digest-pinned, immutable after write, source vs. projection
split). This analysis does not pre-decide the schema; inventing one here
would be exactly the "start implementation in an architecture task" failure
this mission explicitly forbids. What can be stated now: whatever the shape,
it must (a) distinguish SOURCE state (the raw process-exit/teardown facts) from
PROJECTION state (any rebuildable summary), mirroring B3/§7.5 of S3, and (b)
be provably idempotent under the same restart/crash discipline as S3 §7.6.

**8. What happens after crash/restart at every non-atomic boundary?**
Cannot be enumerated correctly until Slice A pins its actual write ordering —
fabricating an A–G-style table now, before the mechanism is designed, would
misrepresent unproven work as proven. What is certain from precedent: Slice A
must produce its own enumerated crash-window table (mirroring S3 §7.6) and its
own restart-harness proof (mirroring the "separate child-process, SIGKILL,
reconcile" pattern used by S1/S2/S3), before Slice B may depend on it.

**9. What projections are written back to aiControl, and who is authoritative
for their contents?**
The Slice-B terminal-projection path into `data/app.db` **copies** the
terminal outcome; it must never independently compute or re-decide it (§G
item 6, mirroring S3 PROV-4's "never re-decide" language exactly). Authority
split: Orca becomes authoritative for the *mechanical* facts it now performs
(exit observed, teardown completed, at what time); aiControl's existing
outcome-classification logic remains the single source of truth for *what the
outcome means* — there is exactly one decision authority for outcome
semantics before and after cutover, never two.

**10. What legacy execution code can be retired at each stage?**
- **Slice A:** nothing — it is additive-only, like every prior slice.
- **Slice B:** only after independent acceptance, and only work Maestro
  actually owns. Two concrete candidates, **not decided here**: (a)
  `NativeResultsAuthoritativeExecutor` and the disposable-aicontrol-env gate-8
  acceptance scaffolding built to compare Orca-shadow against a real
  aiControl-native run — once Orca is authoritative for delegated dispatches,
  there is no longer a separate aiControl-native run to compare against for
  those dispatches, so this harness's purpose narrows or changes; (b)
  aiControlCenter's own native execution-attempt lifecycle path for delegated
  runs — but that code lives in a **different repository** under its own
  amendment process; Maestro cannot unilaterally retire it, only propose
  retirement through the same external-plane amendment mechanism already used
  for S1 amendment 002.

**11. What must be proven before `AICONTROL_NATIVE`/`ORCA_SHADOW_ADVISORY` →
`ORCA_DELEGATED`?**
1. Every §H item (1, 2, 4, 5 in §4) enumerated and proven safe under shadow
   (Slice A's output).
2. Zero-dual-write-authority proof across the cutover instant itself.
3. A full crash/restart proof (enumerated windows, restart harness) for every
   new non-atomic step Slice A/B introduce.
4. Idempotent, no-duplicate-side-effect proof for teardown/kill/reap and for
   terminal-event emission (a retried finalization must not double-kill or
   double-emit).
5. "Copies-never-decides" proof for the terminal-projection path.
6. S1/S2/S3 acceptance suites remain green and byte-unchanged through cutover
   (the regression discipline every prior slice already enforces on itself).
7. Explicit, reviewed resolution of the `onDispatchSettled` hook question and
   the real-executor-parity question (even if the resolution is "defer past
   cutover, here is why that is safe").
8. Explicit written confirmation that admission/capacity/queue/scheduler
   responsibilities remain with aiControl (not silently carried across by the
   same commit that flips the authority stage).
9. An independent-acceptance attack-surface list for Slice B, in the same
   adversarial-question style as S1 §-equivalent / S2 §26 / S3 §18.

---

## 6. Constraints carried forward (unchanged by this analysis)

- One correctness authority per transition — never two components deciding
  the same fact concurrently (decision 9 above operationalizes this).
- No dual-write correctness — restated explicitly as prerequisite 2 above.
- S1/S2/S3 contracts, S3 worktree-provenance semantics, and S2 settlement
  semantics are unmodified by this analysis and must remain unmodified by
  Slice A (additive-only, exactly like S3 was to S2).
- Fail-closed, idempotent, restart-correct — the standard every prior slice
  met; Slice A must meet the same standard for its own new mechanism before
  it may be trusted as Slice B's dependency.
- Orca remains Execution infrastructure behind Maestro boundaries throughout
  both proposed slices; neither slice touches Governance / Delivery bounded
  contexts.

## 7. Note on unverifiable scope

The full text of the external aiControlCenter amendment (§§D, E, F, G, H, I,
L, P) is **not** vendored into this repository — every citation above is a
quote already present in a frozen Maestro SPEC, never a fresh read of the
external document. This analysis does not claim to have independently
re-verified the external amendment's exact §H/§G wording beyond what Maestro's
own frozen contracts already quote. Any Slice A/B SPEC author should re-read
the external amendment directly (read-only, in the aiControlCenter checkout)
before freezing §0's `CONTRACT_CONFLICT` check, rather than relying solely on
the secondhand quotes collected here.

---

_State class: `GAP_ANALYSIS_READY_FOR_REVIEW` (analysis — not frozen, not an
implementation authorization, not a slice definition)._
_Display verdict: `MAESTRO_PRE_DELEGATION_GAP_ANALYSIS_READY_FOR_INDEPENDENT_REVIEW`._
