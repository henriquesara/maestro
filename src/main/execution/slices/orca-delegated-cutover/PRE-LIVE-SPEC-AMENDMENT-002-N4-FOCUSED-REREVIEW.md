# PRE-LIVE SPEC AMENDMENT-002 (N-4) — FOCUSED REREVIEW OF B1–B4 CORRECTIONS

**Scope.** This review checks only that independent-review blockers B1–B4 (and clarifications N1–N4) are closed by
the corrected candidate, and that the correction added no new load-bearing claim that lacks support. It is
not a full re-review of the N-4 architecture.

| Item | Value |
| --- | --- |
| Base (origin/main) | `9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21` |
| Original candidate | `d709fdb0373dff9976b4257691dddd6791831dc6` |
| Independent review | `0abd5dddf04d018f1ca5938d2aa0a4cb7661aa58` |
| Corrected candidate (reviewed) | `6159a8dfae2d04a2c82b7c7d4d58f7a018414890` |
| Reviewer | Fresh session; did not author the amendment, the original candidate or the independent review |

## 1. Process

- **Independence:** this session authored none of the candidate, the review or the correction. The review was
  done in an isolated detached worktree at `6159a8df`. The amendment was not edited.
- **Lineage:** verified linear, one parent per hop. `d709fdb ← 9c4383fe`; `0abd5ddd ← d709fdb`;
  `6159a8df ← 0abd5ddd`. `origin/main` = `9c4383fe` after fetch.
- **Exact diff, `0abd5ddd..6159a8df`:** `M PRE-LIVE-SPEC-AMENDMENT-002-N4-PLATFORM-SAFE-PRECUTOVER-CLEANUP.md`
  only (+567/−191). Nothing else changed.
- **Review read first:** the independent review (0abd5ddd) was read in full before the correction.

## 2. Blocker matrix

