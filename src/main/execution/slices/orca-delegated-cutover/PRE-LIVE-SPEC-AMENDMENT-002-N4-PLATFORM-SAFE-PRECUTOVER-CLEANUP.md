# PRE_LIVE SPEC Amendment 002 — N-4 Platform-Safe Pre-Cutover Process Cleanup

**Status:** CANDIDATE, CORRECTED (r1). It is not re-reviewed, not frozen and not published.
**Base:** `9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21`. This is the published PRE_LIVE chain:
- normative content `743458076769911cfe1fa5193f7c38ec4610ffee`;
- ratification `5bc243d169201b71b7a02944ede8e141d7129c75`;
- freeze verification `9c4383fe…`.

**Lineage:**
- candidate `d709fdb0373dff9976b4257691dddd6791831dc6`;
- independent review `0abd5dddf04d018f1ca5938d2aa0a4cb7661aa58`, verdict
  `N4_ARCHITECTURE_AMENDMENT_CHANGES_REQUIRED`, blockers B1–B4, clarifications N1–N4;
- this correction. The correction record and closure matrix are in §15.

**Evidence:** `P1-N4-PLATFORM-SAFETY-DISCOVERY.md` (cited below as DISC §n or by row id) and the independent
review (cited as REV Bn / Nn).
**Kind:** additive. No frozen document is edited. This amendment supersedes **only** the clauses named in §12
(S-1…S-8). Every other frozen clause stands.

**Gate to take effect (all four, in order):**
1. an independent re-review accepts it;
2. it is frozen and ratified;
3. the freeze is independently verified;
4. the amendment chain is published.

Until then P1 stays **BLOCKED ON N-4 ARCHITECTURE AMENDMENT**, and no P1 RED may be written.

**Operational state (unchanged by this document):**
- authority `AICONTROL_NATIVE`;
- `ORCA_DELEGATED` not started;
- fence acquisition disabled;
- R3 not started;
- M5 not started.

**Source vs contract.** This document defines the contract P1 will RED-test. Wherever it says "current
production", that describes the source today. Current production is **not** compliant with §4 (ordering and
backend qualification). Nothing here is implemented.

---

## 1. Trigger and N-4 formal conclusion

The frozen P1 contract (ARCH AD-2, state (a′), Mechanism A; P1 RED obligation (6)) terminates a just-spawned
process "through the direct live-process handle the spawn call frame still owns … not a pid lookup". The P1
GENUINE RED mission halted before RED on the N-4 stop condition. Source re-verification found the following
(DISC §1–§2):

- **Linux/POSIX.**
  - `UnixTerminal.prototype.kill` is `process.kill(this.pid, signal)` (DISC L1).
  - `_pid` is never cleared (L2), and there is no guard for an exited child (L3).
  - Native `waitpid` reaps the child on a separate thread **before** the exit event reaches JS (L4). The public
    `'exit'` is also deferred until the socket closes (REV §4).
  - The object holds no kernel handle to the process (L5), and Orca's patch does not change this (L6).
- **Windows, only on the node-pty ConPTY + `useConptyDll` branch.**
  - `IPty.kill()` reaches native `PtyKill`.
  - `PtyKill` terminates a duplicated, owned shell `HANDLE`, found by a baton id that is never reused. There is
    no pid lookup (W1–W5).
  - This is true **only** when node-pty actually selects that branch. On builds below 18309 node-pty selects
    winpty, which is pid-addressed (§4.2; REV B2).

**Conclusion (normative).**
- On Linux/POSIX, "same `IPty` object" does **not** imply "same OS process target". The object's termination
  primitive addresses a reusable pid after a reap the JS layer cannot observe. `IPty.kill()` on Linux is
  therefore **not** a Mechanism A primitive.
- On Windows, the OS name alone does not decide this either. The backend node-pty actually selects decides it.
- The frozen AD-2 text was right in what it forbade (pid-lookup signalling). It was wrong to assume that object
  continuity avoids pid addressing on every platform and every backend.

## 2. Timing-based safety — rejected

The argument "pid reuse is unlikely within the H1 window" is **rejected as architecture**. H1 narrows
crash/restart expectations (ARCH §10). It does not weaken wrong-process-signalling safety, and it may not. No
argument from scheduling, delay, pid-space size or a short workload substitutes for proof of identity.

**Invariant SIG-1 (normative):** *No signal or termination request may be sent to a process solely because it
currently occupies a pid previously owned by the delegated child.*

SIG-1 is a restatement, not a new rule. It applies two already-frozen rules to the case where the pid addressing
is hidden inside a library call:
- ARCH §11 break-glass: "signal by pid — Forbidden";
- AD-2 (a′): "any pid-based OS lookup+signal fallback — Forbidden".

## 3. Revised Mechanism A eligibility (supersedes the AD-2 Mechanism A control basis — §12 S-1)

Mechanism A and Mechanism B stay distinct and must not be conflated:
- Mechanism A is pre-cutover, state (a′).
- Mechanism B is post-cutover or restart-recovered (`verifyRestartRecoveredIdentity`). It is **unchanged**.

Mechanism A is legal only when **all** of these hold:

1. The spawning call frame holds the exact live process-control object returned by this spawn call. (Unchanged
   frozen condition.)
2. `delegation_cutover` has not committed, and the workload has not been released. (Unchanged.)
3. **(New.)** The termination primitive reached through that object addresses the process by a **stable
   underlying target primitive**: a kernel-held, non-reusable reference that cannot name a different process
   after the original exits. It never addresses the process by a numeric pid lookup, including a lookup inside a
   library. Continuity of the object alone does not meet this condition.
4. **(New.)** The host has been determined `SAFE_PRECUTOVER_PROCESS_CONTROL`-eligible **before fence
   acquisition** (§4).

Holding a language-level object is necessary but **not sufficient by itself**.

