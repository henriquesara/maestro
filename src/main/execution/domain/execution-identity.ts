// Execution bounded context — domain. Pure. No infrastructure, no Orca types.
// Opaque identity refs + the RunBinding aggregate (amendment §L).

const REF = Symbol('execution-ref')

type Branded<T extends string> = string & { readonly [REF]: T }

export type AiControlRunRef = Branded<'aicontrol_run'>
export type GovernanceAgentRunRef = Branded<'governance_agent_run'>
export type OrcaRunRef = Branded<'orca_run'>
export type OrcaDispatchRef = Branded<'orca_dispatch'>
export type OrgTaskRef = Branded<'org_task'>

function brand<T extends string>(raw: string, kind: T): Branded<T> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new RunBindingError('invalid_ref', `${kind} ref must be a non-empty string`)
  }
  return raw as Branded<T>
}

export const makeAiControlRunRef = (raw: string): AiControlRunRef => brand(raw, 'aicontrol_run')
export const makeGovernanceAgentRunRef = (raw: string): GovernanceAgentRunRef =>
  brand(raw, 'governance_agent_run')
export const makeOrcaRunRef = (raw: string): OrcaRunRef => brand(raw, 'orca_run')
export const makeOrcaDispatchRef = (raw: string): OrcaDispatchRef => brand(raw, 'orca_dispatch')
export const makeOrgTaskRef = (raw: string): OrgTaskRef => brand(raw, 'org_task')

export type RunBindingErrorCode =
  | 'invalid_ref'
  | 'duplicate_dispatch'
  | 'duplicate_aicontrol_run'
  | 'dispatch_mismatch'
  | 'orphan_binding'

export class RunBindingError extends Error {
  constructor(
    readonly code: RunBindingErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'RunBindingError'
  }
}

// The durable identity map (amendment §L: durable, unambiguous, idempotent,
// persisted by the owning module — never reconstructed heuristically).
export type RunBinding = {
  governanceAgentRunId: GovernanceAgentRunRef
  aicontrolRunId: AiControlRunRef | null
  orcaRunId: OrcaRunRef
  orcaDispatchId: OrcaDispatchRef
  orgTaskId: OrgTaskRef
  sliceRef: string
  baseCommit: string
  candidateHead: string | null
  boundAt: string
}

/**
 * I4 — a settlement / association may only use the Dispatch ref this binding was
 * created with. A wrong or stale ref is rejected here, before it reaches Orca.
 * RED: not implemented yet.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function assertBoundDispatch(_binding: RunBinding, _dispatchRef: OrcaDispatchRef): void {
  throw new Error('NOT_IMPLEMENTED: I4 assertBoundDispatch')
}
