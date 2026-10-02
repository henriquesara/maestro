# ORCA-S5 PRE_LIVE PRODUCTIONIZATION — AD-2 MARKER-CAPTURE-FAILURE FINAL FOCUSED REREVIEW

**Scope:** ONLY the B-1 / AD-2 state (a′) correction in candidate `743458076769911cfe1fa5193f7c38ec4610ffee`.
Not a full architecture review. AD-1/H1, D-7/P7b + PL-1 and A-7 were closed by the valid focused rereview
`e0cb37e6ebd734b7b827fea8fd386567e89f17f8` and are checked here only for "unchanged by the diff".

`56a0a2ed79f323fa2223f5c1f549ac3c15b4e60d` remains **INVALID_REVIEW_LINEAGE / NON_AUTHORITATIVE** and was not
used as evidence.

## Verdict

- **state_class:** `ARCHITECTURE_ACCEPTED_READY_TO_FREEZE`
- **display_verdict:** `ORCA_S5_PRELIVE_PRODUCTIONIZATION_ARCHITECTURE_ACCEPTED_READY_TO_FREEZE`
- **accepted_architecture_candidate_head:** `743458076769911cfe1fa5193f7c38ec4610ffee`
- AD-2 marker-capture blocker: **CLOSED**
- All four findings from the valid review (AD-1/H1, D-7/P7b+PL-1, A-7, AD-2 a′): **CLOSED**
- PRE_LIVE productionization architecture: **ACCEPTED READY FOR FREEZE**
- Implementation: **NOT AUTHORIZED YET** · P1: **NOT STARTED** · ORCA_DELEGATED: **NOT STARTED** ·
  Fence acquisition: **DISABLED** · R3: **NOT STARTED** · M5: **NOT STARTED**

Five non-blocking observations (N-1…N-5, §20) are recorded for the freeze editor / P1. None reopens the
mechanism, none permits pid-only signalling, dual execution, or a cutover after marker failure.

## 1. Independence

Reviewer: fresh Claude Code session (Claude Opus 5.5), clean worktree `C:/mw-orca-s5-ad2-final-rereview`
(branch `review/orca-s5-prelive-ad2-final-rereview`, created at the candidate head). This session authored none
of `4a2cddc282…`, `e0cb37e6…`, `7434580767…`; all three carry `Co-Authored-By: Claude Sonnet 5`. Git author on
every commit in the chain is the repository owner.

## 2. Lineage — VALID

`git log --format='%H %P'` (each commit has exactly one parent, no merges):

```
1f70bdf4992ae920aed56de905edb0463faa8657  (canonical public base)
→ dfb1235673cba63242d2bd15a347415a86e678c4  (discovery)
→ 8970df4affaf80227a819a1efe2ae9b0f9945213  (valid independent architecture review)
→ 4a2cddc2825c3ee150a4b4ef0493905755e16277  (architecture correction)
→ e0cb37e6ebd734b7b827fea8fd386567e89f17f8  (valid focused rereview)
→ 743458076769911cfe1fa5193f7c38ec4610ffee  (final AD-2 correction candidate)
```

Full SHAs resolved for the two abbreviated inputs (`8970df4aff…`, `4a2cddc282…`). No amend/rebase: each listed
SHA is the literal parent of the next. Publication: `git branch -r --contains` is empty for both `7434580767…`
and `e0cb37e6…` → **unpublished**.

## 3. Exact diff `e0cb37e6… → 7434580767…` — IN SCOPE

`1 file changed, 90 insertions(+), 19 deletions(-)` —
`src/main/execution/slices/orca-delegated-cutover/PRE-LIVE-PRODUCTIONIZATION-ARCHITECTURE.md` only.

| Hunk | Location | Classification |
| --- | --- | --- |
| `@@ -79,25 +79,89 @@` | AD-2 crash matrix row (a′) + supporting prose (Mechanism A/B, pid-is-not-identity, cleanup failure, partial sidecar, retry, break-glass, authority) | `AD2_MARKER_FAILURE_CORRECTION` |
| `@@ -378,12 +442,19 @@` | §5 P1 "Genuine RED" bullet | `P1_RED_OBLIGATION` |

