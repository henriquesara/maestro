# PRE_LIVE AMENDMENT-002 (N-4 Platform-Safe Pre-Cutover Cleanup) — Independent Architecture Review

**Status:** INDEPENDENT REVIEW — NOT A FREEZE, NOT A PUBLICATION, NOT AN AMENDMENT.
**Candidate reviewed:** `d709fdb0373dff9976b4257691dddd6791831dc6`
**Candidate base:** `9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21` (= `origin/main`)
**Frozen normative content HEAD:** `743458076769911cfe1fa5193f7c38ec4610ffee`
**Documents under review:**
`PRE-LIVE-SPEC-AMENDMENT-002-N4-PLATFORM-SAFE-PRECUTOVER-CLEANUP.md` (the amendment) and
`P1-N4-PLATFORM-SAFETY-DISCOVERY.md` (the discovery).

**Final verdict:** `N4_ARCHITECTURE_AMENDMENT_CHANGES_REQUIRED` /
`ORCA_S5_PRELIVE_N4_PLATFORM_SAFETY_AMENDMENT_CHANGES_REQUIRED`.

There are four blockers, B1–B4, and every one can be corrected in the docs alone. There are also four required
clarifications, N1–N4. P1 GENUINE RED stays **BLOCKED** until a corrected amendment is accepted and frozen.

---

## 0. Independence and method

- The reviewer did not author the amendment, the discovery, or any frozen PRE_LIVE document. The review ran in a
  separate detached worktree at the candidate SHA.
- Every claim below was re-derived from source in this checkout. The sources were:
  - Orca's `src/`;
  - the installed `node-pty@1.1.0`, with Orca's patch applied (`lib/*.js`, `src/win/conpty.cc`,
    `src/unix/pty.cc`);
  - `config/patches/node-pty@1.1.0.patch`;
  - the frozen PRE_LIVE documents;
  - the CI workflow definitions.
- The trigger prompt's citations and the amendment's own reasoning were treated as claims to verify, not as
  evidence.
- Nothing was executed against aiControl. Its guard was checked read-only (§36).
- Arguments of the form "PID reuse is unlikely" were rejected on principle; none of the verdicts rests on one.

## 1. Summary of findings

| Id | Kind | Section(s) of amendment | One line |
| --- | --- | --- | --- |
| B1 | Blocker | §4 R-1, §10 Contract B | The fence and the run_reservation are taken **before** the capability gate rejects a Linux delegated request. |
| B2 | Blocker | §3, §4, §6 WP-1 | "win32" is not a safe qualifier: on Windows builds below 18309, node-pty silently uses pid-based **winpty**. |
| B3 | Blocker | §12 S-2, "Not superseded" | The supersession targets text A-8 does not contain, and leaves out the clauses (A-8, SPEC §7.3, gate 52 evidence) that it actually changes. |
| B4 | Blocker | §11 | "S1–S8 remain" silently drops S9 and S10. The SIGTERM-ignoring workload means nothing on Windows. |
| N1 | Clarification | §5 | The only exit code derived from the HANDLE is private (`_agent._exitCode`), and the public `'exit'` on the kill path probably carries `undefined`. |
| N2 | Clarification | §5 | Only the tracker's bound may be reused, not its success signal, and the bound must be named exactly (`LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS`). |
| N3 | Clarification | §5, §7 | `_deferNoArgs` can keep `kill()` from ever executing. |
| N4 | Clarification | §4 R-2 | The Windows shell fallback chain keeps the DLL options but changes the shell. |

---

## 2. Per-section verdicts (mission §§1–37)

