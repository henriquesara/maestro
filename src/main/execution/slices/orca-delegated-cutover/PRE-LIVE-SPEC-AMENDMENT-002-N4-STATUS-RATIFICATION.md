# PRE_LIVE SPEC Amendment 002 (N-4) — Status Ratification (Freeze)

**This is a status and ratification record only.**
- It does not create a new semantic amendment version.
- It does not restate the amendment's normative content. That content lives only in the accepted file at the
  normative content HEAD below.
- Where this record summarizes a rule, the accepted amendment text wins.

## 1. Identity

| Role | Commit / artifact |
| --- | --- |
| Canonical published base | `9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21` |
| Original candidate (+ discovery evidence `P1-N4-PLATFORM-SAFETY-DISCOVERY.md`) | `d709fdb0373dff9976b4257691dddd6791831dc6` |
| Independent review (`PRE-LIVE-SPEC-AMENDMENT-002-N4-INDEPENDENT-REVIEW.md`) | `0abd5dddf04d018f1ca5938d2aa0a4cb7661aa58` |
| **Normative Amendment-002 content HEAD** (`PRE-LIVE-SPEC-AMENDMENT-002-N4-PLATFORM-SAFE-PRECUTOVER-CLEANUP.md`) | **`6159a8dfae2d04a2c82b7c7d4d58f7a018414890`** |
| Focused independent rereview (`PRE-LIVE-SPEC-AMENDMENT-002-N4-FOCUSED-REREVIEW.md`) — **review evidence only** | `ee046ec86d3844c5ed4ea57482632ee38c96e989` |

**Lineage.** `9c4383fe → d709fdb0 → 0abd5ddd → 6159a8df → ee046ec8 → (this ratification)`. The chain is linear:
every hop has a single parent and there are no merges or rewrites. `ee046ec8` is durably referenced by the local
branches `orca-s5-n4-amendment-002` and `review/orca-s5-prelive-n4-focused-rereview`.

**Content byte identity.** The amendment blob is `ef6fe4dff06e8c23a8e0fcb76cab2ae1e05bd404` both at `6159a8df` and
at `ee046ec8`. This ratification does not change it.

**Acceptance authority.** The focused rereview found:
- B1, B2, B3 and B4 all **CLOSED**;
- no new blocker;
- `state_class: N4_ARCHITECTURE_AMENDMENT_ACCEPTED_READY_TO_FREEZE`;
- `accepted_amendment_content_head: 6159a8dfae2d04a2c82b7c7d4d58f7a018414890`.

## 2. Freeze state

| Property | Status |
| --- | --- |
| Amendment-002 | **FROZEN** · **INDEPENDENTLY ACCEPTED** · **NOT YET PUBLISHED** |
| P1 implementation | **NOT AUTHORIZED** until this ratification is independently freeze-verified **and** the full Amendment-002 chain is published. No P1 RED before both |

This freeze does **not** mean any of the following:
- PRE_LIVE complete;
- LIVE ready;
- ORCA_DELEGATED active;
- delegated Linux enabled.

## 3. Ratified frozen decisions

### 3.1 B1 — pre-fence ordering (amendment §4.4, §4.5)

The `SAFE_PRECUTOVER_PROCESS_CONTROL` capability is decided **before** each of these:
- any fence acquisition attempt;
- `run_reservation`;
- PTY spawn;
- the sidecar;
- `dispatch_process_binding`;
- `delegation_cutover`;
- workload release.

An ineligible request produces no fence attempt, no reservation, no process and no fallback. Authority stays
`AICONTROL_NATIVE`.

There is one capability answer (`supportsDelegatedCutoverHold`, W-E-qualified). It is consulted at S1, and the
spawn-options gate is kept as defence in depth.

**Current production remains non-compliant until P1 implements this.** Admission today passes
`providerEligible: !isRemote` (`orca-runtime-create-agent-session.ts:238`).

### 3.2 B2 — platform/backend eligibility (amendment §4.2, §4.3)

`OS == Windows` is **not sufficient**. Eligibility requires **all** of W-E1…W-E4, each decided pre-flight, before
spawn and before the fence:

| Condition | Requirement |
| --- | --- |
| W-E1 | `process.platform === 'win32'` |
| W-E2 | Windows build **`>= 18309`**, evaluated exactly as node-pty evaluates it (third numeric component of `os.release()`) |
| W-E3 | Delegated spawn options carry `useConptyDll: true` and do not carry `useConpty: false` |
| W-E4 | `LocalPtyProvider` on the local (non-remote, non-daemon) host |