`UNRELATED_ARCHITECTURE_CHANGE`: **zero.** No production, test, or schema file touched.

## 4. Source proof — live handle — PROVEN

Read directly at the candidate head:

- `src/main/providers/local-pty-spawn.ts:81` — `const spawnResult = spawnShellWithFallback({ … ptySpawn: pty.spawn … })`,
  a `const` local of `spawnLocalPty`.
- `src/main/providers/local-pty-utils.ts:187-199, 236-237, 287-298` — every return branch is
  `{ process: <the value returned by ptySpawn(...)> }`; `ShellSpawnResult.process: pty.IPty` (`:151`). It is the
  object node-pty handed back at spawn, not a pid lookup, reconstruction, other provider handle, or rediscovery.
- `local-pty-spawn.ts:116` — pid is *derived from* that object: `{ pid: spawnResult.process.pid }`.
- `local-pty-spawn.ts:118-119` — `await args.onPtySpawnCommitted()`; `spawnResult` is still the same in-scope
  `const` across the await and is consumed afterwards at `:121` and `:134` (`const proc = spawnResult.process`).
- `src/main/runtime/orca-runtime-delegated-cutover-callback.ts:49-74` — the callback body (marker capture `:54`,
  `commitDelegatedCutover` `:55`) runs inside that await; it receives only the pid box, never the handle.

Same-object continuity from spawn through the callback is real. **`DIRECT_HANDLE_IDENTITY_PROOF_FALSE`: not raised.**

Precedent (strengthens, not required): frozen S4 `delegated-side-effect-boundary/SPEC.md:861-866` (§9.1 call
shape 1, "Same-process-instance path") and `:1316-1318` already establish that a live handle held by the
spawning owner needs no OS-marker check, distinct from the restart-recovered path (shape 2). Mechanism A is an
instance of that frozen split, not a new identity protocol.

## 5. State (a′) entry conditions — CONSISTENT

Row + prose state: spawn succeeded; live process "still directly owned by the spawn call frame"; pid captured
(`:116`, "pid is captured from it"); marker capture failed; sidecar "placeholder, incomplete"; Binding `none`,
`delegation_cutover` "stays uncommitted"; workload "not released as delegated". No contradictory assumption in
the corrected text. (Reachability wording: see N-1.)

## 6. Authority — CORRECT

"(a′) occurs strictly before cutover commit, so authority remains `AICONTROL_NATIVE`" and explicitly "does
**not** authorize automatically restarting native execution for the failed attempt … aborted (fails closed) …
No dual authority, no fallback." Consistent with §11 row 1 (pre-commit: run `fenced`, native impossible).

## 7. Mechanism A — CORRECT

