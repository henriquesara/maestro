// ORCA-S5 Delegated Cutover Core — mission §17 positive control.
// Not new RED. Confirms the invariant the future coordinator's identity
// transport (SPEC §4.8.3) depends on: today, BEFORE any implementation,
// `RuntimeCreateAgentSessionRequest` carries no aiControl/fence field, and
// `buildRuntimePtySpawnOptions`'s REAL output carries none either. Kept in
// its own file (not the coordinator RED file) so it can independently PASS
// and stay a live regression guard: after GREEN adds `delegatedCutover` to
// the REQUEST type only, this file must keep passing unmodified except for
// the first assertion's expected value.

import { describe, expect, it } from 'vitest'
import type { RuntimeCreateAgentSessionRequest } from '../../../../shared/agent-session-host-authority'
import { buildRuntimePtySpawnOptions } from '../../../ipc/pty/runtime/spawn-options'
import {
  createRuntimePtySpawnState,
  type RuntimePtySpawnArgs
} from '../../../ipc/pty/runtime/spawn-state'
import type { PtyRuntimeControllerDeps } from '../../../ipc/pty/runtime/controller-deps'

describe('ORCA-S5 Delegated Cutover Core -- identity/provider-contract boundary (§17, positive control)', () => {
  it('RuntimeCreateAgentSessionRequest today has no delegatedCutover field (pre-GREEN baseline)', () => {
    const request: RuntimeCreateAgentSessionRequest = {
      clientOperationId: 'op_1',
      worktree: '/tmp/w',
      agent: 'claude' as never
    }
    expect('delegatedCutover' in request).toBe(false)
  })

  it('the real buildRuntimePtySpawnOptions output never carries an aiControl/fence-shaped key', async () => {
    const deps = {
      getSettings: () => undefined,
      trustedTerminalHandleEnv: new Set<string>()
    } as unknown as PtyRuntimeControllerDeps
    const args = { cols: 80, rows: 24 } as unknown as RuntimePtySpawnArgs
    const ctx = createRuntimePtySpawnState(deps, args)
    ctx.provider = { spawn: () => undefined, supportsDelegatedCutoverHold: () => true } as never

    await buildRuntimePtySpawnOptions(ctx)

    const forbidden = [
      'aicontrolRunId',
      'fenceToken',
      'delegatedCutover',
      'orcaFence',
      'aicontrolRunRef'
    ]
    const actualKeys = Object.keys(ctx.spawnOptions)
    for (const f of forbidden) {
      expect(actualKeys).not.toContain(f)
    }
  })
})
