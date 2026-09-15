// GREEN evidence for orca-delegated-cutover SPEC.md §4.5.1a's closing
// requirement and gate 60: for one execution identity, every alias that
// reads back guard layer 2 must converge on the SAME single in-flight
// spawn-commit Promise/result.
//
// History: started RED (commit c75a76bd651) -- neither call site carried a
// Promise at all. The GREEN implementation session's shared
// `createAsyncSpawnCommitReporter` (src/shared/async-spawn-commit-reporter.ts)
// caches and returns the SAME underlying Promise object for the guard's
// entire lifecycle, so every alias that reads it back observes the
// identical object.
//
// This file crosses TWO different real, unmocked production call paths for
// the SAME spawn -- not two invocations of one wrapper (that is already
// covered by the guard-layer GREEN files):
//
//   - site #12 (`local-pty-spawn.ts:89`, `args.onPtySpawnCommitted?.()`,
//     nested inside the local provider's own spawn implementation, fired
//     BEFORE `ctx.provider.spawn(...)`'s awaited call resolves) -- simulated
//     here by a stub `IPtyProvider.spawn` that calls
//     `ctx.spawnOptions.onPtySpawnCommitted?.()` exactly the way
//     `spawnLocalPty` really does (unawaited, before returning), because
//     exercising the real `LocalPtyProvider`/`node-pty` stack end-to-end
//     adds no additional coverage of the guard-convergence contract under
//     test here (already covered for the Windows-argv contract by
//     `local-pty-provider-delegated-command-delivery.test.ts`);
//   - site #16 (`spawn-execute.ts:88`, `ctx.reportPtySpawnCommitted()`,
//     called directly, unmocked, from the real `executeRuntimePtySpawn`,
//     immediately after `ctx.provider.spawn(...)` resolves).
//
// Both call sites read back the literal same guard-layer-2 closure
// (`ctx.reportPtySpawnCommitted`, constructed for real by the real,
// unmocked `buildRuntimePtySpawnOptions`, and threaded into
// `ctx.spawnOptions.onPtySpawnCommitted` by real, unmocked site #11 wiring)
// -- confirmed structurally in `spawn-options-commit-guard-async.test.ts`
// and asserted again below. No `delegation_cutover` table or any other
// durable storage is introduced; the future durable operation is
// represented by a controllable deferred Promise injected at
// `args.onPtySpawnCommitted`, the real existing injection seam.

import { describe, expect, it, vi } from 'vitest'

const { ensureMock, findMock, reconcileMock } = vi.hoisted(() => ({
  ensureMock: vi.fn(),
  findMock: vi.fn(),
  reconcileMock: vi.fn(async () => {})
}))

vi.mock('../pane/agent-session-owners', () => ({
  agentSessionOwners: { ensure: ensureMock, find: findMock },
  assertSpawnReplyWasLive: vi.fn(),
  reconcileAgentSessionOwnerListings: reconcileMock
}))

import { executeRuntimePtySpawn } from './spawn-execute'
import { buildRuntimePtySpawnOptions } from './spawn-options'
import { createRuntimePtySpawnState, type RuntimePtySpawnArgs } from './spawn-state'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import type { IPtyProvider, PtySpawnResult } from '../../../providers/types'

function makeCtx(onPtySpawnCommitted: () => unknown) {
  const deps = {
    getSettings: () => undefined,
    trustedTerminalHandleEnv: new Set<string>()
  } as unknown as PtyRuntimeControllerDeps
  const args = {
    cols: 80,
    rows: 24,
    agentSessionEnsure: { claim: { kind: 'terminal' }, surface: {} } as never,
    // Represents the future durable spawn-commit operation. Real injection
    // seam: RuntimePtySpawnArgs.onPtySpawnCommitted -- no fake storage.
    onPtySpawnCommitted: onPtySpawnCommitted as unknown as () => void
  } as unknown as RuntimePtySpawnArgs
  return createRuntimePtySpawnState(deps, args)
}

/** Wires a real ctx through real buildRuntimePtySpawnOptions, then installs a
 *  recording wrapper around the REAL guard-layer-2 closure at both of the
 *  real production read-back points (ctx.reportPtySpawnCommitted itself,
 *  which site #16 calls directly, and ctx.spawnOptions.onPtySpawnCommitted,
 *  which site #12 calls via the provider) -- so both real call sites can be
 *  observed without altering their own logic. */
async function wireCtxWithObservedGuard(onPtySpawnCommitted: () => unknown) {
  const ctx = makeCtx(onPtySpawnCommitted)
  await buildRuntimePtySpawnOptions(ctx)

  // Site #11 (real, unmocked): confirms both real call sites below do in
  // fact read back the SAME closure instance before we wrap it.
  expect(ctx.spawnOptions.onPtySpawnCommitted).toBe(ctx.reportPtySpawnCommitted)

  const realGuard = ctx.reportPtySpawnCommitted
  const observedReturns: unknown[] = []
  const observingGuard = (): unknown => {
    const result = realGuard()
    observedReturns.push(result)
    return result
  }
  ctx.reportPtySpawnCommitted = observingGuard as unknown as typeof ctx.reportPtySpawnCommitted
  ctx.spawnOptions.onPtySpawnCommitted =
    observingGuard as unknown as typeof ctx.spawnOptions.onPtySpawnCommitted

  return { ctx, observedReturns }
}

