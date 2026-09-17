// ORCA-S5 Delegated Cutover Core — mission §35 (aiControl port, test fake
// only). Not RED against production code: this file validates that
// `FakeAiControlFenceClient` (cutover-core-test-harness.ts) faithfully
// reproduces the outcome enums and CAS dispositions of the REAL
// `orca-fence.ts` (aiControlCenter `origin/master`,
// ab5967bdde5115afe6673e8b520a73cfb29f0eaf, read this session via `git show`
// against the tracked file only, never the local working-tree checkout,
// which is behind). It is a positive control over the FIXTURE itself, not a
// claim about production code -- every RED test above depends on this fake
// behaving correctly, so its own contract is asserted here once, directly.
// No network adapter, no real Maestro-to-aiControl HTTP call (mission §35:
// "Do not implement network adapter").

import { describe, expect, it } from 'vitest'
import { FakeAiControlFenceClient } from './cutover-core-test-harness'

describe('ORCA-S5 Delegated Cutover Core -- fake aiControl fence client contract (§35)', () => {
  it('ACQUIRED then a same-token re-acquire is ALREADY_FENCED_SAME_TOKEN (real orca-fence.ts case A/B)', async () => {
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible('run_1')
    const first = await fence.acquireOrcaFence({ runId: 'run_1', token: 'tok_1' })
    const second = await fence.acquireOrcaFence({ runId: 'run_1', token: 'tok_1' })
    expect(first.outcome).toBe('ACQUIRED')
    expect(second.outcome).toBe('ALREADY_FENCED_SAME_TOKEN')
  })

  it('a different token on an already-fenced run is CONFLICT_DIFFERENT_TOKEN (real case C)', async () => {
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible('run_2')
    await fence.acquireOrcaFence({ runId: 'run_2', token: 'tok_a' })
    const conflict = await fence.acquireOrcaFence({ runId: 'run_2', token: 'tok_b' })
    expect(conflict.outcome).toBe('CONFLICT_DIFFERENT_TOKEN')
  })

  it('an ineligible run is NOT_ELIGIBLE (real case E)', async () => {
    const fence = new FakeAiControlFenceClient()
    fence.seedIneligible('run_3')
    const result = await fence.acquireOrcaFence({ runId: 'run_3', token: 'tok_c' })
    expect(result.outcome).toBe('NOT_ELIGIBLE')
  })

  it('acquisition disabled short-circuits before eligibility (real §12 gate, safe default)', async () => {
    const fence = new FakeAiControlFenceClient()
    fence.acquisitionEnabled = false
    fence.seedEligible('run_4')
    const result = await fence.acquireOrcaFence({ runId: 'run_4', token: 'tok_d' })
    expect(result.outcome).toBe('ACQUISITION_DISABLED')
  })

  it('safeReleaseOrcaFence requires positive evidence -- rejects without it (real §6.1)', async () => {
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible('run_5')
    await fence.acquireOrcaFence({ runId: 'run_5', token: 'tok_e' })
    const rejected = await fence.safeReleaseOrcaFence({
      runId: 'run_5',
      token: 'tok_e',
      positiveNoCutoverEvidence: false
    })
    expect(rejected.outcome).toBe('REJECTED_NO_EVIDENCE')
    const released = await fence.safeReleaseOrcaFence({
      runId: 'run_5',
      token: 'tok_e',
      positiveNoCutoverEvidence: true
    })
    expect(released.outcome).toBe('RELEASED')
  })

  it('a stale release (wrong/expired token, or already cleared) is REJECTED_STALE, never a false success', async () => {
    const fence = new FakeAiControlFenceClient()
    const stale = await fence.safeReleaseOrcaFence({
      runId: 'run_never_fenced',
      token: 'tok_f',
      positiveNoCutoverEvidence: true
    })
    expect(stale.outcome).toBe('REJECTED_STALE')
  })

  it('acknowledgeOrcaCutover is idempotent for a repeat same-token ack, and rejects a wrong token', async () => {
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible('run_6')
    await fence.acquireOrcaFence({ runId: 'run_6', token: 'tok_g' })
    const first = await fence.acknowledgeOrcaCutover({ runId: 'run_6', token: 'tok_g' })
    const second = await fence.acknowledgeOrcaCutover({ runId: 'run_6', token: 'tok_g' })
    expect(first.outcome).toBe('ACKNOWLEDGED')
    expect(second.outcome).toBe('ACKNOWLEDGED')

    const fence2 = new FakeAiControlFenceClient()
    fence2.seedEligible('run_7')
    await fence2.acquireOrcaFence({ runId: 'run_7', token: 'tok_h' })
    const wrong = await fence2.acknowledgeOrcaCutover({ runId: 'run_7', token: 'WRONG' })
    expect(wrong.outcome).toBe('REJECTED_WRONG_TOKEN')
  })
})