| § | Topic | Verdict |
| --- | --- | --- |
| 1 | Independence | PASS |
| 2 | Lineage | PASS |
| 3 | Frozen contract understood correctly | PASS with B3 |
| 4 | Linux N-4 reproduction | PASS (confirmed) |
| 5 | Windows backend matrix | **FAIL — B2** |
| 6 | ConPTY id / HANDLE stability | PASS |
| 7 | Exit observation | PASS with N1 |
| 8 | SAFE_TARGET vs CLEANUP_CONFIRMED | PASS with N1/N2 |
| 9 | Undefined exit code | PASS |
| 10 | Wait bound | PASS with N2/N3 |
| 11 | terminatePtyJob | PASS |
| 12 | Gate location | **FAIL — B1** |
| 13 | Pre-spawn side effects | **FAIL — B1** |
| 14 | All delegated entry paths | PASS (one production path) — feeds B1 |
| 15 | Non-delegated Linux unaffected | PASS |
| 16 | No silent fallback | **FAIL — B2** (host-level), N4 (shell-level) |
| 17 | Mechanism A | PASS on the DLL path; conditional on B2 |
| 18 | Mechanism B | PASS (unchanged) |
| 19 | A-8 supersession | **FAIL — B3** |
| 20 | N-4 status | PASS |
| 21 | First workload | **FAIL — B2, B4** |
| 22 | P1 RED contract | **FAIL — B1** (Contract B) |
| 23 | 10-obligation map | PASS with B1/B4 corrections |
| 24 | Cleanup uncertainty | PASS with N1/N3 |
| 25 | N-5 / H2 | PASS (unchanged) |
| 26 | LE-1 … LE-6 | PASS |
| 27 | Gate impact | **FAIL — B3** (gate 52 evidence) |
| 28 | PL impact | PASS with B3 (PL-14 wording) |
| 29 | DAG | PASS (unchanged) |
| 30 | P0 | PASS |
| 31 | Daemon | PASS (stays ineligible) |
| 32 | Schema | PASS (none) |
| 33 | Source evidence vs architecture | **FAIL — B1, B2** |
| 34 | Minimality | PASS (the corrections stay docs-only and reuse existing seams) |
| 35 | Frozen immutability | PASS |
| 36 | aiControl guard | PASS |
| 37 | Operational state | PASS |

---

## 3. Verified PASS evidence

### §1–2, §35 Independence, lineage and frozen immutability

- The candidate `d709fdb` has one parent, `9c4383fe` (= `origin/main`).
- `git diff --name-status 9c4383fe d709fdb` returns two added files (`A`, `A`): the amendment and the discovery.
  No existing file is modified.
- `743458` is an ancestor of `9c4383fe`. The span `743458..9c4383fe` adds only three status documents
  (AD2-FINAL-REREVIEW, FREEZE-VERIFICATION, RATIFICATION-001). The frozen normative documents (SPEC, ARCH,
  AMENDMENT-001) are byte-identical at the candidate.

### §4 Linux N-4 — CONFIRMED

The discovery's L1–L7 findings check out against the source:

- `UnixTerminal.prototype.kill` is `process.kill(this.pid, signal || 'SIGHUP')`. It has no guard for an exited
  child.
- In the native Linux path (`src/unix/pty.cc`), `waitpid` (≈:194) completes before `tsfn.BlockingCall` (≈:216).
  The kernel has therefore released the pid before JS can observe the exit.
- No identity token (pidfd or anything similar) is retained.
- The patch does not touch `kill` or the order of the reap.

The window is **wider** than the discovery states. `UnixTerminal` defers the public `'exit'` until the socket
closes (`DESTROY_SOCKET_TIMEOUT_MS` = 200 ms), so the gap between the reap and JS-visible exit includes that
deferral as well as normal event-loop scheduling.

Conclusion: `IPty.kill()` on Linux is not identity-safe for Mechanism A. No timing argument rescues it.

### §6 ConPTY id/HANDLE stability — PASS

- `_pty` is the baton id minted by `InterlockedIncrement(&ptyCounter)` (conpty.cc ≈:353). It is never reissued
  during the life of the process.
- `PtyKill` (≈638–720) looks up the baton under `ptyJobMutex` and calls `DuplicateHandle(hShell)`. Outside the
  lock it calls `ClosePseudoConsole` and then `TerminateProcess(hShellDup, 1)`.
- The watcher thread nulls `hShell` under the same mutex when the shell exits. A held HANDLE keeps the kernel
  process object alive, so the target cannot be a recycled pid.

This holds **only** on the `_useConpty && _useConptyDll` branch (see B2).

### §9 Undefined exit code — TRUE

`windowsTerminal.js` (≈:101–102) emits `'exit'` on socket `'close'` with `_agent.exitCode`. That value stays
`undefined` until `_$onProcessExit` runs, so the amendment is right that an `'exit'` with `undefined` is not
confirmation.

