# PRE_LIVE SPEC Amendment 002 (N-4) — Independent Freeze Verification

**This is a freeze verification record only.** It does not edit, restate or reinterpret Amendment-002. Where
this record summarizes a rule, the accepted amendment text at the normative content HEAD wins.

| Role | Commit |
| --- | --- |
| Canonical published base (`origin/main`) | `9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21` |
| Original candidate | `d709fdb0373dff9976b4257691dddd6791831dc6` |
| Independent review | `0abd5dddf04d018f1ca5938d2aa0a4cb7661aa58` |
| **Normative Amendment-002 content HEAD** | **`6159a8dfae2d04a2c82b7c7d4d58f7a018414890`** |
| Focused independent rereview | `ee046ec86d3844c5ed4ea57482632ee38c96e989` |
| **Freeze / ratification HEAD (verified)** | **`bf0b0edbc68a9383b8d765d4427c539cf32a86af`** |

## 1. Reviewer independence

- This verification ran in a fresh session with no carried-over authoring context, in a clean worktree created
  from `bf0b0edb` (`C:/mw-orca-s5-n4-freeze-verify`, branch `verify/orca-s5-n4-freeze-verification`).
- This session authored none of `6159a8df`, `ee046ec8` or `bf0b0edb`, nor `d709fdb0` or `0abd5ddd`.
- All chain commits share the repository git identity (the operator). Independence is therefore session-level,
  as for every prior review in this chain.
- No file other than this record was written. No reviewed artifact was edited.

## 2. Fetch / base

`git fetch origin` → `origin/main == 9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21`. **No remote drift.** Re-checked
at the end of verification: unchanged.

## 3. Exact lineage

| Hop | Parent (single) | Merge? |
| --- | --- | --- |
| `d709fdb0` | `9c4383fe` | no |
| `0abd5ddd` | `d709fdb0` | no |
| `6159a8df` | `0abd5ddd` | no |
| `ee046ec8` | `6159a8df` | no |
| `bf0b0edb` | `ee046ec8` | no |

- `git rev-list --count 9c4383fe..bf0b0edb` = 5; `--merges` = 0; `9c4383fe` is an ancestor of `bf0b0edb`.
- All commits are locally reachable. `ee046ec8` is contained in local branches `orca-s5-n4-amendment-002` and
  `review/orca-s5-prelive-n4-focused-rereview`.
- Every hop's SHA matches the published lineage exactly; no amend or rebase reconstruction.

**PASS.**

## 4. Freeze diff (`ee046ec8 → bf0b0edb`)

```
A  src/main/execution/slices/orca-delegated-cutover/PRE-LIVE-SPEC-AMENDMENT-002-N4-STATUS-RATIFICATION.md
```

Exactly one added file. Zero modifications to the amendment, discovery, independent review, focused rereview,
frozen PRE_LIVE docs, source, tests or schema. **PASS — no `N4_FREEZE_SCOPE_VIOLATION`.**

Per-hop scope (for completeness):

| Hop | Change |
| --- | --- |
| `9c4383fe → d709fdb0` | A discovery, A amendment |
| `d709fdb0 → 0abd5ddd` | A independent review |
| `0abd5ddd → 6159a8df` | M amendment (only) |
| `6159a8df → ee046ec8` | A focused rereview |
| `ee046ec8 → bf0b0edb` | A status ratification |

## 5. Normative content identity

`PRE-LIVE-SPEC-AMENDMENT-002-N4-PLATFORM-SAFE-PRECUTOVER-CLEANUP.md` blob:

| Commit | Blob |
| --- | --- |
| `6159a8df` | `ef6fe4dff06e8c23a8e0fcb76cab2ae1e05bd404` |
| `ee046ec8` | `ef6fe4dff06e8c23a8e0fcb76cab2ae1e05bd404` |
| `bf0b0edb` | `ef6fe4dff06e8c23a8e0fcb76cab2ae1e05bd404` |

Byte-identical. **PASS — no `N4_NORMATIVE_CONTENT_CHANGED_AFTER_ACCEPTANCE`.**

