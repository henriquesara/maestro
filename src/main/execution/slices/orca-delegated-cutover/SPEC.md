# Slice B — `ORCA_DELEGATED` Cutover (provisionally ORCA-S5) — CORRECTED CANDIDATE SLICE SPEC

> SDD artifact. **Candidate — not frozen, not independently accepted, not
> published, authorizes no implementation.** Re-derived end-to-end against
> the real repository state of both Maestro and aiControlCenter. No code,
> schema, migration, test, dependency, or skill is changed by producing this
> document. No `data/app.db` byte is touched by this task. **No authority
> stage moves by virtue of this document existing.** `ORCA_DELEGATED` stays
> `NOT STARTED`. When frozen it becomes the functional authority for the
> slice; a real conflict is `CONTRACT_CONFLICT` → architecture decision →
> amendment, never a silent edit here.
>
> **This is a correction, not an amendment, of the rejected candidate**
> `f1d3396473908a869753b44b21caa35f105ada4c` (branch
> `orca-s5-delegated-cutover-architecture`). That candidate is
> `REJECTED / UNPUBLISHED` per aiControlCenter `docs/HANDOFF.md`
> (`AICONTROL_ORCA_DELEGATION_FENCE_CLOSED_PUBLISHED_READY_FOR_SLICE_B_ARCHITECTURE_CORRECTION`,
> published HEAD `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`) — it predates the
> real aiControl fence prerequisite and was built from a stale local
> aiControlCenter checkout that could not read the real handshake. This
> document is re-derived from canonical `origin/main` on a fresh worktree,
> never branched from the rejected commit, and stands alone: a fresh
> implementation session consumes it without reconstructing architecture from
> chat history or from the rejected text. Salvaged language is re-verified
> against real code before being kept; nothing is carried forward merely to
> minimize diff.

**State class:** `ARCHITECTURE_READY_FOR_INDEPENDENT_REVIEW`.
**Display verdict:** `ORCA_S5_DELEGATED_CUTOVER_ARCHITECTURE_CORRECTED_READY_FOR_REVIEW`.

---

## Artifact identity

| Field | Value |
| --- | --- |
| Proposed slice | **Slice B — `ORCA_DELEGATED` Cutover** (provisionally ORCA-S5), **corrected candidate** |
| Bounded context owner | **Execution** |
| Migration authority ladder stage (before) | `AICONTROL_NATIVE` |
| Migration authority ladder stage (after, per delegated run, on independent acceptance + explicit activation) | `ORCA_DELEGATED` — the only slice permitted to move this |
| Orca mode (before → after) | `ORCA_SHADOW_ADVISORY` → `ORCA_SHADOW_ADVISORY` for every run never explicitly admitted as delegated; a delegated run's mode becomes `ORCA_DELEGATED` at its own cutover instant only |
| Authority transfer scope | **Per-run, explicit, opt-in.** No global flip. |
| Maestro base / HEAD | `origin/main` = `66dab64373942f58a6ddfccf71a99c94ff719bae`, verified by fresh `git fetch` this session — **matches the mission's required canonical value exactly**; no drift |
| Candidate branch | `arch/orca-s5-delegated-cutover-correction`, fresh `git worktree add -b … origin/main` this session (never branched from `f1d339…`) |
| Predecessor slice | ORCA-S4 — Delegated Side-Effect Boundary Enumeration & Shadow Proof (`src/main/execution/slices/delegated-side-effect-boundary/`), `CLOSED / PUBLISHED`, frozen contract = `SPEC.md` (read in full this session) |
| Predecessor analysis | `GAP-ANALYSIS-ORCA-DELEGATED.md`, independently accepted, read in full this session |
| Rejected reference | `f1d3396473908a869753b44b21caa35f105ada4c` (910-line SPEC, read in full this session) — salvaged only where re-verified correct; its own §20 admits it never located the real integration seam (risk 1) and never read the real fence protocol (§0) |
| Candidate SPEC path | `src/main/execution/slices/orca-delegated-cutover/SPEC.md` (absent from canonical `main`; created fresh by this session) |
| aiControlCenter canonical read state | `origin/master` = `ab5967bdde5115afe6673e8b520a73cfb29f0eaf`, verified by fresh `git fetch` this session — **matches the mission's required canonical value exactly**; read via `git show origin/master:<path>` (never the stale local working-tree checkout, whose `HEAD` at session start was `c2d404a5`, five commits behind) |
| aiControlCenter published fence technical HEAD | `d5a1512b2e965f4afb4794dbd082f58d906de01f` — confirmed a real ancestor of `origin/master` (`git merge-base --is-ancestor`, this session) |
| aiControlCenter operational DB guard | `data/app.db` SHA-256 `2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`, no `-wal`/`-shm`/journal — verified **before** this session's work by direct hash (`certutil -hashfile`); re-verified identical at close, §22 |

**Normative source, re-read fresh this session (not secondhand-quoted):**

- Maestro: `GAP-ANALYSIS-ORCA-DELEGATED.md` (full), `delegated-side-effect-boundary/SPEC.md` (full, all 20 sections), `orca-runtime-create-agent-session.ts` and `orca-runtime-create-terminal.ts` (the real production launch seam, §4), `orca-runtime-report-pty-spawn-commit.ts`, `repo-worktrees.ts`.
- aiControlCenter (`origin/master`, read-only, via `git show`): `docs/HANDOFF.md`, `docs/architecture/orca-delegation-fence-prerequisite.md` (full, all 16 sections), `src/lib/agent-runner/orca-fence.ts` (full, 284 lines), `src/lib/agent-runner/orca-fence-projection.ts` (full, 96 lines).

Unlike the rejected candidate (whose §0 header stated its local aiControlCenter
checkout was stale and could not read the amendment fresh), **this session
independently re-read the real, published fence protocol and the real
projector code** rather than quoting it secondhand. Every claim about
aiControl behavior below is sourced to a specific function or SQL statement
in one of the two files above, not to a mission-brief paraphrase.

---

## 0. `CONTRACT_CONFLICT` check

**No conflict** against any frozen Maestro contract (ORCA-S1–S4) or the
published aiControl fence prerequisite. This SPEC:

- moves the authority ladder **only** for runs an explicit, aiControl-owned
  fence-acquisition-then-Maestro-cutover handshake names as delegated — never
  a global flip, never a queue/capacity/scheduler transfer;
- consumes ORCA-S4's `ShadowLifecycleProcessPort` shape, `dispatch_process_binding`,
  `dispatch_termination`, `dispatch_lifecycle_closure`, `dispatch_lifecycle_event`,
  and `convergeDelegationBoundaryLifecycle` as already-proven mechanism,
  extended (not rewritten) per §8;