| Platform/backend path | Mechanism A? | Basis |
| --- | --- | --- |
| Windows, `LocalPtyProvider`, node-pty ConPTY selected (build ≥ 18309) **and** `useConptyDll: true` in force | **Candidate SAFE_PRECUTOVER_PROCESS_CONTROL implementation**, subject to P1 proof (§6) | owned `hShell` HANDLE (DISC W2–W5) |
| Windows, ConPTY without the DLL (`_useConptyDll` false) | **No** | `_getConsoleProcessList()` + `process.kill(pid)` (DISC W2x(a)) |
| Windows, winpty (`_useConpty` false, including every build < 18309) | **No** | `getProcessList(this._pid)` + `process.kill(pid)` (DISC W2x(b); REV B2) |
| Linux/POSIX node-pty (`UnixTerminal`) | **No** | `process.kill(this.pid)` after native reap (DISC L1–L5) |
| macOS | **No** (already outside first controlled scope; A-4c) | same as POSIX |

For the first workload, eligible Mechanism A is exactly the verified Windows ConPTY-DLL HANDLE path. Linux
`IPty.kill` stays ineligible.

## 4. Delegated-host capability boundary: `SAFE_PRECUTOVER_PROCESS_CONTROL`

### 4.1 Definition

A host has `SAFE_PRECUTOVER_PROCESS_CONTROL` iff all three hold:
- its pre-cutover cleanup of the exact spawned process satisfies §3 items 3–4;
- the cleanup-completion observable of §5 is defined for it;
- eligibility can be decided deterministically **before any child exists and before fence acquisition**.

Here "host" means the provider, platform and actual PTY backend together. Eligibility is a property of the
**PTY backend's** termination primitive. It is not a property of the OS name, and not of the shell executable
(§4.6).

### 4.2 Windows backend eligibility predicate (REV B2)

Source facts, verified in the installed `node-pty@1.1.0` with Orca's patch:

- **Build check (`lib/windowsPtyAgent.js`).**
  - When `useConpty` is `undefined` or `true`, the agent runs
    `this._useConpty = this._getWindowsBuildNumber() >= 18309`.
  - `_getWindowsBuildNumber()` parses the third component of `os.release()` and returns `0` when it cannot parse
    it.
  - Any build below 18309, or an unparseable release, therefore selects **winpty**, whatever `useConptyDll` says.
- **Orca passes no `useConpty` option.** Orca's `src/main` spawn sites do not set it, so the build check above
  decides the backend.
- **Orca's DLL options are conditional.** `windowsConptyDllOptions()` (`local-pty-utils.ts:174-175`) returns
  `{ useConptyDll: true }` on `win32` and `{}` otherwise.
- **winpty can actually load.** The winpty binaries ship in `prebuilds/win32-x64`.
- **Older builds are in scope.** Electron `^43.4.1` still supports Windows 10 1809 / LTSC 2019 (build 17763).
- **A missing DLL fails before any child exists.** With `useConptyDll: true`, a missing `conpty\conpty.dll` throws
  ("Cannot find conpty.dll at …"). Orca's patch resolves the DLL **before** `CreateProcessW`
  (`src/win/conpty.cc`, the "Orca: resolve the DLL BEFORE creating anything" hunk), so there is no silent
  fallback to the system ConPTY. This is an ordinary spawn failure that happens before a child exists. It is not
  a pid-backend hazard, and it is not an eligibility input.

**Normative predicate.** A local delegated request is Windows-eligible iff **all** of the following hold. Each
is known before spawn and before fence acquisition:

- W-E1 `process.platform === 'win32'`;
- W-E2 the Windows build, evaluated **exactly as node-pty evaluates it** (third numeric component of
  `os.release()`, unparseable ⇒ `0`), is `>= 18309`. This means the ConPTY branch will be selected;
- W-E3 the delegated spawn options carry `useConptyDll: true` and do not carry `useConpty: false`;
- W-E4 the provider is `LocalPtyProvider` on the local (non-remote, non-daemon) host. These restrictions are
  unchanged.

This is a deterministic preflight built from the same inputs node-pty uses to choose its backend. It is not a
speculative runtime probe, and it does not spawn anything.

DISC W2x says both pid-based Windows paths are "excluded by W1". That holds for the non-DLL path. It does
**not** hold for winpty, which W-E2 excludes. P1 must keep W-E2 and node-pty's selection in agreement, either by
evaluating the predicate exactly as node-pty does or through a shared seam. P1 must also prove that agreement in
RED with a stubbed build-number seam.

### 4.3 Normative eligibility matrix (fail closed by default)

| Host / backend | Delegated eligibility |
| --- | --- |
| Windows + `LocalPtyProvider` + W-E1…W-E4 (ConPTY DLL, HANDLE-backed) | **DELEGATED-ELIGIBLE**, subject to P1 proof (§6) |
| Windows build < 18309, or unparseable build (node-pty ⇒ winpty) | **NOT DELEGATED-ELIGIBLE** — rejected before fence acquisition |
| Windows + non-DLL ConPTY (pid-targeting) | **NOT DELEGATED-ELIGIBLE** — rejected before fence acquisition |
| Linux/POSIX + `LocalPtyProvider` (node-pty `UnixTerminal`) | **NOT DELEGATED-ELIGIBLE** — `DELEGATED_LINUX = DISABLED`; rejected before fence acquisition |
| macOS (any) | **NOT ELIGIBLE** for the first controlled workload (unchanged) |
| Daemon adapter (any OS) | **NOT ELIGIBLE** (unchanged; A-8 / AD-1) |
| Remote / SSH provider | **NOT ELIGIBLE** (unchanged; gate 53) |
| Any unknown or unproven backend | **NOT ELIGIBLE** |

Anything not shown to be eligible is ineligible.

### 4.4 Required ordering — capability check before fence acquisition (REV B1)

