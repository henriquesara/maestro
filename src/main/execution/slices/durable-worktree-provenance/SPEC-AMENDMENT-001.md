# ORCA-S3 — SPEC AMENDMENT 001

**Append-only.** Resolves **exactly one** `CONTRACT_CONFLICT` found by
independent implementation review of candidate `cc0d3db6aea125a8d7640e28d7adc7039f704858`
(rejected — see the independent review report; not accepted, not merged, not
retroactively validated by this amendment). Everything else in
[`SPEC.md`](./SPEC.md) — every prior revision note, every B/C/R decision, the
full §0–§18 contract — is unchanged and remains frozen exactly as published.

Branch `orca-s3-amendment-001-provenance-json`. Base — and unchanged —
`origin/main` `501121c7273818ae869bd03844b2ac80ba6c1ae0`. Authority stays
`AICONTROL_NATIVE`; Orca mode stays `ORCA_SHADOW_ADVISORY`. No stage transition.
No M5. No ORCA-S4.

---

## 1. The conflict

Independent implementation review found an internal inconsistency in the frozen
`SPEC.md` itself:

> **CONTRACT_CONFLICT** — §7.1's `worktree_provenance` DDL block does not
> declare a `provenance_json` column, but §7.1's own prose ("Every `base_commit`
> / `candidate_head` / `files_changed_json` / `provenance_json` /
> `provenance_source` column is **immutable** after Phase A"), §3(b) ("cites its
> exact source ... as `provenance_json`"), §5 ("Outputs ... analogous to
> ORCA-S2's `settlement-evidence-bundle.json`"), and acceptance gate 7 ("prove a
> `worktree_provenance` with the correct real `base_commit`, `candidate_head`,
> `files_changed`, `provenance_digest`, **and full `provenance_json`**") all
> name it three or more times as a column that must exist and be provable on
> the row.

The rejected candidate (`cc0d3db6ae`) resolved this unilaterally in code —
adding `provenance_json TEXT NOT NULL` to its `CREATE TABLE worktree_provenance`
with a comment declaring the DDL omission "resolved ... in favor of the
repeated prose, never as a silent redefinition of any decision." That is a
**silent edit of a frozen contract**, forbidden by SPEC.md's own governing
clause ("A real conflict is `CONTRACT_CONFLICT` → architecture decision →
amendment, never a silent edit here"), regardless of whether the column itself
was the right call. Independent review correctly rejected the candidate on
this basis (among others) and on the frozen TDD/RED gate and the restart/crash
gate — both **out of scope** for this amendment (§5 below).

## 2. Normative resolution

**The canonical ORCA-S3 `worktree_provenance` schema includes:**

```
provenance_json     TEXT NOT NULL
```

as a column of `worktree_provenance`, inserted immediately after
`provenance_digest` and before `first_seen_at` in the column order given in
§7.1's DDL block (cosmetic ordering only — column order carries no semantic
weight; a future implementation may `CREATE TABLE` in any order that satisfies
the column set below).

This resolves the DDL omission **in favor of the already-repeated frozen prose
and acceptance requirements** (§1 above) — the prose and gate 7 were correct;
the DDL block was incomplete. No other column, table, index, or constraint in
§7.1 changes.

## 3. Affected frozen section

**§7.1 `worktree_provenance` — projection / evidence (rebuildable)** — the DDL
code block only. The corrected, complete DDL:

```
worktree_provenance (
  correlation_id      TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id    TEXT NOT NULL,
  orca_run_id         TEXT NOT NULL,
  slice_ref           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'recorded',   -- recorded | conflicted
  base_commit         TEXT NOT NULL,
  candidate_head      TEXT NOT NULL,
  files_changed_json  TEXT NOT NULL,                      -- canonical ordered set (filesChangedSet)
  provenance_source   TEXT NOT NULL,                      -- converged_from_worktree | synchronous_capture
  worktree_path_ref   TEXT NOT NULL,                      -- LOCAL metadata; excluded from digest + replay equivalence
  provenance_digest   TEXT NOT NULL,                      -- content digest; excludes local paths / absolute prefixes / timestamps / incident ids
  provenance_json     TEXT NOT NULL,                      -- ADDED by this amendment — exact source citation (§3b): resolved commits + whitelisted git-command transcript hashes; excluded from provenance_digest and from every replay-equivalence / dedup comparison (PROV-2)
  first_seen_at       TEXT NOT NULL,                      -- LOCAL metadata
  observed_at         TEXT NOT NULL,                      -- LOCAL metadata
  conflicted_at       TEXT
)
CREATE INDEX IF NOT EXISTS worktree_provenance_by_slice ON worktree_provenance(slice_ref);
```

No other frozen section is touched.

## 4. Prose, invariants, and gates already requiring `provenance_json` — confirmed unchanged

This amendment adds no new obligation. It makes the DDL match obligations
`SPEC.md` already stated:

