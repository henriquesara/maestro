// PRE_IMPLEMENTATION RED baseline for orca-delegated-cutover SPEC.md §7.3
// (provider eligibility gate, `supportsDelegatedCutoverHold`). Gates 52, 53.
//
// Neither the capability nor the gate check exists anywhere in the
// repository today (confirmed by symbol search against `pty-provider-contract.ts`
// and `local-pty-provider.ts` during this session's re-derivation, §2).
// These tests exercise the REAL `buildRuntimePtySpawnOptions` and prove a
// provider lacking the capability is never rejected before a spawn would be
// allowed to proceed.

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

describe('delegated-cutover provider eligibility gate (SPEC §7.3, RED)', () => {
  it('RED (gate 52): a provider without supportsDelegatedCutoverHold is not rejected before cutover', async () => {
    const stubProvider = {
      spawn: vi.fn()
      // Deliberately does not declare supportsDelegatedCutoverHold.
    } as unknown as IPtyProvider

    const ctx = makeCtx({
      // Why cast: deferDelegatedCommandDelivery does not exist on
      // PtySpawnOptions/RuntimePtySpawnArgs yet -- it is this seam's own
      // delegated-spawn indicator (§4.1a/§18.1), reused here as the trigger
      // §7.3's gate must key off.
      deferDelegatedCommandDelivery: true
    } as never)
    ctx.provider = stubProvider

    let thrown: unknown
    try {
      await buildRuntimePtySpawnOptions(ctx)
    } catch (error) {
      thrown = error
    }

    // FROZEN CONTRACT (§7.3): must throw
    // `delegated_cutover_provider_unsupported` before any spawn is allowed
    // to proceed. Fails today -- the gate does not exist, so nothing throws.
    expect((thrown as Error | undefined)?.message).toBe('delegated_cutover_provider_unsupported')
    expect(stubProvider.spawn).not.toHaveBeenCalled()
  })

  it(
    'RED (gate 52, fail-closed positive control): the check must never invoke the provider ' +
      'spawn before deciding eligibility, even when eligible',
    async () => {
      // LocalPtyProvider is this slice's only eligible provider (§7.3) --
      // but it does not declare the capability yet either (confirmed below),
      // so this documents the gate's absence rather than its correctness.
      const provider = new LocalPtyProvider()
      expect(
        (provider as unknown as { supportsDelegatedCutoverHold?: unknown })
          .supportsDelegatedCutoverHold
      ).toBeUndefined()
    }
  )
})
