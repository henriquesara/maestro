// Execution bounded context — application. Persistence port for the S3-owned
// dispatch_worktree aggregate (§7.2). Durable SOURCE state — the row is
// inserted once, at bind time, in the same transaction as run_binding, and is
// NEVER rebuilt by a provenance-projection rebuild (§7.5, PROV-11).

import type { DispatchWorktreeRecord } from '../domain/worktree-provenance'

export type DispatchWorktreeStore = {
  /** Throws on a duplicate orca_dispatch_id (PRIMARY KEY) — never a silent overwrite. */
  insert(record: DispatchWorktreeRecord): void
  getByDispatchId(orcaDispatchId: string): DispatchWorktreeRecord | undefined
  getByCorrelationId(correlationId: string): DispatchWorktreeRecord | undefined
}