- references the **real, published** aiControl fence protocol
  (`orca-fence.ts`, `orca-fence-projection.ts`,
  `docs/architecture/orca-delegation-fence-prerequisite.md`) instead of a
  hypothetical "admission grant" (correcting the rejected candidate's §4);
- is explicitly gated `NOT_YET_LIVE_ACTIVATABLE` (§18) because aiControl's
  own rollout (`R1 COMPLETE`, `R2 CODE PUBLISHED`, `R3 NOT STARTED`, fence
  acquisition structurally disabled — `docs/HANDOFF.md`, re-confirmed by
  reading `isOrcaFenceAcquisitionEnabled()` in `orca-fence.ts:49-51`) has not
  reached the state this SPEC's own entry criteria require, and because
  `orca-fence-projection.ts`'s declared `DIVERGENCE` outcome (line 24) is
  never actually returned by the function (§17) — both are pre-activation
  dependencies, not implementation gaps in this SPEC.

`docs/HANDOFF.md`'s own delegation-fence closeout entry names seven
correction items (A–G) required of the next Slice-B architecture session;
this document is organized to visibly close each one, cited by letter
throughout.

---

## 1. Name / purpose

**Slice B — `ORCA_DELEGATED` Cutover.** Give Orca correctness authority over
the mechanical running→terminal lifecycle of explicitly delegated, real
executions — using ORCA-S4's already-proven machinery, extended to a real
process — while aiControl keeps admission/capacity/queue authority and,
because no `execution_attempts` row is ever opened for a delegated run
(`GAP-ANALYSIS-ORCA-DELEGATED.md` §3; confirmed again by reading
`orca-fence-projection.ts`'s own doc comment, §9 below), Orca necessarily
becomes the terminal-status **classification** authority too — a correction
to the rejected candidate's framing, not a re-litigation of anything frozen.

### What changed from the rejected candidate, and why (map to mission items A–G)

| Item | Rejected candidate's defect | This correction |
| --- | --- | --- |
| **A** | §4 said the real process launches *after* the cutover commit; §6.3/§9.2 said the bind-time seam is invoked *from inside* the real launch path, i.e. the process already exists *before* the seam runs. Self-contradictory, and §20 risk 1/2 admits the real call site was never located. | §4/§5 below: the real call site is located and read (`orca-runtime-create-terminal.ts`); the real `ptyController.spawn()` primitive has no "prepare without spawning" mode, so process creation **necessarily** precedes any Maestro-side commit. The ordering is frozen as a fact about the real runtime, not a preference between two hypothetical paths. |
| **B** | Invented an "aiControl admission grant" with no cited implementation. | §6 below cites the real, published `acquireOrcaFence` / `safeReleaseOrcaFence` / `acknowledgeOrcaCutover` / `flagOrcaFenceBreakGlass` functions and their exact CAS predicates from `orca-fence.ts`. |
| **C** | Reused `ShadowLifecycleProcessPort` by asserting a real handle "can be substituted behind the same port" without checking whether the real launch call site's hook is even `await`-able. | §5.2 below reads `orca-runtime-report-pty-spawn-commit.ts` and finds `onPtySpawnCommitted` is a synchronous, unawaited, fire-and-forget callback today — too weak to host a durable multi-row transaction — and names the exact, minimal change required. |
| **D** | Collapsed cancellation and timeout into the identical `dispatch_termination.termination_method='signalled'` value with no distinguishing durable field. | §9 below adds a `teardown_reason` column, written **before** the signal is ever sent, and a `terminal_status_ref` closure column computed from durable facts only, never inferred later. |
| **E** | Asserted "delegate to Orca" without naming the real owning call boundary; §20 risk 1 admits the seam was never located. | §4 below names exact files and functions: `OrcaRuntimeWithCreateAgentSession.createAgentSession` → `OrcaRuntimeWithCreateTerminal.createTerminal` → `this.ptyController.spawn(...)`. |
| **F** | Cardinality was implied, never frozen against the real recovery primitives. | §11 below freezes 1:1:1:1 and names the **real, already-existing** reconciliation primitives (`ptyController.adoptStablePane`, `reconcileRemoteTerminalCreate`, the `agentSessionCreateOperations` idempotency ledger) as the recovery path — never a second spawn. |
| **G** | Not addressed at all (rejected candidate predates the published fence). | §17 below freezes the divergence-fix prerequisite by reading `orca-fence-projection.ts` directly and showing exactly which line never fires. |

### What this slice is not

Not a rewrite of ORCA-S1–S4. Not a queue/capacity/admission transfer. Not
`ORCA_AUTHORITATIVE`. Not a claim that the Execution bounded context and
Maestro's real agent-session runtime are already the same code path — they
are not; naming the seam between them precisely is this document's hardest
job (§4).

## 2. Bounded-context owner

**Execution** (unchanged). New Execution-owned aggregates: `delegation_cutover`
(§8.1), `aicontrol_terminal_projection` (§8.3). One extended ORCA-S4 table
(`dispatch_process_binding` gains `teardown_reason`, §8.2) and one extended
ORCA-S4 table (`dispatch_lifecycle_closure` gains `terminal_status_ref`,
§8.2). No new bounded context; no new Delivery/Governance read or write
surface over Execution's store.

## 3. Non-negotiable authority model (restated, unchanged)

```
AICONTROL_NATIVE → ORCA_SHADOW_ADVISORY → ORCA_DELEGATED → ORCA_AUTHORITATIVE
```

Slice B moves only the `AICONTROL_NATIVE`/`ORCA_SHADOW_ADVISORY` →
`ORCA_DELEGATED` edge, per run, never the `ORCA_DELEGATED → ORCA_AUTHORITATIVE`
edge. Exactly one correctness authority per action, per §12.

---

## 4. The real Orca runtime integration seam (closes item E)

Traced this session, file and function exact:

1. **`OrcaRuntimeWithCreateAgentSession.createAgentSession`**
   (`src/main/runtime/orca-runtime-create-agent-session.ts:36`) — the real
   production entry point for launching an agent session. Already durable-ish
   at the request level: it keys an in-flight/replay ledger
   (`agentSessionCreateOperations`) by `(callerKey, clientOperationId)`,
   fingerprints the resolved request, and replays the same result for a
   retried operation — this is the **real** idempotency discipline the
   rejected candidate never found. It pre-mints an `operationHandle` =
   `` `term_${deterministicAgentSessionUuid(...)}` `` **before** anything is
   spawned (line 202) and records it in `reclaim.identity` for post-crash
   reconciliation (line 205).
2. It calls **`this.createTerminal(...)`** (line 211), passing
   `preAllocatedHandle: operationHandle` and an `onPtySpawnCommitted`
   callback.
3. **`OrcaRuntimeWithCreateTerminal.createTerminal`**
   (`orca-runtime-create-terminal.ts:9`) resolves launch options, then at
   line 127 calls **`this.ptyController.spawn({ …, preAllocatedHandle, … })`**
   — this is the actual OS process creation. `spawn` returns `{ id, pid,
   incarnationId, stablePaneOwner?, agentSessionEnsure?, wslDistro? }`
   (`result`).
4. Immediately after `spawn` resolves (line 178-180): `if
   (!result.stablePaneOwner) { reportPtySpawnCommitted() }` — the
   `onPtySpawnCommitted` hook fires.
5. Only after that: `this.registerPreAllocatedHandleForPty(...)`,
   `this.registerPty(...)` (durable/in-memory registration in Maestro's own
   runtime state), then, conditionally, `this.notifier.revealTerminalSession(...)`
   (first point anything becomes visible to a renderer/user).

**This is the smallest existing insertion point.** No new call path is
invented; Slice B's bind-time seam is inserted as the *body* of the
`onPtySpawnCommitted` callback `createAgentSession` already supplies at step
2, executing between steps 4 and 5 above — i.e. after the real process
exists and its `pid` is known, but strictly before any registration or
external visibility. This is a materially stronger, more precise claim than
the rejected candidate's "the real job is: invoke the bind-time seam from
inside orca-runtime.ts... this SPEC does not invent that call site's exact
shape" (its own §6.3) — that call site is now named exactly.

### 4.1 A concrete, minimal seam gap found and named honestly

Reading `orca-runtime-report-pty-spawn-commit.ts` in full:

```ts
export function createPtySpawnCommitReporter(callback?: () => void): () => void {
  let reported = false
  return () => {
    if (reported) return
    reported = true
    callback?.()
  }
}
```

`onPtySpawnCommitted` is **synchronous, fire-and-forget, `() => void`**.
Today's only consumer (`createAgentSession`'s `retainReplayFence = true`,
line 226) is a cheap in-memory flag write — safe to fire without awaiting.
Slice B's cutover commit is a multi-row SQLite transaction (§5.4) — it
**cannot** safely be fire-and-forget: `createTerminal` would proceed to
`registerPty`/`revealTerminalSession` before the durable commit lands,
which is exactly the externally-visible-before-cutover violation the
mission forbids.

**Required minimal seam change, named explicitly rather than hand-waved
(mirrors the discipline `GAP-ANALYSIS` and ORCA-S1–S4 already apply to their
own real gaps):** `createTerminal` must `await reportPtySpawnCommitted()`
and propagate a rejection from it as a spawn failure, and
`createPtySpawnCommitReporter`'s callback type must widen to `() =>
Promise<void> | void`. This is a **two-line, additive, backward-compatible**
change (existing synchronous callers are unaffected by an `await` on a
function that already returns `undefined` today) — the smallest seam this
correction can specify, not a rewrite of the terminal-creation path. Per
AGENTS.md "no production code in this task," this change is **specified,
not made**, here; implementation must apply it as the very first commit of
the eventual Slice-B implementation session, independently RED/GREEN-proven
like every prior slice's own seam extension.

### 4.2 What is honestly NOT re-verified this session

Whether the agent's actual startup command/prompt begins executing
synchronously inside `ptyController.spawn(...)` (embedded in the launch
command/env at spawn time, per `orca-runtime-create-terminal.ts:107-149`) or
only after a later, separate delivery step was **not** independently traced
to the PTY provider's own implementation this session — that code lives
below `ptyController`, which this session did not open. This matters
because it bears on how much of "workload execution" is already irreversible
at the instant `spawn()` returns, before Slice B's cutover commit can even
run. §5.6 states the invariant this SPEC can freeze regardless of the
answer, and §21 lists resolving this precisely as a required
implementation-time confirmation, not an assumption this SPEC makes either
way.

---

## 5. The corrected cutover / process-bind ordering (closes item A) — frozen state machine

### 5.1 Why the rejected candidate's contradiction cannot be resolved by "choosing a path"

The rejected candidate framed process-before-commit vs. commit-before-process
as a design choice (its own §9.2 "path (a)" vs. "path (b)"). Given the real
seam (§4), **it is not a choice**: `ptyController.spawn(...)` is the only
primitive that creates the real OS process, it is synchronous-return
(`await`ed once, resolves with a `pid`), and nothing between
`createAgentSession` and `spawn` returning can commit anything to Maestro's
Execution store without a call site that does not exist today. The real
runtime has no "prepared but not yet spawned" execution instance — inventing
one (a suspended PTY, a pre-forked-but-not-execed process) would be
suspension semantics the platform does not support, which the mission itself
forbids inventing. **Process creation necessarily precedes the Maestro-side
durable commit.**

### 5.2 The frozen numbered state machine

```
S0  NATIVE_ELIGIBLE
      (aiControl: orca_fence_state='none'; authority AICONTROL_NATIVE)
S1  FENCE_ACQUIRED               [aiControl commit — Phase 1, §6]
      (aiControl: orca_fence_state='fenced'; authority still AICONTROL_NATIVE;
       native claim/dequeue/direct-claim/execute all structurally impossible, §6.2)
S2  ORCA_PREPARING
      (Maestro has the fence token; no durable Execution-store row yet;
       resolves workspace, launch plan, preAllocatedHandle — all in-memory,
       nothing committed, mirrors createAgentSession steps before spawn)
S3  PROCESS_SPAWNED_NOT_YET_AUTHORIZED   [real side effect — ptyController.spawn()]
      (the real OS process exists, pid known; NO Maestro Execution-store row
       yet; NOT visible to any renderer/user; NOT yet delegated in aiControl's
       eyes — this is the smallest real "prepared but not yet authorized"
       state the platform supports, per §5.1)
S4  ORCA_DELEGATION_CUTOVER_COMMITTED    [Maestro durable commit — THE authority-transfer instant]
      (single SQLite transaction, §5.4: run_binding + dispatch_worktree +
       dispatch_process_binding + delegation_cutover, all-or-nothing;
       authority is ORCA_DELEGATED for this correlation_id from this instant;
       aiControl does not yet know)
S5  AICONTROL_CUTOVER_ACKNOWLEDGED       [aiControl commit — Phase 3, §6]
      (orca_fence_state='fenced'→'cutover'; acknowledgement only, not the
       transfer decision — the transfer already happened at S4)
S6  ORCA_EXECUTING
      (registerPty, reveal, prompt/command delivery proceed; this is the
       first point any output may reach a user or any external system)
S7  ORCA_TERMINAL_CLOSED                 [dispatch_lifecycle_closure written, §9]
S8  AICONTROL_TERMINAL_PROJECTED         [projectDelegatedTerminalResult, §10]
```

Two reconciliation/incident branches, entered from any of S1–S7 on a genuine
contradiction, never silently absorbed into the happy path:

```
S-INC   RECONCILIATION_INCIDENT   (a dispatch_lifecycle_incident row — never a fabricated fact)
S-REL   FENCE_RELEASED            (only from S1, only via §6.4's positive-evidence path)
```

### 5.3 The critical invariant, restated precisely against S3

**No externally visible authoritative workload side effect may occur before
S4's durable commit.** "Externally visible" is defined precisely, not
loosely: no `registerPty`, no `revealTerminalSession`, no
`publishPtyBackedMobileSessionTerminal`, no IPC broadcast, no SSE, no mobile
session publish — every one of these is a real, named call in
`orca-runtime-create-terminal.ts` that happens **after** `spawn()` returns
(§4 steps 4–5). Slice B's seam inserts S4's commit into step 4, strictly
before step 5. The bare existence of a spawned-but-unregistered OS process at
S3 is not itself externally visible by this definition — it is inert
infrastructure, not yet reachable by any Maestro/aiControl-facing surface.

**Genuine residual, not concealed (§4.2, §21):** whether the spawned
process has already begun consuming its startup command/prompt at the
instant `spawn()` returns (a question this session could not answer without
reading the PTY provider's own internals) is orthogonal to the invariant
above but matters to how much can be undone if S3→S4 never completes (§5.5).
This SPEC freezes the *visibility* invariant unconditionally; it does **not**
claim S3 is costlessly reversible, and flags that honestly rather than
asserting it.

### 5.4 Transaction boundary at S4

```
BEGIN IMMEDIATE;
INSERT run_binding (ORCA-S1, unchanged schema);
INSERT dispatch_worktree (ORCA-S3, unchanged schema, pointed at the REAL
  dispatch worktree the real Orca runtime already governs — never a new
  worktree, never ORCA-S3's own durable *shadow* worktree root, §13);
INSERT dispatch_process_binding (ORCA-S4 schema + §8.2's new
  teardown_reason column, NOT NULL pid/os_start_marker — always known at
  this point per §5.1, so ORCA-S4's NOT NULL pid constraint needs NO
  amendment, unlike the rejected candidate's undecided §9.2 path (b));
INSERT delegation_cutover (§8.1);
COMMIT;
```

One transaction, four inserts, the same `BEGIN IMMEDIATE` +
bounded-`SQLITE_BUSY`-retry discipline every prior slice uses. This
resolves the rejected candidate's §9.2 "path (a) vs (b)" dilemma
definitively in favor of (a) — not as a preference, but because §5.1 shows
(b) requires a nullable-`pid` state the real runtime never produces.

### 5.5 Crash windows at the ordering boundary (subset; full table §14)

| Window | Point | Durable state | Authority | Recovery |
| --- | --- | --- | --- | --- |
| **C0** | crash during S2 (before `spawn()`) | nothing durable, no process | still `AICONTROL_NATIVE`; fence remains `fenced` at aiControl (S1 durable) | retry S2→S3→S4 from scratch; §6's fence path (B) makes a same-token retry idempotent |
| **C1** | crash after `spawn()` returns (S3), before the S4 transaction opens or commits | a real OS process exists, **no Execution-store row at all**, **not registered with Maestro's own pty registry either** (registration is step 5, after the seam) | still `AICONTROL_NATIVE` — S4 never committed | the process is an **orphan by Maestro's own bookkeeping**, not merely by ORCA-S4's synthetic-fixture definition; §5.6 defines the honest, fail-closed disposition |
| **C2** | crash after S4 commits, before S5's acknowledgement | `ORCA_DELEGATED` already true (S4's own durable fact); aiControl still shows `'fenced'` | Orca (already transferred) | retry Phase 3 acknowledgement with the same token (§6, idempotent by aiControl's own CAS) |

### 5.6 The honest disposition of window C1 (a real orphan, not a synthetic one)

Unlike ORCA-S4's synthetic shadow process (whose pre-commit orphan class,
§10.3 there, is Execution's own disposable fixture), a C1 orphan is a **real
user-facing process** with no Execution-store row and — because registration
is downstream of the seam — **not even visible to Maestro's own
`orca-runtime` pty bookkeeping**. Two real, already-existing primitives make
this recoverable without inventing anything:

1. `createAgentSession`'s own `reclaim.identity` (worktreeId, connectionId,
   terminalHandle) was already recorded **before** `spawn()` was ever called
   (§4 step 1) — durable in the operation ledger for the lifetime of that
   ledger entry (bounded by `AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS`).
2. `reclaimFencedAgentSessionSpawn` (`orca-runtime-create-agent-session.ts:273`)
   already calls `reconcileRemoteTerminalCreate(worktreeId, terminalHandle,
   connectionId)` — read-only adoption, "never spawns and never kills" (its
   own doc comment) — to find whether the PTY the failed operation started
   is still alive, by handle, not by scanning.

**Required extension, named not hand-waved:** on an operation-ledger
timeout (the existing `AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS` boundary) with
no S4 commit ever observed, Slice B's own sweep (§12) must attempt the same
`reconcileRemoteTerminalCreate`-by-`terminalHandle` lookup before declaring
the process unrecoverable — reusing the identical primitive
`reclaimFencedAgentSessionSpawn` already uses for its own, narrower,
in-request retry case. If found alive and identity-corroborated: complete S4
late (a delayed commit is still correct — nothing authoritative happened
before it, §5.3) and proceed to S5. If not found, or ambiguous: **fail
closed** — raise `dispatch_lifecycle_incident(kind='pre_cutover_orphan_process')`,
release the fence via §6.4's positive-evidence path (the process is
confirmed gone, so Maestro can honestly assert "never committed cutover"),
and never guess. This is a genuinely new S4-adjacent orphan class this
slice introduces (unlike anything S4 itself had), named explicitly per the
mission's "do not hand-wave" instruction rather than silently reused from
S4's synthetic-fixture treatment.

---

## 6. The real cross-repo aiControl fence handshake (closes item B)

Every phase below cites the exact function and CAS predicate from
`orca-fence.ts` / `orca-fence-projection.ts` (`origin/master`,
`ab5967bdde…`), not a paraphrase.

**Phase 0 — native eligible.** `agent_runs.orca_fence_state = 'none'`.
Authority `AICONTROL_NATIVE`.

**Phase 1 — acquire fence.** Maestro generates `token` (caller-supplied,
never minted by aiControl — `orca-fence.ts:14`) and calls
`acquireOrcaFence({ runId, token })`. Its CAS
(`orca-fence.ts:97-105`):

```sql
UPDATE agent_runs SET orca_fence_state='fenced', orca_fence_token=:token, orca_fenced_at=:now
WHERE id=:runId AND status IN ('pending','queued') AND orca_fence_state='none'
```

Five real outcomes, all already implemented: `ACQUIRED`,
`ALREADY_FENCED_SAME_TOKEN` (idempotent retry, same token),
`CONFLICT_DIFFERENT_TOKEN`, `ALREADY_CUTOVER`, `NOT_ELIGIBLE`. A sixth,
**`ACQUISITION_DISABLED`**, fires unconditionally while
`isOrcaFenceAcquisitionEnabled()` reads false (`orca-fence.ts:49-51`,
`process.env.ORCA_FENCE_ACQUISITION_ENABLED === 'true'`) — this is the R3
activation gate (§18), and it is **the current real state of the published
system**: this session confirmed no override makes it true. aiControl
remains authority; native claim/dequeue/direct-claim are now structurally
impossible for this row (the prerequisite's own §3 proof, not re-derived
here); Maestro is **not yet** authority.

**Phase 2 — prepare.** Maestro's own S2/S3 (§5.2 above), entirely internal,
no aiControl interaction, no durable Execution-store fact yet at S2, one real
side effect (process spawn) at S3.

**Phase 3 — Maestro cutover commit (§5.4).** The authority-transfer instant.
Entirely inside Maestro's database; aiControl cannot observe it directly —
this matches the prerequisite doc's own §5 Phase 2 language ("not built or
specified here... aiControl cannot observe it directly") verbatim.

**Phase 4 — aiControl acknowledgement.** Maestro calls
`acknowledgeOrcaCutover({ runId, token })`. Its CAS
(`orca-fence.ts:255-263`):

```sql
UPDATE agent_runs SET orca_fence_state='cutover', orca_cutover_at=:now
WHERE id=:runId AND orca_fence_state='fenced' AND orca_fence_token=:token
```

Idempotent (a retry with the same token that finds the row already
`'cutover'` with the same token is treated as `ACKNOWLEDGED`, not an error —
`orca-fence.ts:277-279`). A wrong/stale token is rejected
(`REJECTED_WRONG_TOKEN` / `REJECTED_STALE`). If acknowledgement is lost:
Maestro remains authority (Phase 3 already happened); retry is naturally
idempotent per the same CAS.

**Phase 5 — execution / closure / terminal projection.** §5.2 S6–S8, §9,
§10.

### 6.1 Release — the only path that clears a fence, and why break-glass never does

`safeReleaseOrcaFence({ runId, token, positiveNoCutoverEvidence })`
(`orca-fence.ts:162-186`) requires the caller to **assert** positive
evidence — the function has no way to verify it, only to refuse when the
caller admits it has none (`orca-fence.ts:150-158`'s own doc comment). Its
CAS matches only `orca_fence_state='fenced'` (never `'cutover'`), so a stale
release after cutover is rejected, not silently accepted. **Slice B's own
obligation:** never call this with `positiveNoCutoverEvidence: true` except
from §5.6's C1 fail-closed path (a confirmed-dead pre-commit process) or an
equivalent explicit, evidence-backed withdrawal before S4 ever commits — a
timeout, a lost response, or operator judgment are explicitly insufficient
per the prerequisite's own §6.1, and this SPEC does not weaken that.

`flagOrcaFenceBreakGlass` (`orca-fence.ts:215-232`) is **structurally
incapable of clearing a fence** — it performs zero `.update()` calls to the
three fence columns, by construction (its own doc comment). Slice B never
calls it to unblock anything; it is aiControl's own operator-facing
reconciliation marker, out of this SPEC's scope entirely.

---

## 7. Corrected process/execution-plane ownership contract (closes item C)

Answering the mission's eight questions directly, against real code:

1. **Who creates the production process/execution instance?** Maestro's
   already-shipping `ptyController` (behind `OrcaRuntimeWithCreateTerminal`),
   via `spawn(...)` at S3 — never a new, second, competing spawn mechanism.
2. **Who owns its PID/handle?** Maestro's `orca-runtime` pty registry
   (`registerPty`), from S6 onward; the durable `dispatch_process_binding`
   row (Execution-owned) holds the `pid` + `os_start_marker` as a durable
   *copy*, written at S4, not a second ownership claim.
3. **Who durably binds it to the delegated dispatch?** The S4 transaction
   itself (§5.4) — `dispatch_process_binding.orca_dispatch_id` is the
   binding key.
4. **What object crosses the ExecutionPlane port?** `ShadowLifecycleProcessPort`'s
   exact interface (`spawn`/`observe`/`requestTermination`, ORCA-S4 §9),
   **unmodified as a type**, with a new adapter (§7.1) whose `spawn(...)`
   does not call `spawnProcess` — it **adopts** the already-real
   `{ pid, killScope, osStartMarker, osStartMarkerSource }` the real runtime
   already produced at S3, synchronously, never discovered later by scanning.
5. **Does the port create the process, adopt an externally-created process,
   or prepare an execution handle?** **Adopts.** Named explicitly — this is
   the one point where Slice B's adapter genuinely differs from ORCA-S4's
   `spawn`-creates-a-process adapter, and the port's own shape
   accommodates it without a type change (ORCA-S4 §5 pre-designed exactly
   this substitutability).
6. **How is execution prevented before authority cutover?** §5.3's
   visibility invariant — not process non-existence (§5.1 shows that is not
   achievable), but zero external reachability until S4 commits.
7. **How is the same execution instance recovered after Maestro restart?**
   §11 — the real `ptyController.adoptStablePane` /
   `reconcileRemoteTerminalCreate` primitives, never a second spawn.
8. **Who is allowed to signal/terminate it after cutover?** Orca, exclusively,
   via ORCA-S4's unmodified `signalProcessTree`/pid-addressed termination
   path (§9.3 there), now protecting a real user process — never aiControl
   directly (§12).

### 7.1 `RealDelegatedProcessPort` — an adapter, not a new port shape

Implements ORCA-S4's exact `ShadowLifecycleProcessPort` (§9, that SPEC),
substituted behind the same port interface, exactly as ORCA-S4 §5
anticipated:

- `spawn(...)` does not call `spawnProcess`. It receives, synchronously at
  the S3→S4 seam (§4), the real `{ pid, incarnationId }` `ptyController.spawn`
  already returned, and the real `osStartMarker`/`osStartMarkerSource`
  captured via the **same** local-host primitives ORCA-S4 already uses
  (`windows-process-table.ts` / `/proc/<pid>/stat` / `ps -o lstart=`) — never
  a fabricated value, and honestly `'unavailable'` if the host cannot supply
  one (ORCA-S4 §8.1's own fallback, unchanged).
- `observe(...)` / `requestTermination(...)` reuse ORCA-S4's existing
  `signalProcessTree` / pid-addressed sibling entry point **verbatim** — the
  same fail-closed sidecar/nonce/OS-marker discipline, including the macOS
  compound argv/nonce proof (ORCA-S4 §9.1.3), now protecting a real process.

---

## 8. Durable model (Execution-owned, additive-only)

`EXECUTION_SCHEMA_VERSION` 5 → 6 — **two new tables, two additive nullable
columns on two ORCA-S4 tables, zero column added to any ORCA-S1–S3 table.**

### 8.1 `delegation_cutover` — the cutover fact (SOURCE, write-once, immutable)

```sql
CREATE TABLE IF NOT EXISTS delegation_cutover (
  correlation_id     TEXT PRIMARY KEY REFERENCES run_reservation(correlation_id),
  orca_dispatch_id   TEXT NOT NULL REFERENCES dispatch_process_binding(orca_dispatch_id),
  orca_run_id        TEXT NOT NULL,
  aicontrol_run_id   TEXT NOT NULL,
  fence_token        TEXT NOT NULL,   -- the exact token supplied to acquireOrcaFence
  cutover_digest     TEXT NOT NULL,   -- SHA-256(fence_token || aicontrol_run_id || orca_dispatch_id)
  cutover_at         TEXT NOT NULL,
  ack_status         TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'acknowledged' — mutable bookkeeping, not a correctness fact
);
CREATE UNIQUE INDEX IF NOT EXISTS delegation_cutover_by_aicontrol_run
  ON delegation_cutover(aicontrol_run_id);
```

- Written once, at S4, in the same transaction as `run_binding` /
  `dispatch_worktree` / `dispatch_process_binding` (§5.4).
- **SOURCE. Never dropped or regenerated by a projection rebuild** — it *is*
  the authority-transfer fact; a rebuild that could not reproduce it would be
  indistinguishable from silently un-delegating a run.
- Every column except `ack_status` is immutable after insert. `ack_status`
  is the **one** permitted post-insert mutation, set by Phase 4 (§6) or the
  sweep's own retry of it — never touching `cutover_digest` or any `*_ref`.

### 8.2 Extensions to two existing ORCA-S4 tables (additive, nullable, backward-compatible)

```sql
ALTER TABLE dispatch_process_binding ADD COLUMN teardown_reason TEXT;
  -- 'user_cancel' | 'timeout' | NULL (NULL until a teardown is ever requested)
  -- written in the SAME UPDATE as teardown_requested_at (§9.1) — never a
  -- separate statement, so there is no window where intent exists without reason.

ALTER TABLE dispatch_lifecycle_closure ADD COLUMN terminal_status_ref TEXT;
  -- 'completed' | 'failed' | 'cancelled' | 'timeout' | NULL
  -- NULL only for a closure whose termination_method_ref = 'confirmed_dead_unknown_cause'
  -- (§9.2) — never guessed, never defaulted to 'failed'.
```

Both additions are nullable and default `NULL`, so every ORCA-S4 row ever
written (all synthetic, shadow-only) is unaffected and every ORCA-S4
acceptance test remains byte-valid. `EXECUTION_SCHEMA_VERSION` 5→6's ladder
step is "ensure these two tables + these two columns exist" — no data
migration, mirroring every prior slice's own additive discipline.

### 8.3 `aicontrol_terminal_projection` — the projection outbox

```sql
CREATE TABLE IF NOT EXISTS aicontrol_terminal_projection (
  correlation_id          TEXT PRIMARY KEY REFERENCES dispatch_lifecycle_closure(correlation_id),
  aicontrol_run_id        TEXT NOT NULL,
  fence_token_ref         TEXT NOT NULL,   -- copy of delegation_cutover.fence_token
  closure_digest_ref      TEXT NOT NULL,   -- copy of dispatch_lifecycle_closure.closure_digest at read time
  attempt_count           INTEGER NOT NULL DEFAULT 0,
  last_attempted_at       TEXT,
  projected_at            TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending'
    -- pending | projected | blocked_fence_mismatch | blocked_already_terminal_divergent | blocked_closure_contradicted
);
CREATE UNIQUE INDEX IF NOT EXISTS aicontrol_terminal_projection_by_run
  ON aicontrol_terminal_projection(aicontrol_run_id);
```

Created (`status='pending'`) once a `dispatch_lifecycle_closure` exists with
`terminal_status_ref IS NOT NULL` and
`post_closure_settlement_conflict_detected_at IS NULL` (ORCA-S4's own
prohibition, inherited verbatim, §14 LIFE-15 there). A closure with the
conflict marker set, or with `terminal_status_ref IS NULL` (the honest
"cannot classify" case, §9.2), is created directly as
`status='blocked_closure_contradicted'` — no aiControl call is ever
attempted for it.

---

## 9. Durable cancelled-vs-timeout contract (closes item D)

### 9.1 The reason is captured at the moment of decision, never inferred later

`convergeDelegationBoundaryLifecycle`'s Phase 1 (ORCA-S4 §9.3, unmodified
control flow), when it decides to request termination, now writes **both**
columns in the **same** statement:

```sql
UPDATE dispatch_process_binding
SET teardown_requested_at = :now, teardown_reason = :reason
WHERE orca_dispatch_id = ? AND teardown_requested_at IS NULL
```

`:reason` is `'user_cancel'` when the teardown originates from §12's
cancellation command handler, or `'timeout'` when it originates from the
sweep's own SLA check (§12) — decided **before** `signalProcessTree` is
ever called, never derived afterward from signal, exit code, or elapsed
time. This is the durable owner of the distinction: `dispatch_process_binding.teardown_reason`.

### 9.2 Closure computes `terminal_status_ref` from durable facts only

At Phase 3 (ORCA-S4 §11, unmodified control flow), alongside the four
existing `*_ref` copies, compute:

- `dispatch_termination.termination_method = 'self_exit'` → `terminal_status_ref
  = dispatch_termination.exit_code === 0 ? 'completed' : 'failed'`.
- `termination_method = 'signalled'` → `terminal_status_ref =
  dispatch_process_binding.teardown_reason` (`'user_cancel'` maps to
  `'cancelled'`, `'timeout'` maps to `'timeout'` — a fixed, reviewable
  two-entry map, never a heuristic).
- `termination_method = 'confirmed_dead_unknown_cause'` → `terminal_status_ref
  = NULL`. **Never guessed.** A closure with this shape is created directly
  as `blocked_closure_contradicted` in the projection outbox (§8.3) and a
  `dispatch_lifecycle_incident(kind='unclassifiable_terminal_status')` is
  raised for operator adjudication — honest under-determination, not a
  fabricated verdict.

`terminal_status_ref` is included in `closure_digest`'s input set (extending
ORCA-S4's four-field digest to five), so a retried closure computation is
byte-comparable exactly like every other `*_ref` field.

### 9.3 Why Orca, not aiControl, is the classification authority for delegated runs

Reading `orca-fence-projection.ts` directly (its own doc comment, lines
7-14): `projectDelegatedTerminalResult` is **deliberately not**
`finalizeRunOnce` — it never touches `execution_attempts`, "because none
exists for a delegated run (no native claim ever succeeded)." aiControl's
own `classifyAttemptOutcome` logic requires an `execution_attempts` row to
classify from; none is ever opened for a delegated run. **This means
aiControl's classification authority structurally cannot apply to a
delegated run's outcome — there is nothing for it to classify.** This
corrects the rejected candidate's §5 ownership-matrix claim ("aiControl's
own frozen outcome-classification logic remains sole authority for what
[the terminal result] means semantically") — that claim does not hold
against the real, published projector's actual contract, which trusts
`status` **verbatim** from its caller. Orca is therefore the sole
classification authority for a delegated run's `completed`/`failed`/
`cancelled`/`timeout` status; aiControl's role is COPY-NEVER-DECIDE storage
of an already-final verdict via CAS (§10), never semantic re-interpretation.
This is a correction beyond the mission's enumerated A–G, surfaced only by
reading the real code the rejected candidate's stale checkout could not.

---

## 10. Terminal projection — copy, CAS, and the real divergence gap (closes item G)

`AiControlDelegationProjectionWriter` (new, Execution-owned infrastructure —
**not** `AiControlDbReader`, whose I1 read-only invariant is untouched) calls
the **real, published** `projectDelegatedTerminalResult({ runId, token,
status, finishedAt, stdout, stderr })` — never a hand-rolled SQL statement
against `agent_runs`, so Slice B inherits the projector's own CAS exactly:

```sql
UPDATE agent_runs SET status=:status, finished_at=:finishedAt, ...
WHERE id=:runId AND orca_fence_state='cutover' AND orca_fence_token=:token
  AND status NOT IN ('completed','failed','timeout','cancelled')
```

Four real outcomes (`orca-fence-projection.ts:24,67-96`): `PROJECTED`,
`ALREADY_TERMINAL`, `FENCE_MISMATCH`, and a **declared-but-never-returned**
`DIVERGENCE`.

### 10.1 The real residual, read from the file, not paraphrased

Lines 90-95 of `orca-fence-projection.ts`:

```
// Identity matches; the row is simply already terminal — idempotent no-op,
// never a re-decision. (A future DIVERGENCE outcome is reserved for a
// caller that re-reads and finds its own supplied status/fields disagree
// with what was already projected — this prerequisite's RED contract does
// not exercise that path, so it is not fabricated here.)
return { outcome: 'ALREADY_TERMINAL' }
```

Confirmed by direct inspection: when the CAS's `status NOT IN (...)` guard
excludes an already-terminal row, the function returns `ALREADY_TERMINAL`
**unconditionally** — it never re-reads the row's `status`/`finishedAt`/
`stdout`/`stderr` and compares them against the caller's own supplied
`input`. A genuinely conflicting delegated result (Maestro says `'failed'`,
the row already says `'completed'`) is therefore silently treated as a
benign idempotent no-op today, exactly as `docs/HANDOFF.md`'s own residual
entry states.

### 10.2 Activation prerequisite, frozen here, not implemented here

**Before Maestro may send a single real `ORCA_DELEGATED` terminal
projection, aiControl must ship an accepted, published fix to
`projectDelegatedTerminalResult` that:** re-reads the already-terminal row's
`status`/`finished_at`/`stdout`/`stderr` when the CAS excludes it on the
"already terminal" branch; compares them field-for-field against the
caller's `input`; returns `ALREADY_TERMINAL` only on exact semantic
equality; returns the (currently-unreachable) `DIVERGENCE` outcome on any
mismatch; never overwrites the existing terminal row in either case; remains
COPY-NEVER-DECIDE (the comparison decides *sameness*, never a new value).
**This SPEC does not implement that fix — it is aiControlCenter's own file,
under its own amendment process — and does not mark it solved.**

Until that fix ships and is independently accepted: `AiControlDelegationProjectionWriter`
treats every `ALREADY_TERMINAL` outcome as **unverifiable**, not as
confirmed agreement — it records `status='blocked_closure_contradicted'`
locally and raises an incident rather than assuming the silent no-op was
benign. This is the honest, fail-closed stance available with today's
published code; §18 makes the real fix a hard, separate activation gate on
top of it.

---

## 11. Execution cardinality (closes item F)

```
1 aiControl AgentRun (agent_runs.id)
  ↔ 1 delegation_cutover row (PK correlation_id, UNIQUE aicontrol_run_id)
  ↔ 1 dispatch_process_binding row (PK orca_dispatch_id)
  ↔ 1 real OS process, addressed by (pid, os_start_marker) AND by
      Maestro's own pre-existing terminalHandle/operationHandle identity
      (the `preAllocatedHandle` minted before spawn, §4 step 1)
```

**Recovery reconnects to the same identity; it is never a second attempt.**
This slice does not invent a recovery mechanism — it reuses two real,
already-shipping primitives:

- `ptyController.adoptStablePane` — already used by `createTerminal` (§4
  step 3) to re-attach to a pane by `(worktreeId, connectionId, tabId,
  leafId)` before ever spawning.
- `reconcileRemoteTerminalCreate` (via `reclaimFencedAgentSessionSpawn`) —
  already used to find a possibly-still-alive PTY by `terminalHandle`
  without spawning or killing anything.

On a Maestro restart, the sweep (§12) finds a `dispatch_process_binding`
with no `dispatch_termination`: it first attempts the restart-recovered
identity path already defined by ORCA-S4 §9.1 (sidecar/nonce/OS-marker
match against the real pid), and, only if that is ambiguous, falls back to
the same `terminalHandle`-based adoption `reclaimFencedAgentSessionSpawn`
already performs. **If neither path can positively confirm the same process
instance, the binding is left `identity_unverifiable` and a
`dispatch_lifecycle_incident` is raised — no automatic second spawn is ever
attempted**, satisfying the mission's "uncertainty never auto-spawns a
second process" gate directly. A genuinely new production attempt (a
deliberate retry after confirmed failure) requires a new
`delegation_cutover` row under a fresh fence token — a distinct future
protocol this SPEC does not define, exactly as the mission requires.

---

## 12. Cancellation / timeout authority

- **Before cutover (S0–S3):** aiControl owns administrative cancellation,
  unchanged, via the real `finalizeRunOnce` + `extraRunFields` path the
  prerequisite doc's §7 already describes (clears the fence in the same
  statement as the terminal write). Orca has committed nothing yet at S0–S2;
  at S3 a real process may exist with no Execution-store row — §5.6 defines
  its fail-closed disposition, never a native cancel racing an
  uncommitted seam.
- **The aiControl-cancellation-vs-Maestro-cutover race, resolved without
  wall-clock ordering:** exactly one of two durable facts commits first —
  aiControl's `finalizeRunOnce` CAS (which also clears
  `orca_fence_state`/`orca_fence_token` in the same statement, per the
  prerequisite §7) or Maestro's S4 transaction. If aiControl's cancel commits
  first: the fence is cleared; Maestro's own Phase-1 precondition re-check
  (§6, `acquireOrcaFence`'s `status IN ('pending','queued')` predicate) finds
  the run no longer eligible and S2/S3/S4 never proceed for this
  `aicontrol_run_id` — no race to resolve after the fact, because the fence
  CAS itself is the single serialization point. If Maestro's S4 commits
  first: `orca_fence_state='cutover'` is later acknowledged (§6 Phase 4),
  and aiControl's cancel route must branch on `orca_fence_state='cutover'`
  **before** its existing status checks and refuse with a distinct error
  (the prerequisite §7's own stated requirement, quoted directly: "the cancel
  route must branch on `orca_fence_state = 'cutover'`... and refuse with a
  distinct, honest error... rather than attempting a native cancel that the
  finalize CAS would silently no-op"). Exactly one legal winner, decided by
  which durable write lands first — never by comparing timestamps.
- **After cutover (S4+):** Orca owns cancellation exclusively, via a new
  Orca-owned command handler that writes `dispatch_process_binding.teardown_reason='user_cancel'`
  + `teardown_requested_at` in one statement (§9.1) — aiControl never
  signals a delegated real process directly, and never writes into the
  Execution store (single-writer discipline, ORCA-S4 LIFE-11, unchanged).
- **Timeout:** unreachable before cutover, by the same structural argument
  the prerequisite doc's own §8 already proves for aiControl-native timeout
  ("`getTimeoutMs`... is only reachable from inside `executeClaimedRun`...
  for a `running` row" — and §3.3 there proves a fenced row can never become
  `running`). After cutover, Orca's own sweep enforces the SLA (the value
  itself may still be aiControl-authored and copied at cutover time — an
  assumption this SPEC states, not confirms, per §21) and writes
  `teardown_reason='timeout'` before signalling (§9.1) — never inferred
  from elapsed time after the fact.
- **Concurrent self-exit vs. cancellation/timeout race:** resolved by
  `dispatch_termination`'s existing `PRIMARY KEY (correlation_id)` — whichever
  path commits first wins; the loser is a PK-collision no-op (ORCA-S4
  LIFE-6/LIFE-7, unchanged, reused verbatim).

---

## 13. Worktree / Git ownership — reused, not transferred

ORCA-S3's `base_commit`/`candidate_head`/`files_changed` capture is reused
unmodified, pointed at the **real** dispatch worktree Maestro's existing
`repo-worktrees.ts` infrastructure already creates and lists (confirmed
this session: `listRepoWorktrees`, `listLocalRepoWorktreesStrict`, etc. —
listing/inspection only, **no deletion function in this file**, confirming
the rejected candidate's own conclusion that real-worktree deletion timing
is a separate, product-lifecycle concern this repo does not currently
centralize in one place either). ORCA-S4's `WorktreeFinalizer` real-deletion
arm is **never invoked** for a delegated run's real worktree — every such
binding's `worktree_finalization.status` is recorded `'skipped_not_eligible'`
by policy, exactly as the rejected candidate's §12 concluded (this
conclusion is re-verified sound against the real `repo-worktrees.ts`, not
merely carried forward). A future slice may join Maestro's existing
worktree-lifecycle policy with Orca's mechanism; that join is explicitly not
claimed here.

---

## 14. Cross-DB crash matrix (full)

No distributed transaction exists between `data/app.db` (aiControl) and
Maestro's Execution DB. Every window below states authority, durable truth,
retry behavior, and the forbidden action:

| # | Window | Authority | Durable truth | Retry / reconcile | Forbidden |
| --- | --- | --- | --- | --- | --- |
| X1 | Fence request sent, response lost | `AICONTROL_NATIVE` | aiControl: possibly `'fenced'` already (F2, prerequisite §9) | retry with the **same** token — path (B) returns the existing fence deterministically | generating a new token for what the caller believes is the same request |
| X2 | Fence acquired (S1), Maestro crashes before S2/S3 | `AICONTROL_NATIVE`, blocked | `'fenced'` | resume S2 with the same token | any native admission/claim (already structurally impossible per §3 of the prerequisite) |
| X3 | Process spawned (S3), Maestro crashes before S4 commits | `AICONTROL_NATIVE` (S4 never committed) | a real, Execution-store-invisible process may exist | §5.6's identity-recovery-then-fail-closed path | an unconditional second spawn |
| X4 | S4 commits, crash before S5 acknowledgement | `ORCA_DELEGATED` (already true — Maestro's own DB) | `delegation_cutover` durable | retry Phase 4 with the same token (idempotent) | any aiControl-side assumption that native execution is still legal (it never was, from Phase 1) |
| X5 | S4 commits, aiControl acknowledgement permanently lost | `ORCA_DELEGATED` | aiControl shows `'fenced'` forever unless retried | operator/monitoring must eventually retry Phase 4; Orca's own correctness does not depend on it (§6 Phase 4) | releasing the aiControl-side fence without §6.1's positive evidence (there is none — cutover genuinely happened) |
| X6 | Execution terminal (S7), projection outbox row not yet delivered | `ORCA_DELEGATED` (closure is source truth) | `dispatch_lifecycle_closure` durable; `aicontrol_terminal_projection.status='pending'` | next sweep pass retries §10's CAS | treating an undelivered projection as lost correctness — it is retriable local state |
| X7 | aiControl projection CAS succeeds, local `status='projected'` ack lost | Orca (mechanical fact already true) | remote row terminal; local row `'pending'` | retry: CAS affects 0 rows because the row is already terminal → today (§10.2) this must be treated as **unverifiable, not confirmed**, until the real divergence fix (§10.2) ships; post-fix, a genuine field-for-field re-read-and-compare resolves it | assuming a 0-row CAS result always means "already correctly projected" while the divergence fix is unshipped |
| X8 | Two conflicting terminal projections attempted for the same run | Orca (closure is write-once, PK-guarded) | `dispatch_lifecycle_closure` cannot itself duplicate (PK); the *projection* could still race two writers | `aicontrol_terminal_projection`'s own PK (`correlation_id`) prevents Orca-side duplication; the aiControl-side race is exactly §10's residual | any code path that writes `aicontrol_terminal_projection` from anywhere but Phase 6 of the sweep (§8.3) |
| X9 | Maestro restarts while the real process still lives | Orca (unchanged by restart — no in-memory state was ever authoritative for `delegation_cutover`, mirrors prerequisite F12's own reasoning for the aiControl side) | `dispatch_process_binding` durable | §11's restart-recovered identity path, then adoption fallback | a second spawn under uncertainty |
| X10 | The real process disappears unexpectedly (crash, OOM-kill, host reboot) | Orca | `dispatch_process_binding` durable, no `dispatch_termination` yet | sweep Phase 1 (ORCA-S4 §9.3, unmodified) resolves it — `confirmed_dead_unknown_cause` if no `teardown_requested_at`, honestly unclassifiable at closure (§9.2) | inventing a `terminal_status_ref` for an unclassifiable case |
| X11 | aiControl cancellation races S4's cutover commit | resolved by §12 — whichever CAS/transaction commits first | either the fence-clearing `finalizeRunOnce` row or `delegation_cutover` | the loser's caller observes zero eligible rows / a stale precondition and stops, never retries into the other outcome | racing them by wall-clock comparison |
| X12 | Cancellation races execution (self-exit vs. signalled) | resolved by `dispatch_termination`'s PK | whichever commits first | PK-collision no-op for the loser | a second `dispatch_termination` row |
| X13 | Timeout races cancellation | same as X12 — both are `teardown_requested_at`/`teardown_reason` writes; the CAS `teardown_requested_at IS NULL` guard admits exactly one | whichever `UPDATE` lands first | the loser's caller observes zero rows affected and treats the durable `teardown_reason` as authoritative, never overwrites it | two teardown reasons recorded for one binding |
| X14 | Worktree finalization races terminal closure | moot for a delegated real worktree — finalization's real-deletion arm never fires (§13); no race exists | `worktree_finalization.status='skipped_not_eligible'` always, for a real binding | N/A | invoking the deletion arm for any real dispatch worktree |

---

## 15. Terminal event semantics

`convergeDelegationBoundaryLifecycle`'s existing Phase 4 (ORCA-S4 §11,
unmodified) continues to record `dispatch_lifecycle_event` exactly once per
`(correlation_id, event_kind)` — durable, restart-safe, idempotent-by-PK,
same as under shadow. Slice B adds no new event table; it adds a real
consumer: once `dispatch_lifecycle_event` exists **and**
`aicontrol_terminal_projection.status='projected'`, a wake-up notification
(hint only, never a correctness source, extending ORCA-S4's own LIFE-8
precedent) informs the real Orca runtime the task reached a terminal state,
so any UI can update promptly without waiting for its own poll. A missed
notification is never a correctness gap — the next scheduled sweep pass
re-derives the same durable state. `dispatch_lifecycle_event` remains
**SOURCE** (ORCA-S4 §8.0.1, unchanged); `aicontrol_terminal_projection`'s
own row is **SOURCE for its terminal state**, ordinary mutable retry
bookkeeping (`attempt_count`, `last_attempted_at`) while `status='pending'`.

---

## 16. Authority table

| State | Admission | Execution | Process signaling | Worktree | Settlement | Terminal classification | Cancellation | Recovery | Terminal projection |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `NATIVE_ELIGIBLE` (S0) | aiControl | aiControl | aiControl | aiControl (native) | aiControl | aiControl | aiControl | aiControl | N/A |
| `FENCE_ACQUIRED` (S1) | aiControl (fence blocks native, §6) | N/A — none started | N/A | aiControl | aiControl | N/A | aiControl (§12) | aiControl | N/A |
| `ORCA_PREPARING` (S2) | — (in-flight, uncommitted) | N/A | N/A | N/A | N/A | N/A | aiControl (§12) | N/A (nothing durable) | N/A |
| `PROCESS_SPAWNED_NOT_YET_AUTHORIZED` (S3) | — | real process exists, unowned by any Execution-store row (§5.6) | **nobody** — Orca cannot yet, aiControl never | N/A | N/A | N/A | aiControl (still legal — fence not yet cutover) | §5.6's identity-recovery path | N/A |
| `ORCA_DELEGATION_CUTOVER_COMMITTED` (S4) | frozen (no more admission decisions for this run) | **Orca** | **Orca**, exclusively | Orca reads only, never deletes (§13) | Orca (§9) | **Orca** (§9.3) | **Orca** (§12) | Orca | not yet — no closure |
| `AICONTROL_CUTOVER_ACKNOWLEDGED` (S5) | frozen | Orca | Orca | Orca (read-only) | Orca | Orca | Orca | Orca | not yet |
| `ORCA_EXECUTING` (S6) | frozen | Orca | Orca | Orca (read-only) | Orca | Orca | Orca | Orca | not yet |
| `ORCA_TERMINAL_CLOSED` (S7) | frozen | closed | closed | Orca (read-only, `skipped_not_eligible`) | Orca (`dispatch_lifecycle_closure`) | **Orca**, final (§9) | closed | Orca | pending outbox row exists |
| `AICONTROL_TERMINAL_PROJECTED` (S8) | frozen | closed | closed | Orca (read-only) | Orca | Orca (historical) | closed | Orca (historical) | **done** — `agent_runs` copy, aiControl-owned storage, never re-decided |
| `RECONCILIATION_INCIDENT` | frozen for this row | whatever it was at incident time, frozen | blocked (§9.3 fail-closed) | Orca (read-only) | frozen | `NULL` / disputed, never fabricated (§9.2) | N/A | operator | blocked (`blocked_closure_contradicted`) |
| `FENCE_RELEASED` | aiControl (run re-enters native lifecycle) | aiControl | aiControl | aiControl | aiControl | aiControl | aiControl | aiControl | N/A |

No row in this table has two independent decision owners for the same
column at the same state — the zero-dual-write proof required by the
mission.

---

## 17. Source / Projection / Incident classification

| Fact | Classification | Why |
| --- | --- | --- |
| `delegation_cutover` | **SOURCE** | the authority-transfer instant itself; never rebuildable |
| `dispatch_process_binding` (+ `teardown_reason`) | **SOURCE** (ORCA-S4 §8.0, extended) | ephemeral spawn-time identity + the reason captured before any signal |
| `dispatch_termination` | **SOURCE** (ORCA-S4 §8.0, unchanged) | ephemeral OS exit event |
| `worktree_finalization` | **SOURCE** (ORCA-S4 §8.0, unchanged) — always `skipped_not_eligible` for a real delegated binding (§13) | no filesystem act ever performed for a real worktree, but the *record of that decision* is still the durable, non-rederivable fact |
| `dispatch_lifecycle_closure` (+ `terminal_status_ref`) | **SOURCE** (ORCA-S4 §8.0.1, extended) | frozen point-in-time reference over facts that may still legitimately diverge later (ORCA-S2's own `observed_conflicted` escape hatch) |
| `dispatch_lifecycle_event` | **SOURCE** (ORCA-S4 §8.0.1, unchanged) | idempotent emission proof |
| `dispatch_lifecycle_incident` | **PROJECTION** (ORCA-S4 §8.4, unchanged) | deterministic function of already-durable SOURCE facts; safely regenerable |
| `aicontrol_terminal_projection` | **SOURCE for its own terminal state** (once `status` leaves `'pending'`); ordinary mutable retry bookkeeping while `'pending'` | mirrors ORCA-S4's `dispatch_lifecycle_event` write-once discipline for the copy-attempt outcome itself |
| aiControl's `agent_runs` terminal columns, for a delegated run | **PROJECTION**, by aiControl's own published contract (`projectDelegatedTerminalResult`'s own doc comment: "every value... a value Maestro already decided") | never re-decided by aiControl once written; Orca's `dispatch_lifecycle_closure` remains the actual source of truth |
| aiControl `orca_fence_state`/`orca_fence_token`/`orca_fenced_at`/`orca_cutover_at` | **SOURCE**, aiControl-owned | the only durable fence fact; no lease, no expiry (prerequisite §4) |

`aicontrol_terminal_projection` is a genuinely new outbox table this slice
introduces — kept, unlike a table the rejected candidate merely proposed,
because it is re-verified here to have a precise durable retry
responsibility (§8.3, §14 X6/X7) against the real, published projector, not
a hypothetical one.

---

## 18. Live activation gate — `R3` and the projector fix (both required, independently)

`IMPLEMENTATION EXISTS` (a future, independently-accepted Slice-B
implementation) is explicitly distinct from `LIVE DELEGATED AUTHORITY
ENABLED`. Both of the following must hold **before any first live
`acquireOrcaFence` call**, verified this session to currently **not** hold:

1. **R3 complete.** `docs/HANDOFF.md`: `R1 COMPLETE`, `R2 CODE PUBLISHED`,
   **`R3 NOT STARTED`**. `isOrcaFenceAcquisitionEnabled()` reads
   `process.env.ORCA_FENCE_ACQUISITION_ENABLED === 'true'` — confirmed this
   session to default false and to be the sole gate; no code path bypasses
   it. Full-fleet fence-awareness (every process capable of a native
   admission/dequeue/claim/finalize CAS running fence-aware code, per the
   prerequisite §12 Phase R3) must be operationally verified, not merely
   inferred from `git log`.
2. **Projector divergence fix shipped and published.** §10.2's fix to
   `projectDelegatedTerminalResult` must be independently accepted and on
   `origin/master` before a real terminal projection is ever attempted;
   `docs/HANDOFF.md`'s own residual entry lists this as "especially
   relevant to the upcoming Slice B work."

Additionally, before first live delegation: compatible Maestro Slice-B code
(this SPEC's own eventual implementation) must be independently accepted and
deployed; §4.1's `onPtySpawnCommitted` await-ability change must be in place
and proven; and every S1–S4 regression suite must remain green
(§19 gate 30).

**If any of the above does not hold, fail closed — no live cutover.** Git
publication of code is never conflated with fleet deployment or with the
projector fix's own independent acceptance.

---

## 19. Acceptance gates (future, executable — not satisfied by this document)

1. Real aiControl fence acquisition handshake exercised against the real
   `orca-fence.ts` functions (not a mock), including `ACQUISITION_DISABLED`
   while the gate is off.
2. Same-token idempotency — a repeated `acquireOrcaFence`/`acknowledgeOrcaCutover`
   call with the identical token is a deterministic no-op, never a second
   state change.
3. Cancellation-vs-cutover: exactly one winner, proven under an injected
   race at the CAS level (§12), never by timestamp comparison.
4. Process-preparation/cutover ordering: a crash-injection harness proves no
   Execution-store row, no registration, and no external visibility exist
   before the S4 transaction commits (§5.3).
5. No workload side effect (registration, reveal, IPC, SSE) before cutover —
   a static call-graph audit of `orca-runtime-create-terminal.ts`'s post-spawn
   sequence.
6. One cutover → one authoritative execution instance — §11's cardinality,
   audited against a fixed sample of delegated runs.
7. Restart recovers the same process identity via `adoptStablePane`/
   `reconcileRemoteTerminalCreate` — never a second spawn (§11).
8. Uncertainty never auto-spawns a second process — §11, §5.6's fail-closed
   path exercised directly.
9. Cutover-acknowledgement loss (X4/X5) resolves correctly on restart/retry.
10. aiControl acknowledgement idempotency (`ACKNOWLEDGED` on a same-token
    retry, never a second write) — §6 Phase 4.
11. Native execution structurally impossible post-fence — reused, not
    re-proven, from the prerequisite's own §3.3/§13 gates 2-4.
12. Native settlement impossible post-cutover — reused from the
    prerequisite's own §8/§13 gate 17 (`orca_fence_state != 'cutover'` guard).
13. Durable `completed` outcome — self-exit, exit code 0.
14. Durable `failed` outcome — self-exit, nonzero exit code.
15. Durable `cancelled` outcome — `teardown_reason='user_cancel'`.
16. Durable `timeout` outcome — `teardown_reason='timeout'`.
17. `cancelled` != `timeout` — both exercised in the same test run against
    the fixed `teardown_reason` map (§9.2), never inferred from signal alone.
18. COPY-NEVER-DECIDE projection — a call-site audit proves
    `AiControlDelegationProjectionWriter` never computes a value; every
    field is byte-traceable to `dispatch_lifecycle_closure`.
19. Equal duplicate projection is idempotent (`ALREADY_TERMINAL` today,
    treated as unverifiable per §10.2 until the real fix ships; `PROJECTED`
    exactly once otherwise).
20. Conflicting projection fails loudly — **blocked on §10.2's real fix
    shipping**; until then, gate 20 is unsatisfiable and this SPEC does not
    claim otherwise.
21. Projector-divergence prerequisite required before live activation — §18
    item 2, enforced as a hard release gate, not a test this repo's own CI
    can run (the fix lives in aiControlCenter).
22. R3 required before live fence acquisition — §18 item 1.
23. Worktree provenance reused unmodified — a byte-diff of ORCA-S3's
    converge logic before/after this slice's implementation.
24. Worktree finalization real-deletion arm never fires for a real
    dispatch — static + runtime audit (§13).
25. Terminal event exactly-once, idempotent delivery — reused from ORCA-S4
    gate 14/LIFE-7, now against the real signal (§15).
26. Cross-DB crash windows X1–X14 (§14) each proven via a separate-child-process
    restart harness, mirroring every prior slice's own pattern.
27. Process signaling only by the current authority — aiControl never
    signals a delegated real process directly (static audit of every
    `signalProcessTree`/`kill` call site).
28. No auto fallback to aiControl-native execution after cutover — a
    negative test: a failed delegated run never re-admits natively.
29. Local-only scope — no remote/SSH process-identity claim anywhere in this
    slice's implementation (mirrors ORCA-S4 §5.1's own boundary, unchanged).
30. S1–S4 regression suites remain green and byte-unchanged; the two new
    nullable columns (§8.2) never appear in any ORCA-S4 fixture's asserted
    row shape.

---

## 20. Deferred scope, unchanged from ORCA-S1–S4's own boundaries

- **`ORCA_AUTHORITATIVE`** — queue/admission/capacity/scheduler/FIFO/`QUEUE_FULL`
  transfer. Not touched anywhere above.
- **M5 — Controlled Fallback.** Remains `NEXT / READY TO START`, `NOT
  STARTED`. No fallback policy imported into this slice; a failed delegated
  execution is Orca's own terminal outcome to settle (§9), never a silent
  re-admission to aiControl-native.
- **Real (non-`MockExecutor`) executor parity.** Orthogonal, unaffected,
  exactly as `GAP-ANALYSIS-ORCA-DELEGATED.md` §6.2 concluded and ORCA-S4 §18
  reaffirmed.
- **Remote/SSH execution.** Local-only scope, per ORCA-S4 §5.1's own
  reasoning, unchanged: local PID/OS-marker semantics do not transfer to a
  remote host, and this slice's admission-grant precondition must fail
  closed for any non-local target — this SPEC does not attempt a remote
  identity/verdict model.

---

## 21. Unresolved architecture risks, stated plainly (not concealed)

1. **§4.2 / §5.3:** whether the PTY provider begins consuming a delegated
   task's startup command synchronously within `ptyController.spawn(...)` or
   only at a later, separately-gateable step was not traced below
   `ptyController` this session. The visibility invariant (§5.3) holds
   regardless of the answer, but how much of S3 is genuinely undoable does
   not — required confirmation before implementation, not an assumption
   this SPEC makes either way.
2. **§4.1:** the `onPtySpawnCommitted` await-ability change is specified,
   not made. If a fresh implementation session finds a reason it cannot be
   safely awaited at that exact call site, that is a `CONTRACT_CONFLICT`
   requiring a focused amendment to this section, not a silent workaround.
3. **§12:** whether aiControl authors the timeout SLA value (copied, never
   recomputed, at cutover) is stated as an assumption carried from the
   rejected candidate, not independently confirmed against
   `docs/architecture/orca-delegation-fence-prerequisite.md`, which does not
   specify it either way.
4. **§10.2:** the exact shape of the real projector fix (re-read-then-compare
   granularity; which fields participate in the equality check) is this
   SPEC's own proposal for what aiControl's fix must satisfy, not a
   preview of aiControl's actual forthcoming implementation — the real fix
   may differ in shape while still satisfying the same contract.
5. **§16, `RECONCILIATION_INCIDENT` row:** this SPEC does not enumerate every
   possible incident `kind` exhaustively (mirrors ORCA-S4's own explicit
   deferral of full incident taxonomy to implementation, §8.4 there) — only
   the ones named explicitly above (`pre_cutover_orphan_process`,
   `unclassifiable_terminal_status`) are frozen; an implementation session
   may need more, each requiring the same non-fabrication discipline.

---

## 22. aiControl DB guard — session close

Re-verified read-only at the close of this session, same method as the
opening check (§ Artifact identity table): `data/app.db` SHA-256
`2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088`, no
`-wal`/`-shm`/journal — **unchanged**. This session opened `data/app.db`
zero times for write; every aiControl fact above was read via `git show
origin/master:<path>` against tracked source files only.

---

## 23. Predecessor facts consumed

**From ORCA-S1–S3 (unchanged):** `run_reservation`, `run_binding`,
`execution_meta`, `settlement_observation`, `worktree_provenance`,
`dispatch_worktree`, the bind-time composition seam, the versioned schema
ladder, the frozen-evidence-bundle pattern, the `data/app.db` guard pattern.

**From ORCA-S4 (consumed as already-proven mechanism, extended per §8.2):**
`ShadowLifecycleProcessPort`'s exact interface, `dispatch_process_binding`,
`dispatch_termination`, `worktree_finalization`, `dispatch_lifecycle_closure`,
`dispatch_lifecycle_event`, `convergeDelegationBoundaryLifecycle`'s Phases
1–5, the fail-closed identity discipline, "hooks are wake-up hints" (LIFE-8),
"closure copies never re-decides" (LIFE-5), and §18's explicit enumeration
of exactly what Slice B still owed.

**From `GAP-ANALYSIS-ORCA-DELEGATED.md`:** the full §4 gap enumeration and
the §5 decisions this SPEC formalizes.

**From the real, published aiControl fence prerequisite** (`orca-fence.ts`,
`orca-fence-projection.ts`, `docs/architecture/orca-delegation-fence-prerequisite.md`,
`docs/HANDOFF.md`, `origin/master` `ab5967bdde…`): the exact fence CAS
predicates, the R1/R2/R3 rollout discipline, the break-glass Category-A
safety proof, the cancellation/timeout dispositions (§7/§8 there), the
authority table, and the real, named divergence residual.

**From Maestro's real production runtime** (`orca-runtime-create-agent-session.ts`,
`orca-runtime-create-terminal.ts`, `orca-runtime-report-pty-spawn-commit.ts`,
`repo-worktrees.ts`): the exact integration seam, the existing
`preAllocatedHandle`/`onPtySpawnCommitted`/`agentSessionCreateOperations`
idempotency and reconciliation primitives this slice reuses rather than
reinvents.

**From `docs/reference/ssh-execution-boundary.md`:** the fixed `live` /
`unverifiable` / `exited` vocabulary, cited to justify the local-only scope
decision (§20).

**Explicitly NOT consumed:** `parity_observation`/`parity.ts`;
`settlement_incident`/`worktree_provenance_incident`;
`reconcile-shadow-execution-state.ts`/`converge-worktree-provenance*.ts`
(sibling sweeps, never modified); the rejected candidate's own §9.2 "path
(b)" (superseded by §5.1's evidence that it cannot occur).

---

_State class: `ARCHITECTURE_READY_FOR_INDEPENDENT_REVIEW`._
_Display verdict: `ORCA_S5_DELEGATED_CUTOVER_ARCHITECTURE_CORRECTED_READY_FOR_REVIEW`._