describe('gate 60: cross-alias spawn-commit Promise convergence (SPEC §4.5.1a, GREEN)', () => {
  it(
    'GREEN: site #12 (nested provider invocation) and site #16 (direct spawn-execute call) ' +
      'converge on the SAME single in-flight Promise, with the underlying operation ' +
      'invoked exactly once',
    async () => {
      let underlyingInvocations = 0
      let resolveDurable!: (result: { outcome: 'COMMITTED' }) => void
      const durable = new Promise<{ outcome: 'COMMITTED' }>((resolve) => {
        resolveDurable = resolve
      })

      const { ctx, observedReturns } = await wireCtxWithObservedGuard(() => {
        underlyingInvocations += 1
        return durable
      })

      findMock.mockReturnValue(undefined)
      ensureMock.mockImplementation(async (opts: { spawn: () => Promise<{ ptyId: string }> }) => {
        const spawned = await opts.spawn()
        return { owner: { ptyId: spawned.ptyId }, disposition: 'fresh' }
      })
      ctx.provider = {
        // Mirrors local-pty-spawn.ts:89 exactly: an unawaited call to the
        // threaded callback, made before the provider's own spawn settles.
        spawn: vi.fn(async (): Promise<PtySpawnResult> => {
          ctx.spawnOptions.onPtySpawnCommitted?.() // site #12
          return { id: 'pty-1', incarnationId: 'inc-1' }
        })
      } as unknown as IPtyProvider

      let executeSettled = false
      const execution = executeRuntimePtySpawn(ctx).then(() => {
        executeSettled = true
      })
      // Why a macrotask boundary, not a tick count: see
      // spawn-execute-commit-propagation.test.ts's own rationale.
      await new Promise((resolve) => setImmediate(resolve))

      // By now both site #12 (inside the provider stub) and site #16
      // (spawn-execute.ts:88, real, fired right after provider.spawn()
      // resolves) have run exactly once each.
      expect(observedReturns).toHaveLength(2)

      // GREEN, preserved: the underlying durable operation is invoked
      // exactly once across BOTH real aliases, not per-alias.
      expect(underlyingInvocations).toBe(1)

      // FROZEN CONTRACT (gate 60): GREEN -- the second alias, invoked while
      // the durable operation is still pending, observes the SAME in-flight
      // Promise the first alias started (referential equality).
      expect(observedReturns[0]).toBeInstanceOf(Promise)
      expect(observedReturns[1]).toBe(observedReturns[0])

      // FROZEN CONTRACT: GREEN -- no alias reports success before the
      // shared Promise settles.
      expect(executeSettled).toBe(false)

      resolveDurable({ outcome: 'COMMITTED' })
      await execution
      expect(executeSettled).toBe(true)
    }
  )

  it(
    'GREEN: a rejection from the underlying operation reaches both converging aliases, ' +
      'with no retry and no unhandled rejection',
    async () => {
      const rejectionError = new Error('durable_commit_failed')
      let underlyingInvocations = 0
      let capturedPromise: Promise<never> | undefined

      const { ctx, observedReturns } = await wireCtxWithObservedGuard(() => {
        underlyingInvocations += 1
        capturedPromise = Promise.reject(rejectionError)
        return capturedPromise
      })

      findMock.mockReturnValue(undefined)
      ensureMock.mockImplementation(async (opts: { spawn: () => Promise<{ ptyId: string }> }) => {
        const spawned = await opts.spawn()
        return { owner: { ptyId: spawned.ptyId }, disposition: 'fresh' }
      })
      ctx.provider = {
        spawn: vi.fn(async (): Promise<PtySpawnResult> => {
          ctx.spawnOptions.onPtySpawnCommitted?.() // site #12
          return { id: 'pty-2', incarnationId: 'inc-2' }
        })
      } as unknown as IPtyProvider

      let thrown: unknown
      try {
        await executeRuntimePtySpawn(ctx)
      } catch (error) {
        thrown = error
      }
      // Deterministic, not timing-dependent: capturedPromise is the exact
      // object the underlying operation produced, caught here explicitly so
      // this test never depends on process-level unhandledRejection timing.
      await capturedPromise?.catch(() => {})

      // GREEN, preserved: still exactly one underlying invocation -- no
      // alias retried after the failure.
      expect(underlyingInvocations).toBe(1)
      expect(observedReturns).toHaveLength(2)

      // FROZEN CONTRACT (gate 60, failure case): GREEN -- both converging
      // aliases observe the same rejection (same Promise object), and it
      // reaches the owning flow (executeRuntimePtySpawn's own rejection).
      expect(observedReturns[0]).toBeInstanceOf(Promise)
      expect(observedReturns[1]).toBe(observedReturns[0])
      expect(thrown).toBe(rejectionError)
    }
  )
})
