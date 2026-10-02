# PRE_LIVE SPEC Amendment 002 — N-4 Platform-Safe Pre-Cutover Process Cleanup

**Status:** CANDIDATE — NOT REVIEWED, NOT FROZEN, NOT PUBLISHED.
**Base:** `9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21` (published PRE_LIVE chain: normative content
`743458076769911cfe1fa5193f7c38ec4610ffee`, ratification `5bc243d169201b71b7a02944ede8e141d7129c75`, freeze
verification `9c4383fe…`).
**Evidence:** `P1-N4-PLATFORM-SAFETY-DISCOVERY.md` (cited below as DISC §n / row id).
**Kind:** additive. No frozen document is edited. This amendment supersedes **only** the clauses named in §12 (S-1…S-5);
every other frozen clause stands.

**Gate to take effect (all four, in order):** (1) independent amendment review accepts it; (2) it is
frozen/ratified; (3) the freeze is independently verified; (4) the amendment chain is published. Until then P1
remains **BLOCKED ON N-4 ARCHITECTURE AMENDMENT** and no P1 RED may be written.

**Operational state (unchanged by this document):** authority `AICONTROL_NATIVE`; `ORCA_DELEGATED` not started;
fence acquisition disabled; R3 not started; M5 not started.

---

## 1. Trigger and N-4 formal conclusion

The frozen P1 contract (ARCH AD-2, state (a′), Mechanism A; P1 RED obligation (6)) terminates a just-spawned
process "through the direct live-process handle the spawn call frame still owns … not a pid lookup". The P1
GENUINE RED mission halted before RED on the N-4 stop condition. Re-verification from source (DISC §1–§2):

- **Linux/POSIX.** `UnixTerminal.prototype.kill` is `process.kill(this.pid, signal)` (DISC L1). `_pid` is never
  cleared (L2); there is no exited guard (L3); the child is reaped by native `waitpid` on a separate thread
  **before** the exit event reaches JS (L4); the object retains no kernel handle to the process (L5); Orca's
  patch does not change this (L6).