**Build threshold — node-pty behaviour vs Maestro policy (§9 of the mission; no reinterpretation).**
- **node-pty's own behaviour.** `_getWindowsBuildNumber()` returns `0` when `os.release()` cannot be parsed. With
  `useConpty` undefined or true, node-pty selects ConPTY iff `build >= 18309`, so a build below 18309 or an
  unparseable one selects winpty (`lib/windowsPtyAgent.js:37-39, 211-218`).
- **Maestro's accepted rule.** W-E2 mirrors that evaluation exactly, so an unparseable build is evaluated as `0`
  and fails W-E2. Separately, the eligibility matrix's fail-closed default applies: "any unknown or unproven
  backend ⇒ NOT ELIGIBLE".
- The accepted text introduces no other Maestro-specific parse rule.

**Ratified matrix (amendment §4.3; anything not shown eligible is ineligible):**

| Host / backend | Status |
| --- | --- |
| Windows + `LocalPtyProvider` + W-E1…W-E4 (ConPTY DLL, HANDLE-backed) | **DELEGATED-ELIGIBLE**, subject to P1 proof (§6 WP-1…WP-6) |
| Windows build < 18309 or unparseable (winpty) | INELIGIBLE — rejected before fence |
| Windows non-DLL ConPTY (pid-targeting) | INELIGIBLE — rejected before fence |
| Linux/POSIX | INELIGIBLE — `DELEGATED_LINUX = DISABLED` |
| macOS | INELIGIBLE for the first controlled workload |
| Daemon adapter | INELIGIBLE (A-8 / AD-1) |
| Remote / SSH | INELIGIBLE (gate 53) |
| Unknown or unproven backend | INELIGIBLE |

Further rules:
- **No post-spawn rescue.** The post-spawn backend check is an assertion only.
- **No silent backend or host fallback** (R-2).
- **A shell fallback is not a backend change** (§4.6).

### 3.3 B3 — exact supersession set (amendment §12; nothing else)

| Id | Superseded frozen text | Effect |
| --- | --- | --- |
| S-1 | ARCH AD-2 Mechanism A control basis | Object continuity is necessary, not sufficient |
| S-2 | ARCH §10 "Windows or Linux only" (≈:679); PL-14 "(Windows/Linux only until A-4c)" (≈:661); ARCH §5 P1 qualifier "(Windows/Linux)" (≈:458) | → Windows, `LocalPtyProvider`, ConPTY DLL (W-E1…W-E4) only |
| S-3 | AMENDMENT-001 §A-8, **only** "no change to the capability contract or the eligibility gate (§7.3)" | The capability is narrowed and platform/backend-qualified, and checked before the fence. The rest of A-8 is intact, including its host/provider scope |
| S-4 | ARCH §5 P1 "Gates moved … (Windows/Linux)"; PL-4 "(Windows/Linux)" | Windows proven by P1; Linux deferred; PL-4 additionally needs the §10.B/§10.C pre-fence rejection evidence |
| S-5 | RATIFICATION-001 §N-4 "…continuity **and timing**…" | Timing branch withdrawn; items 1-5 discharged by WP-1…WP-6 on ConPTY-DLL; item 6 → Windows ConPTY-DLL |
| S-6 | ARCH §10 "cancellation-safe (…ignores `SIGTERM`…)" and S10, as applied to the first host only | → S10-W(a)/(b); POSIX form → LE-6 |
| S-7 | SPEC §7.3 "`LocalPtyProvider` declares it `true`" (≈:1638) | `true` only when W-E1…W-E4 hold; the rest of §7.3 is intact |
| S-8 | Gate 52 GREEN **evidence** `spawn-options-delegated-cutover-capability-gate.test.ts:92-107` | `SUPERSEDED_NEEDS_REPROOF` |

**Explicitly not superseded:**
- Mechanism B;
- the AD-2 legal-state table and "binding ⇒ sidecar-with-pid first";
- A-4a, A-4b and A-4c;
- ARCH §11 "signal by pid — Forbidden";
- the restart-scope boundary;
- S1–S9;
- P3's Genuine RED;
- N-5 / H2;
- every SPEC gate **definition**, including gate 52's;
- every other A-8 clause;
- PL-1…PL-3, PL-5…PL-13 and PL-15…PL-20;
- SPEC gates 1-63 other than gate 52's evidence.

### 3.4 Gate 52

- **Old evidence:** `SUPERSEDED_NEEDS_REPROOF`.
- **Definition:** unchanged. It remains governed by SPEC §7.3 as superseded by S-7, under which "unsupported" now
  includes a platform/backend-ineligible `LocalPtyProvider`.