## 6. Acceptance authority

`PRE-LIVE-SPEC-AMENDMENT-002-N4-FOCUSED-REREVIEW.md` (`ee046ec8`) records B1, B2, B3, B4 all **CLOSED**, no new
blocker, `state_class: N4_ARCHITECTURE_AMENDMENT_ACCEPTED_READY_TO_FREEZE`,
`accepted_amendment_content_head: 6159a8dfae2d04a2c82b7c7d4d58f7a018414890`. **PASS.**

## 7. Ratification semantics

The ratification (§2) marks Amendment-002 **FROZEN · INDEPENDENTLY ACCEPTED · NOT YET PUBLISHED**, and states
explicitly it does **not** mean PRE_LIVE complete, LIVE ready, ORCA_DELEGATED active or delegated Linux enabled.
It does not mark P1 started; it records P1 **NOT AUTHORIZED** until freeze verification **and** publication.
Its own verdict is `N4_AMENDMENT_FROZEN_READY_FOR_INDEPENDENT_FREEZE_VERIFICATION`. **PASS.**

## 8. Semantic cross-check, ratification vs accepted content

| # | Item | Ratification | Accepted source | Verdict |
| --- | --- | --- | --- | --- |
| 8 | **B1** ordering | §3.1: capability decided before fence attempt → `run_reservation` → spawn → sidecar → `dispatch_process_binding` → `delegation_cutover` → release; ineligible ⇒ no fence attempt, reservation, process or fallback; production non-compliant until P1 (`providerEligible: !isRemote`, source re-confirmed at `orca-runtime-create-agent-session.ts:238`) | §4.4 items 1–7, §4.5 R-1 | **MATCH** |
| 9 | **B2** backend-specific eligibility | §3.2: "`OS == Windows` is **not sufficient**"; W-E1…W-E4 all required, pre-flight | §4.1–§4.2 | **MATCH** — no "Windows == safe" simplification |
| 10 | Build rule | §3.2: W-E2 = build `>= 18309` evaluated exactly as node-pty does (3rd component of `os.release()`, unparseable ⇒ `0` ⇒ fails); node-pty behaviour (winpty selection) stated separately from Maestro's fail-closed "unknown/unproven ⇒ NOT ELIGIBLE"; "no other Maestro-specific parse rule" | §4.2, §4.3 | **MATCH** — source re-confirmed: `windowsPtyAgent.js:37-39` and `:211-218` in installed `node-pty@1.1.0` (+patch) |
| 11 | Matrix | §3.2 table: 8 rows | §4.3 table: 8 rows | **MATCH** row-for-row (see §9 below) |
| 12 | **B3** supersession set | §3.3 S-1…S-8 + "explicitly not superseded" list | §12 S-1…S-8 + §11.3 "Unchanged" row | **MATCH** — A-8 capability clause only (S-3); SPEC §7.3 sentence (S-7); Gate 52 evidence (S-8); P1 Windows/Linux (S-2, S-4); PL-4/PL-14 wording (S-2, S-4); first-workload scope (S-2); timing argument (S-5); first-host S10 (S-6). No other frozen semantics superseded |
| 13 | Gate 52 | §3.4: old evidence `SUPERSEDED_NEEDS_REPROOF`; definition unchanged; "No gate is marked COMPLETE"; new-evidence table covers eligible Windows, Linux negative, unsafe Windows, unknown, stub/daemon/remote, non-delegated, both seams; R-5/CI named assertion change | §11.3 | **MATCH** — source re-confirmed: unconditional `toBe(true)` at `spawn-options-delegated-cutover-capability-gate.test.ts:92-107` |
| 14 | **B4** S1–S10 | §3.5: S1–S8 preserved on Windows; S9 preserved; S10 POSIX → LE-6; S10-W(a)/(b) preserve TERMINATION REQUEST ≠ CLEANUP CONFIRMED; no SIGTERM semantics invented | §11.2 | **MATCH** — all ten accounted for |
| 15 | Cleanup state model | §3.6: `SAFE_TARGET_SELECTED` ≠ `KILL_REQUESTED` ≠ `KILL_EXECUTED` ≠ `CLEANUP_CONFIRMED`; uncertain ⇒ no cutover, release, retry, fallback | §5 chain, §7 | **MATCH** — no pair collapsed |
| 16 | Public-API confirmation | §3.7: N1 non-blocking; public `onExit.exitCode` *may* carry the HANDLE-derived code when the native callback wins the race; signal not frozen; P1 must identify it; no pre-authorization of `_agent._exitCode`, undocumented internals or a node-pty patch; §3.8: no supported seam ⇒ **P1 MUST STOP** for architecture | §5 "Reachability" + rereview §3 N1 | **MATCH** — "undocumented internals" is a fail-closed restatement of §5's "supported surfaces", not a widening |
| 17 | 8-second bound | §3.9: `LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS = 8000` reused only as the physical-exit wait bound; not task timeout / SLA / G-H / classification; `markExited` not reused; expiry ⇒ `CLEANUP_UNCERTAIN` | §5 "Bound" | **MATCH** — source re-confirmed `local-pty-termination.ts:26` = `8_000` |
| 18 | Deferred kill | §3.10: queued ≠ executed; unexecuted at bound ⇒ `CLEANUP_UNCERTAIN`, no fallback | §5, §7, §11.2 S10-W(b) | **MATCH** |
| 19 | Provider-registry consistency | §3.11: same effective provider/backend capability at pre-fence decision and spawn; P1 must prove no admission/spawn race; no sync mechanism invented | §4.4 "one capability answer … P1 RED must prove they consult the same answer"; rereview §3 implementation note | **MATCH** — obligation grounded in accepted §4.4 |
| 20 | Mechanism A | §3.12: object identity insufficient; stable kernel-held non-reusable target + pre-fence eligibility; ConPTY-DLL HANDLE path is the only positive candidate | §3 | **MATCH** |
| 21 | Mechanism B | §3.12: UNCHANGED; no HANDLE shortcut after restart | §3, §12 not-superseded | **MATCH** |
| 22 | Linux | §3.14: `DELEGATED_LINUX = DISABLED`; non-delegated unchanged (R-3); LE-1…LE-6; no primitive selected; §13 N-4 classification lines kept visible | §9, §13 | **MATCH** — pidfd only as a non-normative example in source; not frozen |
| 23 | N-5 / H2 | §3.13: N-5 OPEN; narrow H1 only | §8 | **MATCH** |
| 24 | P1 A–F | §3.16: A Windows positive; B Linux pre-fence reject; C unsafe/unknown Windows pre-fence reject; D non-delegated controls; E ten AD-2 remapped; F Gate 52 re-proof; plus provider-registry consistency | §10 A–F | **MATCH** |
| 26 | DAG / P0 | §3.17: DAG unchanged; P0 includes the two-part decision (Windows ConPTY-DLL only / Linux disabled; pre-fence ordering) | §11.4 | **MATCH** |
| 27 | Schema | §3.17: no change; no persisted capability field | §11.5 | **MATCH** |

