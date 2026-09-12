// Execution bounded context — application. The S3-owned compare-and-swap seam
// onto the LATENT run_binding.candidate_head column (§7.4, R2). The existing
// ExecutionStore.setBindingCandidateHead (S1) is an UNCONDITIONAL UPDATE and
// cannot express "never overwrite a non-null disagreeing value" — this is a
// second, narrower writer of the same column, never a replacement of it.

export type CandidateHeadCasResult = 'set' | 'already_equal' | 'conflict'

export type RunBindingCandidateHeadStore = {
  /**
   * NULL -> sha: succeeds, returns 'set'. Already equal: 0-row match, returns
   * 'already_equal', no error. Already different: refuses, returns 'conflict',
   * NEVER overwrites (R2).
   */
  casSetCandidateHead(orcaDispatchId: string, candidateHead: string): CandidateHeadCasResult
}