| Blocker | Sub-check | Evidence | Verdict |
| --- | --- | --- | --- |
| **B1** | Pre-fence ordering | §4.4 orders ineligibility rejection before `acquireOrcaFence` and before `run_reservation`. | CLOSED |
| B1 | Current-source non-compliance stated | §4.4 says "Current production violates this ordering". Source confirms it: `orca-runtime-create-agent-session.ts:233-240` passes `providerEligible: !isRemote` into `establishReservation`. `delegated-cutover-reservation-step.ts` then runs eligibility → `acquireOrcaFence` → `reserve`. The real capability check only runs later, at `spawn-options.ts:161-171`. | CLOSED (accurate) |
| B1 | One capability answer at admission and spawn | §4.4: the same `supportsDelegatedCutoverHold` answer, made W-E-qualified, is consulted at S1. The spawn-options check stays as defence in depth. A disagreement between the two seams is a defect, and P1 RED must prove both seams use the same answer. Knowability check: the S1 site can reach the provider before fence through the in-process registry (`getLocalPtyProvider()`, `ipc/pty/provider/registry.ts:128`). The contract signature accepts probe options and may be async (`pty-provider-contract.ts:169`). | CLOSED |
| B1 | Linux negative contract | §4.5 R-1 says: no fence request, no `run_reservation`, no spawn, no sidecar, no cutover, no fallback; authority stays `AICONTROL_NATIVE`. §9 LE-1…LE-6. | CLOSED |
| B1 | P1 Contract B at the real seam | §10 B: Linux negative asserted at the real admission and spawn seams. `acquireOrcaFence` is never invoked and no `run_reservation` is written. | CLOSED |
| **B2** | No "win32 ⇒ eligible" rule | §4.1–4.3 define W-E1 (win32), W-E2 (build ≥ 18309), W-E3 (`useConptyDll: true` and no `useConpty: false`) and W-E4 (local, non-remote, non-daemon). All four are required. | CLOSED |
| B2 | Source proof of the 18309 threshold | `node-pty/lib/windowsPtyAgent.js:37-39`: `_useConpty === undefined \|\| === true` ⇒ `_useConpty = _getWindowsBuildNumber() >= 18309`. Lines 211-218 return `0` when the build is unparseable. The threshold and "unparseable ⇒ 0" are both existing node-pty behaviour, and the amendment attributes them correctly. | CLOSED |
| B2 | node-pty behaviour vs Maestro policy | The amendment separates the two. node-pty's backend selection is mirrored; Maestro's refusal policy is layered on top. | CLOSED |
| B2 | Pre-fence knowability | Every input is knowable before fence: `process.platform`, `os.release()`, the spawn options (`windowsConptyDllOptions()`, `local-pty-utils.ts:174-176`) and the provider identity from the registry. | CLOSED |
| B2 | Backend matrix | Rows for ConPTY-DLL ✔, non-DLL ConPTY ✘, winpty (< 18309) ✘, unknown or unparseable ✘, Linux ✘, macOS ✘, daemon ✘ and remote ✘. These match node-pty's kill paths: DLL uses HANDLE `PtyKill`; non-DLL uses `_getConsoleProcessList` + `process.kill(pid)`; winpty uses `getProcessList` + `process.kill`. | CLOSED |
| B2 | No post-spawn rescue | §6 WP-1 is a pre-spawn predicate. The post-spawn backend check is an assertion only; it never admits. | CLOSED |
| B2 | No silent fallback | §4.5 R-2 and §7: fail closed, no retry, no fallback to native or another backend. | CLOSED |
| **B3** | Exact A-8 supersession | S-3 targets only the A-8 clause "no change to the capability contract or the eligibility gate (§7.3)". That clause is at AMENDMENT-001 lines 198-199 (verified), and the rest of A-8 is preserved. The S-2 targets exist: ARCH §10 "Windows or Linux only" at :679, PL-14 at :661 and the P1 "(Windows/Linux)" at :458 (all verified). | CLOSED |
| B3 | SPEC §7.3 | S-7 targets "`LocalPtyProvider` declares it `true`" at SPEC :1638 (verified). The rest of §7.3 is kept: probe shape, absent ⇒ false, the throw, and "checked before S2" (SPEC :1641-1643). | CLOSED |
| B3 | Gate 52 old evidence | Classified `SUPERSEDED_NEEDS_REPROOF`. This is the unconditional `true` assertion at `spawn-options-delegated-cutover-capability-gate.test.ts:92-107`, which runs on ubuntu-latest. R-5/CI impact recorded; the assertion may not be silently deleted. | CLOSED |
| B3 | Gate 52 definition vs evidence (no word games) | Gate 52's literal text (SPEC :2415-2418) is "Unsupported provider is rejected before cutover — §7.3's gate, proven against a stub provider that does not declare `supportsDelegatedCutoverHold`, asserting `acquireOrcaFence` is never called". It does not name `LocalPtyProvider` as supported, so the text stays valid unchanged. What "unsupported" means comes from §7.3, and the amendment changes that openly, and only there, through S-7. "Definition kept" plus "'Unsupported' now includes…" is a consistent, disclosed change of meaning carried by §7.3, not a hidden redefinition. | CLOSED |
| B3 | Gate 52 new evidence | §11.3 table covers: Windows-eligible true; Linux false; unsafe or unknown Windows false; stub, daemon and remote false; non-delegated unaffected; both seams agree. | CLOSED |
| **B4** | Full S1–S10 inventory | §11.1–11.2 cover S1–S10, matching ARCH §10 :702. | CLOSED |
| B4 | S9 | Preserved on Windows: tampered sidecar ⇒ no signal. | CLOSED |
| B4 | S10 POSIX form | Marked not applicable on the first host. It moves to LE-6, the future POSIX re-enablement, and is not dropped. | CLOSED |
| B4 | S10 Windows safety intent | S10-W(a): after cutover, cancellation completes only on observed death, per P3. S10-W(b): before cutover, a queued kill or expiry of the bound ⇒ `CLEANUP_UNCERTAIN`, with no cutover, release, retry or fallback. Together these keep S10's intent: never assume death. | CLOSED |
| B4 | Future POSIX S10 | LE-6 requires POSIX S10 before Linux can be re-enabled. | CLOSED |

**New load-bearing unsupported claims introduced by the correction: none found.** One claim is overstated, but
in the conservative direction (N1 below). It is non-blocking.

## 3. N1–N4 classifications

- **N1, CLEANUP_CONFIRMED observability:** **P1_MUST_DISCOVER**, not KNOWN_UNREACHABLE.
  - The amendment names the public-API risk. It authorizes neither reading the private `_agent._exitCode` nor a
    new node-pty patch hunk, and P1 must stop and return to review if neither path works. That closes N1.
  - Non-blocking accuracy note: the sentence "no public event carries it" is overstated. In
    `src/win/conpty.cc` (108-178), the exit-watcher thread waits on the process handle with
    `WaitForSingleObject(hShell)`, reads the code with `GetExitCodeProcess`, and passes it to JS through
    `tsfn.BlockingCall`. That sets `_exitCode`, and `PtyKill` does not cancel it. Separately,
    `windowsTerminal.js:101-104` emits `'exit'` with `this._agent.exitCode` when the socket closes, and
    `terminal.js:93` forwards that to the public `onExit`.
  - So on the DLL kill path, the public `onExit.exitCode` is the code read from the process handle (call it
    handle-derived) if the native callback runs before the socket closes, and `undefined` otherwise. That is a
    race, not a guarantee. The amendment's stricter wording is therefore safe. P1 must pin which observable
    it uses.