### §10 Wait bound — an existing bound exists and was not invented

`LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS = 8_000` is defined at `src/main/providers/local-pty-termination.ts:26`. On
expiry, `waitForPtyPhysicalExit` rejects with "Timed out waiting for PTY process exit". The amendment's "e.g." must
be made exact (N2).

### §11 terminatePtyJob — PASS

`src/main/windows/windows-pty-job.ts:72-116` behaves as the amendment says:

- It returns `'unavailable'` and never a false `'terminated'`.
- `shellPid` is an ownership proof checked natively, not a lookup key.

The only `taskkill` degradation is in `local-pty-termination.ts` (≈:181), which is outside the delegated contract.
The amendment's ban on `taskkill` and its "unavailable ⇒ not confirmed" rule are both consistent with the source.

### §14–15 Entry paths and non-delegated Linux

The only production delegated entry is `src/main/runtime/orca-runtime-create-agent-session.ts:221-260`, which sets
`deferDelegatedCommandDelivery: true` at :259. The other `pty.spawn` sites are not delegated:

- daemon `native-pty-spawn.ts`;
- `windows-conpty-warmup.ts`;
- relay `pty-handler.ts`;
- the rate-limit probes;
- the zsh harness;
- `spawn-preflight.ts`.

The gate at `spawn-options.ts:161-171` only acts on `deferDelegatedCommandDelivery === true`, so non-delegated
Linux spawns are unaffected.

### §18, §25, §26, §29–32 Unchanged areas

- Mechanism B and N-5/H2 have unchanged semantics.
- LE-1…LE-6 are consistent with the source.
- The DAG and P0 decision are unchanged.
- The daemon stays ineligible (R-4).
- There is no schema change.

---

## 4. Blockers

### B1 — The capability gate is not the earliest eligibility point; the fence and reservation precede it

- **Amendment sections:** §4 R-1 and §10 Contract B. Also affects mission §§12, 13, 22 and 33.
- **Evidence:**
  - `orca-runtime-create-agent-session.ts:221-260` calls
    `establishReservation({ …, providerEligible: !isRemote, … })` **before** `createTerminal` reaches
    `spawn-options.ts:161-171`.
  - In `delegated-cutover-reservation-step.ts`, `providerEligible === false` throws `provider_ineligible`.
    Otherwise it calls `deps.fence.acquireOrcaFence(…)` and then `reservations.reserve(…)`.
  - `!isRemote` takes no account of the platform. A local delegated request on Linux therefore acquires the fence
    and writes a `run_reservation` before the platform-qualified capability rejects it.
  - SPEC §5.2 orders S1→S2 as eligibility → fence → run_reservation. SPEC §7.3 says the capability is "checked
    before `ORCA_PREPARED_NOT_AUTHORIZED` (S2) is ever entered".
- **Consequence:**
  - R-1's guarantee of "no fence acquisition attempt" is false on Linux.
  - Contract B, as written, would pass a RED/GREEN that never observes the reservation side effect.
  - The amendment names the spawn-options seam as "the narrowest place to fail closed before spawn". It is before
    spawn, but it is *after* S2. The frozen eligibility ordering is broken on exactly the host the amendment makes
    ineligible.
- **Smallest docs-only correction:**
  - §4 must require that the **same** platform/backend-qualified capability answer is used as the
    `providerEligible` input at S1. That means reusing `supportsDelegatedCutoverHold`, not adding a parallel gate.
    The spawn-options check stays as defence in depth.
  - R-1 must then list "no fence acquire, no run_reservation row" explicitly.
  - §10 Contract B must assert both absences, not only "no pty.spawn".
  - If the author instead accepts the late gate, R-1 must be narrowed and the amendment must define how the
    reservation and fence are disposed on that rejection. That would be a larger change and is not recommended.

### B2 — "Platform-qualified" admits a pid-based Windows backend

