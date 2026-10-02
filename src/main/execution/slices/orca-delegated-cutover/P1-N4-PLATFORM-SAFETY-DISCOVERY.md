# P1 — N-4 Platform Safety Discovery (evidence for AMENDMENT-002)

**Status:** DISCOVERY EVIDENCE — CANDIDATE, NOT FROZEN, NOT PUBLISHED.
**Base:** `9c4383fe9ac550d02c0eea4f7b68e548a3ff2d21` (= `origin/main`; freeze-verification HEAD of the PRE_LIVE
chain; normative content HEAD `743458076769911cfe1fa5193f7c38ec4610ffee`).
**Supports:** `PRE-LIVE-SPEC-AMENDMENT-002-N4-PLATFORM-SAFE-PRECUTOVER-CLEANUP.md`.
**Trigger:** the P1 GENUINE RED mission halted before writing any test on the frozen N-4 stop condition
(P1 RED commit: NONE).

All citations below were re-read from source for this document; none are carried over from the trigger prompt.
node-pty is `1.1.0` with Orca's patch `config/patches/node-pty@1.1.0.patch` applied (the installed package
under `node_modules/.pnpm/node-pty@1.1.0_patch_hash=…/`).

---

## 1. Linux / POSIX — `IPty.kill()` targets a reusable pid

| # | Question | Finding | Source |
| --- | --- | --- | --- |
| L1 | How does `UnixTerminal.kill` select its target? | `process.kill(this.pid, signal \|\| 'SIGHUP')` inside `try { } catch (e) {}`. The target is the numeric pid, nothing else. | `lib/unixTerminal.js` `UnixTerminal.prototype.kill` |
| L2 | Is the pid cleared when the child exits? | No. `_pid` is assigned at fork and only set to `-1` by the `UnixTerminal.open()` factory (no child). `Terminal._close()` retires `_fd` but not `_pid`; the `pid` getter returns `_pid` unconditionally. | `lib/unixTerminal.js` (open factory), `lib/terminal.js` (`_close`, `pid` getter) |
| L3 | Is there an "already exited" guard in `kill()`? | No. There is no exited flag, no liveness probe and no fd check on the kill path. | L1 |
| L4 | When is the child reaped relative to JS? | Native `SetupExitCallback` starts a `std::thread` that calls `waitpid(pid, &stat_loc, 0)` (Linux branch; kqueue on macOS), and only **after** the reap builds the `ExitEvent` and delivers it via `tsfn.BlockingCall`. The kernel has released the pid before JS can observe exit. | `src/unix/pty.cc` `SetupExitCallback` |
| L5 | Is any kernel handle (pidfd or similar) retained on the JS object? | No. The JS object holds `_pid` and `_fd` (the pty master). The master fd names the terminal, not the process; nothing on the object pins the process identity. | `lib/unixTerminal.js`, `lib/terminal.js` |
| L6 | Does Orca's patch change any of L1–L5? | No. The `lib/unixTerminal.js` hunks only add asar unpack guards, `_fd < 0` guards on the `process` getter, `resize()` and the write queue, and retire `_fd` in `CustomWriteStream.dispose()`. No hunk touches `kill` or the `waitpid` sequencing. | `config/patches/node-pty@1.1.0.patch` |
| L7 | Does Orca already recognize the hazard? | Yes, post-exit only: `local-pty-session-activation.ts` replaces `proc.kill` with a no-op on non-win32 inside `onExit` ("node-pty SIGHUPs on socket 'close', which can race here and signal a reaped/recycled pid"). That neutralizes the call *after* JS learned of exit; it does not, and cannot, protect the window between native reap and JS exit delivery. | `src/main/providers/local-pty-session-activation.ts` (`onExit` handler) |

**Window.** Between L4's `waitpid` returning and the JS exit callback running (event-loop scheduling, plus any
synchronous work the AD-2 (a′) handler is already doing — e.g. a failed marker capture), the pid is free for
reuse. A Mechanism A teardown issued in that window through `IPty.kill()` signals whatever process now holds the
number. Holding the same `IPty` object does not narrow the window: L1–L5 show the object carries no identity that
the kernel would check.

## 2. Windows — Orca's ConPTY DLL path targets a HANDLE

