// ORCA-S5 Delegated Cutover Core — GENUINE FOCUSED RED, real production
// call-graph (SPEC.md §4.8.4, Gate 31). Independent acceptance review
// (BLOCKERS_FOUND / ORCA_S5_DELEGATED_CUTOVER_CORE_COMPOSITION_BLOCKER_FOUND)
// confirmed the site #5 closure in `orca-runtime-create-agent-session.ts`
// is byte-identical to before -- never conditioned on
// `request.delegatedCutover`, never calls
// `this.getDelegatedCutoverCoordinator().commitDelegatedCutover(...)` --
// and that `getDelegatedCutoverCoordinator` has ZERO production callers
// anywhere in the repository.
//
// This file drives the REAL production composition:
// runtime.createAgentSession (real, unmodified site #5 closure construction)
// -> LocalPtyProvider.spawn (real) -> spawnLocalPty (real) ->
// onPtySpawnCommitted (real invocation, at the exact real call site gate 31
// names, local-pty-spawn.ts:89) -> site #5 closure body. It never constructs
// or calls DelegatedCutoverCoordinator directly -- it spies on the SAME
// instance the real runtime chain would use
// (`runtime.getDelegatedCutoverCoordinator()`, called once up front to
// obtain the memoized instance the real closure will later reach through
// `this`), so a passing assertion is only possible if the real call graph
// actually reaches it.
//
// `runtime.createTerminal` is replaced with a minimal stand-in that itself
// calls the REAL `LocalPtyProvider.spawn()` with the REAL `onPtySpawnCommitted`
// closure `createAgentSession` built -- this is the same established
// precedent `orca-runtime-agent-session-operation.test.ts` already uses
// (`vi.spyOn(runtime, 'createTerminal')`) to isolate `createAgentSession`'s
// own logic from the full Electron-bound `PtyRuntimeControllerDeps`/
// `BrowserWindow` production IPC bootstrap (`register-handlers.ts`) --
// infrastructure genuinely unrelated to this composition question, not the
// call graph gate 31/this blocker are about. What stays 100% real and
// unmocked is exactly the hop this blocker concerns: site #5's closure
// construction inside `createAgentSession`, and its real invocation inside
// `spawnLocalPty` at `local-pty-spawn.ts:89`.
//
// Mocking discipline for the provider layer mirrors
// `local-pty-provider-delegated-command-delivery.test.ts` exactly (node-pty,
// fs, electron, macOS TCC, Windows PowerShell resolver, WSL,
// shell-prompt-readiness-probe) -- only `node-pty`'s own process spawn is
// faked; the real provider/launch-plan code is unmocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MacosTccLoginShell from '../../../providers/macos-tcc-login-shell'

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
  app: { getPath: vi.fn(() => '/tmp/orca-user-data') }
}))

vi.mock('node-pty', () => ({ spawn: spawnMock }))

vi.mock('../../../providers/macos-tcc-login-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof MacosTccLoginShell>()),
  prepareMacosTccLoginShell: prepareMacosTccLoginShellMock
}))

vi.mock('../../../providers/pty-descendant-termination', () => ({
  killWithDescendantSweep: killWithDescendantSweepMock
}))

const WINDOWS_POWERSHELL_ABS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const PWSH7_ABS = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
const CMD_ABS = 'C:\\Windows\\System32\\cmd.exe'
vi.mock('../../../providers/windows-powershell-executable', () => ({
  resolveWindowsPowerShellExecutablePath: (family: 'pwsh.exe' | 'powershell.exe') =>
    family === 'pwsh.exe' ? PWSH7_ABS : WINDOWS_POWERSHELL_ABS,
  resolveWindowsPowerShellSpawnChain: (family: 'pwsh.exe' | 'powershell.exe') =>
    family === 'pwsh.exe'
      ? [PWSH7_ABS, WINDOWS_POWERSHELL_ABS, CMD_ABS]
      : [WINDOWS_POWERSHELL_ABS, CMD_ABS],
  getWindowsCmdPath: () => CMD_ABS
}))

vi.mock('../../../providers/agent-foreground-process', () => ({
  resolveAgentForegroundProcessWithAvailability: (...args: unknown[]) =>
    resolveAgentForegroundProcessMock(...args)
}))