For a delegated request, the platform/backend-qualified capability answer must be determined **before** every
one of these:
1. any fence acquisition attempt (`acquireOrcaFence`);
2. creating the `run_reservation`;
3. `pty.spawn`;
4. the placeholder process sidecar;
5. `dispatch_process_binding`;
6. `delegation_cutover`;
7. workload release.

```
DELEGATED HOST/PLATFORM/BACKEND CAPABILITY CHECK (S1 eligibility)
  └─ ELIGIBLE   → only now may fence acquisition begin → run_reservation → spawn → …
  └─ INELIGIBLE → fail CLOSED; aiControl stays authoritative; nothing below is attempted
```

This restores the frozen order: SPEC §5.2 S1→S2 (eligibility → fence → `run_reservation`), and SPEC §7.3
"checked before `ORCA_PREPARED_NOT_AUTHORIZED` (S2) is ever entered".

**Current production violates this ordering.** `orca-runtime-create-agent-session.ts` (≈:233-238) calls
`establishReservation({ …, providerEligible: !isRemote, … })` before `createTerminal` reaches the spawn-options
gate (`spawn-options.ts:161-171`). Inside `delegated-cutover-reservation-step.ts`, `providerEligible === true`
leads to `deps.fence.acquireOrcaFence(…)` (≈:87/97) and then `reservations.reserve(…)` (≈:105). `!isRemote`
ignores platform and backend. A local delegated request on Linux, or on an old Windows build, would therefore
acquire the fence and write a `run_reservation` before anything rejects it. `!isRemote` is necessary but
insufficient.

**Required change (the contract, not an implementation).**
- The S1 `providerEligible` input must combine the existing remote restriction (`!isRemote`, unchanged) with
  **the same** platform/backend-qualified capability answer the spawn-options gate consults. That answer is the
  provider's `supportsDelegatedCutoverHold`, made W-E1…W-E4-qualified. Its contract already accepts probe options
  and may be async.
- There is **one** capability answer, consulted at S1, with no parallel gate, no new IPC and no new error
  vocabulary.
- The spawn-options check at `spawn-options.ts:161-171` stays as defence in depth with its existing frozen
  failure semantics. It is not a substitute for the S1 check. A disagreement between the two seams is a defect,
  and P1 RED must prove they consult the same answer.
- P1 must change the real admission/composition order. Existing code does not satisfy this contract.

### 4.5 Rules

- **R-1 — An ineligible delegated request fails closed before fence acquisition.** For example, Linux/POSIX has
  `SAFE_PRECUTOVER_PROCESS_CONTROL == false`. Such a request produces:
  - **no** fence acquisition request, and no fence token transition caused by Maestro;
  - **no** `run_reservation` row;
  - **no** `pty.spawn` and no child process;
  - **no** placeholder sidecar and no process facts;
  - **no** `dispatch_process_binding`;
  - **no** `delegation_cutover`;
  - **no** workload release;
  - **no** automatic native fallback.

  Authority stays `AICONTROL_NATIVE`, because cutover never began.
- **R-2 — No silent host or backend fallback.** A request on an ineligible platform/backend is rejected through
  the frozen fail-closed boundary. It is never:
  - spawned and then inspected afterwards;
  - run on winpty or non-DLL ConPTY;
  - converted into a native (non-delegated) launch;
  - rerouted to another provider or host;
  - run with weakened identity semantics.
- **R-3 — Non-delegated PTY creation is unaffected on every platform.** This covers requests where
  `deferDelegatedCommandDelivery` is absent or `false`, on Linux and on older or unsafe Windows builds alike.
  Only the delegated branch reaches the capability check.
- **R-4 — The boundary composes with the existing provider boundary and does not replace it** (A-8 / AD-1 /
  §7.3). A daemon-hosted or remote request stays ineligible for the reason it already was. There is no
  daemon→local fallback.

### 4.6 Shell fallback (REV N4)

`spawnWindowsFallbackChain` (`local-pty-utils.ts:178-193`) retries other shells with the same
`windowsConptyDllOptions()`. Eligibility is defined by PTY backend safety, not by the shell executable. A
delegated request may therefore end up under a fallback shell, provided W-E1…W-E4 still hold. They do, because
W-E1…W-E4 depend on the host and the options, not on the shell.

Mechanism A (WP-2) applies to the `IPty` actually returned to the spawning frame. A primary attempt that throws
before returning an `IPty` leaves no child of this amendment's concern; Orca's DLL-resolve-first patch removes
the leak-on-throw case. A shell change is never a backend change. A fallback that changed the backend would be
an R-2 violation.

## 5. Windows cleanup semantics: `SAFE_TARGET_SELECTED` ≠ `CLEANUP_CONFIRMED`

These are two distinct facts, and the first never implies the second. The chain is:

```
kill() called  ⇏  kill() executed  ⇏  CLEANUP_CONFIRMED
```

- **`SAFE_TARGET_SELECTED`.** Teardown was issued through the exact live `IPty` returned by this spawn, on a host
  that satisfies §4.2, and it reaches native `PtyKill`'s HANDLE-addressed termination (DISC W2–W5).
- **`kill()` executed.** On Windows, `WindowsTerminal.kill` runs through `_deferNoArgs` (`lib/windowsTerminal.js`).
  Until the first data event sets `_isReady`, the call is **queued, not executed** (DISC W7; REV N3). A queued
  kill that never runs is not a termination.
- **`CLEANUP_CONFIRMED`.** The old attempt's process is observed terminated through **HANDLE-derived exit evidence
  for that same object**. That evidence is the native `WaitForSingleObject(hShell)` + `GetExitCodeProcess` result
  delivered for that `IPty` (DISC W6). `TerminateProcess` only initiates termination.

**Constraints on the observable.** P1 must pin the exact observable; no number is invented here.