- **N2, 8 s bound:** **VALID_REUSE**. `LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS = 8_000`
  (`local-pty-termination.ts:26`) is the existing physical-exit wait bound. §5 reuses the bound only, not the
  `markExited` or tracker signal as proof of death, and expiry ⇒ `CLEANUP_UNCERTAIN`.
- **N3, deferred kill:** CLOSED. `windowsTerminal.js:175-186` (`_deferNoArgs`) queues a kill made before the
  terminal is ready. §5 treats a queued kill as not executed ⇒ `CLEANUP_UNCERTAIN` (and S10-W(b)).
- **N4, shell fallback:** CLOSED. `spawnWindowsFallbackChain` (`local-pty-utils.ts:178-205`) keeps
  `windowsConptyDllOptions()` and changes only the shell, so the backend and eligibility follow unchanged (§4.6).
- **Non-blocking implementation note for P1:** the S1 admission check must consult the provider the registry
  actually has at admission time. After daemon init that can be a `DaemonPtyAdapter`, and W-E4 must answer
  false for it. The check must also not race the provider swap during startup
  (`getLocalPtyProviderStartupPromise`). The amendment's "one answer at both seams" contract already covers
  this; it is noted so P1 RED exercises it.

## 4. Unchanged areas

| Area | Verdict |
| --- | --- |
| Mechanism A | UNCHANGED in intent, narrowed to the eligible host only (S-1). |
| Mechanism B | UNCHANGED. |
| N-5 / H2 | UNCHANGED (§8). |
| DAG / P0 | DAG UNCHANGED. P0 gains a two-part host decision (§11.4); no schema change (§11.5). |

## 5. P1 RED

- Contracts A–F are defined (§10).
- Current production must still fail RED, and it does:
  - `LocalPtyProvider.supportsDelegatedCutoverHold()` returns `true` unconditionally
    (`local-pty-provider.ts:77-79`);
  - admission passes `providerEligible: !isRemote`.
- So Contract B (Linux negative: fence never requested) and Contract C (unsafe Windows refused before fence)
  fail on today's code. That confirms the RED contracts have real targets.

## 6. Guards

- **Frozen-doc immutability:** `git diff --name-status 9c4383fe 6159a8df` shows only three added files:
  `P1-N4-PLATFORM-SAFETY-DISCOVERY.md`, the review, and the amendment. SPEC.md, ARCHITECTURE,
  AMENDMENT-CANDIDATE-001 and both RATIFICATION docs are byte-identical to base. **PASS.**
- **aiControl guard (read-only, `C:/Users/henrique/Documents/aiControlCenter`):** **PASS.**
  - `origin/master` = `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`.
  - `data/app.db` SHA-256 = `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`.
  - No `-wal`, `-shm` or `-journal` files.
  - `ORCA_FENCE_ACQUISITION_ENABLED` is absent.
  - Dirty state was not touched.
- **Operational state (unchanged):**

  | Item | State |
  | --- | --- |
  | Authority | `AICONTROL_NATIVE` |
  | ORCA_DELEGATED | NOT STARTED |
  | Fence acquisition | DISABLED |
  | R3 | NOT STARTED |
  | M5 | NOT STARTED |
  | P1 | BLOCKED |
  | Publication | NOT PUBLISHED |
  | Freeze | NOT FROZEN |

## 7. Verdict

All of B1–B4 are CLOSED, and no new blocker was found.

```
state_class:                     N4_ARCHITECTURE_AMENDMENT_ACCEPTED_READY_TO_FREEZE
display_verdict:                 ORCA_S5_PRELIVE_N4_PLATFORM_SAFETY_AMENDMENT_ACCEPTED_READY_TO_FREEZE
accepted_amendment_content_head: 6159a8dfae2d04a2c82b7c7d4d58f7a018414890
P1:                              BLOCKED UNTIL FREEZE + INDEPENDENT FREEZE VERIFICATION + PUBLICATION
```
