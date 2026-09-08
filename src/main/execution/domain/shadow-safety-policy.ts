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

const SAFE_KINDS: ReadonlySet<WorkloadKind> = new Set([
  'synthetic',
  'sandboxed',
  'repo_local_code_only'
])

/**
 * Frozen rule (amendment §I). Eligible iff the workload cannot produce a
 * duplicate real-world side effect:
 *  - kind ∈ {synthetic, sandboxed, repo_local_code_only} AND no prohibited
 *    capability is declared; or
 *  - a prohibited capability / kind 'external_effect' is present ONLY with an
 *    isolation strategy that has a non-empty `acceptedBy` (independently accepted).
 * Shadow parity never justifies duplicating an external effect.
 */
export function classifyShadowWorkload(descriptor: WorkloadDescriptor): SafetyDecision {
  const hasProhibited = descriptor.declaredCapabilities.length > 0
  const isolationPresent = descriptor.isolationStrategy !== undefined
  const isolationAccepted =
    isolationPresent && descriptor.isolationStrategy!.acceptedBy.trim().length > 0
  const needsIsolation = hasProhibited || descriptor.kind === 'external_effect'

  if (descriptor.kind !== 'external_effect' && !SAFE_KINDS.has(descriptor.kind)) {
    return {
      eligible: false,
      code: 'unknown_kind',
      reason: `unknown workload kind ${descriptor.kind}`
    }
  }

  if (!needsIsolation) {
    return { eligible: true, reason: `${descriptor.kind} with no declared side effects` }
  }

  if (isolationAccepted) {
    return { eligible: true, reason: 'side-effecting workload isolated by an accepted strategy' }
  }
  if (isolationPresent) {
    return {
      eligible: false,
      code: 'isolation_not_accepted',
      reason: 'the isolation strategy has no independent acceptance (acceptedBy is empty)'
    }
  }
  if (hasProhibited) {
    return {
      eligible: false,
      code: 'prohibited_capability',
      reason: `declares a prohibited capability without an accepted isolation strategy: ${descriptor.declaredCapabilities.join(', ')}`
    }
  }
  return {
    eligible: false,
    code: 'external_effect_without_isolation',
    reason: 'external_effect workloads need a registered, independently-accepted isolation strategy'
  }
}

export const SHADOW_EXECUTION_SAFETY_POLICY = {
  classify: classifyShadowWorkload
}