- **It must come from the HANDLE-based native exit path, not from socket `'close'` alone.** A JS `'exit'`
  carrying an `undefined` exit code (the socket closed before W6 delivered) is **not** `CLEANUP_CONFIRMED`.
- **Scope.** It must be scoped to the exact object. An exit for another pty, incarnation or attempt is ignored.
- **Bound — reuse the bound, not the signal (REV N2).**
  - The only wait bound is the existing `LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS` = `8_000` ms
    (`src/main/providers/local-pty-termination.ts:26`).
  - Only the **bound** is reused. The PhysicalExitTracker's success signal (`markExited()`, driven by node-pty
    `onExit`, i.e. the socket-close `'exit'`; `local-pty-session-activation.ts` ≈:136) is **not**
    `CLEANUP_CONFIRMED`.
  - The bound limits how long pre-cutover cleanup confirmation is awaited, and nothing else. It is not an
    execution timeout, not a termination policy, not P3's `G`/`H` escalation, and not a product SLA.
  - If the bound expires, the result is `CLEANUP_UNCERTAIN`, never `CLEANUP_CONFIRMED`.
- **Deferred kill (REV N3).** A child that emits no output can leave `kill()` queued. That case reaches the bound
  and is `CLEANUP_UNCERTAIN`.
- **Reachability of the public exit code (REV N1) — a named P1 discovery risk.**
  - On the kill path, `PtyKill` calls `ClosePseudoConsole` **before** `TerminateProcess`. The conout socket can
    therefore close, and the public `'exit'` fire with `undefined`, before the native watcher delivers
    `_$onProcessExit`.
  - The HANDLE-derived exit code reaches only the private `_agent._exitCode`, and no public event carries it.
  - Through the public API alone, `CLEANUP_CONFIRMED` may be unreachable. That fails closed: the result is always
    `CLEANUP_UNCERTAIN`, and the first workload cannot proceed.
  - This amendment authorizes **neither** reading the private field **nor** a new node-pty patch hunk. If P1
    discovery finds the observable unreachable through supported surfaces, P1 stops and returns that choice to
    architecture review. It does not pick one unilaterally.
- **Descendants.**
  - If the controlled workload can create descendants, root exit alone does not prove the tree is gone.
  - The existing tree mechanism is the HANDLE-addressed job primitive `terminatePtyJob` (DISC W8).
  - Its `'unavailable'` result means cleanup is **not confirmed**. The pid-addressed `taskkill` degradation used by
    its other callers (`local-pty-termination.ts` ≈:181) is forbidden here by SIG-1.
  - Whether the first scripted workload (ARCH §10) is descendant-free, and therefore root-exit-sufficient, is a P1
    decision. Review must accept it explicitly.

## 6. Windows safe-target proof (P1 must prove; failure of any ⇒ P1 stops again)

- **WP-1 (restated as a pre-spawn predicate, REV B2).** Before fence acquisition, W-E1…W-E4 are evaluated and
  hold, and their W-E2 evaluation agrees with node-pty's own backend selection. A post-spawn check that the agent
  runs with `_useConpty && _useConptyDll` may stay **as an assertion only**. It is never the eligibility
  decision. Cleaning up a child spawned on an ineligible backend would itself be unsafe.
- WP-2 Cleanup is executed through the exact `IPty` object returned by this spawn call (object identity).
- WP-3 The termination reaches native `PtyKill` and operates on the shell HANDLE (`hShell` or its duplicate).
- WP-4 No pid lookup selects the target anywhere on the path. This includes proving, statically and dynamically,
  that the non-DLL and winpty branches are unreachable for a delegated request.
- WP-5 A recycled numeric pid cannot redirect cleanup to an unrelated process. This follows by construction from
  WP-3, and must be proven rather than asserted.
- WP-6 `CLEANUP_CONFIRMED` is reached only from the §5 observable. A queued or merely-called `kill()` never
  reaches it.

## 7. Cleanup failure or uncertainty (Windows)

This section applies when cleanup is requested through the safe handle but `CLEANUP_CONFIRMED` is not reached.
The cases are:
- `CLEANUP_UNCERTAIN`, including a queued kill that never executed and expiry of
  `LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS`;
- a native throw;
- `terminatePtyJob` returning `'unavailable'` where tree cleanup is required.

In every case:
- `delegation_cutover` stays uncommitted, and the workload stays unreleased;
- **no retry may create another delegated process while the old attempt's cleanup is uncertain**;
- there is no pid-lookup fallback and no automatic native-execution fallback;
- the operation stays failed/blocked under the accepted H1 boundary and is surfaced to the operator (manual
  supervision, ARCH §10).

This does **not** resolve N-5.

## 8. Unchanged: N-5 / H2

This amendment solves pre-cutover target selection on one platform/backend. It does not provide host-crash
recovery, durable orphan handling, durable cleanup uncertainty across a host crash, or general retry convergence.

**N-5 remains the H2 / general-restart PRE_LIVE obligation.** The first Windows controlled workload still relies
on the accepted H1 boundary (ARCH §10, `FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` only).

## 9. Linux: status and future enablement contract

**Status:** `DELEGATED_LINUX = DISABLED`. A Linux delegated request is rejected before fence acquisition (§4.4,
R-1). Ordinary non-delegated Linux PTY behaviour is unaffected.

No Linux primitive is selected. Source analysis found none already available in Orca or node-pty (DISC §4.4).
Non-normative examples of families a future proposal might use:
- a pidfd or equivalent kernel process handle;
- a node-pty or native-addon enhancement exposing stable process identity and control;
- another kernel-backed, non-reusable process-control token.