- §3(b) — `provenance_json` as the exact source citation, unchanged.
- §5 — the evidence-bundle analogy, unchanged.
- §7.1 prose — `provenance_json` named among the columns immutable after Phase
  A, unchanged (now backed by an actual column).
- §12 PROV-1 — `base_commit` / `candidate_head` / `files_changed` still come
  only from real Git objects; `provenance_json` is the citation of that
  reading, not a new fact source.
- §12 PROV-2 — the digest, dedup key, and replay-equivalence comparisons
  **continue to exclude** `provenance_json` exactly as they already excluded
  `worktree_path_ref` and every local-metadata timestamp/id. `provenance_json`
  is source citation, never part of the identity of a row.
- Acceptance gate 7 — "prove ... full `provenance_json`" is now literally
  satisfiable against a real column instead of an inferred one.
- Acceptance gate 3 (TDD/RED) and gate 10 (restart/crash) are **untouched by
  this amendment** — they were independent blockers in the rejected candidate,
  unrelated to the DDL omission, and remain open findings against any future
  implementation attempt.

## 5. No other schema or semantic change

This amendment changes **one DDL block, one column**. It does not:

- add, remove, or rename any other column, table, or index;
- change `dispatch_worktree` (§7.2), `worktree_provenance_incident` (§7.3), or
  `run_binding` (§7.4) in any way;
- change the crash-window table (§7.6 A–G), the convergence design (§8), the
  read port / argv whitelist (§9), the worktree-lifetime decision (§10), the
  failure semantics (§11), any PROV-1..12 invariant's *substance* (only PROV-2's
  already-stated exclusion list is confirmed to include the new column, per §4
  above), the out-of-scope list (§13), the acceptance-gate list (§14), the
  rollback section (§15), the `ORCA_DELEGATED` relationship (§16), the
  predecessor facts (§17), or the attack-surface list (§18);
- reopen B1–B5, C1–C3, or R1–R7;
- authorize any implementation, test, schema-code, TDD-repair, restart-harness-
  repair, authority-transfer, lifecycle-ownership, parity, M5, or ORCA-S4 work.

## 6. Schema remains additive v3 → v4

`EXECUTION_SCHEMA_VERSION` 3 → 4, **three new tables**
(`dispatch_worktree`, `worktree_provenance`, `worktree_provenance_incident`) —
unchanged by this amendment. `worktree_provenance` now correctly declares
**thirteen** columns (was twelve) in its own `CREATE TABLE IF NOT EXISTS`
statement; this is a difference *within a table that does not yet exist in any
shipped schema* (v4 has never been published), not an `ALTER TABLE` against a
prior version. **Zero columns are added to any ORCA-S1/S2 table.** The v3 → v4
migration step remains "ensure the new tables + indexes exist," no `ALTER`.

## 7. Previous ORCA-S3 architecture decisions remain frozen

Revision notes 1–3 in `SPEC.md` (B1–B5, C1–C3, R1–R7) stand **verbatim** and are
**not** reopened by this amendment: incident isolation (B1), worktree identity
semantics (B2) and its sidecar location (C1), source-vs-projection
classification (B3) and DB/filesystem crash-consistency ordering (C2),
lifecycle boundary / retention-by-storage-boundary (B4), no parity
responsibility (B5), the exact Git argv whitelist (R6), the sibling-sweep
placement with no "phase 2.5" (R7), `settlement_incident` untouched,
`reconcile-shadow-execution-state.ts` and `orca-execution-plane.ts` untouched,
and prospective Phase A eligibility / `LEGACY_BINDING_NOT_CONVERGEABLE` (C3).
The cumulative frozen contract for ORCA-S3 is now **`SPEC.md` + this
`SPEC-AMENDMENT-001.md`** — read together, amendment first for §7.1's DDL,
`SPEC.md` for everything else.

## 8. Rejected candidate — not accepted, not retroactively validated

`cc0d3db6aea125a8d7640e28d7adc7039f704858` remains a **rejected** implementation
candidate. This amendment resolves only the DDL/prose contract defect that
candidate's code comment surfaced; it does **not** accept, merge, publish, or
retroactively validate that candidate, its branch, its test suite, its
RED-EVIDENCE.md, or its restart-harness behavior. A future implementation
attempt against the corrected contract (`SPEC.md` + this amendment) still owes
independent review the outstanding TDD/RED evidence (gate 3) and a
non-flaky restart/crash suite (gate 10) — neither of which this amendment
touches or excuses.

## 9. Coupling

**Documentation-only.** No code, schema, migration, test, dependency, or skill
is changed by this amendment — consistent with `SPEC.md`'s own framing rule for
a candidate/amendment artifact. No Orca core file, no aiControlCenter file, no
`src/main/execution` production or test file is touched.

---

**State class:** `ARCHITECTURE_AMENDMENT_READY_FOR_REVIEW`.
**Display verdict:** `MAESTRO_ORCA_S3_AMENDMENT_001_PROVENANCE_JSON_READY_FOR_INDEPENDENT_REVIEW`.