## 9. Platform / backend matrix

| Host / backend | Accepted §4.3 | Ratification §3.2 | Verdict |
| --- | --- | --- | --- |
| Windows + `LocalPtyProvider` + W-E1…W-E4 (ConPTY DLL) | ELIGIBLE, subject to P1 proof | same | MATCH |
| Windows build < 18309 / unparseable (winpty) | INELIGIBLE before fence | same | MATCH |
| Windows non-DLL ConPTY (pid-targeting) | INELIGIBLE before fence | same | MATCH |
| Linux/POSIX | INELIGIBLE before fence (`DELEGATED_LINUX = DISABLED`) | same | MATCH |
| macOS | NOT ELIGIBLE for first controlled workload | same | MATCH |
| Daemon | NOT ELIGIBLE | same | MATCH |
| Remote / SSH | NOT ELIGIBLE | same | MATCH |
| Unknown / unproven backend | NOT ELIGIBLE | same | MATCH |

## 10. Non-blocking observations (no correction required)

The ratification states (§1) that it does not restate the normative content and that the accepted text wins.
Under that precedence the following summary omissions change no semantics; they are recorded so P1 does not
treat the ratification as exhaustive.

- **O-1.** Ratification S-1 row names only the AD-2 Mechanism A control basis. Accepted S-1 also covers "P1 RED
  obligation (6) as unqualified by platform/backend", read per §10.E. The ratification carries §10.E in §3.16 E.
