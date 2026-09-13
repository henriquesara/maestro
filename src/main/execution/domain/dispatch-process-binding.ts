// Execution bounded context — domain. Pure. No infrastructure, no Orca types.
// ORCA-S4 SPEC §4, §8.1 — the spawn-time identity of the synthetic shadow
// lifecycle process. Durable SOURCE state (§8.0): never dropped/rebuilt.

export type OsStartMarkerSource =
  | 'windows_creation_time'
  | 'posix_proc_stat_starttime'
  | 'posix_ps_lstart'
  | 'unavailable'

export type ProcessTreeKillScope = 'posix-process-group' | 'win-taskkill-tree'

export type DispatchProcessBindingRecord = {
  orcaDispatchId: string
  correlationId: string
  orcaRunId: string
  /** Immutable, Execution-minted random id (§4). On macOS also the exact argv token (§9.1.3). */
  processNonce: string
  /** Corroborating only — never identity by itself (pids recycle, §4). */
  pid: number
  killScope: ProcessTreeKillScope
  /** Opaque OS-observed process-instance discriminator; NULL when unavailable at spawn (§12 window L13). */
  osStartMarker: string | null
  osStartMarkerSource: OsStartMarkerSource
  spawnedAt: string
  /** The ONE permitted post-insert mutation — set durably BEFORE signalProcessTree (§9.3, window L6). */
  teardownRequestedAt: string | null
}

/** The process identity sidecar (§9.2 steps 3/4) — written before the transaction opens. */
export type ProcessIdentitySidecar = {
  correlationId: string
  orcaRunId: string
  orcaDispatchId: string
  processNonce: string
  spawnedAt: string | null
  pid: number | null
  osStartMarker: string | null
  osStartMarkerSource: OsStartMarkerSource | null
}
