// GREEN evidence for orca-delegated-cutover SPEC.md §4.1a
// (`DELEGATED_DEFERRED_COMMAND_DELIVERY`) and gates 41, 42, 49, 55.
//
// History: started RED (commit 0a1bf4c265) -- `deferDelegatedCommandDelivery`
// did not exist and had zero effect on argv. The GREEN implementation
// session threaded it through `PtySpawnOptions` and
// `createWindowsLocalPtyLaunchPlan` (local-pty-launch-plan.ts), forcing the
// codebase's own existing "command not embeddable" branch unconditionally.
//
// This file proves, against the REAL `LocalPtyProvider.spawn()` path (only
// `node-pty`, `fs`, `electron`, and the PowerShell-executable resolver are
// mocked -- the argv-construction logic itself, `createLocalPtyLaunchPlan` /
// `createWindowsLocalPtyLaunchPlan` / `resolveWindowsShellLaunchArgs`, is
// real and unmocked), that:
//
//   1. `deferDelegatedCommandDelivery: true` now keeps the delegated
//      agent's startup command out of the spawned process's argv, for both
//      the real default Windows PowerShell path and the cmd.exe path
//      (GREEN for gate 41/42/55).
//   2. `startupCommandDeliveredInShellArgs` is therefore false/absent for a
//      delegated spawn (GREEN for gate 42).
//   3. Ordinary (non-delegated) spawns keep embedding a short startup
//      command in argv exactly as before -- unaffected, purely additive
//      (positive control for Area B).
//
// Mirrors the mocking discipline of `local-pty-provider-windows-shell-launch.test.ts`
// (the file the frozen SPEC itself cites for the real default Windows path).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MacosTccLoginShell from './macos-tcc-login-shell'
import type { PtySpawnOptions } from './types'

const {
  existsSyncMock,
  statSyncMock,
  accessSyncMock,
  mkdirSyncMock,
  writeFileSyncMock,
  spawnMock,
  prepareMacosTccLoginShellMock,
  resolveAgentForegroundProcessMock,
  readWindowsPtyJobProcessIdsMock,
  killWithDescendantSweepMock,
  isWslAvailableAsyncMock,
  wslUncDirectoryExistsMock,
  createShellPromptReadinessProbeMock
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  accessSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  spawnMock: vi.fn(),
  prepareMacosTccLoginShellMock: vi.fn(),
  resolveAgentForegroundProcessMock: vi.fn(),
  readWindowsPtyJobProcessIdsMock: vi.fn(),
  killWithDescendantSweepMock: vi.fn(),
  isWslAvailableAsyncMock: vi.fn(),
  wslUncDirectoryExistsMock: vi.fn(),
  createShellPromptReadinessProbeMock: vi.fn()
}))

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
  accessSync: accessSyncMock,
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  constants: { X_OK: 1 }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/orca-user-data')
  }
}))

vi.mock('node-pty', () => ({
  spawn: spawnMock
}))

vi.mock('./macos-tcc-login-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof MacosTccLoginShell>()),
  prepareMacosTccLoginShell: prepareMacosTccLoginShellMock
}))

vi.mock('../pty-descendant-termination', () => ({
  killWithDescendantSweep: killWithDescendantSweepMock
}))

const WINDOWS_POWERSHELL_ABS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const PWSH7_ABS = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
const CMD_ABS = 'C:\\Windows\\System32\\cmd.exe'
vi.mock('./windows-powershell-executable', () => ({
  resolveWindowsPowerShellExecutablePath: (family: 'pwsh.exe' | 'powershell.exe') =>
    family === 'pwsh.exe' ? PWSH7_ABS : WINDOWS_POWERSHELL_ABS,
  resolveWindowsPowerShellSpawnChain: (family: 'pwsh.exe' | 'powershell.exe') =>
    family === 'pwsh.exe'
      ? [PWSH7_ABS, WINDOWS_POWERSHELL_ABS, CMD_ABS]
      : [WINDOWS_POWERSHELL_ABS, CMD_ABS],
  getWindowsCmdPath: () => CMD_ABS
}))

vi.mock('./agent-foreground-process', () => ({
  resolveAgentForegroundProcessWithAvailability: (...args: unknown[]) =>
    resolveAgentForegroundProcessMock(...args)
}))

vi.mock('./windows-pty-job-membership', () => ({
  readWindowsPtyJobProcessIds: (...args: unknown[]) => readWindowsPtyJobProcessIdsMock(...args),
  isWindowsPtyJobReadable: () => true
}))