- **O-2.** Ratification §3.6 does not restate the accepted §5 **Descendants** constraint: root exit alone does
  not prove tree cleanup; `terminatePtyJob` `'unavailable'` ⇒ not confirmed; pid-addressed `taskkill`
  degradation forbidden (SIG-1); whether the first scripted workload is descendant-free is a P1 decision that
  review must accept explicitly. **This remains binding on P1 via the accepted text.**
- **O-3.** Ratification does not restate the accepted §11.3 row for ARCH §13 item 5 ([UNVERIFIED] node-pty
  survival across host exit: Windows measurement unchanged, Linux to the Linux track). It is an impact row, not a
  §12 supersession, so the "nothing else" supersession claim still holds.
- **O-4.** Ratification §3.11 elevates the rereview's non-blocking provider-registry note to a P1 RED obligation.
  This is grounded in accepted §4.4 and invents no mechanism.

No unresolved risk is classified as solved: N-5 OPEN, Linux OPEN (platform enablement blocker), winpty EXCLUDED,
`CLEANUP_CONFIRMED` observable P1_MUST_DISCOVER with a stop condition, Gate 52 SUPERSEDED_NEEDS_REPROOF.

## 11. P1 authorization boundary

- Before this verification: P1 **BLOCKED**.
- After this verification (passed): P1 remains **BLOCKED UNTIL PUBLICATION**.
- Only after publication of the full Amendment-002 chain (`d709fdb0 … bf0b0edb` + this record) does **P1 GENUINE
  RED** become authorized.
- This record grants no P1 implementation authorization.

## 12. Prior frozen-document immutability

`git diff --name-status 9c4383fe bf0b0edb` shows **only five added files** (discovery, amendment, independent
review, focused rereview, ratification). SPEC.md, ARCHITECTURE, AMENDMENT-CANDIDATE-001, both RATIFICATION
documents and every other published PRE_LIVE artifact are byte-identical to base. **PASS.**

## 13. Guards

**aiControl (read-only, `C:/Users/henrique/Documents/aiControlCenter`), before and after:**
- `origin/master == ab5967bdde5115afe6673e8b520a73cfb29f0eaf`;
- `data/app.db` SHA-256 `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`;
- no `-wal` / `-shm` / `-journal`;
- `ORCA_FENCE_ACQUISITION_ENABLED` absent — fence acquisition disabled;
- existing dirty state not touched.

**PASS.**

**Docs-only.** This commit adds only this file. No code, tests, schema, node-pty, aiControl or ratification
change. Not published.

## 14. Operational state (unchanged)

| Item | State |
| --- | --- |
| Amendment-002 | FROZEN / INDEPENDENTLY ACCEPTED |
| Publication | NOT YET PERFORMED |
| P1 | AUTHORIZED ONLY AFTER PUBLICATION — current: NOT STARTED |
| Authority | `AICONTROL_NATIVE` |
| ORCA_DELEGATED | NOT STARTED |
| Fence acquisition | DISABLED |
| R3 | NOT STARTED |
| M5 | NOT STARTED |

## 15. Verdict

```
state_class:                        N4_AMENDMENT_FROZEN_READY_FOR_PUBLICATION
display_verdict:                    ORCA_S5_PRELIVE_N4_PLATFORM_SAFETY_AMENDMENT_FREEZE_VERIFIED_READY_FOR_PUBLICATION
normative_amendment_content_head:   6159a8dfae2d04a2c82b7c7d4d58f7a018414890
freeze_ratification_head:           bf0b0edbc68a9383b8d765d4427c539cf32a86af
```
