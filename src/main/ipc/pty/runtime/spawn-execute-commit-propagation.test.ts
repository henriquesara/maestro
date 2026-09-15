// GREEN evidence for orca-delegated-cutover SPEC.md §4.5.1 sites #16/#17
// (`spawn-execute.ts`) and, via the real `spawnForStablePane` it calls, site
// #19 (`stable-owner.ts`). Gates 47, 57, 59, 61, 62, plus Areas G/H/K/L.
//
// History: started RED (commit 0a1bf4c265) -- both calls were bare and
// unawaited. The GREEN implementation session added `await` at
// `spawn-execute.ts:88` (site #16) and `stable-owner.ts:302` (site #19).
//
// `executeRuntimePtySpawn` is exercised for real; only the agent-session
// owner registry (a stateful singleton irrelevant to this seam) is mocked
// for the `agentSessionEnsure` branch. The non-`agentSessionEnsure` branch
// needs no mocking beyond a stub provider -- it runs the real
// `spawnForStablePane`/`attachStablePaneOwner` code from stable-owner.ts.

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
import { createRuntimePtySpawnState, type RuntimePtySpawnArgs } from './spawn-state'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import type { IPtyProvider, PtySpawnResult } from '../../../providers/types'

function makeCtx(args: Partial<RuntimePtySpawnArgs>) {
  const deps = {
    trustedTerminalHandleEnv: new Set<string>()
  } as unknown as PtyRuntimeControllerDeps
  const fullArgs = { cols: 80, rows: 24, ...args } as unknown as RuntimePtySpawnArgs
  return createRuntimePtySpawnState(deps, fullArgs)
}

describe('spawn-execute.ts commit-guard propagation (SPEC §4.5.1 sites #16/#17/#19, GREEN)', () => {
  it(
    'GREEN (gate 47/61, site #16): agentSessionEnsure branch awaits the durable commit ' +
      'before executeRuntimePtySpawn resolves',
    async () => {
      let resolveDurable!: () => void
      const durable = new Promise<void>((resolve) => {
        resolveDurable = resolve
      })

      findMock.mockReturnValue(undefined)
      ensureMock.mockImplementation(async (opts: { spawn: () => Promise<{ ptyId: string }> }) => {
        const spawned = await opts.spawn()
        return { owner: { ptyId: spawned.ptyId }, disposition: 'fresh' }
      })

      const ctx = makeCtx({
        agentSessionEnsure: { claim: { kind: 'terminal' }, surface: {} } as never
      })
      ctx.provider = {
        spawn: vi.fn(async (): Promise<PtySpawnResult> => ({ id: 'pty-1', incarnationId: 'inc-1' }))
      } as unknown as IPtyProvider
      // Site #16 reads back this exact closure.
      ctx.reportPtySpawnCommitted = () => durable

      let settled = false
      const execution = executeRuntimePtySpawn(ctx).then(() => {
        settled = true
      })
      // Why setImmediate, not a fixed count of microtask ticks: the mocked
      // agentSessionOwners.ensure/reconcile chain has several real await
      // hops unrelated to the bug under test; a macrotask boundary drains
      // all of them deterministically instead of guessing a tick count.
      await new Promise((resolve) => setImmediate(resolve))

      // FROZEN CONTRACT (§4.5.1 site #16): executeRuntimePtySpawn's own
      // returned Promise does not resolve before the durable commit does --
      // GREEN, via `await ctx.reportPtySpawnCommitted()` at spawn-execute.ts:88.
      expect(settled).toBe(false)

      resolveDurable()
      await execution
      expect(settled).toBe(true)
    }
  )

  it(
    'GREEN (gate 59/61, sites #17/#19): non-agentSessionEnsure branch awaits onFreshSpawn ' +
      'before spawnForStablePane/executeRuntimePtySpawn resolves',
    async () => {
      let resolveDurable!: () => void
      const durable = new Promise<void>((resolve) => {
        resolveDurable = resolve
      })

      const ctx = makeCtx({})
      ctx.provider = {
        spawn: vi.fn(async (): Promise<PtySpawnResult> => ({ id: 'pty-2', incarnationId: 'inc-2' }))
      } as unknown as IPtyProvider
      // Site #17 forwards this exact reference into spawnForStablePane's
      // onFreshSpawn; site #19 (stable-owner.ts:302) reads it back.
      ctx.reportPtySpawnCommitted = () => durable

      let settled = false
      const execution = executeRuntimePtySpawn(ctx).then(() => {
        settled = true
      })
      await new Promise((resolve) => setImmediate(resolve))

      // FROZEN CONTRACT (§4.5.1 sites #17/#19): GREEN -- `await args.onFreshSpawn?.(result)`
      // at stable-owner.ts:302.
      expect(settled).toBe(false)

      resolveDurable()
      await execution
      expect(settled).toBe(true)
    }
  )

  it(
    'GREEN (gate 48/62): a rejection from the durable commit stops the ' +
      'agentSessionEnsure spawn flow from reporting success',
    async () => {
      const rejectionError = new Error('durable_commit_failed')
      let capturedPromise: Promise<void> | undefined

      findMock.mockReturnValue(undefined)
      ensureMock.mockImplementation(async (opts: { spawn: () => Promise<{ ptyId: string }> }) => {
        const spawned = await opts.spawn()
        return { owner: { ptyId: spawned.ptyId }, disposition: 'fresh' }
      })

      const ctx = makeCtx({
        agentSessionEnsure: { claim: { kind: 'terminal' }, surface: {} } as never
      })
      ctx.provider = {
        spawn: vi.fn(async (): Promise<PtySpawnResult> => ({ id: 'pty-3', incarnationId: 'inc-3' }))
      } as unknown as IPtyProvider
      ctx.reportPtySpawnCommitted = () => {
        capturedPromise = Promise.reject(rejectionError)
        return capturedPromise
      }

      let thrown: unknown
      try {
        await executeRuntimePtySpawn(ctx)
      } catch (error) {
        thrown = error
      }
      await capturedPromise?.catch(() => {})

      // FROZEN CONTRACT (Area M/§5.8): GREEN -- a rejected durable commit
      // prevents the spawn flow from reporting success; the rejection
      // reaches executeRuntimePtySpawn's own caller.
      expect(thrown).toBe(rejectionError)
    }
  )
})
