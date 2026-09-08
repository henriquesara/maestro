// Execution bounded context — domain. Pure.
// SHADOW_EXECUTION_SAFETY_POLICY (amendment §I). Advisory-only shadow execution
// must not create duplicate real-world side effects.

export type WorkloadKind = 'synthetic' | 'sandboxed' | 'repo_local_code_only' | 'external_effect'

// Capabilities that make a workload ineligible for shadow execution unless an
// explicit, registered, independently-accepted isolation strategy is present.
export type ProhibitedCapability =
  | 'send_message'
  | 'mutate_external_service'
  | 'deploy'
  | 'irreversible_cost'
  | 'mutating_external_api'
  | 'alter_production_state'
  | 'network_mutation'

export type IsolationStrategyKind =
  | 'dry_run'
  | 'mocked_endpoint'
  | 'disposable_sandbox_tenant'
  | 'credential_less_profile'
  | 'disposable_environment'

export type IsolationStrategy = {
  kind: IsolationStrategyKind
  /** Non-empty when a human/independent acceptance has registered this strategy. */
  acceptedBy: string
  note: string
}

export type WorkloadDescriptor = {
  id: string
  kind: WorkloadKind
  declaredCapabilities: readonly ProhibitedCapability[]
  isolationStrategy?: IsolationStrategy
}

export type SafetyDecision =
  | { eligible: true; reason: string }
  | { eligible: false; code: SafetyRejectionCode; reason: string }

export type SafetyRejectionCode =
  | 'prohibited_capability'
  | 'external_effect_without_isolation'
  | 'isolation_not_accepted'
  | 'unknown_kind'

/**
 * RED: not implemented yet. Frozen rule (amendment §I):
 *  - eligible iff kind ∈ {synthetic, sandboxed, repo_local_code_only}
 *    AND declaredCapabilities is empty;
 *  - kind 'external_effect' (or any declared prohibited capability) is eligible
 *    ONLY with an isolationStrategy whose acceptedBy is non-empty;
 *  - shadow parity never justifies duplicating an external effect.
 */
export function classifyShadowWorkload(_descriptor: WorkloadDescriptor): SafetyDecision {
  throw new Error('NOT_IMPLEMENTED: I2 classifyShadowWorkload')
}

export const SHADOW_EXECUTION_SAFETY_POLICY = {
  classify: classifyShadowWorkload
}
