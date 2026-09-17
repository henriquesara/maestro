# ORCA-S5 Delegated Cutover — Composition-Root Technical Discovery

> Prerequisite technical discovery only. Does not modify `SPEC.md` or
> `ARCHITECTURE-INDEPENDENT-REVIEW-001.md`, implement code, or write tests.

## Inspected HEADs

- Architecture content HEAD: `7c1796e82c53de53f0a028123defbe53974eb652`
- Independent review artifact: `f2817e2b1fe5000aae5cefe5354974d2ba2542b3`
- Canonical `origin/main` (base for this discovery): `6b84afce586c9ecf56837446fb0b2886161c3202`
- Published PRE_IMPLEMENTATION technical HEAD (treated as established): `eed09b3047db4f71d25763c215335a2f2db0b403`

## Blocker under discovery

From the independent review: SPEC.md never names the composition root
connecting the PTY/runtime layer (where the durable-transaction callback
lives, site #5) to the Execution bounded context (schema + transaction
runner + recovery sweep), and never states where/when a delegated session's
`run_reservation` row gets created.

## 1. Real runtime call graph (traced, file/function exact)

| Hop | File | Function | Owner module | Identity available | Async boundary | Callback/hook |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `src/main/runtime/orca-runtime-create-agent-session.ts:36` | `OrcaRuntimeWithCreateAgentSession.createAgentSession` | `runtime/` (mixin on `OrcaRuntimeService`) | `RuntimeCreateAgentSessionRequest` (worktree, agent, prompt, clientOperationId — **no aiControl/fence field**) | `async`, top-level | Constructs `onPtySpawnCommitted` closure (line 225-227) |
| 2 | `orca-runtime-create-terminal.ts:9` | `OrcaRuntimeWithCreateTerminal.createTerminal` | `runtime/` (same mixin chain) | `preAllocatedHandle`, `launchOpts` | `await this.ptyController.spawn(...)` | Passes `reportPtySpawnCommitted` (wrapped) |
| 3 | `ipc/pty/runtime/spawn-options.ts:31` | `buildRuntimePtySpawnOptions` | `ipc/pty/runtime/` | `ctx.spawnOptions`, provider identity | sync build, called under `await` | Threads guard-layer-2 into `ctx.spawnOptions.onPtySpawnCommitted` (provider-conditional) |
| 4 | `providers/local-pty-spawn.ts:21` | `spawnLocalPty` | `providers/` | `spawnResult.process.pid` (real OS pid, line 88) | synchronous spawn, no `await` between creation and hook | Fires `args.onPtySpawnCommitted?.()` at line 89 — **site #12, the chosen seam** |

**Confirmed this session:** `orca-runtime-create-agent-session.ts` has zero
imports from any `execution/*` module and zero references to
`aicontrol`/`orcaFence`/`delegat*` anywhere in the file. Zero files under
`src/main/runtime/` or `src/main/providers/` import from
`src/main/execution/{application,infrastructure,domain}` (repo-wide grep,
this session).

## 2. Execution-side composition (traced, file exact)

- **Schema** (`execution-schema.ts`, one file, one `SyncDatabase`
  connection): `run_reservation`, `run_binding`, `dispatch_worktree`,
  `dispatch_process_binding`, `dispatch_termination`,
  `dispatch_lifecycle_closure`, `dispatch_lifecycle_event`,
  `worktree_finalization`, `dispatch_lifecycle_incident` all live in **one**
  database, migrated via a real `BEGIN IMMEDIATE`/`COMMIT` transaction
  (`migrateExecutionStore`).
- **Application-layer bind step** (`worktree-provenance-bind-step.ts`):
  `bindDispatchWorktree` performs the real multi-insert
  `deps.txn.withImmediateTransaction(() => { store.recordBinding(binding);
  deps.dispatchWorktrees.insert(...); delegationBoundary.processBindings.insert(...) })`
  — direct, real precedent for §5.4's proposed transaction shape.
- **The only existing caller of this bind step:**
  `shadow-observation-service.ts`'s `runShadowObservation`, itself called
  from exactly one place: `execution/slices/shadow-identity-observation/shadow-identity-observation.ts`'s
  `executeShadowIdentityObservationSlice`.

