import { describe, expect, it } from 'vitest'
import { deriveDelegatedTerminalStatus } from './delegated-terminal-status'

// ORCA-S5 SPEC §9.2 — the fixed, reviewable classification map. Pure: durable facts in, one of
// completed / failed / cancelled / timeout / null out. Never guessed, never defaulted to `failed`.

describe('deriveDelegatedTerminalStatus (SPEC §9.2)', () => {
  it.each([
    { name: 'exit code 0', exitCode: 0, expected: 'completed' },
    { name: 'non-zero exit code', exitCode: 1, expected: 'failed' },
    { name: 'exit code 255', exitCode: 255, expected: 'failed' },
    { name: 'killed by a signal (no exit code)', exitCode: null, expected: 'failed' }
  ])(
    'self_exit / $name -> $expected, regardless of any teardown reason',
    ({ exitCode, expected }) => {
      for (const teardownReason of [null, undefined, 'user_cancel', 'timeout'] as const) {
        expect(
          deriveDelegatedTerminalStatus({
            terminationMethod: 'self_exit',
            exitCode,
            teardownReason
          })
        ).toBe(expected)
      }
    }
  )

  it('signalled maps the durable reason through a fixed two-entry table', () => {
    expect(
      deriveDelegatedTerminalStatus({
        terminationMethod: 'signalled',
        exitCode: null,
        teardownReason: 'user_cancel'
      })
    ).toBe('cancelled')
    expect(
      deriveDelegatedTerminalStatus({
        terminationMethod: 'signalled',
        exitCode: null,
        teardownReason: 'timeout'
      })
    ).toBe('timeout')
  })

  it('cancelled and timeout are distinct outcomes of the same termination mechanism', () => {
    const base = { terminationMethod: 'signalled', exitCode: null } as const
    expect(deriveDelegatedTerminalStatus({ ...base, teardownReason: 'user_cancel' })).not.toBe(
      deriveDelegatedTerminalStatus({ ...base, teardownReason: 'timeout' })
    )
  })

  it.each([
    { name: 'confirmed_dead_unknown_cause', method: 'confirmed_dead_unknown_cause', reason: null },
    {
      name: 'confirmed_dead_unknown_cause even with a stray reason',
      method: 'confirmed_dead_unknown_cause',
      reason: 'timeout'
    },
    {
      name: 'signalled with NO durable reason (cannot classify)',
      method: 'signalled',
      reason: null
    },
    { name: 'signalled with an unknown reason value', method: 'signalled', reason: 'operator_whim' }
  ] as const)('$name -> null (honest under-determination, never guessed)', ({ method, reason }) => {
    expect(
      deriveDelegatedTerminalStatus({
        terminationMethod: method,
        exitCode: null,
        teardownReason: reason as never
      })
    ).toBeNull()
  })
})