| # | Question | Finding | Source |
| --- | --- | --- | --- |
| W1 | Does Orca select the DLL path? | `windowsConptyDllOptions()` returns `{ useConptyDll: true }` on win32 and is spread into both spawn sites in `local-pty-utils.ts`. The daemon spawn (`native-pty-spawn.ts`) and ConPTY warmup also pass `useConptyDll: true`. | `src/main/providers/local-pty-utils.ts:174-175,193,243`; `src/main/daemon/pty-subprocess/native-pty-spawn.ts:43` |
| W2 | What does `WindowsPtyAgent.kill()` do on that path? | `_useConpty && _useConptyDll` ⇒ the inner `else`: destroy the input socket, `_ptyNative.kill(this._pty, true)`, dispose the conout worker. **No** `getConsoleProcessList`, **no** `process.kill(pid)`. | `lib/windowsPtyAgent.js` `kill` |
| W2x | Which Windows paths *are* pid-based? | (a) ConPTY **without** the DLL (`_useConptyDll` false): enumerates `_getConsoleProcessList()` and `process.kill(pid)` each; (b) legacy winpty (`_useConpty` false): `getProcessList(this._pid)` then `process.kill(pid)`. Both are excluded from the eligible path by W1 and must be proven unreachable by P1. | `lib/windowsPtyAgent.js` `kill` |
| W3 | What is `this._pty`? | A per-process baton id minted by `InterlockedIncrement(&ptyCounter)` in `PtyStartProcess`; batons live in `ptyHandles`. It is not an OS pid and is never reissued within the process lifetime. | `src/win/conpty.cc:81,353-355` |
| W4 | What does native `PtyKill` terminate? | Under `ptyJobMutex`: look up the baton by id; if `!consoleClosed`, claim it, `DuplicateHandle(handle->hShell)` (or `TerminateProcess(handle->hShell)` directly if duplication fails); outside the lock `ClosePseudoConsole(hpc)` then `TerminateProcess(hShellDup, 1); CloseHandle(hShellDup)`. HANDLE-addressed only. | `src/win/conpty.cc` `PtyKill` (≈638-720) |
| W5 | Can the HANDLE name a different process? | No. An open process HANDLE keeps the kernel process object alive, so its pid cannot be reused while `hShell` is held. The watcher nulls `hShell` under the same mutex when the shell dies; `PtyKill` then has nothing to terminate (self-exited pty) rather than a stale target. | `src/win/conpty.cc` `SetupExitCallback` (Windows), `PtyKill` |
| W6 | How is exit detected natively? | `WaitForSingleObject(baton->hShell, INFINITE)` + `GetExitCodeProcess`, then handle close and `shellExited = true` under `ptyJobMutex`; the exit code reaches JS via `_$onProcessExit` (sets `_exitCode`). | `src/win/conpty.cc` `SetupExitCallback`; `lib/windowsPtyAgent.js` `_$onProcessExit` |
| W7 | Does calling `kill()` mean cleanup happened? | No. `WindowsTerminal.kill` is wrapped in `_deferNoArgs`: until the first data event sets `_isReady`, the call is queued. Separately, `TerminateProcess` *initiates* termination; completion is only observable via W6. The JS `'exit'` event is emitted on socket `'close'` with `_agent.exitCode`, which can be `undefined` if the socket closes before W6 delivered. | `lib/windowsTerminal.js` (`_deferNoArgs`, `kill`, socket `'close'`) |
| W8 | Tree cleanup primitive? | `terminatePtyJob(proc)` → native `terminateJob(id, shellPid)`: job-object (kernel handle) termination of the whole tree; `shellPid` is an ownership *proof* checked against the baton (refusal on mismatch), not a lookup key. Returns `'unavailable'` — never a false `'terminated'` — when there is no job. After the shell exits the job is nulled, so this is only meaningful before root exit. | `src/main/windows/windows-pty-job.ts:72-116` |

## 3. Eligibility seam that already exists

- `spawn-options.ts:161-171` (condition at :162, throw at :170): a delegated request (`deferDelegatedCommandDelivery === true`) throws
  `delegated_cutover_provider_unsupported` unless the provider's `supportsDelegatedCutoverHold()` is exactly
  `true` — fail-closed, before spawn options are finalized and before `pty.spawn`.
- `local-pty-provider.ts:77-79`: `LocalPtyProvider.supportsDelegatedCutoverHold()` returns `true`
  unconditionally — **platform-blind**. On Linux today a delegated request reaches `pty.spawn`.
- `pty-provider-contract.ts:169`: the capability accepts `PtyProbeOptions` and may be async, so a
  platform-qualified answer fits the existing signature (no new interface).

## 4. Conclusions carried into AMENDMENT-002

1. Linux/POSIX `IPty.kill()` is not identity-safe for AD-2 Mechanism A (L1–L6). The defect is target selection
   by reusable pid after a native reap the JS layer cannot see; no timing argument removes it.
2. Orca's Windows path (W1) selects its target by an owned process HANDLE (W2–W5); target selection is safe.
   Cleanup *completion* is a separate fact (W6–W8).
3. The existing provider capability seam (§3) is the narrowest place to fail closed before spawn; today it does
   not distinguish platforms.
4. No existing Orca or node-pty primitive gives Linux a stable, non-reusable process-control token. None is
   selected here.
