import { createAsyncSpawnCommitReporter } from '../../shared/async-spawn-commit-reporter'
import type { DelegationCutoverCommitResult } from '../../shared/delegation-cutover-commit-result'

/** Async-aware, fire-once callback for the provider's spawn-commit boundary
 *  (SPEC.md §4.5.1 site #6, §4.5.2). */
export function createPtySpawnCommitReporter(
  callback?: () => Promise<DelegationCutoverCommitResult> | void
): () => Promise<DelegationCutoverCommitResult | void> {
  return createAsyncSpawnCommitReporter(callback)
}