vi.mock('../wsl', () => ({
  parseWslPath: () => null,
  toLinuxPath: (path: string) => path.replace(/^C:\\/i, '/mnt/c/').replace(/\\/g, '/'),
  toWindowsWslPath: (path: string, distro: string) =>
    `\\\\wsl.localhost\\${distro}${path.replace(/\//g, '\\')}`,
  getDefaultWslDistro: () => 'Ubuntu',
  isWslAvailableAsync: () => isWslAvailableAsyncMock(),
  wslUncDirectoryExists: (...args: unknown[]) => wslUncDirectoryExistsMock(...args)
}))

vi.mock('../shell-prompt-readiness-probe', () => ({
  createShellPromptReadinessProbe: createShellPromptReadinessProbeMock
}))

import { LocalPtyProvider } from './local-pty-provider'
import {
  applyLocalPtyProviderMockDefaults,
  createLocalPtyMockProcess,
  installLocalPtyProviderEnvSandbox,
  type LocalPtyMockProcess
} from './local-pty-provider-test-harness'

const DELEGATED_MARKER = 'orca-delegated-agent-invoke --claim-token=__SPEC_4_1A_RED_MARKER__'

describe('LocalPtyProvider: delegated command delivery (SPEC §4.1a, gates 41/42/49/55, GREEN)', () => {
  let provider: LocalPtyProvider
  let mockProc: LocalPtyMockProcess
  let exitCb: ((info: { exitCode: number }) => void) | undefined

  installLocalPtyProviderEnvSandbox()

  beforeEach(() => {
    applyLocalPtyProviderMockDefaults({
      existsSyncMock,
      statSyncMock,
      accessSyncMock,
      mkdirSyncMock,
      writeFileSyncMock,
      prepareMacosTccLoginShellMock,
      resolveAgentForegroundProcessMock,
      readWindowsPtyJobProcessIdsMock,
      killWithDescendantSweepMock,
      isWslAvailableAsyncMock,
      wslUncDirectoryExistsMock,
      createShellPromptReadinessProbeMock
    })

    exitCb = undefined
    mockProc = createLocalPtyMockProcess({
      get: () => exitCb,
      set: (cb) => {
        exitCb = cb
      }
    })
    spawnMock.mockReturnValue(mockProc)

    provider = new LocalPtyProvider()
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  })

  function spawnWithDeferredDelivery(overrides: Record<string, unknown> = {}) {
    const args = {
      cols: 80,
      rows: 24,
      cwd: 'C:\\Users\\jin\\repo',
      command: DELEGATED_MARKER,
      deferDelegatedCommandDelivery: true,
      // Blocker-2 fix (construction-safety pairing invariant, below) now
      // requires a real callback whenever the defer flag is set; a
      // harmless resolved one keeps these argv-suppression tests focused
      // on argv, not on the pairing invariant itself.
      onPtySpawnCommitted: async () => {},
      ...overrides
    } as unknown as PtySpawnOptions
    return provider.spawn(args)
  }

  it(
    'GREEN (gate 41/55): real default Windows PowerShell path keeps the delegated ' +
      'command out of argv when deferDelegatedCommandDelivery is set',
    async () => {
      // Why: mirrors the settings layer's own real default (PowerShell), not
      // this dev machine's COMSPEC -- same convention as the existing
      // windows-shell-launch suite's own PowerShell-path tests.
      provider.configure({
        getWindowsShell: () => 'powershell.exe',
        getWindowsPowerShellImplementation: () => 'powershell.exe'
      })
      await spawnWithDeferredDelivery()

      const spawnCall = spawnMock.mock.calls.at(-1)!
      expect(spawnCall[0]).toBe(WINDOWS_POWERSHELL_ABS)
      const encoded = spawnCall[1][3] as string
      const decoded = Buffer.from(encoded, 'base64').toString('utf16le')
      // FROZEN CONTRACT (§4.1a): GREEN -- false/absent.
      expect(decoded).not.toContain(DELEGATED_MARKER)
    }
  )

  it('GREEN (gate 42): startupCommandDeliveredInShellArgs is false/absent for PowerShell', async () => {
    provider.configure({
      getWindowsShell: () => 'powershell.exe',
      getWindowsPowerShellImplementation: () => 'powershell.exe'
    })
    const result = await spawnWithDeferredDelivery()
    // spawnLocalPty does not surface this flag on PtySpawnResult directly, so
    // this is observed indirectly: the marker must not have reached argv at
    // all (same assertion restated at the provider boundary, gate 42's own
    // "no shell family embeds it" requirement).
    const spawnCall = spawnMock.mock.calls.at(-1)!
    const encoded = spawnCall[1][3] as string
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le')
    expect(decoded).not.toContain(DELEGATED_MARKER)
    expect(result.id).toBeTruthy()
  })

  it('GREEN (gate 41/42): real cmd.exe path keeps the delegated command out of the /K argv', async () => {
    provider.configure({ getWindowsShell: () => 'cmd.exe' })

    await spawnWithDeferredDelivery()

    const spawnCall = spawnMock.mock.calls.at(-1)!
    expect(spawnCall[0]).toBe('cmd.exe')
    const shellArgs = spawnCall[1] as string[]
    // FROZEN CONTRACT (§4.1a): GREEN -- never appears in the /K argument.
    expect(shellArgs.join(' ')).not.toContain(DELEGATED_MARKER)
  })

  it(
    'positive control (Area B, unaffected): an ordinary non-delegated spawn keeps embedding ' +
      'a short startup command in argv exactly as today',
    async () => {
      provider.configure({
        getWindowsShell: () => 'powershell.exe',
        getWindowsPowerShellImplementation: () => 'powershell.exe'
      })
      await provider.spawn({
        cols: 80,
        rows: 24,
        cwd: 'C:\\Users\\jin\\repo',
        command: 'echo hello-ordinary-spawn'
      })

      const spawnCall = spawnMock.mock.calls.at(-1)!
      expect(spawnCall[0]).toBe(WINDOWS_POWERSHELL_ABS)
      const encoded = spawnCall[1][3] as string
      const decoded = Buffer.from(encoded, 'base64').toString('utf16le')
      expect(decoded).toContain('echo hello-ordinary-spawn')
    }
  )

  // Focused RED/GREEN evidence for the ORCA-S5 independent-acceptance
  // blocker: `deferDelegatedCommandDelivery: true` was constructible
  // without a paired `onPtySpawnCommitted` callback. The launch plan
  // withheld the command from argv on the defer flag alone, but
  // `local-pty-spawn.ts` skips the durable-commit await whenever the
  // callback is absent -- together, that combination could suppress argv
  // delivery while never blocking on (or even attempting) the settlement
  // the deferred delivery exists to wait for.
  //
  // History: RED against GREEN candidate 9b31fb6ac7ef70b3f5de23fc7913c9e6f1a3de6a
  // -- no construction-time check existed; `spawnWithDeferredDelivery()`
  // (helper above) resolved successfully with no callback at all.
  describe(
  'LocalPtyProvider: delegated command delivery -- required commit-callback pairing ' +
    '(SPEC §4.1a construction safety, blocker 2 fix)',
  () => {
    it('REJECTS a delegated spawn missing the required commit callback, before any process is spawned', async () => {
      provider.configure({
        getWindowsShell: () => 'powershell.exe',
        getWindowsPowerShellImplementation: () => 'powershell.exe'
      })
      spawnMock.mockClear()

      // FROZEN INVARIANT: deferDelegatedCommandDelivery === true implies
      // onPtySpawnCommitted is present and usable -- fails closed, before
      // any launch-plan/process side effect.
      await expect(
        spawnWithDeferredDelivery({ onPtySpawnCommitted: undefined })
      ).rejects.toThrow('delegated_cutover_commit_callback_required')
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('ACCEPTS a delegated spawn that pairs deferDelegatedCommandDelivery: true with a real onPtySpawnCommitted callback', async () => {
      provider.configure({
        getWindowsShell: () => 'powershell.exe',
        getWindowsPowerShellImplementation: () => 'powershell.exe'
      })
      let called = false

      const result = await spawnWithDeferredDelivery({
        onPtySpawnCommitted: async () => {
          called = true
        }
      })

      expect(result.id).toBeTruthy()
      expect(called).toBe(true)
      expect(spawnMock).toHaveBeenCalled()
    })

    it('leaves an ordinary spawn (deferDelegatedCommandDelivery unset) unaffected by the pairing invariant, with a callback present', async () => {
      provider.configure({
        getWindowsShell: () => 'powershell.exe',
        getWindowsPowerShellImplementation: () => 'powershell.exe'
      })
      let called = false

      const result = await provider.spawn({
        cols: 80,
        rows: 24,
        cwd: 'C:\\Users\\jin\\repo',
        command: 'echo hello-ordinary-spawn',
        onPtySpawnCommitted: async () => {
          called = true
        }
      })

      expect(result.id).toBeTruthy()
      expect(called).toBe(true)
    })
  })
})