**Critical finding, beyond what the independent review already established:**
`executeShadowIdentityObservationSlice` is a **one-shot, ephemeral
composition root** — it opens a fresh `new SyncDatabase(input.executionStorePath)`,
runs `migrateExecutionStore`, constructs every store fresh, runs the
observation against a **fixed, frozen set of sample workloads**
(`FROZEN_SLOTS`) and **already-known native results**
(`input.nativeResults: readonly NativeRunResult[]`), and closes everything in
a `finally` block (`execDb.close()`, `shadowOrchestration.close()`,
`shadowRoot.cleanup()`). **The Execution bounded context, as implemented for
ORCA-S1–S4, has no live, persistent, request-driven presence in the running
app at all.** It exists only as a batch job invoked with a known, finite
input set — never as a store held open across the app's lifetime, waiting
for an unpredictable, real-time interactive event.

This means the composition-root question is not merely "which existing
module can see both sides" — no existing module holds the Execution store
open long enough for an interactive terminal-creation event (which can occur
at any time, arbitrarily long after app startup) to write into it. This is
new territory, not a reuse of an existing invocation pattern — but a
**directly analogous** pattern already exists on the runtime side (below).

## 3. The real, existing precedent for a persistent, lazily-owned SQLite store

`src/main/runtime/orca-runtime-fence-automation-owner.ts:152-159`
(`OrcaRuntimeWithFenceAutomationOwner.getOrchestrationDb()`):

```ts
getOrchestrationDb(): OrchestrationDb {
  if (!this._orchestrationDb) {
    const dbPath = join(getAppEnvironment().getPath('userData'), 'orchestration.db')
    this._orchestrationDb = new OrchestrationDb(dbPath)
    this.ensureOrchestrationFederationRelay()
    this.scheduleRestoredMessageRepoints()
  }
  return this._orchestrationDb
}
```

`OrcaRuntimeService` is a **single linear mixin chain**
(`orca-runtime.ts:5`: `class OrcaRuntimeService extends OrcaRuntimeWithResolveWaiter {}`,
itself extending a long chain including `OrcaRuntimeWithFenceAutomationOwner`
and, elsewhere in the same chain, `OrcaRuntimeWithCreateAgentSession`).
Every mixin shares the same `this` at runtime — `this.getOrchestrationDb()`
is genuinely callable from any mixin method, including `createAgentSession`,
today. This is the **real, already-shipping pattern** for "a domain lazily
owns a persistent SQLite-backed store, opened once, held open for the app's
life, memoized on `this`" — not invented for this discovery, reused exactly
as-is.

## 4. Selected common composition root

**`OrcaRuntimeService` itself, via a new mixin, following the
`OrcaRuntimeWithFenceAutomationOwner` pattern exactly.**

```
application/composition coordinator
    OrcaRuntimeWithDelegatedCutoverCoordinator (new mixin, in the existing
    linear chain — e.g. src/main/runtime/orca-runtime-delegated-cutover-coordinator.ts)
        ├── Execution application port: lazily-owned ExecutionStore +
        │     SqliteReservationStore / SqliteDispatchWorktreeStore /
        │     SqliteDispatchProcessBindingStore / (new) SqliteDelegationCutoverStore,
        │     against a NEW persistent path (userData/execution.db — the real,
        │     durable store; NOT the shadow-observation slice's tmp/ephemeral path)
        └── AiControlFenceClientPort (new, see §7) — the caller-generated-token
              acquireOrcaFence / acknowledgeOrcaCutover / safeReleaseOrcaFence
              handshake

createAgentSession (existing mixin, same chain)
    → onPtySpawnCommitted closure (site #5), for a delegated request only,
      calls this.getDelegatedCutoverCoordinator().<method>(...)

providers/local-pty-spawn.ts (site #12) — UNCHANGED, authority-neutral.
It still only ever calls args.onPtySpawnCommitted?.() and awaits the
already-async-aware guard published in eed09b3047. It has no idea a
coordinator, a fence, or aiControl exist.
```

This keeps `src/main/providers/*` and `src/main/ipc/pty/*` exactly as
published (Parts A/B) — authority-neutral, zero new imports. Only
`src/main/runtime/` gains a new mixin, in the same style every other runtime
capability already uses. Dependency direction: Runtime → Execution
application/infrastructure types (a port the coordinator depends on),
**never** the reverse; Runtime → aiControl fence client (a new outbound
port), never inward.