- **Windows (Orca's `useConptyDll: true` path).** `IPty.kill()` reaches native `PtyKill`, which terminates a
  duplicated, owned shell `HANDLE` looked up by a non-reusable baton id; no pid lookup (W1–W5).

**Conclusion (normative).** On Linux/POSIX, "same `IPty` object" does **not** imply "same OS process target".
The object's termination primitive addresses a reusable pid after a reap the JS layer cannot observe, so
`IPty.kill()` on Linux is **not** a Mechanism A primitive. The frozen AD-2 text was correct in what it forbade
(pid-lookup signalling) and wrong in assuming that object continuity avoids it on every platform.

## 2. Timing-based safety — rejected

"pid reuse is unlikely within the H1 window" is **rejected as architecture**. H1 narrows crash/restart
expectations (ARCH §10); it does not, and may not, weaken wrong-process-signalling safety. No scheduling, delay,
pid-space size or workload-shortness argument substitutes for identity proof.

**Invariant SIG-1 (normative):** *No signal or termination request may be sent to a process solely because it
currently occupies a pid previously owned by the delegated child.*

SIG-1 is a restatement, not a new rule: it is the content of the already-frozen ARCH §11 break-glass "signal by
pid — Forbidden" and AD-2 (a′) "any pid-based OS lookup+signal fallback — Forbidden", applied to the case where
the pid-addressing is hidden inside a library call.

## 3. Revised Mechanism A eligibility (supersedes the AD-2 Mechanism A control basis — §12 S-1)

Mechanism A (pre-cutover, state (a′)) and Mechanism B (post-cutover / restart-recovered,
`verifyRestartRecoveredIdentity`) remain distinct and are not to be conflated. Mechanism B is unchanged.

Mechanism A is legal only when **all** hold:

1. the exact live process-control object returned by this spawn call is held by the spawning call frame
   (unchanged frozen condition);
2. `delegation_cutover` has not committed and the workload has not been released (unchanged);
3. **(new)** the termination primitive reached through that object addresses the process by a **kernel-held,
   non-reusable reference** — one that cannot name a different process after the original exits — and never by
   a numeric pid lookup, including a lookup performed inside a library;
4. **(new)** the platform/provider combination has been declared `SAFE_PRECUTOVER_PROCESS_CONTROL` (§4).

Holding a language-level object is necessary but **not by itself sufficient**.

| Platform path | Mechanism A? | Basis |
| --- | --- | --- |
| Windows, `LocalPtyProvider`, node-pty ConPTY with `useConptyDll: true` | **Candidate** — subject to P1 proof §6 | owned `hShell` HANDLE (DISC W2–W5) |
| Windows, ConPTY without DLL, or winpty | **No** | pid enumeration + `process.kill(pid)` (DISC W2x) |
| Linux/POSIX node-pty (`UnixTerminal`) | **No** | `process.kill(this.pid)` after native reap (DISC L1–L5) |
| macOS | **No** (already outside first controlled scope; A-4c) | same as POSIX |

## 4. Delegated-host capability boundary: `SAFE_PRECUTOVER_PROCESS_CONTROL`

**Definition.** A provider/platform pair *has* `SAFE_PRECUTOVER_PROCESS_CONTROL` iff its pre-cutover cleanup of
the exact spawned process satisfies §3 items 3–4 and the cleanup-completion observable of §5 is defined for it.

**Eligibility matrix for the first controlled delegated workload:**

| Host | Eligible? |
| --- | --- |
| Windows + `LocalPtyProvider` + ConPTY DLL path | ELIGIBLE (subject to P1 proof §6) |
| Linux + `LocalPtyProvider` (node-pty POSIX) | **NOT ELIGIBLE** — `DELEGATED_LINUX = DISABLED` |
| macOS (any) | NOT ELIGIBLE (unchanged) |
| Daemon adapter (any OS) | NOT ELIGIBLE (unchanged; A-8 / AD-1) |

**Where it is enforced (architecture, not implementation).** The capability is evaluated **before `pty.spawn`**,
on the existing fail-closed delegated-eligibility seam: the `deferDelegatedCommandDelivery === true` check in
`spawn-options.ts:161-171` that already throws `delegated_cutover_provider_unsupported` unless the provider's
`supportsDelegatedCutoverHold()` is exactly `true` (DISC §3). Today `LocalPtyProvider` answers `true`
unconditionally; the amendment requires that answer to become platform-qualified so that the existing gate
rejects a Linux delegated request. P1 chooses the narrowest realisation (e.g. a platform-qualified
`supportsDelegatedCutoverHold`, whose contract already accepts probe options and may be async) — no parallel
gate, no new IPC, no new error vocabulary unless review asks for one. **Reuse, not reinvention.**

**Rules.**
- R-1 An ineligible delegated request fails closed **before** `pty.spawn`: no child, no placeholder sidecar, no
  `dispatch_process_binding`, no `delegation_cutover`, no fence acquisition attempt.
- R-2 **No silent host fallback.** On an ineligible platform/provider the request is rejected through the frozen
  fail-closed boundary. It is never converted into a native (non-delegated) launch, never rerouted to another
  provider or host, never spawned "anyway", and never run with weakened identity semantics. Authority stays
  `AICONTROL_NATIVE` because cutover never began.
- R-3 Non-delegated PTY creation (`deferDelegatedCommandDelivery` absent or `false`) is unaffected on every
  platform, Linux included. The capability check is reachable only from the delegated branch.
- R-4 It composes with, and does not replace, the existing provider boundary (A-8 / AD-1 / §7.3): a daemon-hosted
  request remains ineligible for the reason it already was; there is no daemon→local fallback.

## 5. Windows cleanup semantics: `SAFE_TARGET_SELECTED` ≠ `CLEANUP_CONFIRMED`

Two distinct facts; the first never implies the second.

- **`SAFE_TARGET_SELECTED`** — teardown was issued through the exact live `IPty` returned by this spawn, on the
  DLL path, reaching native `PtyKill`'s HANDLE-addressed termination (DISC W2–W5).
- **`CLEANUP_CONFIRMED`** — the old attempt's process is observed terminated through **HANDLE-derived exit
  evidence for that same object**: the native `WaitForSingleObject(hShell)` + `GetExitCodeProcess` result
  delivered to that `IPty` (DISC W6). Calling `kill()` is not confirmation: on Windows the call can be deferred
  until terminal readiness (W7), and `TerminateProcess` only initiates termination.

**Constraints on the observable (P1 must pin the exact one; no number is invented here):**
- It must originate from the HANDLE-based native exit path, not from socket `'close'` alone: a JS `'exit'`
  carrying an `undefined` exit code (socket closed before W6 delivered) is **not** `CLEANUP_CONFIRMED`.
- It must be scoped to the exact object; an exit for another pty, incarnation or attempt is ignored.
- Any bound on how long to wait reuses an existing, already-justified Orca lifecycle bound (e.g. the
  physical-exit tracker's existing timeout) rather than a new arbitrary value; expiry of that bound yields
  `CLEANUP_UNCERTAIN`, never `CLEANUP_CONFIRMED`.
- **Descendants.** If the controlled workload can create descendants, root exit alone does not prove the tree is
  gone. The HANDLE-addressed job primitive `terminatePtyJob` (DISC W8) is the existing tree mechanism; its
  `'unavailable'` result must be treated as cleanup **not confirmed** — the pid-addressed `taskkill` degradation
  its other callers use is forbidden here by SIG-1. Whether the first scripted workload (ARCH §10) is
  descendant-free, and therefore root-exit-sufficient, is a P1 decision that review must accept explicitly.

## 6. Windows safe-target proof (P1 must prove; failure of any ⇒ P1 stops again)

- WP-1 Orca's eligible delegated spawn actually requests `useConptyDll: true`, and the resulting agent runs with
  `_useConpty && _useConptyDll` (not merely that the option is passed).
- WP-2 Cleanup is executed through the exact `IPty` object returned by this spawn call (object identity).
- WP-3 The termination reaches native `PtyKill` and operates on the shell HANDLE (`hShell` or its duplicate).
- WP-4 No pid lookup selects the target anywhere on the path — including the non-DLL and winpty branches being
  unreachable (static + dynamic).
- WP-5 A recycled numeric pid cannot redirect cleanup to an unrelated process (by construction of WP-3, proven
  rather than asserted).
- WP-6 `CLEANUP_CONFIRMED` is reached only from the §5 observable.

## 7. Cleanup failure or uncertainty (Windows)

If cleanup is requested through the safe handle but `CLEANUP_CONFIRMED` is not reached (`CLEANUP_UNCERTAIN`,
native throw, `terminatePtyJob` `'unavailable'` where tree cleanup is required):

- `delegation_cutover` remains uncommitted; the workload remains unreleased;
- **no retry may create another delegated process while the old attempt's cleanup is uncertain**;
- no pid-lookup fallback; no automatic native-execution fallback;
- the operation remains failed/blocked under the accepted H1 boundary, surfaced to the operator (manual
  supervision, ARCH §10).

This does **not** resolve N-5.

## 8. Unchanged: N-5 / H2

This amendment solves pre-cutover target selection on one platform. It does not provide host-crash recovery,
durable orphan handling or general retry convergence. **N-5 remains the H2 / general-restart PRE_LIVE
obligation.** The first Windows controlled workload continues to rely on the accepted H1 boundary (ARCH §10,
`FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE` only).

## 9. Linux: status and future enablement contract

**Status:** `DELEGATED_LINUX = DISABLED`. Ordinary non-delegated Linux PTY behaviour is unaffected.

No Linux primitive is selected. Source analysis found none already available in Orca or node-pty (DISC §4.4).
Non-normative examples of families a future proposal might use: a pidfd or equivalent kernel process handle; a
node-pty/native-addon enhancement exposing stable process identity/control; another kernel-backed non-reusable
process-control token.

**Enablement contract (all required before Linux may become delegated-eligible, via its own reviewed
amendment):**
- LE-1 stable association with the originally spawned process, established before any opportunity for reap;
- LE-2 no recycled-pid target substitution on any control path, including inside libraries;
- LE-3 safe control after arbitrary JS scheduling delay (no window between native reap and JS delivery);
- LE-4 an explicit terminal/cleanup observable equivalent to §5 `CLEANUP_CONFIRMED`;
- LE-5 crash/restart behaviour appropriate to the intended lifecycle (H1 vs H2 stated);
- LE-6 platform tests on the actual supported Linux environment(s).

Linux enablement is a **separate later platform track**, not a node on the first-live critical path (§11).

## 10. Revised P1 contract (future RED; nothing implemented here)

P1 stays **REAL PROCESS IDENTITY PRODUCTION**. Its supported delegated scope for RED/GREEN becomes **Windows +
ConPTY DLL path only**.

**A. Windows positive contract.** Exact live `IPty`/ConPTY object; pid captured as metadata only, never as
control authority; placeholder-sidecar → pid/marker rewrite → binding ordering (frozen AD-2 invariant); the AD-2
(a′) escaping-exception case; safe HANDLE-backed cleanup (WP-1…WP-5); no pid lookup; `CLEANUP_CONFIRMED` observed
(§5); cleanup uncertainty fails closed (§7); retry blocked while cleanup is uncertain; every other applicable
frozen AD-2 obligation (§10.D).

**B. Linux negative capability contract.** For a delegated request on Linux/POSIX: the capability gate fails;
`pty.spawn` is **not** called; no child process is created; no sidecar, binding or `delegation_cutover` is
created; no fallback of any kind occurs (R-2); authority remains `AICONTROL_NATIVE`. Proven through the real
eligibility seam (not a test double of it) on the Linux code path; must not exercise Linux cleanup.

**C. Non-delegated Linux control.** An ordinary (non-delegated) Linux PTY spawn through the same provider still
spawns and behaves as before.

**D. The ten frozen AD-2 (a′) obligations, re-mapped** (safety meaning preserved; platform scope corrected):

| # | Frozen obligation | Windows (supported path) | Linux |
| --- | --- | --- | --- |
| 1 | spawn returns the exact live handle | unchanged | not reached — rejected pre-spawn (B) |
| 2 | pid captured from it | unchanged; pid is metadata only | not reached |
| 3 | marker capture forced to fail | unchanged | not reached |
| 4 | callback never commits `delegation_cutover` | unchanged | B: no cutover row |
| 5 | workload never released | unchanged | B: nothing to release |
| 6 | terminated through the direct handle | **strengthened:** through the direct handle **and** its HANDLE-addressed primitive (WP-1…WP-5), with `CLEANUP_CONFIRMED` (§5) | not reached; B proves the risky state is unreachable |
| 7 | no pid-only signalling anywhere (static + dynamic) | **strengthened:** includes library-internal pid addressing (non-DLL/winpty branches unreachable, WP-4) | B: static proof that the delegated branch cannot reach `UnixTerminal.kill` |
| 8 | surviving placeholder cannot verify (`identity_unverifiable`) | unchanged | B: no placeholder exists |
| 9 | forced teardown failure fails closed | **extended:** includes `CLEANUP_UNCERTAIN` (§7) | B: rejection is itself the fail-closed outcome |
| 10 | retry begins a fresh identity lifecycle | **extended:** retry is blocked while prior cleanup is uncertain (§7) | B: retry is rejected identically |

Other frozen P1 RED items keep their meaning with platform scope corrected: "recycled pid (per A-4b) ⇒
`confirmed_dead_unknown_cause`" and crash windows are proven on Windows for P1; the Linux equivalents become
Linux-enablement evidence (§9 LE-5/LE-6). The macOS negative control (`identity_unverifiable`) is unchanged.

## 11. Scope effects

**First controlled workload (ARCH §10).** "Windows or Linux only" is superseded by **Windows only** (§12 S-2).
All other §10 properties remain: disposable aiControl environment first; disposable git worktree (or folder
workspace); scripted deterministic stub workload; no irreversible external effects; bounded runtime; manual
supervision, one run at a time; local provider host per AD-1; no automatic fallback. Scenarios S1–S8 remain and
are executed on Windows. Linux live proof moves to the Linux enablement track (§9).

**Gate / PL impact** (only items that name Windows/Linux; nothing is marked complete by this document):

| Item | Frozen text | Classification after this amendment |
| --- | --- | --- |
| P1 "Gates moved: 7, 38, 50 → `IMPLEMENTATION_PROVEN` (Windows/Linux)" | ARCH §5 P1 | Windows: satisfied later by P1 Windows evidence. Linux: **deferred platform proof** (§9) |
| PL-4 "recycled-pid and crash windows proven (Windows/Linux)" | ARCH §9 | Windows: satisfied later by P1 evidence. Linux: deferred platform proof; PL-4 additionally requires the §10.B Linux pre-spawn rejection evidence |
| PL-14 "Platform scope recorded (Windows/Linux only until A-4c); no macOS run" | ARCH §9 | Recorded scope becomes **Windows only for delegated runs**; Linux delegated runs refused (`DELEGATED_LINUX = DISABLED`); no macOS run unchanged |
| ARCH §10 "Windows or Linux only" | ARCH §10 | Superseded → Windows only (S-2) |
| [UNVERIFIED] "in-process node-pty survival across host exit (Win/Linux)" | ARCH §13 item 5 | Windows measurement unchanged; Linux measurement moves to the Linux track |
| N-4 item 6 "the platform behaviour needed for the first workload (Windows, Linux)" | RATIFICATION-001 §N-4 | Read as Windows for the first delegated workload; Linux deferred |
| PL-13, PL-15, PL-1…PL-3, PL-5…PL-12, PL-16…PL-20; SPEC gates 1-63 not listed above | — | **Unchanged** |

**P0 / DAG impact.** The DAG and critical path are **unchanged**. P0 gains one clarified host-capability
decision — *FIRST CONTROLLED DELEGATED PLATFORM = WINDOWS / ConPTY DLL ONLY; `DELEGATED_LINUX = DISABLED`* —
recorded by this amendment under P0's existing "A-1…A-8" amendment input. That decision fully closes P1's
platform prerequisite, so the `P0 → P1` edge stands and no new slice is inserted. Linux enablement is a separate
later platform track outside `P0 → … → P12`.

**Schema impact.** None. No durable platform-capability field is required: eligibility is decided before spawn
and before any durable write. No v7/v8 change.

## 12. Exact supersessions (and nothing else)

| Id | Superseded clause (frozen, not edited) | Replacement |
| --- | --- | --- |
| S-1 | ARCH AD-2 "Two process-control mechanisms — A" — the control basis "direct object/handle continuity to the exact spawned process" treated as sufficient on every first-workload platform; and P1 RED obligation (6) as unqualified by platform | §3: object continuity is necessary, not sufficient; Mechanism A additionally requires a non-reusable kernel-held target and `SAFE_PRECUTOVER_PROCESS_CONTROL`. Obligation (6) read per §10.D |
| S-2 | A-8 (AMD-001 §A-8) as applied by ARCH AD-1 / §10 / PL-14 — **only** the first-controlled-workload host set "Windows or Linux" | **FIRST CONTROLLED DELEGATED WORKLOAD HOST SET = Windows only** (ConPTY DLL path, `LocalPtyProvider`). A-8's remaining content is intact: delegated scope = eligible provider actually selected; H1 for the first workload, H2 tracked separately; daemon adapter ineligible until it declares the capability and clears gates 31-63; no assumption of node-pty survival across restart; the H1 restart-acceptance scope boundary. The capability contract is **narrowed**, never widened: §4 adds a platform qualifier to the existing eligibility answer |
| S-3 | ARCH §5 P1 "Gates moved … (Windows/Linux)" and PL-4 "(Windows/Linux)" | per §11 Gate/PL table |
| S-4 | ARCH §10 "Windows or Linux only" | Windows only |
| S-5 | RATIFICATION-001 §N-4, the clause "P1 must prove why live-handle continuity **and timing** still make the AD-2 safety claim valid" | The timing branch is withdrawn (§2, SIG-1). N-4 items 1-5 stand and are discharged on Windows by WP-1…WP-6; item 6 is read as Windows only. On Linux the "stop for architecture correction" branch was taken; this amendment is that correction |

Not superseded (explicitly): Mechanism B; AD-2 legal-state table and its invariant "binding ⇒ sidecar-with-pid
first"; A-4a/A-4b/A-4c; ARCH §11 break-glass "signal by pid — Forbidden"; ARCH §10 restart-scope boundary; N-5 /
H2; every SPEC.md gate definition.

## 13. N-4 classification after this amendment

- **N-4 for the P1 first-workload path: RESOLVED BY PLATFORM CAPABILITY RESTRICTION** (once this amendment takes
  effect and P1 proves §6).
- **N-4 for Linux: OPEN — PLATFORM ENABLEMENT BLOCKER.** Linux is not "proven safe"; it is excluded.

These two lines must remain visible in every later status record that cites N-4.

## 14. Guards recorded at authoring time

- `origin/main == 9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21` (fetched).
- aiControl (read-only): `origin/master == ab5967bdde5115afe6673e8b520a73cfb29f0eaf`; `data/app.db` SHA-256
  `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`; no WAL/SHM/journal; fence acquisition
  disabled. Not modified. Re-checked identical after authoring.
- Implementation: **BLOCKED.** P1 RED: **NOT AUTHORIZED** until this amendment is reviewed, frozen and published.