- **Amendment sections:** §3 (platform table), §4 (matrix), §6 WP-1. Also affects mission §§5, 16, 21 and 33.
- **Evidence:**
  - `node-pty/lib/windowsPtyAgent.js:38` contains
    `if (_useConpty === undefined || true) this._useConpty = this._getWindowsBuildNumber() >= 18309;`.
    On builds below 18309, `_useConpty` is false whatever `useConptyDll` says, so the agent runs **winpty**.
  - winpty's `kill` is `getProcessList(this._pid)` followed by `process.kill(pid)`, which is pid-addressed
    (discovery W2x(b)).
  - The winpty binaries ship in `prebuilds/win32-x64` (`winpty-agent.exe`, `winpty.dll`).
  - Electron `^43.4.1` still supports Windows 10 1809 / LTSC 2019 (build 17763).
  - The amendment's own §3 table marks winpty "No". Its §4 gate, however, is qualified only by platform, and WP-1
    checks `_useConpty && _useConptyDll` **after** spawn.
- **Consequence:**
  - On an older but supported Windows host, a delegated request passes the gate and runs a backend that violates
    SIG-1.
  - The WP-1 check after spawn cannot repair this. Any cleanup of the child it detects would itself go through the
    pid-based winpty `kill`, which is exactly the N-4 hazard.
- **Smallest docs-only correction:**
  - §4 must define the eligibility answer as **backend-qualified before spawn**: `win32` AND node-pty's ConPTY
    selection predicate (build ≥ 18309, evaluated the same way node-pty evaluates it) AND the DLL options in
    force.
  - Add a matrix row: "Windows build < 18309 (winpty) ⇒ NOT ELIGIBLE, fail closed per R-1".
  - WP-1 must be restated as a predicate checked before spawn. The check after spawn may stay as an assertion only.
  - P1 obligations must include a RED for the build below 18309, which can use a stubbed build-number seam.

### B3 — The supersession list names the wrong text and leaves out what it really changes

- **Amendment section:** §12 (S-2 and "Not superseded"). Also affects mission §§3, 19, 27 and 28.
- **Evidence:**
  - AMENDMENT-001 A-8 (lines 191–205) contains no "Windows or Linux" text. It *does* say "no change to the
    capability contract or the eligibility gate (§7.3)". The phrase "Windows or Linux only" is in ARCH §10
    (≈672–703), and the related text is in PL-14 and P1.
  - SPEC §7.3 says "`LocalPtyProvider` declares it `true`". After this amendment, that is only true on qualified
    hosts.
  - Gate 52 (SPEC ≈:2415) is "Unsupported provider is rejected before cutover". Its GREEN evidence today includes
    `src/main/ipc/pty/runtime/spawn-options-delegated-cutover-capability-gate.test.ts:92-107`, which asserts
    `LocalPtyProvider.supportsDelegatedCutoverHold() === true` without conditions. That test runs on
    `ubuntu-latest` in `unit-tests.yml` and `pr.yml`.
  - Despite all this, the amendment lists "every SPEC.md gate definition" as not superseded.
- **Consequence:**
  - The supersession record is inaccurate. A later reader would hold both A-8's "no change to the capability
    contract" and the amendment's narrowed contract as frozen at the same time.
  - Gate 52's existing evidence will turn RED on Linux CI as soon as P1 lands, and nothing in the amendment
    accounts for that standing-regression (R-5) impact.
- **Smallest docs-only correction:**
  - Re-target S-2 to the text that exists: ARCH §10 "Windows or Linux only", PL-14, and the P1 host statement.
  - Add explicit supersessions for:
    - A-8's "no change to the capability contract or the eligibility gate (§7.3)" clause;
    - SPEC §7.3's "`LocalPtyProvider` declares it `true`" sentence.
  - Keep gate 52's *definition*, but classify its *evidence* as reshaped. Name the capability-gate test that
    becomes platform-conditional, and record the R-5 impact on Linux CI.

### B4 — Scenarios S9 and S10 are silently dropped, and the SIGTERM workload has no Windows meaning

- **Amendment section:** §11. Also affects mission §§21 and 23.
- **Evidence:**
  - ARCH §10 defines scenarios S1–S10:
    - S9 is a tampered sidecar ⇒ no signal;
    - S10 is a SIGTERM-ignoring workload, which is cancelled only after its death has been observed.
  - ARCH §10 also requires a "cancellation-safe (a variant that ignores `SIGTERM`…)" workload, and ARCH P3 (≈:478)
    has a SIGTERM-ignoring real-child escalation RED.
  - The amendment says "Scenarios S1–S8 remain".
  - On Windows, `WindowsTerminal.kill(signal)` throws if a signal is passed, and termination is `TerminateProcess`.
    A workload that "ignores SIGTERM" has no meaning there.
