// GREEN evidence for orca-delegated-cutover SPEC.md §4.5.1 sites #10/#11
// (`spawn-options.ts`'s inline guard, "guard layer 2") and §4.5.2's
// async-aware fire-once contract. Gates 44, 45, 46, 47, 48, 61.
//
// History: started RED (commit 0a1bf4c265) -- the inline guard was
// `(): void => { ...; args.onPtySpawnCommitted?.() }`: fire-once, but not
// async-aware. The GREEN implementation session replaced it with the same
// shared `createAsyncSpawnCommitReporter` guard layer 1 uses
// (src/shared/async-spawn-commit-reporter.ts).
//
// Exercises the REAL `buildRuntimePtySpawnOptions` (the exact function
// production calls) against a minimal `RuntimePtySpawnState`.

import { describe, expect, it, vi } from 'vitest'
import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import { buildRuntimePtySpawnOptions } from './spawn-options'
import { createRuntimePtySpawnState, type RuntimePtySpawnArgs } from './spawn-state'
import type { PtyRuntimeControllerDeps } from './controller-deps'

function makeCtx(onPtySpawnCommitted: () => unknown) {
  const deps = {
    getSettings: () => undefined,
    trustedTerminalHandleEnv: new Set<string>()
  } as unknown as PtyRuntimeControllerDeps
  const args = {
    cols: 80,
    rows: 24,
    onPtySpawnCommitted:
      onPtySpawnCommitted as unknown as RuntimePtySpawnArgs['onPtySpawnCommitted']
  } as unknown as RuntimePtySpawnArgs
  const ctx = createRuntimePtySpawnState(deps, args)
  ctx.provider = new LocalPtyProvider()
  return ctx
}

describe('buildRuntimePtySpawnOptions commit guard (SPEC §4.5.1 sites #10/#11, GREEN)', () => {
  it('GREEN (gate 44): ctx.reportPtySpawnCommitted returns a Promise, not bare void', async () => {
    let settled = false
    const ctx = makeCtx(() => {
      return Promise.resolve().then(() => {
        settled = true
      })
    })

    await buildRuntimePtySpawnOptions(ctx)
    const returned = ctx.reportPtySpawnCommitted()

    // FROZEN CONTRACT (§4.5.1 site #10): GREEN -- returns
    // Promise<DelegationCutoverCommitResult | void>.
    expect(returned).toBeInstanceOf(Promise)
    await (returned as unknown as Promise<unknown>)
    expect(settled).toBe(true)
  })

  it('GREEN (gate 46): duplicate invocation while in-flight returns the SAME in-flight Promise', async () => {
    let resolveUnderlying!: () => void
    const underlying = new Promise<void>((resolve) => {
      resolveUnderlying = resolve
    })
    const ctx = makeCtx(() => underlying)

    await buildRuntimePtySpawnOptions(ctx)
    const first = ctx.reportPtySpawnCommitted()
    const second = ctx.reportPtySpawnCommitted()

    // FROZEN CONTRACT (§4.5.2): GREEN -- both calls return the same object.
    expect(first).toBeInstanceOf(Promise)
    expect(first).toBe(second)

    resolveUnderlying()
    await underlying
  })

  it('GREEN (gate 11): threads the SAME async-capable guard into ctx.spawnOptions.onPtySpawnCommitted', async () => {
    const ctx = makeCtx(() => Promise.resolve())

    await buildRuntimePtySpawnOptions(ctx)

    // Site #11's own wiring threads ctx.reportPtySpawnCommitted through
    // unconditionally (real and correct since before this seam's RED
    // baseline) -- GREEN adds that the threaded closure is now awaitable.
    expect(ctx.spawnOptions.onPtySpawnCommitted).toBe(ctx.reportPtySpawnCommitted)
    const threadedResult = ctx.spawnOptions.onPtySpawnCommitted?.()
    expect(threadedResult).toBeInstanceOf(Promise)
  })

  it('GREEN (gate 48/61): a rejection from the real callback rejects the guard, is never discarded', async () => {
    const rejectionError = new Error('durable_commit_failed')
    let capturedPromise: Promise<void> | undefined
    const ctx = makeCtx(() => {
      capturedPromise = Promise.reject(rejectionError)
      return capturedPromise
    })

    await buildRuntimePtySpawnOptions(ctx)
    const returned = ctx.reportPtySpawnCommitted()
    await capturedPromise?.catch(() => {})

    // FROZEN CONTRACT: GREEN -- `returned` rejects with this exact error.
    expect(returned).toBeInstanceOf(Promise)
    await expect(returned as unknown as Promise<unknown>).rejects.toBe(rejectionError)
  })

  it('invariant preserved: the underlying callback still fires exactly once across duplicates', async () => {
    const callback = vi.fn()
    const ctx = makeCtx(callback)

    await buildRuntimePtySpawnOptions(ctx)
    ctx.reportPtySpawnCommitted()
    ctx.reportPtySpawnCommitted()
    ctx.reportPtySpawnCommitted()

    expect(callback).toHaveBeenCalledTimes(1)
  })
})