Defined as "direct object/handle continuity to the exact spawned process — not process rediscovery", valid only
while the original spawning frame holds the handle and before commit/release. Explicitly: no OS-level pid
lookup, no marker comparison, no sidecar dependency, "does **not** use `verifyRestartRecoveredIdentity`".
Explicitly distinguished from restart identity recovery ("it isn't recovering an identity — it never let go of
one"). Safety basis is object/reference continuity. (Implementation note: N-4.)

## 8. Mechanism B — UNCHANGED

"durable identity evidence + pid + required incarnation/start-marker proof + fresh re-verification
(`verifyRestartRecoveredIdentity`, AD-4). No pid-only downgrade is ever legal here either." Cross-checked
against `restart-recovered-identity-verification.ts:66-122`: check 1 sidecar match, check 2 pid exists, L13
`unavailable` ⇒ unverifiable, check 3 marker equality, macOS compound proof; comment `:73` "Sidecar-plus-pid-
exists alone is never sufficient". Correction restates this invariant verbatim; no indirect downgrade.

## 9. Pid-only prohibition — HOLDS

The corrected wording contains no path "marker fails → use pid → signal". It states the opposite three times:
row Forbidden column "any pid-based OS lookup+signal fallback"; "Pid is not identity … does **not**, by itself,
authorize termination in any state"; "If Mechanism A's handle is ever lost … pid → OS lookup → signal is not
permitted". The pid is recorded/observed only. The removed text ("using the in-scope pid") is gone from both
hunks. **`PID_ONLY_PRECUTOVER_SIGNAL_ESCAPE`: not raised.**

## 10. Cleanup success — CORRECT

Row: close via direct handle, "then reject the operation; `delegation_cutover` stays uncommitted". No commit ⇒
no binding ⇒ no `ORCA_DELEGATED`; workload not released; retry is fresh only (§13). No success path continues
delegation after marker failure.

## 11. Cleanup failure — CORRECT (fails closed)

"If the direct-handle termination itself throws, cannot terminate the process, or cannot be confirmed:
`delegation_cutover` remains uncommitted; the workload remains unreleased; the operation fails closed; there is
no `ORCA_DELEGATED` transition; there is no pid-only retry of the kill; there is no automatic native-workload
fallback." Does not pretend cleanup succeeded. Persistence/incident mechanism left as a P1 obligation — accepted
per mission §11. Consistent with §11 row 1: P9 release requires *positive* no-cutover evidence ("process
confirmed absent/terminated"), which an unconfirmed cleanup cannot supply. (Cross-ref defect: N-2; durability:
N-5.)

## 12. Partial sidecar — CORRECT

"A partial/placeholder sidecar is never verified process identity." Structurally ineligible: placeholder has
`osStartMarker:null` (AD-2 producer text, line 70) so check 1/3 of the verifier cannot pass; and "no
`dispatch_process_binding` row exists for it to be read against" — the verifier's `durable` input cannot exist
for (a′) because the AD-2 invariant only allows binding after sidecar-with-pid. P1 RED (8) asserts
`identity_unverifiable`. Retry cannot adopt it (§13).

## 13. Retry — CORRECT

"begins a **fresh** process-identity lifecycle (new spawn, new capture) and must not adopt the incomplete (a′)
sidecar"; "If the Mechanism-A cleanup's outcome is itself uncertain … a new delegated cutover for that dispatch
stays blocked until the pre-cutover cleanup is resolved — never two live workloads for the same logical
attempt." No silent orphan coexistence. Consistent with §11 row 1 (same-token retry; no new token).

## 14. Break-glass consistency — NO CONTRADICTION

§11 table forbids "signal by pid" (row "After cutover … unverifiable") and AD-2 row (b) forbids "signal without
identity verification". Mechanism A never rediscovers or reconstructs identity; the spawning frame owns the
exact object continuously, matching frozen S4 §9.1 shape 1. The text states "No general pid-signalling
exception is introduced anywhere by this fix" and the Forbidden column bans the pid fallback. No ambiguity
creating an exemption. (Quote fidelity: N-3.)

## 15. P1 RED obligations — ALL TEN PRESENT

Hunk 2 lists (1) exact live handle `spawnResult.process`; (2) pid captured from it; (3) marker capture forced to
fail; (4) callback never commits `delegation_cutover`; (5) workload never released; (6) exact process terminated
through the direct handle, never pid lookup; (7) no pid-only signalling (static + dynamic); (8) placeholder
sidecar fed to `verifyRestartRecoveredIdentity` ⇒ `identity_unverifiable`; (9) forced teardown failure fails
closed — no commit, no `ORCA_DELEGATED`, no pid-only retry, no native fallback; (10) retry starts a fresh
lifecycle, no adoption. One-to-one with the mission list. No assertion demands detail beyond the architecture.
The prior obligation ("terminated via the identity-verified path using the in-scope pid") was removed, not left
alongside.

## 16. No new architecture

Both hunks classified in §3. Zero `UNRELATED_ARCHITECTURE_CHANGE`.

## 17. Prior closed findings — UNCHANGED

The diff has exactly two hunks, at new-file lines 79-165 (inside AD-2, which spans 65-181) and 442-457 (inside
§5 P1, 436-460). Untouched by construction: AD-1/H1 (46-63) and §10 restart boundary (672+); P7b/PL-1 (526+);
A-7 (AD-8, 296+); §3 DAG (339+); §8 cross-repo (619+); R3; §9 gate matrix/activation checklist (633+); §10 first
controlled workload. Not re-reviewed semantically.

## 18. Frozen SPEC — UNCHANGED

`git diff --stat 1f70bdf4… 743458076…` touches only five `PRE-LIVE-*` docs (all added). `orca-delegated-cutover/
SPEC.md` last changed at `627b00b0b7` (the frozen accepted head named by the amendment candidate). The PRE_LIVE
amendment (`PRE-LIVE-SPEC-AMENDMENT-CANDIDATE-001.md`) still reads "Candidate. Not frozen" — **CANDIDATE, NOT
FROZEN.**

## 19. aiControl guard — PASS (read-only)

`C:/Users/henrique/Documents/aiControlCenter`: `origin/master` = `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` ✔;
`data/app.db` SHA-256 = `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` ✔; no `-wal`/`-shm`/
`-journal` ✔. `ORCA_FENCE_ACQUISITION_ENABLED` not set in any `.env*` (default off). Nothing modified.

## 20. Non-blocking observations (for the freeze editor / P1; do not reopen AD-2)

- **N-1 — Reachability wording.** The corrected prose says the callback "does the marker capture that can
  throw". At this head `captureOsStartMarkerSync` (`process-instance-discriminator.ts:36-62`) catches on every
  platform and returns `{ osStartMarker: null, osStartMarkerSource: 'unavailable' }` — a soft failure that is
  the frozen S4 L13 window (commit legal; restart verification unconditionally `identity_unverifiable`), not
  (a′). (a′) is reached by a *throw* in the pre-commit window (e.g. the P1-introduced sidecar rewrite, or the
  fault injection RED (3) mandates). Mechanism A is correct for any such throw, so the safety disposition is
  unaffected. Smallest docs fix at freeze: state that a soft `unavailable` result follows L13 and (a′) covers a
  thrown pre-commit failure after spawn.
- **N-2 — Dangling cross-reference.** "Cleanup failure" cites "§12 below" for the observability obligation; §12
  is M5. Point it at §11 row 1 / §9 instead. Operative content of the paragraph is complete without it.
- **N-3 — Quote fidelity.** "Signal without reconstructed identity: Forbidden" is a paraphrase; §11's literal
  wording is "signal by pid" (and AD-2 row (b) "signal without identity verification"). Semantics match.
- **N-4 — Handle kill discipline (P1).** `pty.IPty` is not a `ChildProcess`, so frozen S4's
  `signalProcessTree(handle)` cannot be reused verbatim. node-pty's POSIX `kill()` is understood to address
  `this.pid` internally (not re-verified in `node_modules` during this review); P1 must gate the kill on the
  handle's own not-yet-exited state so a reaped-and-reused pid cannot be hit, mirroring S4 §9.1 shape 1's
  "fails closed on a reaped-pid race". Covered in spirit by RED (6)/(7).
- **N-5 — Durability of "cleanup uncertain".** The retry block is not persisted ("not a new persisted incident
  kind or table") and the placeholder sidecar holds no pid. Across a host restart this relies on the H1
  assumption that in-process node-pty children die with the host (§13 item 5, `[UNVERIFIED]`). Acceptable under
  mission §11 as a P1 obligation; must be revisited for H2.

## 21. Operational state — UNCHANGED

Authority `AICONTROL_NATIVE` · ORCA_DELEGATED **NOT STARTED** · Fence acquisition **DISABLED** · R3 **NOT
STARTED** · M5 **NOT STARTED**. No candidate doc edited, nothing frozen, nothing published.