## Rejected alternatives

**(a) Wire the Execution store/aiControl client directly into
`providers/local-pty-spawn.ts` or `ipc/pty/runtime/spawn-options.ts`.**
Rejected: makes the provider/PTY mechanism aiControl- and
Execution-bounded-context-aware, violating the mission's explicit "provider/
runtime mechanism must remain authority-neutral" and inverting the intended
dependency direction (a low-level mechanism must not depend on a high-level
policy decision like "this run is delegated").

**(b) Reuse `executeShadowIdentityObservationSlice`'s composition root
directly, calling it (or a variant) from inside the callback.** Rejected:
its lifecycle (open DB → run one fixed batch against frozen sample data →
close DB) is structurally incompatible with an interactive event of
unpredictable timing; opening and closing a `SyncDatabase` connection on
every terminal creation would also defeat the whole point of `BEGIN
IMMEDIATE` write serialization this store relies on elsewhere. Adapting it
to a persistent variant is exactly what the new mixin does, in the correct
location, with an existing precedent to imitate.

**(c) A free-standing top-level singleton constructed in
`main-process-runtime-service.ts` and injected into `OrcaRuntimeService`'s
constructor options (mirroring `getLocalProvider`/`onPtyStopped`-style
callback injection).** Not rejected as wrong, but **not selected** — it is
viable but less consistent with the existing precedent for "a domain that
owns its own persistent SQLite store" (`getOrchestrationDb()` is a
same-class lazy accessor on `OrcaRuntimeService`, not an externally
constructed and injected callback). Recorded as a secondary option if a
future session finds a reason the mixin approach doesn't fit (e.g. testing
ergonomics), but the mixin approach is the smaller diff and the more
consistent one.

## 5. Future cutover coordinator

- **Bounded context:** Execution (logically) — physically realized as a new
  Runtime-layer mixin, per §4 above, because that is the only place both
  sides are legally reachable without inverting dependency direction.
- **Likely module/path:** `src/main/runtime/orca-runtime-delegated-cutover-coordinator.ts`,
  exporting `OrcaRuntimeWithDelegatedCutoverCoordinator`, inserted into the
  existing linear mixin chain (`orca-runtime.ts`).
- **Constructor/composition point:** lazy, memoized accessor
  (`getDelegatedCutoverCoordinator()`), exactly mirroring
  `getOrchestrationDb()` — constructed on first use, not eagerly at app
  startup (avoids opening `execution.db` for every app launch, including
  ones that never touch a delegated run).
- **Caller:** `createAgentSession`'s `onPtySpawnCommitted` closure (site #5),
  guarded by whatever eligibility/mode flag identifies a delegated request
  (§7 below).
- **Dependencies:** the lazily-owned `ExecutionStore`/`ExecutionTransactionRunner`
  + relevant Sqlite stores (existing infrastructure, reused as-is); a new
  `AiControlFenceClientPort` (§7); the real process identity
  (`pid`/`osStartMarker`) handed to it by the callback, not fetched itself.
- **Lifecycle:** same as `OrchestrationDb` — opened once, held for the app's
  life, closed only on app shutdown (needs a shutdown-hook symmetrical to
  however `OrchestrationDb`'s own close is currently handled, not traced
  further in this discovery — narrowly out of scope).
