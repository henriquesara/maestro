// PRE_IMPLEMENTATION RED baseline for orca-delegated-cutover SPEC.md §4.5.1's
// callback type-site inventory. Type-checked evidence only (`pnpm tc:node`),
// not a runtime test, not imported by any production module, not part of
// the vitest suite.
//
// IMPORTANT, discovered while building this evidence: a `() => void`-typed
// slot is structurally permissive in TypeScript -- a function that actually
// returns `Promise<X>` type-checks fine when assigned to it (over-returning
// callbacks are allowed; the caller side is simply expected to ignore the
// value). So asserting "assigning an async callback to today's `() => void`
// site is a type error" is FALSE and cannot be used as a RED signal here.
// This is itself load-bearing evidence for why the real defect is a runtime
// one, not a compile-time one: `pnpm tc:node` alone would never have caught
// it.
//
// The genuine, demonstrable type-level fact is the other direction: given
// today's declared type, the CALL SITE's return value is typed `void`, so
// no caller can treat it as awaitable. Each block proves exactly that --
// `@ts-expect-error` marks the line that must stop erroring once a site is
// correctly widened to `Promise<DelegationCutoverCommitResult | void> | void`
// (at which point `void` becomes part of a union a `Promise<unknown> | void`
// -typed local can hold, per gate 63's own re-derivation instruction, a
// future GREEN session removes the marker or converts it to a positive
// assertion).

import type { TerminalCreateOptions } from '../../../runtime/runtime-terminal-contracts'
import type { RuntimePtyController } from '../../../runtime/runtime-pty-controller-contract'
import type { PtySpawnOptions } from '../../../providers/pty-provider-contract'
import type {
  RuntimePtySpawnState,
  RuntimePtySpawnArgs
} from '../../../ipc/pty/runtime/spawn-state'
import type { StablePaneSpawnContext } from '../../../ipc/pty/pane/stable-owner'

// Site #1 -- runtime-terminal-contracts.ts:55, TerminalCreateOptions.onPtySpawnCommitted
function redSite1(opts: TerminalCreateOptions): void {
  const returned = opts.onPtySpawnCommitted?.()
  // @ts-expect-error RED (§4.5.1 site #1): declared return type is `void` --
  // nothing here for a caller to await for the durable result.
  const awaited: Promise<unknown> | undefined = returned
  void awaited
}
void redSite1

// Site #2 -- runtime-pty-controller-contract.ts:71, RuntimePtyController['spawn'] options
type Site2SpawnOpts = NonNullable<Parameters<NonNullable<RuntimePtyController['spawn']>>[0]>
function redSite2(opts: Site2SpawnOpts): void {
  const returned = opts.onPtySpawnCommitted?.()
  // @ts-expect-error RED (§4.5.1 site #2): same defect as site #1.
  const awaited: Promise<unknown> | undefined = returned
  void awaited
}
void redSite2

// Site #3 -- pty-provider-contract.ts:109, PtySpawnOptions.onPtySpawnCommitted
function redSite3(opts: PtySpawnOptions): void {
  const returned = opts.onPtySpawnCommitted?.()
  // @ts-expect-error RED (§4.5.1 site #3): same defect as site #1.
  const awaited: Promise<unknown> | undefined = returned
  void awaited
}
void redSite3

// Site #4 -- spawn-state.ts:115, RuntimePtySpawnArgs.onPtySpawnCommitted
function redSite4(args: RuntimePtySpawnArgs): void {
  const returned = args.onPtySpawnCommitted?.()
  // @ts-expect-error RED (§4.5.1 site #4): same defect as site #1.
  const awaited: Promise<unknown> | undefined = returned
  void awaited
}
void redSite4

// Site #14 -- spawn-state.ts:80, RuntimePtySpawnState.reportPtySpawnCommitted
function redSite14(ctx: Pick<RuntimePtySpawnState, 'reportPtySpawnCommitted'>): void {
  const returned = ctx.reportPtySpawnCommitted()
  // @ts-expect-error RED (§4.5.1 site #14): declared return type is `void` --
  // sites #12/#16/#17/#19 all read this same slot back and can never await it.
  const awaited: Promise<unknown> = returned
  void awaited
}
void redSite14

// Site #18 -- stable-owner.ts:169, StablePaneSpawnContext.onFreshSpawn
function redSite18(
  ctx: Pick<StablePaneSpawnContext, 'onFreshSpawn'>,
  result: Parameters<NonNullable<StablePaneSpawnContext['onFreshSpawn']>>[0]
): void {
  const returned = ctx.onFreshSpawn?.(result)
  // @ts-expect-error RED (§4.5.1 site #18): declared return type is `void` --
  // site #19 (stable-owner.ts:302) reads this back and can never await it.
  const awaited: Promise<unknown> | undefined = returned
  void awaited
}
void redSite18

// Sites #5, #7, #8, #9 (orca-runtime-create-terminal.ts) and #6, #10, #11,
// #12, #16, #17, #19 (implementation call sites, not type declarations) are
// not independently type-checkable in isolation this way:
//   - #5/#7/#8/#9 live in orca-runtime-create-terminal.ts, which carries a
//     repository-wide `@ts-nocheck` (mechanically split from OrcaRuntimeService;
//     confirmed this session, see PREIMPLEMENTATION-RED-EVIDENCE.md) --
//     `tsc` never reports an error there regardless of the type it conforms
//     to, so a type-level assertion there proves nothing. Its RED evidence is
//     runtime-only (see spawn-execute-commit-propagation.test.ts's site #16
//     coverage, which exercises the same real call-graph shape via
//     spawn-execute.ts).
//   - #6, #10, #12, #16, #17, #19 are invocation/wiring sites, not type
//     declarations -- their RED evidence is the runtime behavior proven in
//     orca-runtime-report-pty-spawn-commit-async.test.ts,
//     spawn-options-commit-guard-async.test.ts, and
//     spawn-execute-commit-propagation.test.ts.
//   - #13 (stable-owner.ts:233, attachStablePaneOwner) is confirmed
//     unchanged/out-of-scope by the frozen SPEC itself -- no RED is claimed
//     for it.
