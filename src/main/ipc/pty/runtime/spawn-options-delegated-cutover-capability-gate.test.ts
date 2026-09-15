// GREEN evidence for orca-delegated-cutover SPEC.md §7.3 (provider
// eligibility gate, `supportsDelegatedCutoverHold`). Gates 52, 53.
//
// History: started RED (commit c75a76bd651) -- neither the capability nor
// the gate check existed. The GREEN implementation session added
// `IPtyProvider.supportsDelegatedCutoverHold`, `LocalPtyProvider`'s own
// `true` declaration, and the fail-closed check in
// `buildRuntimePtySpawnOptions`. These tests now exercise the REAL
// production code and assert the frozen contract holds (see
// PREIMPLEMENTATION-GREEN-EVIDENCE.md).

import { describe, expect, it, vi } from 'vitest'
import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import { buildRuntimePtySpawnOptions } from './spawn-options'
import { createRuntimePtySpawnState, type RuntimePtySpawnArgs } from './spawn-state'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import type { IPtyProvider } from '../../../providers/types'

function makeCtx(args: Partial<RuntimePtySpawnArgs>) {
  const deps = {
    getSettings: () => undefined,
    trustedTerminalHandleEnv: new Set<string>()
  } as unknown as PtyRuntimeControllerDeps
  const fullArgs = { cols: 80, rows: 24, ...args } as unknown as RuntimePtySpawnArgs
  return createRuntimePtySpawnState(deps, fullArgs)
}

describe('delegated-cutover provider eligibility gate (SPEC §7.3, GREEN)', () => {
  it('GREEN (gate 52): a provider without supportsDelegatedCutoverHold is rejected before cutover', async () => {
    const stubProvider = {
      spawn: vi.fn()
      // Deliberately does not declare supportsDelegatedCutoverHold.
    } as unknown as IPtyProvider

    const ctx = makeCtx({ deferDelegatedCommandDelivery: true } as never)
    ctx.provider = stubProvider

    let thrown: unknown
    try {
      await buildRuntimePtySpawnOptions(ctx)
    } catch (error) {
      thrown = error
    }

    // FROZEN CONTRACT (§7.3): throws `delegated_cutover_provider_unsupported`
    // before any spawn is allowed to proceed -- no fence acquired, no
    // process prepared.
    expect((thrown as Error | undefined)?.message).toBe('delegated_cutover_provider_unsupported')
    expect(stubProvider.spawn).not.toHaveBeenCalled()
  })

  it('GREEN (gate 52): a provider declaring supportsDelegatedCutoverHold === true is not rejected', async () => {
    const stubProvider = {
      spawn: vi.fn(),
      supportsDelegatedCutoverHold: () => true
    } as unknown as IPtyProvider

    const ctx = makeCtx({ deferDelegatedCommandDelivery: true } as never)
    ctx.provider = stubProvider

    await expect(buildRuntimePtySpawnOptions(ctx)).resolves.not.toThrow()
  })

  it('GREEN (gate 52): a provider explicitly declaring the capability false is rejected, same as absent', async () => {
    const stubProvider = {
      spawn: vi.fn(),
      supportsDelegatedCutoverHold: () => false
    } as unknown as IPtyProvider

    const ctx = makeCtx({ deferDelegatedCommandDelivery: true } as never)
    ctx.provider = stubProvider

    let thrown: unknown
    try {
      await buildRuntimePtySpawnOptions(ctx)
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error | undefined)?.message).toBe('delegated_cutover_provider_unsupported')
  })

  it('GREEN: a non-delegated spawn (deferDelegatedCommandDelivery unset) never consults the capability at all', async () => {
    const supportsDelegatedCutoverHold = vi.fn(() => false)
    const stubProvider = { spawn: vi.fn(), supportsDelegatedCutoverHold } as unknown as IPtyProvider

    const ctx = makeCtx({})
    ctx.provider = stubProvider

    await expect(buildRuntimePtySpawnOptions(ctx)).resolves.not.toThrow()
    expect(supportsDelegatedCutoverHold).not.toHaveBeenCalled()
  })

  it(
    "GREEN (gate 52, real provider): LocalPtyProvider -- this slice's only eligible provider -- " +
      'declares the capability true, and a delegated spawn against it is never rejected',
    async () => {
      const provider = new LocalPtyProvider()
      expect(
        (
          provider as unknown as { supportsDelegatedCutoverHold: () => boolean }
        ).supportsDelegatedCutoverHold()
      ).toBe(true)

      const ctx = makeCtx({ deferDelegatedCommandDelivery: true } as never)
      ctx.provider = provider

      await expect(buildRuntimePtySpawnOptions(ctx)).resolves.not.toThrow()
    }
  )
})