- **Minimum responsibilities** (per the mission's own list): checked
  eligibility (§7.3's existing gate) → call the fence client → on success,
  prepare/read the real process identity handed in by the callback → run the
  one atomic transaction (`run_binding` + `dispatch_worktree` +
  `dispatch_process_binding` + `delegation_cutover`) → return a
  `DelegationCutoverCommitResult` (already specified, §4.5.3) to the caller,
  which is what makes site #12's `await` meaningful. **Not implemented
  here.**

## 6. Spawn-commit callback ownership

- **Closure creation site:** unchanged from SPEC — `orca-runtime-create-agent-session.ts:225-227`
  (site #5), inside `createAgentSession`.
- **Identity captured:** whatever `RuntimeCreateAgentSessionRequest` is
  extended to carry (§7) — at minimum an `aicontrolRunId` and a
  caller-generated fence token; `correlationId`/`orcaDispatchId` are minted
  by `createAgentSession` itself today (`operationHandle`,
  `reclaim.identity`) and can be reused/threaded into the coordinator call,
  not invented anew.
- **Execution application service invoked:** `this.getDelegatedCutoverCoordinator().commitDelegatedCutover(...)`
  (name illustrative, not specified) — a **same-class method call**, not a
  cross-module import, because both live in the same mixin chain (§4).
- **Rejection handling:** unchanged from the published async guard contract
  (`eed09b3047`) — a rejected `Promise<DelegationCutoverCommitResult>`
  propagates through the already-hardened guard exactly as gate 48 requires;
  the coordinator itself decides pre-commit vs. post-commit cleanup (§5.8,
  already specified) but does not change how the callback/guard machinery
  propagates that decision.
- **Provider/runtime mechanism remains authority-neutral:** confirmed — the
  provider (`local-pty-spawn.ts`) never learns the coordinator, the fence
  client, or the Execution store exist. It only ever awaits an opaque
  `Promise<DelegationCutoverCommitResult | void>`, exactly as published.

## 7. Identity transport

**Selected: (C) — pass a narrow opaque correlation/execution context,
captured in the application-layer closure, not leaked into generic
Runtime/PTY/provider contracts.**

Concretely: extend `RuntimeCreateAgentSessionRequest` with one small,
optional, narrowly-typed field (e.g. `delegatedCutover?: { aicontrolRunId:
string; fenceToken: string }`) — additive, absent for every existing
non-delegated caller, so no existing call site changes shape. This is (A)
in the mission's own framing, but deliberately kept to the **minimum**
identity aiControl actually hands over (a run id + a token), not a wholesale
import of aiControl domain concepts into the Runtime request type. Once
received, `createAgentSession` captures this in the `onPtySpawnCommitted`
closure (site #5) alongside the correlation/dispatch identity it already
mints — this is (B) applied to the *closure*, not the wider type system:
the closure, not `PtySpawnOptions`/`ShadowLifecycleProcessPort`, is where
aiControl identity lives. `PtySpawnOptions`, `RuntimePtySpawnState`, and
every type site #4.5.1 already widened stay exactly as published — no
aiControl-specific field is added to any of them. This satisfies the
mission's explicit preference against leaking aiControl concepts into
generic provider contracts.

**Rejected:** (D) reuse an existing mechanism — checked; nothing in the
current `RuntimeCreateAgentSessionRequest`/`PtySpawnOptions` family carries
anything resembling an external-system run identity today (confirmed via
this session's grep), so there is no existing mechanism to reuse; a new,
minimal field is unavoidable.

## 8. Async-late self-dependency compatibility

The proposed callback ownership does **not** make
`ASYNC_LATE_SELF_DEPENDENCY` reachable. The new coordinator method
(`commitDelegatedCutover` or equivalent) is a **new caller** of the
already-published, already-hardened `createAsyncSpawnCommitReporter`/guard
machinery (`eed09b3047`) — it never wraps, re-implements, or re-enters that
reporter itself. Nothing in this discovery proposes the coordinator's own
transaction logic calling back into `onPtySpawnCommitted`'s reporter,
synchronously or asynchronously, directly or indirectly. Residual
classification is unchanged: `UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL`.

## 9. `run_reservation` discovery

**Schema** (`execution-schema.ts:25-44`):

```sql
CREATE TABLE run_reservation (
  correlation_id        TEXT PRIMARY KEY,
  slice_ref             TEXT NOT NULL,
  authoritative_run_ref TEXT,
  workload_id           TEXT NOT NULL,
  state                 TEXT NOT NULL,
  orca_run_id           TEXT,
  orca_dispatch_id      TEXT,
  org_task_id           TEXT,
  candidate_head        TEXT,
  last_error            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
```
Unique index: at most one non-`abandoned` reservation per
`(slice_ref, authoritative_run_ref, workload_id)`.

- **Meaning:** the root admission record for a slice's dispatch attempt
  against one `workload_id` — every other Execution-store fact
  (`run_binding`, `dispatch_worktree`, `dispatch_process_binding`,
  `delegation_cutover`) chains its FK to `run_reservation.correlation_id`.
- **Owner:** Execution bounded context, `ExecutionStore`/`SqliteReservationStore`
  (`sqlite-reservation-store.ts`).
- **Writers today:** the shadow-observation composition root only
  (`executeShadowIdentityObservationSlice` via `runShadowObservation`), for
  its own fixed `FROZEN_SLOTS`/`SHADOW_IDENTITY_OBSERVATION_SLICE_REF`.
- **Readers:** every downstream Execution-store consumer keyed by
  `correlation_id` (settlement, worktree provenance, lifecycle closure, and
  the proposed `delegation_cutover`).
- **Why §5.4 needs it:** `run_binding.correlation_id` is `NOT NULL UNIQUE
  REFERENCES run_reservation(correlation_id)` — the four-insert transaction
  cannot commit `run_binding` without a pre-existing `run_reservation` row.
- **What references it:** `run_binding`, `dispatch_worktree`,
  `settlement_observation`, `worktree_provenance`, every S4 lifecycle table,
  and SPEC's proposed `delegation_cutover.correlation_id`.
- **Can the delegated flow reuse an existing creation path?** **No.** The
  only existing creation path is scoped to the shadow-observation slice's
  own fixed sample-workload harness, keyed by `slice_ref =
  SHADOW_IDENTITY_OBSERVATION_SLICE_REF` — it has no relationship to an
  interactive `createAgentSession` request and was never intended to.

## 10. Reservation ordering

**Selected: (D), with the reservation created inside the new coordinator's
own S2 step — logically "reservation already exists before the atomic
bind+cutover transaction starts," realized as a new insert the coordinator
itself performs, not reused from an unrelated existing path.**

Concretely: the coordinator inserts `run_reservation` as its own **first**
write, at S2 (`ORCA_PREPARING`, before any process is spawned) — **not**
inside the same S5 atomic transaction (§5.4's four inserts stay exactly as
specified: `run_binding` + `dispatch_worktree` + `dispatch_process_binding` +
`delegation_cutover`), and **not** at S1 (fence acquisition is aiControl's
own database, no coupling to `run_reservation` timing is required or
desirable). This is (A)-then-(D) combined: reservation is created before the
atomic transaction, inside the same Execution-store connection, using a
fresh `slice_ref` for this delegated-cutover sub-slice (distinct from the
shadow-observation slice's `slice_ref`, so the two flows can never collide
under the existing `(slice_ref, authoritative_run_ref, workload_id)` unique
index).

**Verified this does not create a second capacity/admission authority:**
`run_reservation.state`/`workload_id`/`authoritative_run_ref` here represent
**Execution's own internal dispatch-identity bookkeeping**, not queue
admission — aiControl's `agent_runs.status`/`orca_fence_state` remains the
sole admission/capacity authority (§6 of `SPEC.md`, unaffected). This
`run_reservation` row is created only **after** `acquireOrcaFence` already
succeeded (S1 already committed) — it can never itself gate or duplicate
aiControl's own admission decision; it exists so the rest of the
Execution-store schema has an identity to hang off, exactly the same role it
already plays for the shadow-observation flow.

## 11. Atomic transaction re-derivation

Confirmed unchanged from the independent review: **one** transaction can
legally write every required Maestro fact. `ExecutionStore`'s
`withImmediateTransaction` (the same `txn: ExecutionTransactionRunner`
`worktree-provenance-bind-step.ts` already uses) is the store/DB/primitive
the future coordinator should expose the operation through — a new
coordinator method (e.g. `commitDelegatedCutover`) wrapping:

```
deps.txn.withImmediateTransaction(() => {
  store.recordBinding(binding)                 // run_binding
  dispatchWorktrees.insert(...)                 // dispatch_worktree
  processBindings.insert(...)                   // dispatch_process_binding
  delegationCutoverStore.insert(...)             // delegation_cutover (new store, not yet implemented)
})
```

against the **same** `execDb`/`ExecutionStore` instance the coordinator
lazily owns (§5) — no cross-DB atomicity assumed or required, consistent
with §14's own "no distributed transaction" framing.

## 12. Crash-boundary trace (composition-specific)

| Boundary | Durable facts | Authority | Process state | Legal recovery | Forbidden |
| --- | --- | --- | --- | --- | --- |
| A. fence acquired / before reservation | aiControl `'fenced'` only | `AICONTROL_NATIVE` | none | retry S1→S2 same token | any native claim |
| B. reservation exists / before prepare | `run_reservation` only | `AICONTROL_NATIVE` | none | resume S2→S3; reservation is idempotently reusable by `correlation_id` | treating reservation existence as authority transfer |
| C. process prepared / before transaction | `run_reservation` only | `AICONTROL_NATIVE` | real process, unbound | §5.6 identity-recovery-then-fail-closed (unchanged from SPEC) | unconditional second spawn |
| D. transaction started (`BEGIN IMMEDIATE` issued) | `run_reservation` only (transaction not yet committed) | `AICONTROL_NATIVE` | real process, unbound | transaction is atomic — either all four inserts land or none do | assuming partial transaction state exists (SQLite guarantees it cannot) |
| E/F. binding + cutover inserted (still inside the same uncommitted transaction) | not durable until COMMIT | `AICONTROL_NATIVE` | real process, unbound | none — not a distinct observable state, same as D | none — not independently observable |
| G. transaction committed | `run_reservation` + `run_binding` + `dispatch_worktree` + `dispatch_process_binding` + `delegation_cutover` all durable | `ORCA_DELEGATED` | real process, bound | reconciliation-only (§5.6/§11) | any fence release |
| H. spawn-commit callback resolves | same as G | `ORCA_DELEGATED` | same | proceed to release | reporting success before G |
| I. workload released | same as G | `ORCA_DELEGATED` | same, now activating | normal S7+ lifecycle | second release, second process |

No row here requires JS Promise-resolution state for correctness — every
transition is gated on a durable SQLite fact, consistent with §14's
requirement and the independent review's confirmation.

## 13. Recovery composition

The real startup/recovery composition root for ORCA-S4's existing sweep is
`converge-delegation-boundary-lifecycle.ts` (`src/main/execution/application/`),
invoked today only from the same shadow-observation composition root chain.
**The delegated-cutover sweep needs the identical cross-boundary reach in
the opposite direction**: it must read `delegation_cutover`/
`dispatch_process_binding` from the (now persistent) Execution store, then
call `adoptStablePane`/`reconcileRemoteTerminalCreate` — real functions
confirmed present in `src/main/ipc/pty/pane/adopt-stable.ts` and the runtime
layer. **Recommended:** the sweep runs as a method on the same new
`OrcaRuntimeWithDelegatedCutoverCoordinator` mixin (§5) — it already owns the
persistent Execution store, and it already shares `this` with whatever
runtime methods can call `adoptStablePane`/`reconcileRemoteTerminalCreate`,
by the same reasoning as §4. This avoids inventing a second composition
root for recovery distinct from the one for the happy path. **Not
implemented here** — the sweep's trigger (timer? app-start hook? existing
sweep cadence used elsewhere?) was not traced in this discovery session and
should be resolved by whichever session designs the coordinator in detail.

## 14. Minimum ports

| Port | Owner | Caller | Purpose | Input | Output |
| --- | --- | --- | --- | --- | --- |
| `ExecutionStore` / `ExecutionTransactionRunner` (existing, reused) | Execution infrastructure | `OrcaRuntimeWithDelegatedCutoverCoordinator` | durable transaction primitive | insert operations | commit/rollback |
| `AiControlFenceClientPort` (**new**) | Execution infrastructure (new file, e.g. `execution/infrastructure/aicontrol-fence-client.ts`) | coordinator | HTTP call to aiControlCenter's real `acquireOrcaFence`/`acknowledgeOrcaCutover`/`safeReleaseOrcaFence` API routes | `{ runId, token }` | the real outcome enums SPEC.md §6 already specifies |
| `RealDelegatedProcessPort` (already named, SPEC §7.1, not yet implemented) | Execution infrastructure | coordinator | adapts `ShadowLifecycleProcessPort`'s exact interface to the real, already-spawned local-PTY process | `{ pid, osStartMarker, ... }` handed in by the callback | conforms to ORCA-S4's existing port shape |
| `DelegatedCutoverCoordinator` accessor (**new**) | `OrcaRuntimeService` (new mixin) | `createAgentSession`'s `onPtySpawnCommitted` closure | orchestrates eligibility→fence→prepare→bind+cutover→release | real process identity + captured aiControl identity | `DelegationCutoverCommitResult` (already specified, §4.5.3) |

No speculative framework API is proposed — every port above either reuses an
existing interface verbatim (`ExecutionStore`, `ShadowLifecycleProcessPort`)
or is the minimum new surface the missing HTTP call (fence client) and the
missing composition point (coordinator accessor) require.

**Note — no existing aiControl HTTP client found:** confirmed via
`aicontrol-*` grep under `execution/infrastructure/` — the only existing
aiControl-facing code (`aicontrol-db-reader.ts`,
`aicontrol-native/native-results-authoritative-executor.ts`) reads
`data/app.db` directly (read-only, guard-only) or replays canned test
results; nothing calls aiControlCenter's real Next.js API routes over HTTP
today. `AiControlFenceClientPort` is therefore new surface, not a reuse.

## 15. Exact architecture correction required

1. **Coordinator owner/path:** new Runtime-layer mixin,
   `OrcaRuntimeWithDelegatedCutoverCoordinator`, inserted into
   `OrcaRuntimeService`'s existing linear chain.
2. **Creation/composition root:** lazy, memoized accessor on
   `OrcaRuntimeService` (`getDelegatedCutoverCoordinator()`), mirroring
   `getOrchestrationDb()` exactly, opening a persistent
   `userData/execution.db` on first use.
3. **Identity transport:** additive, optional
   `delegatedCutover?: { aicontrolRunId, fenceToken }` field on
   `RuntimeCreateAgentSessionRequest`; captured in the site-#5 closure, never
   leaked into `PtySpawnOptions`/`RuntimePtySpawnState`/provider contracts.
4. **Spawn-commit callback owner:** unchanged location (site #5); its body,
   for a delegated request, becomes a call to
   `this.getDelegatedCutoverCoordinator().commitDelegatedCutover(...)`.
5. **Transaction invocation point:** a new coordinator method wrapping
   `ExecutionStore`'s existing `withImmediateTransaction`, writing
   `run_binding` + `dispatch_worktree` + `dispatch_process_binding` +
   `delegation_cutover` in one commit — `run_reservation` is **not** part of
   this transaction.
6. **`run_reservation` creation/order:** created by the coordinator as its
   own first write, at S2 (before process preparation), under a new,
   distinct `slice_ref` for this sub-slice — never reused from the
   shadow-observation flow's reservation, never part of the S5 atomic
   transaction.
7. **Recovery composition point:** a method on the same coordinator mixin
   (§13), reusing `adoptStablePane`/`reconcileRemoteTerminalCreate` via the
   shared `this`; its trigger/cadence is not resolved by this discovery.
8. **Dependency direction:** `OrcaRuntimeService` (Runtime) depends on
   Execution application/infrastructure types and a new aiControl HTTP
   client; `src/main/providers/*` and `src/main/ipc/pty/*` depend on
   neither and remain exactly as published in `eed09b3047`.

**No new blocker found.** This discovery closes the composition-root gap the
independent review identified without requiring any change to a previously
accepted §5+ invariant (fence handshake, atomic transaction shape, schema,
cardinality, cancellation/timeout, terminal projection, crash matrix, and
authority table are all consumed here exactly as already reviewed and
accepted). `run_reservation`'s ordering (§10 here) is new detail SPEC.md's
S0–S12 sequence should gain, not a contradiction of it.

## aiControl guard

`origin/master`: `ab5967bdde5115afe6673e8b520a73cfb29f0eaf` — confirmed via
fresh `git fetch`. `data/app.db` SHA-256:
`2dc6f32a86e42b6cd42e93712af73e33fc39053b3ec2b6265566ac0580a45088` —
confirmed via `sha256sum`. No `-wal`/`-shm`/journal. Not mutated (read-only
`git show`/`git fetch` only, this discovery touched no aiControl file).

## Authority

Before/after: `AICONTROL_NATIVE`. `ORCA_DELEGATED`: NOT STARTED. Fence
acquisition: DISABLED. R3: NOT STARTED. M5: NOT STARTED. Zero code, test,
schema, or migration changes made by this discovery session.
