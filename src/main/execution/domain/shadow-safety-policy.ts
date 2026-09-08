// Execution bounded context — domain. Pure.
// SHADOW_EXECUTION_SAFETY_POLICY (amendment §I, hardened by amendment 001 §6 /
// blocker B5). Advisory-only shadow execution must not create duplicate
// real-world side effects, and a caller-supplied string is never acceptance.

export type WorkloadKind = 'synthetic' | 'sandboxed' | 'repo_local_code_only' | 'external_effect'

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

/**
 * A durable, verifiable isolation decision. Independent acceptance requires
 * **actor separation**: `authoredBy` and `acceptedBy` must both be present,
 * neither may be the placeholder `"self"`, and they must differ.
 */
export type IsolationDecision = {
  kind: IsolationStrategyKind
  /** Stable reference to the durable decision record (not free text). */
  decisionRef: string
  authoredBy: string
  acceptedBy: string
  note: string
}

export type WorkloadDescriptor = {
  id: string
  kind: WorkloadKind
  declaredCapabilities: readonly ProhibitedCapability[]
  isolationDecision?: IsolationDecision
}

export type SafetyDecision =
  | { eligible: true; reason: string }
  | { eligible: false; code: SafetyRejectionCode; reason: string }

export type SafetyRejectionCode =
  | 'prohibited_capability'
  | 'external_effect_without_isolation'
  | 'isolation_actor_not_separated'
  | 'unknown_kind'

const SAFE_KINDS: ReadonlySet<WorkloadKind> = new Set([
  'synthetic',
  'sandboxed',
  'repo_local_code_only'
])

const PLACEHOLDER_ACTORS: ReadonlySet<string> = new Set(['self', 'me', 'implementer', 'caller', ''])

function isActorSeparated(decision: IsolationDecision): boolean {
  const authored = decision.authoredBy.trim().toLowerCase()
  const accepted = decision.acceptedBy.trim().toLowerCase()
  if (decision.decisionRef.trim().length === 0) {
    return false
  }
  if (PLACEHOLDER_ACTORS.has(authored) || PLACEHOLDER_ACTORS.has(accepted)) {
    return false
  }
  return authored !== accepted
}

/**
 * Conservative for ORCA-S1 (amendment 001 §6): auto-admit ONLY synthetic /
 * sandboxed / repo_local_code_only workloads with zero declared prohibited
 * capabilities. An `external_effect` workload, or any declared capability, is
 * admitted only with an `IsolationDecision` whose actors are proven separated.
 */
export function classifyShadowWorkload(descriptor: WorkloadDescriptor): SafetyDecision {
  const hasProhibited = descriptor.declaredCapabilities.length > 0
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

  if (!descriptor.isolationDecision) {
    return {
      eligible: false,
      code: hasProhibited ? 'prohibited_capability' : 'external_effect_without_isolation',
      reason: hasProhibited
        ? `declares a prohibited capability without an isolation decision: ${descriptor.declaredCapabilities.join(', ')}`
        : 'external_effect workloads need a durable isolation decision'
    }
  }

  if (!isActorSeparated(descriptor.isolationDecision)) {
    return {
      eligible: false,
      code: 'isolation_actor_not_separated',
      reason:
        'the isolation decision lacks actor separation (authoredBy/acceptedBy must both be real, distinct, non-"self")'
    }
  }

  return {
    eligible: true,
    reason: 'side-effecting workload isolated by an actor-separated decision'
  }
}

export const SHADOW_EXECUTION_SAFETY_POLICY = {
  classify: classifyShadowWorkload
}