**Enablement contract.** All of the following are required before Linux may become delegated-eligible, through
its own reviewed amendment:
- LE-1 a stable association with the originally spawned process, established before any opportunity for reap;
- LE-2 no recycled-pid target substitution on any control path, including inside libraries;
- LE-3 safe control after arbitrary JS scheduling delay, with no window between native reap and JS delivery;
- LE-4 an explicit terminal/cleanup observable equivalent to §5 `CLEANUP_CONFIRMED`;
- LE-5 crash/restart behaviour appropriate to the intended lifecycle, with H1 vs H2 stated;
- LE-6 platform tests on the actual supported Linux environment(s), including the original POSIX S10 scenario
  (§11.2).

Linux enablement is a **separate, later platform track**. It is not a node on the first-live critical path
(§11).

## 10. Revised P1 contract (future RED; nothing implemented here)

P1 stays **REAL PROCESS IDENTITY PRODUCTION**. Its supported delegated scope for RED/GREEN becomes **Windows +
ConPTY DLL backend only (W-E1…W-E4)**.

### A. Windows positive contract

**Ordering:**
- the pre-fence capability answer says eligible;
- the backend is proven ConPTY-DLL (W-E1…W-E4) **before** fence acquisition;
- only then may fence acquisition and `run_reservation` proceed.

**Identity:**
- the exact live `IPty`/ConPTY object is used;
- the pid is captured as metadata only, never as control authority;
- the ordering placeholder sidecar → pid/marker rewrite → binding holds (frozen AD-2 invariant);
- the AD-2 (a′) escaping-exception case is covered.

**Cleanup:**
- cleanup selects a safe HANDLE-backed target (WP-1…WP-5), with no pid lookup;
- target selection is separate from cleanup confirmation, which comes only from the §5 observable (WP-6);
- a queued or deferred `kill()` is **not** confirmation;
- expiry of `LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS` yields `CLEANUP_UNCERTAIN`;
- uncertainty fails closed (§7), and retry is blocked while cleanup is uncertain.

**Remaining obligations:** every other applicable frozen AD-2 obligation (§10.E).

### B. Linux negative capability contract (REV B1)

For a delegated request on Linux/POSIX, proven through the real eligibility and admission seams (not a test
double of them) on the Linux code path:
- the platform/backend capability answer is `false`, and the rejection happens **before any fence acquisition
  call**;
- the fence client (`acquireOrcaFence`) is **never invoked**;
- **no** `run_reservation` is written;
- `pty.spawn` is **not** called, and no child process exists;
- **no** process sidecar, process facts or binding exist;
- **no** `delegation_cutover`;
- **no** fallback of any kind (R-2);
- authority stays `AICONTROL_NATIVE`.

The contract must not exercise Linux cleanup.

### C. Unsafe-Windows negative contract (REV B2)

For a delegated request on a Windows host whose backend would be winpty (build < 18309 or unparseable, via a
stubbed build-number seam) or non-DLL ConPTY:
- it is rejected **before** fence acquisition;
- the fence client is never invoked;
- no `run_reservation`;
- no spawn;
- no fallback to another backend or to native execution.

### D. Non-delegated controls

- An ordinary (non-delegated) Linux PTY spawn through the same provider still spawns and behaves as before.
- Ordinary non-delegated PTY behaviour on older or unsafe Windows builds stays unaffected, to the extent the
  product supports it today.

### E. The ten frozen AD-2 (a′) obligations, re-mapped

The safety meaning of each obligation is preserved; only the platform scope is corrected.

| # | Frozen obligation | Windows (eligible ConPTY-DLL backend) | Linux / unsafe Windows |
| --- | --- | --- | --- |
| 1 | spawn returns the exact live handle | unchanged | not reached — rejected before fence (B/C) |
| 2 | pid captured from it | unchanged; pid is metadata only | not reached |
| 3 | marker capture forced to fail | unchanged | not reached |
| 4 | callback never commits `delegation_cutover` | unchanged | B/C: no cutover row |
| 5 | workload never released | unchanged | B/C: nothing to release |
| 6 | terminated through the direct handle | **strengthened:** through the direct handle **and** its HANDLE-addressed primitive (WP-1…WP-5), with `CLEANUP_CONFIRMED` (§5) | not reached; B/C prove the risky state is unreachable |
| 7 | no pid-only signalling anywhere (static + dynamic) | **strengthened:** includes library-internal pid addressing (non-DLL/winpty branches unreachable, WP-4) | B/C: static proof that the delegated branch cannot reach `UnixTerminal.kill` or the winpty / non-DLL `kill` |
| 8 | surviving placeholder cannot verify (`identity_unverifiable`) | unchanged | B/C: no placeholder exists |
| 9 | forced teardown failure fails closed | **extended:** includes `CLEANUP_UNCERTAIN`, including a queued kill that never runs (§5, §7) | B/C: rejection before fence is itself the fail-closed outcome |
| 10 | retry begins a fresh identity lifecycle | **extended:** retry is blocked while prior cleanup is uncertain (§7) | B/C: retry is rejected identically, before fence |

Other frozen P1 RED items keep their meaning, with platform scope corrected:
- "recycled pid (per A-4b) ⇒ `confirmed_dead_unknown_cause`" and the crash windows are proven on Windows for P1.
- The Linux equivalents become Linux-enablement evidence (§9 LE-5/LE-6).
- The macOS negative control (`identity_unverifiable`) is unchanged.

### F. Gate 52 evidence (REV B3)

P1 RED/GREEN must replace the superseded gate-52 evidence with platform-aware capability behaviour (§11.3).

## 11. Scope effects

### 11.1 First controlled workload (ARCH §10)

"Windows or Linux only" is superseded by **Windows only, ConPTY DLL backend (W-E1…W-E4)** (§12 S-2).

Every other §10 property remains:
- disposable aiControl environment first;
- disposable git worktree (or folder workspace);
- scripted, deterministic stub workload;
- no irreversible external effects;
- bounded runtime;
- manual supervision, one run at a time;
- local provider host per AD-1;
- no automatic fallback.

The "cancellation-safe" property is kept, but its SIGTERM form is replaced for Windows as shown in §11.2.

