// PRE_IMPLEMENTATION RED baseline for orca-delegated-cutover SPEC.md §4.5.1
// sites #10/#11 (`spawn-options.ts`'s inline guard, "guard layer 2") and
// §4.5.2's async-aware fire-once contract. Gates 44, 45, 46, 47, 48, 61.
//
// Exercises the REAL `buildRuntimePtySpawnOptions` (the exact function
// production calls) against a minimal `RuntimePtySpawnState`, and proves
// `ctx.reportPtySpawnCommitted` -- the closure sites #12/#16/#17 all read
// back -- is still `(): void => { ...; args.onPtySpawnCommitted?.() }`
// today: fire-once, but not async-aware.

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
    // Why cast: onPtySpawnCommitted is typed `() => void` today -- the exact
    // narrowness this RED baseline exists to prove.
    onPtySpawnCommitted: onPtySpawnCommitted as unknown as () => void
  } as unknown as RuntimePtySpawnArgs
  const ctx = createRuntimePtySpawnState(deps, args)
  ctx.provider = new LocalPtyProvider()
  return ctx
}

describe('buildRuntimePtySpawnOptions commit guard (SPEC §4.5.1 sites #10/#11, RED)', () => {
  it('RED (gate 44): ctx.reportPtySpawnCommitted must return a Promise, not void', async () => {
    let settled = false
    const ctx = makeCtx(() => {
      return Promise.resolve().then(() => {
        settled = true
      })
    })

    await buildRuntimePtySpawnOptions(ctx)
    const returned = ctx.reportPtySpawnCommitted()

    // FROZEN CONTRACT (§4.5.1 site #10): must return
    // Promise<DelegationCutoverCommitResult | void>. Fails today.
    expect(returned).toBeInstanceOf(Promise)
    await (returned as unknown as Promise<unknown>)
    expect(settled).toBe(true)
  })

  it('RED (gate 46): duplicate invocation while in-flight must return the SAME in-flight Promise', async () => {
    let resolveUnderlying!: () => void
    const underlying = new Promise<void>((resolve) => {
      resolveUnderlying = resolve
    })
    const ctx = makeCtx(() => underlying)

    await buildRuntimePtySpawnOptions(ctx)
    const first = ctx.reportPtySpawnCommitted()
    const second = ctx.reportPtySpawnCommitted()

    // FROZEN CONTRACT (§4.5.2): fails today -- both calls return `undefined`.
    expect(first).toBeInstanceOf(Promise)
    expect(first).toBe(second)

    resolveUnderlying()
    await underlying
  })

  it('RED (gate 11): threads the SAME async-capable guard into ctx.spawnOptions.onPtySpawnCommitted', async () => {
    const ctx = makeCtx(() => Promise.resolve())

    await buildRuntimePtySpawnOptions(ctx)

    // Site #11's own wiring already threads ctx.reportPtySpawnCommitted through
    // unconditionally (this part is real and correct today) -- the RED is
    // that the threaded closure is still void-returning.
    expect(ctx.spawnOptions.onPtySpawnCommitted).toBe(ctx.reportPtySpawnCommitted)
    const threadedResult = ctx.spawnOptions.onPtySpawnCommitted?.()
    // FROZEN CONTRACT: the threaded closure local-pty-spawn.ts:89 calls must
    // itself be awaitable. Fails today.
    expect(threadedResult).toBeInstanceOf(Promise)
  })

  it('RED (gate 48/61): a rejection from the real callback must reject the guard, not be discarded', async () => {
    const rejectionError = new Error('durable_commit_failed')
    let capturedPromise: Promise<void> | undefined
    const ctx = makeCtx(() => {
      capturedPromise = Promise.reject(rejectionError)
      return capturedPromise
    })

    await buildRuntimePtySpawnOptions(ctx)
    const returned = ctx.reportPtySpawnCommitted()
    await capturedPromise?.catch(() => {})

    // FROZEN CONTRACT: fails today -- `returned` is `undefined`.
    expect(returned).toBeInstanceOf(Promise)
    await expect(returned as unknown as Promise<unknown>).rejects.toBe(rejectionError)
  })

  it('invariant preserved (not RED): the underlying callback still fires exactly once across duplicates', async () => {
    const callback = vi.fn()
    const ctx = makeCtx(callback)

    await buildRuntimePtySpawnOptions(ctx)
    ctx.reportPtySpawnCommitted()
    ctx.reportPtySpawnCommitted()
    ctx.reportPtySpawnCommitted()

    expect(callback).toHaveBeenCalledTimes(1)
  })
})
