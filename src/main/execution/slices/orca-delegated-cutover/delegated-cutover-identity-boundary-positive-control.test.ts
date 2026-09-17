// ORCA-S5 Delegated Cutover Core — mission §17 positive control.
// Not new RED. Confirms the invariant the coordinator's identity transport
// (SPEC §4.8.3) depends on: `RuntimeCreateAgentSessionRequest` carries the
// additive, optional `delegatedCutover` field (added this GREEN session,
// per §10), absent for every existing non-delegated caller by default, and
// `buildRuntimePtySpawnOptions`'s REAL output still carries no
// aiControl/fence-shaped key regardless. Kept in its own file (not the
// coordinator test file) so it can independently PASS and stay a live
// regression guard against the field ever leaking into the provider layer.
//
// GREEN update (documented per mission §3): the RED version of this file's
// first assertion checked a minimal request object omits `delegatedCutover`
// -- still true post-GREEN (the field is optional; omitting it is exactly
// the non-delegated shape), so it is kept, and a second assertion is added
// proving the type now genuinely accepts the field for a delegated request.

import { describe, expect, it } from 'vitest'
import type { RuntimeCreateAgentSessionRequest } from '../../../../shared/agent-session-host-authority'
import { buildRuntimePtySpawnOptions } from '../../../ipc/pty/runtime/spawn-options'
import {
  createRuntimePtySpawnState,
  type RuntimePtySpawnArgs
} from '../../../ipc/pty/runtime/spawn-state'
import type { PtyRuntimeControllerDeps } from '../../../ipc/pty/runtime/controller-deps'

describe('ORCA-S5 Delegated Cutover Core -- identity/provider-contract boundary (§17, positive control)', () => {
  it('a non-delegated RuntimeCreateAgentSessionRequest carries no delegatedCutover key', () => {
    const request: RuntimeCreateAgentSessionRequest = {
      clientOperationId: 'op_1',
      worktree: '/tmp/w',
      agent: 'claude' as never
    }
    expect('delegatedCutover' in request).toBe(false)
  })

  it('RuntimeCreateAgentSessionRequest now genuinely accepts the additive delegatedCutover field', () => {
    const request: RuntimeCreateAgentSessionRequest = {
      clientOperationId: 'op_2',
      worktree: '/tmp/w',
      agent: 'claude' as never,
      delegatedCutover: { aicontrolRunId: 'aicontrol_run_1', fenceToken: 'token_1' }
    }
    expect(request.delegatedCutover).toEqual({
      aicontrolRunId: 'aicontrol_run_1',
      fenceToken: 'token_1'
    })
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