### 11.2 Scenario mapping — complete set S1–S10 (REV B4)

All ten frozen scenarios stay in scope. None is dropped silently.

| Scenario (ARCH §10) | Status for the Windows first workload |
| --- | --- |
| S1 completed (exit 0) | **Preserved**, executed on Windows |
| S2 failed (nonzero exit) | **Preserved**, executed on Windows |
| S3 cancelled via operator surface | **Preserved**, executed on Windows |
| S4 timeout from configured policy | **Preserved**, executed on Windows |
| S5 restart on H1 (incl. recycled-pid safety) | **Preserved**, executed on Windows; H1 boundary and H2 `LIVE_PROOF_REQUIRED` unchanged |
| S6 projection: `PROJECTED` / `ALREADY_TERMINAL` / `DIVERGENCE` | **Preserved**, executed on Windows |
| S7 worktree provenance, `skipped_not_eligible` | **Preserved**, executed on Windows |
| S8 no fallback (kill aiControl API mid-run / mid-projection) | **Preserved**, executed on Windows |
| S9 tampered sidecar ⇒ **no signal** | **Preserved unchanged**, executed on Windows. Narrowing the platform does not remove sidecar-tamper safety |
| S10 `SIGTERM`-ignoring workload cancelled only after observed death | **POSIX form not directly applicable** to Windows first-workload execution. **Safety intent preserved** by S10-W below. Original POSIX form → Linux enablement track (LE-6), off the first-live critical path |

**Why the POSIX S10 form has no Windows meaning.** `WindowsTerminal.kill(signal)` throws if a signal is passed
("Signals not supported on windows."), and Windows termination is `TerminateProcess`. A workload that "ignores
`SIGTERM`" therefore cannot exist there. No SIGTERM semantics are invented for Windows.

**S10-W (Windows replacement).** It preserves the load-bearing principle: **termination request ≠ cleanup /
terminal confirmed.**

- **S10-W(a) — post-cutover cancellation (the original S10 and "cancellation-safe" intent).**
  - A cancelled run is recorded `cancelled` only after HANDLE-derived observed death of the workload (per P3's
    `PROCESS_TERMINAL_OBSERVED`), never on the request alone.
  - If P3 defines a graceful step on Windows (for example console close or Ctrl-C delivery), the workload variant
    ignores that step. Escalation to HANDLE or job termination is then exercised, and the terminal fact follows
    only observed death.
  - This amendment does not define P3's graceful step or `G`/`H`. P3's frozen RED (including its real-child
    escalation RED) is unchanged. S10-W(a) is that RED's executable acceptance form on the first eligible host.