- **New evidence P1 must produce** (amendment §11.3):

  | Case | Required result |
  | --- | --- |
  | Eligible Windows ConPTY-DLL | `true`; admitted to fence |
  | Linux | Ineligible before fence |
  | Unsafe Windows backend (build < 18309 or unparseable via stubbed seam; DLL options absent) | Ineligible before fence |
  | Unknown backend | Ineligible |
  | Stub provider, daemon, remote/SSH | Rejected as previously frozen |
  | Non-delegated PTY | Unchanged; capability not consulted |
  | Both seams | Consult the same answer |

  In every "before fence" case, `acquireOrcaFence` is never called and there is no `run_reservation` and no
  `pty.spawn`.

- **R-5 / CI.** The `:92-107` assertion must become a named, platform-conditional assertion change. It must never
  be silently deleted or skipped.
- **No gate is marked COMPLETE by this freeze.**

### 3.5 B4 — scenarios S1–S10 (amendment §11.2)

- **S1–S8:** preserved, executed on Windows. S5 keeps the H1 boundary and H2 `LIVE_PROOF_REQUIRED`.
- **S9:** tampered sidecar ⇒ **no signal**. Preserved unchanged.
- **S10, POSIX form:** moves to the future Linux enablement track (LE-6).
- **S10-W, the Windows replacement:** preserves the invariant **TERMINATION REQUEST ≠ CLEANUP CONFIRMED**.
  - S10-W(a): after cutover, `cancelled` only after HANDLE-derived observed death, per P3.
  - S10-W(b): before cutover, a queued kill or expiry of the bound ⇒ `CLEANUP_UNCERTAIN`, with no cutover, no
    release, no retry and no fallback.
- **No SIGTERM semantics are invented for Windows.**

### 3.6 Cleanup confirmation (amendment §5, §7)

`SAFE_TARGET_SELECTED` ≠ `KILL_REQUESTED` ≠ `KILL_EXECUTED` ≠ `CLEANUP_CONFIRMED`.

None of the following is terminal evidence on its own:
- a `kill()` call;
- a deferred or queued kill;
- a socket-close-first `'exit'` with an `undefined` code.

`CLEANUP_CONFIRMED` comes only from HANDLE-derived exit evidence for the same object. Anything less is
`CLEANUP_UNCERTAIN`, which means no cutover, no release, no retry and no fallback.

### 3.7 N1 — public-API accuracy note (from the focused rereview)

**Classification: NON_BLOCKING SOURCE-ACCURACY CLARIFICATION.** The accepted content is not modified.

- The amendment's sentence "no public event carries it" is overstated.
- The public `onExit.exitCode` *can* carry the HANDLE-derived code, but only when the native exit callback wins
  the race with socket close. Otherwise it carries `undefined`.
- The stricter accepted wording fails closed and stands.

P1 must identify the exact supported/public signal it uses for `CLEANUP_CONFIRMED`. This freeze does **not**
pre-authorize:
- reading private `_agent._exitCode`;
- using undocumented node-pty internals as authority;
- patching node-pty merely to satisfy P1.

### 3.8 Cleanup-confirmation stop condition

If P1 proves that the required `CLEANUP_CONFIRMED` fact cannot be obtained through a supported production seam or
public API, **P1 MUST STOP and return to architecture.** Implementation may not weaken confirmation semantics.

### 3.9 8-second bound

**Classification: VALID_REUSE.** `LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS = 8000` is reused **only** as the existing
physical-exit wait bound.

It is **not**:
- an execution timeout;
- an SLA;
- a `G`/`H` escalation value;
- a terminal-classification timeout.

The tracker's `markExited` signal is not reused. Expiry ⇒ `CLEANUP_UNCERTAIN`, never confirmed.

### 3.10 Deferred Windows kill

A queued kill is not an executed kill. A kill still queued or unexecuted when the bound expires ⇒
`CLEANUP_UNCERTAIN`, with no fallback.

### 3.11 Provider-registry consistency — P1 IMPLEMENTATION / RED OBLIGATION

From the focused rereview: the admission check must use whichever provider the registry actually holds at that
moment. After daemon init that may be a daemon adapter, which must answer ineligible. The check must not race
provider replacement during startup.

**Architecture invariant.** The capability decision used before the fence and the provider/backend used for the
subsequent delegated spawn must describe the same effective provider capability.

P1 must prove there is no admission/spawn capability race. No synchronization mechanism is invented by this
freeze.

### 3.12 Mechanism A / Mechanism B

