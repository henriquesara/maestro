// ORCA-S5 Post-Cutover Lifecycle — RED-ONLY fakes for EXTERNAL MECHANISM EDGES
// ONLY (mission §5, §38): (a) OS process observation/signalling, (b) the future
// aiControl projection transport. Neither performs classification, identity
// decisions, or any durable write — those live in production. Every call is
// recorded so tests can assert on the actual signal / transport surface.

import type {
  ProcessLifecycleObservationLike,
  ShadowLifecycleProcessPortLike
} from '../../application/converge-delegation-boundary-lifecycle'
import type { DelegatedRun } from './post-cutover-lifecycle-fixture'

// ── Fake OS edge (scripted responses ONLY) ─────────────────────────────────

export type ScriptedOsState =
  | ProcessLifecycleObservationLike
  | (() => ProcessLifecycleObservationLike | Promise<ProcessLifecycleObservationLike>)

/**
 * Models what the OS/process layer would report and whether a signal request
 * succeeded. It performs NO classification, NO identity decision (identity is
 * decided in production from the `__raw_os_observation__` facts it reports),
 * and NO durable write. Every call is recorded so tests can assert on the
 * actual signal surface (S4 gate 25: "a bug that classifies correctly but
 * signals anyway would still fail").
 */
export class FakeOsProcessPort implements ShadowLifecycleProcessPortLike {
  private readonly script = new Map<number, ScriptedOsState>()
  readonly observeCalls: number[] = []
  readonly signalByPidCalls: { pid: number; killScope: string }[] = []
  readonly signalByHandleCalls: unknown[] = []
  /** Any call at all is a fallback/respawn violation (SPEC §5.7/§11/§20). */
  spawnCalls = 0
  signalVerified = true
  signalError: Error | null = null
  /** Runs at the instant a signal is requested — lets a test read durable state "at signal time". */
  onSignal: (() => void) | null = null

  set(pid: number, state: ScriptedOsState): this {
    this.script.set(pid, state)
    return this
  }

  running(run: DelegatedRun): this {
    return this.set(run.pid, { kind: 'still_running' })
  }
  selfExit(run: DelegatedRun, exitCode: number | null, exitSignal: string | null = null): this {
    return this.set(run.pid, { kind: 'self_exit', exitCode, exitSignal })
  }
  deadUnknownCause(run: DelegatedRun): this {
    return this.set(run.pid, { kind: 'confirmed_dead_unknown_cause' })
  }
  /** The raw OS facts production's identity verifier decides on (PID reuse, missing marker, ...). */
  rawOs(
    run: DelegatedRun,
    facts: { pidExists: boolean; currentOsStartMarker: string | null; argv?: string | null }
  ): this {
    return this.set(run.pid, { kind: '__raw_os_observation__', ...facts })
  }

  async observe(
    _handle: unknown,
    durable: { pid: number }
  ): Promise<ProcessLifecycleObservationLike> {
    this.observeCalls.push(durable.pid)
    const state = this.script.get(durable.pid)
    if (!state) {
      throw new Error(`FakeOsProcessPort: no scripted OS state for pid ${durable.pid}`)
    }
    return typeof state === 'function' ? await state() : state
  }
  async requestTermination(handle: unknown): Promise<{ verified: boolean }> {
    this.signalByHandleCalls.push(handle)
    this.onSignal?.()
    if (this.signalError) {
      throw this.signalError
    }
    return { verified: this.signalVerified }
  }
  async requestTerminationByPid(pid: number, killScope: string): Promise<{ verified: boolean }> {
    this.signalByPidCalls.push({ pid, killScope })
    this.onSignal?.()
    if (this.signalError) {
      throw this.signalError
    }
    return { verified: this.signalVerified }
  }
  spawn(): never {
    this.spawnCalls += 1
    throw new Error('FakeOsProcessPort.spawn must never be called after cutover')
  }

  get totalSignals(): number {
    return this.signalByPidCalls.length + this.signalByHandleCalls.length
  }
}

// ── Fake aiControl projection transport (SPEC §10; real function's own name) ─

export type ProjectionOutcome = 'PROJECTED' | 'ALREADY_TERMINAL' | 'FENCE_MISMATCH' | 'DIVERGENCE'
export type ProjectionCall = { runId: string; token: string; status: string; [k: string]: unknown }

/** Mirrors the real published `projectDelegatedTerminalResult({ runId, token, status, ... })` name and outcome enum. */
export class FakeProjectionWriter {
  readonly calls: ProjectionCall[] = []
  private readonly queue: (ProjectionOutcome | Error)[] = []
  defaultOutcome: ProjectionOutcome = 'PROJECTED'
  /** When set, every call with an empty script queue throws this (a permanently dead transport). */
  defaultError: Error | null = null

  next(...outcomes: (ProjectionOutcome | Error)[]): this {
    this.queue.push(...outcomes)
    return this
  }

  async projectDelegatedTerminalResult(
    input: ProjectionCall
  ): Promise<{ outcome: ProjectionOutcome }> {
    this.calls.push(input)
    if (this.queue.length === 0 && this.defaultError) {
      throw this.defaultError
    }
    const next = this.queue.shift() ?? this.defaultOutcome
    if (next instanceof Error) {
      throw next
    }
    return { outcome: next }
  }
}
