// Execution bounded context — infrastructure. Fail-closed errors for the durable
// shadow orchestration.db lifetime (§17). S2 never silently creates a
// replacement DB and never converges against a different source than the one its
// projection was built from.

/** §17 — persisted `shadow_orchestration_path` present but the DB file is missing. */
export class ShadowSettlementSourceMissingError extends Error {
  constructor(readonly path: string) {
    super(`durable shadow orchestration.db is missing at the persisted path: ${path}`)
    this.name = 'ShadowSettlementSourceMissingError'
  }
}

/** §17 — configured `shadow_orchestration_path` disagrees with the persisted `execution_meta` value. */
export class ShadowSourcePathMismatchError extends Error {
  constructor(
    readonly configuredPath: string,
    readonly persistedPath: string
  ) {
    super(
      `configured shadow_orchestration_path (${configuredPath}) != persisted (${persistedPath}) — refusing to converge against a different source DB`
    )
    this.name = 'ShadowSourcePathMismatchError'
  }
}