**Mechanism A (revised, S-1).**
- Safe pre-cutover process control requires a stable, kernel-held, non-reusable target primitive and pre-fence
  eligibility.
- Language-level object identity is insufficient on its own.
- For the first workload, the verified eligible Windows ConPTY-DLL HANDLE path is the only positive candidate.

**Mechanism B: UNCHANGED.**
- Post-cutover and restart-recovered process control keeps the existing durable identity semantics.
- No Windows HANDLE shortcut may silently replace Mechanism B after restart.

### 3.13 N-5 / H2

- **N-5: OPEN.** H2 / general restart durability is not solved by Amendment-002.
- The first controlled workload keeps the accepted narrow H1 boundary (`FIRST_CONTROLLED_ACTIVATION_ACCEPTANCE`
  only).

### 3.14 Linux

| Item | Status |
| --- | --- |
| `DELEGATED_LINUX` | **DISABLED** — rejected before fence |
| Linux ordinary non-delegated PTY | **UNCHANGED / SUPPORTED AS BEFORE** (R-3) |

- Future delegated Linux enablement requires LE-1…LE-6 through its own reviewed amendment.
- No implementation primitive is selected.
- The N-4 classification lines of amendment §13 remain visible:
  - first-workload path: RESOLVED BY PLATFORM/BACKEND CAPABILITY RESTRICTION (effective upon P1 proof);
  - Linux: OPEN — PLATFORM ENABLEMENT BLOCKER;
  - Windows builds < 18309 (winpty): EXCLUDED.

### 3.15 First controlled workload

Scope: **Windows only · local eligible provider (`LocalPtyProvider`, non-remote, non-daemon) · safe ConPTY-DLL
backend (W-E1…W-E4).** Every previously accepted workload restriction that is not superseded also applies:
- disposable aiControl environment;
- disposable worktree or folder workspace;
- scripted deterministic stub workload;
- no irreversible effects;
- bounded runtime;
- manual supervision, one run at a time;
- local provider host per AD-1;
- no automatic fallback.

Windows in general is **not** declared delegated-ready. Only the exact eligible backend scope is authorized, and
only for P1 proof.

### 3.16 P1 RED contract (amendment §10)

| Contract | Requirement |
| --- | --- |
| **A** | Eligible Windows ConPTY-DLL positive path: ordering, identity and cleanup (WP-1…WP-6) |
| **B** | Linux rejected before fence, at the real seams: no fence call, reservation, spawn, sidecar, binding, cutover or fallback |
| **C** | Unsafe or unknown Windows backend rejected before fence, using a stubbed build seam |
| **D** | Non-delegated compatibility controls |
| **E** | The ten AD-2 (a′) obligations, remapped |
| **F** | Gate 52 re-proof (§3.4) |
| **Plus** | The provider-registry consistency obligation (§3.11), with no admission/spawn capability race |

### 3.17 DAG / P0 / schema

- **DAG:** unchanged.
- **P0:** the P0 prerequisite for P1 now includes the frozen two-part decision: the platform/backend capability
  (Windows ConPTY-DLL only; `DELEGATED_LINUX = DISABLED`) and pre-fence ordering. No further product decision
  blocks P1 once Amendment-002 is published.
- **Schema:** no change. No persisted capability field is created.

### 3.18 Prior documents

- Amendment-002 is additive.
- No prior frozen PRE_LIVE artifact is modified. The previously published architecture remains
  historical/normative except where §3.3 explicitly supersedes it.
- The accepted amendment, its discovery document and both review artifacts are content/evidence history and are
  unmodified.

## 4. Guards at ratification

**Docs-only.** This commit adds only this file: no code, tests, schema, migration or package change.

**aiControl, checked read-only before and after:**
- `origin/master == ab5967bdde5115afe6673e8b520a73cfb29f0eaf`;
- `data/app.db` SHA-256 `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`;
- no WAL/SHM/journal;
- fence acquisition disabled;
- dirty state untouched.

**Operational state (unchanged):**

| Item | State |
| --- | --- |
| Authority | `AICONTROL_NATIVE` |
| ORCA_DELEGATED | NOT STARTED |
| Fence acquisition | DISABLED |
| R3 | NOT STARTED |
| M5 | NOT STARTED |
| P1 | BLOCKED |
| Publication | NOT PUBLISHED |

```
state_class:     N4_AMENDMENT_FROZEN_READY_FOR_INDEPENDENT_FREEZE_VERIFICATION
display_verdict: ORCA_S5_PRELIVE_N4_PLATFORM_SAFETY_AMENDMENT_FROZEN_READY_FOR_REVIEW
```
