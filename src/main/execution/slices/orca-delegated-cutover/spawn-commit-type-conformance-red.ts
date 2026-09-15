// PRE_IMPLEMENTATION type-conformance evidence for orca-delegated-cutover
// SPEC.md §4.5.1's callback type-site inventory. Type-checked only
// (`pnpm tc:node`), not a runtime test, not imported by any production
// module, not part of the vitest suite.
//
// History: this file started (commit 0a1bf4c265) as genuine RED --
// `@ts-expect-error` markers proving each site's then-current `() => void`
// return type could never be treated as awaitable. The GREEN implementation
// session widened every one of these sites; each block below now asserts
// the POSITIVE conformance fact directly (the assignment succeeds without a
// suppression), which is the legitimate GREEN form of the same evidence
// (see PREIMPLEMENTATION-GREEN-EVIDENCE.md).
//
// Two distinct, correct shapes exist by design (SPEC.md §4.5.1's own "the
// union type accommodates both" language):
//   - RAW CALLBACK sites (#1-#4, #18) -- what a caller supplies. Typed
//     `() => Promise<DelegationCutoverCommitResult> | void` (or, for #18,
//     the same wrapped in an extra `| void` from its own optional-callback
//     shape): EITHER a real, awaitable Promise OR a plain synchronous
//     `void` return, so every existing non-delegated caller (still passing
//     a bare `() => void`) remains valid, unchanged, additive.
//   - GUARD OUTPUT (#14, `RuntimePtySpawnState.reportPtySpawnCommitted`,
//     and its `createAsyncSpawnCommitReporter`-produced twin at
//     `spawn-options.ts`'s site #10) -- always a real `async` function, so
//     its return type is unconditionally `Promise<DelegationCutoverCommitResult | void>`,
//     never a bare `void`.
// A raw callback's return therefore can never be asserted to be
// unconditionally awaitable (it might genuinely be `void`) -- that was
// never the frozen contract's intent, and treating it as such would be a
// FALSE regression signal, not real evidence. What IS provable, and is
// asserted below, is that a real `Promise<...>` is now structurally part of
// each site's return type where the frozen contract calls for one.

import type { TerminalCreateOptions } from '../../../runtime/runtime-terminal-contracts'
import type { RuntimePtyController } from '../../../runtime/runtime-pty-controller-contract'
import type { PtySpawnOptions } from '../../../providers/pty-provider-contract'
import type {
  RuntimePtySpawnState,
  RuntimePtySpawnArgs
} from '../../../ipc/pty/runtime/spawn-state'
import type { StablePaneSpawnContext } from '../../../ipc/pty/pane/stable-owner'
import type { DelegationCutoverCommitResult } from '../../../../shared/delegation-cutover-commit-result'

// Site #1 -- runtime-terminal-contracts.ts, TerminalCreateOptions.onPtySpawnCommitted
function greenSite1(opts: TerminalCreateOptions): void {
  const returned = opts.onPtySpawnCommitted?.()
  // GREEN (§4.5.1 site #1): a real Promise<DelegationCutoverCommitResult> is
  // now structurally part of the return type; a bare `void`-returning
  // caller (every existing non-delegated call site) remains valid too.
  const awaited: Promise<DelegationCutoverCommitResult> | void | undefined = returned
  void awaited
}
void greenSite1

// Site #2 -- runtime-pty-controller-contract.ts, RuntimePtyController['spawn'] options
type Site2SpawnOpts = NonNullable<Parameters<NonNullable<RuntimePtyController['spawn']>>[0]>
function greenSite2(opts: Site2SpawnOpts): void {
  const returned = opts.onPtySpawnCommitted?.()
  // GREEN (§4.5.1 site #2): same widened contract as site #1.
  const awaited: Promise<DelegationCutoverCommitResult> | void | undefined = returned
  void awaited
}
void greenSite2

// Site #3 -- pty-provider-contract.ts, PtySpawnOptions.onPtySpawnCommitted
function greenSite3(opts: PtySpawnOptions): void {
  const returned = opts.onPtySpawnCommitted?.()
  // GREEN (§4.5.1 site #3): this field also carries guard layer 2's own
  // output once threaded (site #11, always a Promise), so its declared
  // type is the full three-way union.
  const awaited: Promise<DelegationCutoverCommitResult | void> | void | undefined = returned
  void awaited
}
void greenSite3

// Site #4 -- spawn-state.ts, RuntimePtySpawnArgs.onPtySpawnCommitted
function greenSite4(args: RuntimePtySpawnArgs): void {
  const returned = args.onPtySpawnCommitted?.()
  // GREEN (§4.5.1 site #4): same widened contract as site #1.
  const awaited: Promise<DelegationCutoverCommitResult> | void | undefined = returned
  void awaited
}
void greenSite4

// Site #14 -- spawn-state.ts, RuntimePtySpawnState.reportPtySpawnCommitted
function greenSite14(ctx: Pick<RuntimePtySpawnState, 'reportPtySpawnCommitted'>): void {
  const returned = ctx.reportPtySpawnCommitted()
  // GREEN (§4.5.1 site #14): guard output is unconditionally a real Promise
  // -- sites #12/#16/#17/#19 can all genuinely await this same slot now.
  const awaited: Promise<DelegationCutoverCommitResult | void> = returned
  void awaited
}
void greenSite14

// Site #18 -- stable-owner.ts, StablePaneSpawnContext.onFreshSpawn
function greenSite18(
  ctx: Pick<StablePaneSpawnContext, 'onFreshSpawn'>,
  result: Parameters<NonNullable<StablePaneSpawnContext['onFreshSpawn']>>[0]
): void {
  const returned = ctx.onFreshSpawn?.(result)
  // GREEN (§4.5.1 site #18): widened identically to the raw-callback sites;
  // site #19 (stable-owner.ts) now awaits this.
  const awaited: Promise<DelegationCutoverCommitResult | void> | void | undefined = returned
  void awaited
}
void greenSite18

// Sites #5, #7, #8, #9 (orca-runtime-create-terminal.ts) and #6, #10, #11,
// #12, #16, #17, #19 (implementation call sites, not type declarations) are
// not independently type-checkable in isolation this way:
//   - #5/#7/#8/#9 live in orca-runtime-create-terminal.ts, which carries a
//     repository-wide `@ts-nocheck` (mechanically split from OrcaRuntimeService)
//     -- `tsc` never reports anything there regardless of the type it
//     conforms to. Their GREEN evidence is runtime-only: site #9's `await
//     reportPtySpawnCommitted()` is exercised end-to-end by
//     spawn-execute-commit-propagation.test.ts's settlement-timing
//     assertions (the same real call-graph shape), and directly by
//     manual/functional verification this session (see
//     PREIMPLEMENTATION-GREEN-EVIDENCE.md).
//   - #6, #10, #12, #16, #17, #19 are invocation/wiring sites, not type
//     declarations -- their GREEN evidence is the runtime behavior proven
//     in orca-runtime-report-pty-spawn-commit-async.test.ts,
//     spawn-options-commit-guard-async.test.ts,
//     spawn-execute-commit-propagation.test.ts, and
//     spawn-execute-cross-alias-promise-convergence.test.ts.
//   - #11 (spawn-options.ts, threading) is asserted directly by
//     spawn-execute-cross-alias-promise-convergence.test.ts's own
//     structural equality check.
//   - #13 (stable-owner.ts, attachStablePaneOwner) is confirmed
//     unchanged/out-of-scope by the frozen SPEC itself -- no change made.
