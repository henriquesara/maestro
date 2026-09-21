import type { ChildProcessHandle } from '../../../shared/child-process/process-spec'
import type { DispatchLifecycleIncidentKind } from '../domain/dispatch-lifecycle-incident'
import type { SqliteAiControlTerminalProjectionStore } from '../infrastructure/sqlite-aicontrol-terminal-projection-store'
import type { SqliteDispatchLifecycleClosureStore } from '../infrastructure/sqlite-dispatch-lifecycle-closure-store'
import type { SqliteDispatchLifecycleEventStore } from '../infrastructure/sqlite-dispatch-lifecycle-event-store'
import type { SqliteDispatchLifecycleIncidentStore } from '../infrastructure/sqlite-dispatch-lifecycle-incident-store'
import type { SqliteDispatchProcessBindingStore } from '../infrastructure/sqlite-dispatch-process-binding-store'
import type { SqliteDispatchTerminationStore } from '../infrastructure/sqlite-dispatch-termination-store'
import type { SqliteWorktreeFinalizationStore } from '../infrastructure/sqlite-worktree-finalization-store'
import type {
  AiControlDelegationProjectionPort,
  DelegationCutoverReader
} from './converge-delegated-lifecycle-steps'
import type { DispatchWorktreeStore } from './dispatch-worktree-store'
import type { ExecutionStore } from './execution-store'
import type { ShadowLifecycleProcessPortLike } from './lifecycle-process-termination'
import type { SettlementObservationStore } from './settlement-observation-store'
import type { WorktreeProvenanceIncidentStore } from './worktree-provenance-incident-store'
import type { WorktreeProvenanceStore } from './worktree-provenance-store'

// Execution bounded context — application. The input/output CONTRACT of the ORCA-S4
// third sibling sweep (`convergeDelegationBoundaryLifecycle`), split out so the sweep
// file stays under the repo's max-lines ceiling. Re-exported by the sweep module, so
// every existing import path is unchanged.

export type DelegationBoundaryLifecycleDeps = {
  bindings: ExecutionStore
  settlements: SettlementObservationStore
  dispatchWorktrees: DispatchWorktreeStore
  provenance: WorktreeProvenanceStore
  worktreeProvenanceIncidents: WorktreeProvenanceIncidentStore
  processBindings: SqliteDispatchProcessBindingStore
  terminations: SqliteDispatchTerminationStore
  finalizations: SqliteWorktreeFinalizationStore
  closures: SqliteDispatchLifecycleClosureStore
  events: SqliteDispatchLifecycleEventStore
  incidents: SqliteDispatchLifecycleIncidentStore
  processPort: ShadowLifecycleProcessPortLike
  /** Live ChildProcess handles for shadow lifecycle processes spawned by the CURRENT composition-root instance (§6). Keyed by orcaDispatchId. */
  liveHandles: Map<string, ChildProcessHandle>
  durableShadowWorktreeRoot: string
  /** §9.2 — the durable shadow-lifecycle root the process identity sidecar lives under. Required to re-read the REAL sidecar on the restart-recovered path (§9.1.2 check 1). */
  durableShadowLifecycleRoot: string
  now: () => string
  newId: (prefix: string) => string
  /** ORCA-S5 §8.1 — a run with a durable cutover is DELEGATED. Absent ⇒ every binding is an ORCA-S4 shadow binding. */
  delegationCutovers?: DelegationCutoverReader
  /** ORCA-S5 §8.3 — the Maestro-side projection outbox. Absent ⇒ Phase 6 does not run. */
  projections?: SqliteAiControlTerminalProjectionStore
  /** ORCA-S5 §10 — the aiControl transport. Absent ⇒ outbox rows stay `pending` (no network transport exists). */
  projectionWriter?: AiControlDelegationProjectionPort
}

export type DelegationBoundaryLifecycleOptions = { sliceRef: string }

export type RetryableResult = { correlationId: string; code: string; attempts: number }
export type IncidentSummary = { correlationId: string; kind: DispatchLifecycleIncidentKind }

/** S4 SPEC §13 — "any exception for one binding is caught and reported; the sweep continues". */
export type LifecycleSweepErrorRef = { correlationId: string; error: string }

export type DelegationBoundaryLifecycleReport = {
  closed: string[]
  legacyNotLifecycleManaged: string[]
  incidents: IncidentSummary[]
  retryable: RetryableResult[]
  sweepErrors: LifecycleSweepErrorRef[]
  /** §5, gate 21 — the acceptance-evidence disclaimer this report itself must carry. */
  syntheticProcessDisclaimer: string
}

export const SYNTHETIC_PROCESS_DISCLAIMER =
  'SYNTHETIC LOCAL LIFECYCLE PROOF: every process this report accounts for is a synthetic, ' +
  'self-spawned Execution fixture (ORCA-S4 SPEC §4/§5). This report does not prove, and must ' +
  'never be cited as evidence of, production process-handle acquisition, real (non-MockExecutor) ' +
  'executor parity, or remote/SSH execution identity parity — no production workload process is ' +
  'ever observed or signalled here.'

export const DELEGATED_PROCESS_DISCLAIMER =
  'This pass accounted for at least one DELEGATED run (a durable ORCA-S5 delegation_cutover) whose ' +
  'process is a real workload; it is observed and signalled only on a durable teardown request. ' +
  'ORCA-S4 shadow bindings in the same pass remain synthetic fixtures. This report is not evidence ' +
  'of live ORCA_DELEGATED activation, remote/SSH identity parity, or aiControl-side acknowledgement.'