- **S10-W(b) — pre-cutover cleanup uncertainty (this amendment's domain).**
  - The forced marker-capture failure path (AD-2 (a′)) requests cleanup, but cleanup cannot be confirmed. The
    primary construction is a workload that emits no output, so `kill()` stays queued by `_deferNoArgs` (REV N3).
  - If P1 discovery shows that state is unreachable (for example because ConPTY always emits initial output), P1
    uses an equivalent source-supported uncertainty path: HANDLE-derived exit evidence is not delivered within
    `LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS` (REV N1).
  - Required outcome: cleanup stays `CLEANUP_UNCERTAIN`; **no** cutover; **no** workload release; **no** retry;
    **no** fallback.
  - No new timeout value is introduced.

Linux live proof, including the POSIX S10, moves to the Linux enablement track (§9).

### 11.3 Gate / PL impact

Nothing is marked COMPLETE by this document. Prior evidence whose meaning changes is classified
`SUPERSEDED_NEEDS_REPROOF`.

| Item | Frozen text / evidence | Classification after this amendment |
| --- | --- | --- |
| **Gate 52** "Unsupported provider is rejected before cutover" | SPEC ≈:2415-2418; GREEN evidence includes `src/main/ipc/pty/runtime/spawn-options-delegated-cutover-capability-gate.test.ts:92-107`, which asserts `LocalPtyProvider.supportsDelegatedCutoverHold() === true` unconditionally and runs on `ubuntu-latest` (`unit-tests.yml`, `pr.yml`) | **Definition kept** (it already requires `acquireOrcaFence` never be called). **"Unsupported" now includes a platform/backend-ineligible `LocalPtyProvider`** (S-7). **Old evidence: `SUPERSEDED_NEEDS_REPROOF`**; not "still green", not complete. New evidence shape: see below |
| P1 "Gates moved: 7, 38, 50 → `IMPLEMENTATION_PROVEN` (Windows/Linux)" | ARCH §5 P1 (≈:458) | Windows: satisfied later by P1 Windows evidence. Linux: **deferred platform proof** (§9) |
| PL-4 "recycled-pid and crash windows proven (Windows/Linux)" | ARCH §9 (≈:647) | Windows: satisfied later by P1 evidence. Linux: deferred platform proof. PL-4 additionally requires the §10.B Linux and §10.C unsafe-Windows **pre-fence** rejection evidence |
| PL-14 "Platform scope recorded (Windows/Linux only until A-4c); no macOS run" | ARCH §9 (≈:661) | Recorded scope becomes **Windows ConPTY-DLL backend only for delegated runs**. Linux delegated runs refused (`DELEGATED_LINUX = DISABLED`). Windows builds < 18309 refused. No macOS run (unchanged) |
| ARCH §10 "Windows or Linux only" | ARCH §10 (≈:679) | Superseded → Windows ConPTY-DLL only (S-2) |
| ARCH §10 S9, S10 and "cancellation-safe (… ignores `SIGTERM` …)" | ARCH §10 (≈:678, ≈:702) | S9 preserved. S10 / cancellation-safe: POSIX form deferred to the Linux track; Windows form S10-W (§11.2) (S-6) |
| [UNVERIFIED] "in-process node-pty survival across host exit (Win/Linux)" | ARCH §13 item 5 | Windows measurement unchanged; Linux measurement moves to the Linux track |
| N-4 item 6 "the platform behaviour needed for the first workload (Windows, Linux)" | RATIFICATION-001 §N-4 | Read as Windows ConPTY-DLL for the first delegated workload; Linux deferred |
| PL-13, PL-15, PL-1…PL-3, PL-5…PL-12, PL-16…PL-20; SPEC gates 1-63 other than gate 52 | — | **Unchanged** |

**New gate-52 evidence contract.** P1 RED/GREEN must produce all of the following:

| Case | Required evidence |
| --- | --- |
| Windows, W-E1…W-E4 hold (safe ConPTY-DLL) | capability answer `true`; a delegated request is admitted to fence acquisition |
| Linux/POSIX `LocalPtyProvider` | capability answer `false`; rejected **before** fence; `acquireOrcaFence` never called; no `run_reservation`; no `pty.spawn` |
| Windows with unsafe or unknown backend (build < 18309 / unparseable via stubbed seam; DLL options absent) | capability answer `false`; rejected **before** fence; `acquireOrcaFence` never called; no `run_reservation`; no `pty.spawn` |
| Stub provider without the capability; daemon; remote/SSH | rejected as previously frozen (gates 52/53; A-8 / AD-1) |
| Non-delegated PTY on every platform | unchanged — spawns; capability not consulted (the existing "not called" assertion is kept) |
| Both seams | the S1 `providerEligible` input and the spawn-options gate consult the same answer |

**R-5 / CI impact.**
- The capability-gate test is gate-52 GREEN evidence running on Linux CI. Its unconditional-`true` assertion at
  :92-107 becomes false on Linux the moment P1 lands.
- P1 must change that assertion as an explicitly named, platform-conditional assertion change, reviewed like an
  R-2 named assertion. It must **never** be silently deleted or skipped.
- On Linux CI the test must then assert the ineligible answer.
- The R-5-enumerated suites (Gate 30, Cutover-Core, Post-Cutover) are not changed by this amendment.

### 11.4 P0 / DAG impact

The DAG and critical path are **unchanged**.

P0 gains one clarified host-capability decision, recorded by this amendment under P0's existing "A-1…A-8"
amendment input. The decision has two parts:
1. *FIRST CONTROLLED DELEGATED PLATFORM = WINDOWS / ConPTY DLL BACKEND ONLY (W-E1…W-E4);
   `DELEGATED_LINUX = DISABLED`;*
2. *eligibility is decided before fence acquisition (§4.4).*

Once this amendment is frozen and published, both parts close P1's platform prerequisite. The `P0 → P1` edge
therefore stands, and no new slice is inserted. Linux enablement is a separate, later platform track outside
`P0 → … → P12`.

### 11.5 Schema impact

None. No durable platform-capability field is required. Eligibility is decided before fence acquisition, before
spawn and before any durable write. No v7/v8 change.

## 12. Exact supersessions (and nothing else)

Each entry names text that exists in the frozen documents at the base.

| Id | Superseded clause (frozen, not edited) | Replacement |
| --- | --- | --- |
| S-1 | ARCH AD-2 "Two process-control mechanisms — A": the control basis "direct object/handle continuity to the exact spawned process", treated as sufficient on every first-workload platform; and P1 RED obligation (6) as unqualified by platform/backend | §3: object continuity is necessary, not sufficient. Mechanism A additionally requires a stable, non-reusable, kernel-held target primitive and pre-fence `SAFE_PRECUTOVER_PROCESS_CONTROL` eligibility. Obligation (6) is read per §10.E |
| S-2 | The first-controlled-workload host statement where it actually appears: ARCH §10 "**Windows or Linux only**" (≈:679); PL-14 "(Windows/Linux only until A-4c)" (≈:661); and the ARCH §5 P1 host qualifier "(Windows/Linux)" (≈:458) | **FIRST CONTROLLED DELEGATED WORKLOAD HOST SET = Windows, `LocalPtyProvider`, ConPTY DLL backend (W-E1…W-E4) only.** Linux and Windows builds < 18309 are refused before fence acquisition |
| S-3 | AMENDMENT-001 §A-8 (lines ≈191–205), **only** the clause "no change to the capability contract or the eligibility gate (§7.3)" | The capability contract **is** changed, by narrowing only. The delegated capability is now platform/backend-qualified (§4.2), and the eligibility gate is consulted before fence acquisition (§4.4). The rest of A-8 is intact: delegated scope = the eligible provider actually selected; H1 for the first workload, H2 tracked separately; any future provider must declare `supportsDelegatedCutoverHold` and clear gates 31-63; no assumption of node-pty survival across restart; the restart-scope boundary |
| S-4 | ARCH §5 P1 "Gates moved … (Windows/Linux)" and PL-4 "(Windows/Linux)" | per §11.3 Gate/PL table |
| S-5 | RATIFICATION-001 §N-4, the clause "P1 must prove why live-handle continuity **and timing** still make the AD-2 safety claim valid" | The timing branch is withdrawn (§2, SIG-1). N-4 items 1-5 stand and are discharged on the Windows ConPTY-DLL backend by WP-1…WP-6. Item 6 is read as Windows ConPTY-DLL only. On Linux the "stop for architecture correction" branch was taken, and this amendment is that correction |
| S-6 | ARCH §10 "cancellation-safe (a variant that ignores `SIGTERM` exercises P3 escalation)" and scenario "(S10) `SIGTERM`-ignoring workload cancelled only after observed death", **only** as applied to the first controlled workload's host | For the Windows first workload: S10-W(a)/(b) (§11.2), with the safety intent preserved. The POSIX form is retained for the Linux enablement track (LE-6). S9 is **not** superseded |
| S-7 | SPEC §7.3 "`LocalPtyProvider` declares it `true`" (≈:1638) | `LocalPtyProvider` eligibility is **necessary but not sufficient**. It declares the delegated capability `true` **only** when W-E1…W-E4 hold (Windows ConPTY-DLL backend), and `false` on Linux/POSIX, on Windows builds < 18309 or unparseable, and on any unknown backend. The rest of §7.3 (the probe shape, absent ⇒ `false`, the `delegated_cutover_provider_unsupported` throw, and "checked before S2") is intact. §4.4 makes "checked before S2" hold in fact |
| S-8 | Gate 52's existing GREEN **evidence** (not its definition): `spawn-options-delegated-cutover-capability-gate.test.ts:92-107` (unconditional `true`) | `SUPERSEDED_NEEDS_REPROOF`; replaced by the §11.3 gate-52 evidence contract |

**Explicitly not superseded:**
- Mechanism B;
- the AD-2 legal-state table and its invariant "binding ⇒ sidecar-with-pid first";
- A-4a, A-4b and A-4c;
- ARCH §11 break-glass "signal by pid — Forbidden";
- the ARCH §10 restart-scope boundary;
- ARCH §10 scenarios S1–S9;
- P3's Genuine RED;
- N-5 / H2;
- every SPEC.md gate **definition**, including gate 52's (only its evidence is reshaped, S-8);
- every other A-8 clause.

## 13. N-4 classification after this amendment

- **N-4 for the P1 first-workload path: RESOLVED BY PLATFORM/BACKEND CAPABILITY RESTRICTION.** This takes effect
  once the amendment does and P1 proves §6 and §10.B/§10.C.
- **N-4 for Linux: OPEN — PLATFORM ENABLEMENT BLOCKER.** Linux is not "proven safe"; it is excluded before fence
  acquisition.
- **N-4 for Windows builds < 18309 (winpty): EXCLUDED.** Not eligible.

These lines must remain visible in every later status record that cites N-4.

## 14. Guards recorded at authoring time

- Base `9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21`. The correction is a linear child of the review
  `0abd5dddf04d018f1ca5938d2aa0a4cb7661aa58`.
- aiControl, checked read-only:
  - `origin/master == ab5967bdde5115afe6673e8b520a73cfb29f0eaf`;
  - `data/app.db` SHA-256 `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`;
  - no WAL/SHM/journal;
  - fence acquisition disabled.

  Nothing was modified.
- Implementation: **BLOCKED.**
- P1 RED: **NOT AUTHORIZED** until this amendment is re-reviewed, frozen and published.

## 15. Correction record (r1, after independent review `0abd5dd`)

Only amendment text changed. The discovery, the review artifact and every frozen document are unmodified.

| Blocker | Review requirement | Amendment section(s) | Correction | Status |
| --- | --- | --- | --- | --- |
| B1 — pre-fence capability ordering | The same platform/backend-qualified answer feeds S1 `providerEligible`; R-1 lists no fence and no reservation; Contract B asserts both absences | §4.4, §4.5 R-1, §10.B/C, §11.3 gate 52 | Capability decided before fence, `run_reservation`, spawn, sidecar, binding, cutover and release. Current `providerEligible: !isRemote` recorded as non-compliant. Contract B asserts no `acquireOrcaFence` call and no `run_reservation`. Spawn-options gate kept as defence in depth | **CLOSED** |
| B2 — actual safe Windows backend | Backend-qualified before spawn (win32 + build ≥ 18309 evaluated as node-pty does + DLL options); winpty row; WP-1 moved before spawn; RED for build < 18309 | §1, §3, §4.2, §4.3, §6 WP-1, §10.C | W-E1…W-E4 predicate; full backend matrix (winpty, non-DLL, unknown ⇒ ineligible); no spawn-then-inspect; stubbed build-seam RED | **CLOSED** |
| B3 — exact A-8 / SPEC §7.3 / gate 52 supersession | Re-target S-2 to text that exists; supersede the A-8 "no change to the capability contract" clause and SPEC §7.3 "declares it `true`"; reshape gate-52 evidence; record R-5/CI impact | §12 S-2, S-3, S-7, S-8; §11.3 | S-2 now cites ARCH §10, PL-14 and the P1 qualifier. S-3 supersedes only the A-8 capability clause. S-7 supersedes the §7.3 sentence. S-8 and §11.3 classify the gate-52 evidence `SUPERSEDED_NEEDS_REPROOF`, define the new evidence shape and record the Linux-CI impact | **CLOSED** |
| B4 — S9/S10 preservation | "S1–S10 remain" or explicit supersession; Windows form of S10 / cancellation-safe | §11.1, §11.2, §12 S-6 | Complete S1–S10 mapping. S9 preserved. POSIX S10 marked not applicable on Windows and deferred to the Linux track. S10-W(a) (post-cutover, observed death) and S10-W(b) (pre-cutover `CLEANUP_UNCERTAIN`) preserve the intent | **CLOSED** |

| Clarification | Disposition |
| --- | --- |
| N1 | §5: named as a P1 discovery risk. Neither a private-field read nor a node-pty patch hunk is authorized; if the observable is unreachable, P1 stops and returns to review |
| N2 | §5: the bound is named exactly (`LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS`, 8 000 ms); only the bound is reused, not the tracker's signal; no broadening |
| N3 | §5, §7, §11.2 S10-W(b): a queued `kill()` is not an executed kill; never executed ⇒ the bound applies ⇒ `CLEANUP_UNCERTAIN` |
| N4 | §4.6: shell fallback is permitted; eligibility follows the backend, not the shell |

Unchanged by this correction:
- Mechanism B;
- N-5 / H2;
- LE-1…LE-6 (LE-6 now also names the deferred POSIX S10);
- the DAG;
- the schema;
- transport, exit evidence, lifecycle reconciliation, R3, ingress and projection;
- the timeout values (none added).