vi.mock('../../../providers/windows-pty-job-membership', () => ({
  readWindowsPtyJobProcessIds: (...args: unknown[]) => readWindowsPtyJobProcessIdsMock(...args),
  isWindowsPtyJobReadable: () => true
}))

vi.mock('../../../wsl', () => ({
  parseWslPath: () => null,
  toLinuxPath: (path: string) => path.replace(/^C:\\/i, '/mnt/c/').replace(/\\/g, '/'),
  toWindowsWslPath: (path: string, distro: string) =>
    `\\\\wsl.localhost\\${distro}${path.replace(/\//g, '\\')}`,
  getDefaultWslDistro: () => 'Ubuntu',
  isWslAvailableAsync: () => isWslAvailableAsyncMock(),
  wslUncDirectoryExists: (...args: unknown[]) => wslUncDirectoryExistsMock(...args)
}))

vi.mock('../../../providers/shell-prompt-readiness-probe', () => ({
  createShellPromptReadinessProbe: createShellPromptReadinessProbeMock
}))

import { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import {
  applyLocalPtyProviderMockDefaults,
  createLocalPtyMockProcess,
  installLocalPtyProviderEnvSandbox,
  type LocalPtyMockProcess
} from '../../../providers/local-pty-provider-test-harness'
import type { RuntimeCreateAgentSessionRequest } from '../../../../shared/agent-session-host-authority'
import { FakeAiControlFenceClient } from './cutover-core-test-harness'

const MOCK_SPAWNED_PID = 12345

let operationCounter = 0
function operationId(): string {
  operationCounter += 1
  return `${Date.now()}-${operationCounter.toString(16).padStart(32, '0')}`
}

describe('ORCA-S5 Delegated Cutover Core -- real site #5 production composition (Gate 31)', () => {
  installLocalPtyProviderEnvSandbox()

  let mockProc: LocalPtyMockProcess
  let exitCb: ((info: { exitCode: number }) => void) | undefined
  const openRuntimes: OrcaRuntimeService[] = []
  afterEach(() => {
    while (openRuntimes.length) {
      openRuntimes.pop()?.getDelegatedCutoverDatabaseForDiagnostics()?.close()
    }
  })

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
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  })

  function newRuntime() {
    const runtime = new OrcaRuntimeService(
      {
        getSettings: () => ({
          disabledTuiAgents: [],
          agentCmdOverrides: {},
          agentDefaultArgs: {},
          agentDefaultEnv: {}
        })
      } as never,
      undefined,
      { getLocalProvider: () => new LocalPtyProvider() }
    )
    const internal = runtime as unknown as {
      resolveTerminalWorkspaceLaunchScope: ReturnType<typeof vi.fn>
    }
    internal.resolveTerminalWorkspaceLaunchScope = vi.fn(async () => ({
      id: 'worktree-1',
      path: '/tmp/worktree-1',
      connectionId: null
    }))
    // Isolates createAgentSession's own logic (real, unmodified) from the
    // full Electron-bound PtyRuntimeControllerDeps/BrowserWindow production
    // IPC bootstrap -- see file header. `opts.onPtySpawnCommitted` is the
    // REAL site #5 closure; it is threaded, unmodified, into a REAL
    // LocalPtyProvider.spawn() call.
    vi.spyOn(runtime, 'createTerminal').mockImplementation(async (_worktree, opts) => {
      const provider = new LocalPtyProvider()
      const result = await provider.spawn({
        cols: 80,
        rows: 24,
        cwd: '/tmp/worktree-1',
        command: opts?.command ?? 'echo hi',
        onPtySpawnCommitted: opts?.onPtySpawnCommitted,
        preparedDelegatedProcessIdentityCapture: opts?.preparedDelegatedProcessIdentityCapture
      } as never)
      return {
        handle: opts?.preAllocatedHandle ?? 'term_stub',
        tabId: '11111111-1111-4111-8111-111111111111',
        paneKey: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222',
        ptyId: result.id,
        worktreeId: 'worktree-1',
        title: null,
        surface: 'background' as const
      }
    })
    openRuntimes.push(runtime)
    return runtime
  }

  function delegatedRequest(clientOperationId: string): RuntimeCreateAgentSessionRequest {
    return {
      clientOperationId,
      worktree: 'id:worktree-1',
      agent: 'codex',
      prompt: 'do the thing',
      presentation: 'background',
      delegatedCutover: { aicontrolRunId: 'aicontrol_run_site5_1', fenceToken: 'token_site5_1' }
    }
  }

  it('a real delegated request causes the real site #5 callback to invoke the real coordinator with the real spawned process identity', async () => {
    const runtime = newRuntime()
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible('aicontrol_run_site5_1')
    runtime.getDelegatedCutoverCoordinatorDeps = () => ({ fence })
    const coordinator = runtime.getDelegatedCutoverCoordinator()
    const commitSpy = vi.spyOn(coordinator, 'commitDelegatedCutover')

    await runtime.createAgentSession(delegatedRequest(operationId()))

    // FUTURE assertion (fails against 67a36218 -- production never calls this).
    expect(commitSpy).toHaveBeenCalledTimes(1)
    const call = commitSpy.mock.calls[0]![0]
    expect(call.aicontrolRunId).toBe('aicontrol_run_site5_1')
    expect(call.fenceToken).toBe('token_site5_1')
    expect(call.processIdentity?.pid).toBe(MOCK_SPAWNED_PID)
  })

  // §4 -- native positive control: no delegatedCutover, no coordinator call,
  // existing native behavior preserved.
  it('an ordinary (non-delegated) request never touches the coordinator', async () => {
    const runtime = newRuntime()
    const coordinator = runtime.getDelegatedCutoverCoordinator()
    const commitSpy = vi.spyOn(coordinator, 'commitDelegatedCutover')

    const result = await runtime.createAgentSession({
      clientOperationId: operationId(),
      worktree: 'id:worktree-1',
      agent: 'codex',
      prompt: 'do the thing',
      presentation: 'background'
    })

    expect(commitSpy).not.toHaveBeenCalled()
    expect(result.disposition).toBe('created')
  })

  // §5 -- coordinator rejection holds the workload: onPtySpawnCommitted
  // rejects, spawnLocalPty's own real deferred-delivery await propagates it
  // out of `activateLocalPtySession`, so createAgentSession itself rejects.
  //
  // Test-authoring note (mission §3/§29): the first version of this test
  // left the fence unseeded eligible, expecting the rejection to surface at
  // the commit step -- but wiring the real S1->S2 reservation step (this
  // GREEN session, ahead of the S5.4 commit call) now correctly fails
  // closed EARLIER, at `establishReservation`, before any process is ever
  // prepared -- exactly the frozen ordering (eligibility -> fence ->
  // reservation -> prepare) mission §11 requires. commitDelegatedCutover is
  // therefore never reached in that scenario, which is the CORRECT
  // behavior, not a test bug in the old sense -- but it means this specific
  // test must seed the fence eligible (so reservation succeeds and a real
  // process IS prepared) and reject at the commit step itself instead, to
  // exercise the intended boundary (§5/§6 of this mission).
  it('a coordinator rejection through the real path holds the workload (createAgentSession rejects)', async () => {
    const runtime = newRuntime()
    const fence = new FakeAiControlFenceClient()
    fence.seedEligible('aicontrol_run_site5_1')
    runtime.getDelegatedCutoverCoordinatorDeps = () => ({ fence })
    const coordinator = runtime.getDelegatedCutoverCoordinator()
    const commitSpy = vi
      .spyOn(coordinator, 'commitDelegatedCutover')
      .mockRejectedValue(new Error('delegated_cutover_commit_rejected: test'))

    await expect(runtime.createAgentSession(delegatedRequest(operationId()))).rejects.toThrow()
    expect(commitSpy).toHaveBeenCalledTimes(1)
  })

  // §5 companion -- the ordering claim itself: an ineligible/rejected fence
  // never even reaches the commit step, proving fail-closed-before-prepare.
  it('a fence rejection through the real path never reaches commitDelegatedCutover', async () => {
    const runtime = newRuntime()
    const fence = new FakeAiControlFenceClient()
    // Deliberately NOT seeded eligible.
    runtime.getDelegatedCutoverCoordinatorDeps = () => ({ fence })
    const coordinator = runtime.getDelegatedCutoverCoordinator()
    const commitSpy = vi.spyOn(coordinator, 'commitDelegatedCutover')

    await expect(runtime.createAgentSession(delegatedRequest(operationId()))).rejects.toThrow()
    expect(commitSpy).not.toHaveBeenCalled()
  })
})