- **Consequence:**
  - Two frozen scenarios disappear without a supersession entry.
  - The escalation obligation (S10 and P3) has no executable form on the only eligible host.
- **Smallest docs-only correction:**
  - Write "S1–S10 remain", or supersede S9/S10 explicitly with a reason.
  - Translate the cancellation-safe variant and S10 into a Windows form, for example a workload that ignores the
    graceful step (console close / Ctrl-C delivery), so that escalation to HANDLE/job termination is exercised.
  - Alternatively, record it as an explicit P3 obligation with the same observed-death requirement.

---

## 5. Required clarifications (non-blocking; bundle with B1–B4)

- **N1 — What the §5 confirmation actually observes.**
  - On the kill path, `PtyKill` calls `ClosePseudoConsole` **before** `TerminateProcess`. The conout socket can
    therefore close, and the public `'exit'` fire, before the native watcher delivers `_$onProcessExit`. The
    public exit code would then be `undefined`.
  - The HANDLE-derived exit code only reaches the private `_agent._exitCode`, and no event fires for it.
  - If P1 is limited to the public API, CLEANUP_CONFIRMED may be unreachable. That fails closed (always
    CLEANUP_UNCERTAIN), but it would make the first workload unable to proceed.
  - The amendment should name this as a P1 discovery risk. It should also say whether reading a private field, or
    adding a node-pty patch hunk that emits it, is permitted.
- **N2 — Reuse the bound, not the signal.**
  - The PhysicalExitTracker's `markExited()` is driven by node-pty `onExit` (`local-pty-session-activation.ts`
    ≈:136), which is the socket-close `'exit'`. That is not CLEANUP_CONFIRMED.
  - §5 should say that only the bound is reused, and name it exactly: `LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS`
    (8 000 ms).
- **N3 — A deferred kill that never runs.**
  - `WindowsTerminal.kill` goes through `_deferNoArgs` and runs only after the first data event (`_isReady`).
  - A child that never emits output can make `kill()` a queued no-op. §5/§7 should state that this case reaches
    the bound and is CLEANUP_UNCERTAIN.
- **N4 — The shell fallback chain.**
  - `spawnWindowsFallbackChain` (`local-pty-utils.ts` ≈:193) retries other shells with the same
    `windowsConptyDllOptions()`.
  - It is not a host fallback, so R-2 holds. However, a delegated request can end up under a different shell than
    requested. §4 R-2 should either permit this explicitly or forbid it for delegated requests.

---

## 6. Operational state (verified read-only at review time)

| Item | State |
| --- | --- |
| aiControl `origin/master` | `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` (matches) |
| aiControl `data/app.db` SHA-256 | `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` (matches) |
| aiControl WAL / SHM / journal | none present |
| `ORCA_FENCE_ACQUISITION_ENABLED` | absent (only `.env.example` exists) — fence acquisition **DISABLED** |
| aiControl dirty state | untouched |
| Delegation | not enabled |
| R3 / M5 | NOT STARTED |
| Candidate amendment / discovery | unmodified by this review |
| Frozen PRE_LIVE documents | unmodified |
| P1 GENUINE RED | **NOT AUTHORIZED** (BLOCKED pending a corrected, accepted and frozen amendment) |
| Freeze / publish / push | none |

---

## 7. Final verdict

```
state_class:     N4_ARCHITECTURE_AMENDMENT_CHANGES_REQUIRED
display_verdict: ORCA_S5_PRELIVE_N4_PLATFORM_SAFETY_AMENDMENT_CHANGES_REQUIRED
blockers:        B1 (gate after fence/reservation), B2 (winpty below build 18309),
                 B3 (supersession accuracy / gate 52 evidence), B4 (S9/S10 dropped)
clarifications:  N1–N4
next:            docs-only correction of AMENDMENT-002, then a fresh independent re-review
```
