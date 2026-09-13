import { createHash } from 'node:crypto'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SqliteDispatchProcessBindingStore } from '../infrastructure/sqlite-dispatch-process-binding-store'
import { readCurrentOsStartMarker, readMacosProcessObservation } from '../infrastructure/process-instance-discriminator'
import { verifyRestartRecoveredIdentity } from '../domain/restart-recovered-identity-verification'
import type { ProcessTreeKillScope } from '../domain/dispatch-process-binding'
import type { DispatchWorktreeStore } from './dispatch-worktree-store'

// Execution bounded context — application. ORCA-S4 SPEC §10.3, §12 window L7 —
// two orphan classes S3/S4's bind-time transactions can leave behind. NEITHER
// ever received a committed Execution-store row, so neither gets a
// correlation_id-keyed durable fact; both are audit-logged only. Invoked ONCE
// per composition-root run, BEFORE the main sweep chain (§9.2, §11).

export type OrphanReapAction = 'reaped' | 'skipped_unverifiable'
export type OrphanReapKind = 'orphan_worktree' | 'orphan_process'

export type OrphanReapAuditEntry = {
  kind: OrphanReapKind
  /** A hashed fingerprint — NEVER a raw absolute path (§10.3). */
  fingerprint: string
  observedAt: string
  action: OrphanReapAction
}

export type ReconcileOrphanShadowStateDeps = {
  dispatchWorktrees: DispatchWorktreeStore
  processBindings: SqliteDispatchProcessBindingStore
  processPort: {
    requestTerminationByPid(pid: number, killScope: ProcessTreeKillScope): Promise<{ verified: boolean }>
  }
  /** ORCA-S3's durable shadow-worktree root. Defaults to durableShadowLifecycleRoot when omitted. */
  durableShadowWorktreeRoot?: string
  /** S4's own durable shadow-lifecycle root (the `process/` subtree). */
  durableShadowLifecycleRoot: string
}

export type ReconcileOrphanShadowStateOptions = {
  orphanGraceMs: number
  now: () => string
}

function fingerprint(path: string): string {
  return createHash('sha256').update(path).digest('hex')
}

function ageMs(path: string, nowMs: number): number {
  return nowMs - statSync(path).mtimeMs
}

function currentKillScope(): ProcessTreeKillScope {
  return process.platform === 'win32' ? 'win-taskkill-tree' : 'posix-process-group'
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const CORRELATION_FROM_WORKTREE_DIR = /^shadow-(.+)$/

async function reconcileOrphanWorktrees(
  deps: ReconcileOrphanShadowStateDeps,
  opts: ReconcileOrphanShadowStateOptions,
  nowMs: number
): Promise<OrphanReapAuditEntry[]> {
  const root = deps.durableShadowWorktreeRoot ?? deps.durableShadowLifecycleRoot
  const worktreesDir = join(root, 'worktrees')
  if (!existsSync(worktreesDir)) {
    return []
  }
  const audit: OrphanReapAuditEntry[] = []
  for (const entry of readdirSync(worktreesDir)) {
    const match = CORRELATION_FROM_WORKTREE_DIR.exec(entry)
    if (!match) {
      continue
    }
    const correlationId = match[1]
    if (deps.dispatchWorktrees.getByCorrelationId(correlationId)) {
      continue // has a committed row — not an orphan
    }
    const entryPath = join(worktreesDir, entry)
    if (ageMs(entryPath, nowMs) < opts.orphanGraceMs) {
      continue // defends against racing an in-flight bind
    }
    rmSync(entryPath, { recursive: true, force: true })
    audit.push({ kind: 'orphan_worktree', fingerprint: fingerprint(entryPath), observedAt: opts.now(), action: 'reaped' })
  }
  return audit
}

async function reconcileOrphanProcesses(
  deps: ReconcileOrphanShadowStateDeps,
  opts: ReconcileOrphanShadowStateOptions,
  nowMs: number
): Promise<OrphanReapAuditEntry[]> {
  const processDir = join(deps.durableShadowLifecycleRoot, 'process')
  if (!existsSync(processDir)) {
    return []
  }
  const audit: OrphanReapAuditEntry[] = []
  for (const entry of readdirSync(processDir)) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const orcaDispatchId = entry.slice(0, -'.json'.length)
    if (deps.processBindings.getByDispatchId(orcaDispatchId)) {
      continue // has a committed row — not an orphan
    }
    const sidecarPath = join(processDir, entry)
    if (ageMs(sidecarPath, nowMs) < opts.orphanGraceMs) {
      continue
    }

    let sidecar: {
      pid?: unknown
      processNonce?: unknown
      osStartMarker?: unknown
      osStartMarkerSource?: unknown
      correlationId?: unknown
      orcaRunId?: unknown
    } | null = null
    try {
      sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'))
    } catch {
      sidecar = null
    }
    if (
      !sidecar ||
      typeof sidecar.pid !== 'number' ||
      typeof sidecar.processNonce !== 'string' ||
      typeof sidecar.osStartMarkerSource !== 'string'
    ) {
      // Identity-unverifiable → skip, log, do NOT touch — fail closed exactly
      // as the main sweep requires (§9.3); an orphan sweep is not exempt.
      audit.push({
        kind: 'orphan_process',
        fingerprint: fingerprint(sidecarPath),
        observedAt: opts.now(),
        action: 'skipped_unverifiable'
      })
      continue
    }

    const pid = sidecar.pid
    const osStartMarkerSource = sidecar.osStartMarkerSource as
      | 'windows_creation_time'
      | 'posix_proc_stat_starttime'
      | 'posix_ps_lstart'
      | 'unavailable'

    if (!pidExists(pid)) {
      // Process already gone — nothing to terminate, just reap the sidecar.
      rmSync(sidecarPath, { force: true })
      audit.push({ kind: 'orphan_process', fingerprint: fingerprint(sidecarPath), observedAt: opts.now(), action: 'reaped' })
      continue
    }

    // The sidecar alone — never a committed DB row — is the identity source
    // for this class (§8.1, §9.2 step 4, §10.3): it already carries every
    // field a restart-recovered re-verification needs.
    const currentOsStartMarker = await readCurrentOsStartMarker(pid, osStartMarkerSource)
    let macos: { argv: string | null; expectedShapePrefix: string } | undefined
    if (osStartMarkerSource === 'posix_ps_lstart') {
      const observed = await readMacosProcessObservation(pid)
      macos = { argv: observed.argv, expectedShapePrefix: 'shadow-lifecycle-child.mjs' }
    }
    const verification = verifyRestartRecoveredIdentity({
      durable: {
        correlationId: typeof sidecar.correlationId === 'string' ? sidecar.correlationId : '',
        orcaRunId: typeof sidecar.orcaRunId === 'string' ? sidecar.orcaRunId : '',
        orcaDispatchId,
        processNonce: sidecar.processNonce,
        pid,
        osStartMarker: typeof sidecar.osStartMarker === 'string' ? sidecar.osStartMarker : null,
        osStartMarkerSource
      },
      sidecar: {
        correlationId: typeof sidecar.correlationId === 'string' ? sidecar.correlationId : '',
        orcaRunId: typeof sidecar.orcaRunId === 'string' ? sidecar.orcaRunId : '',
        orcaDispatchId,
        processNonce: sidecar.processNonce
      },
      pidExists: true,
      currentOsStartMarker,
      macos
    })

    if (verification.kind !== 'verified') {
      audit.push({
        kind: 'orphan_process',
        fingerprint: fingerprint(sidecarPath),
        observedAt: opts.now(),
        action: 'skipped_unverifiable'
      })
      continue
    }

    await deps.processPort.requestTerminationByPid(pid, currentKillScope())
    rmSync(sidecarPath, { force: true })
    audit.push({ kind: 'orphan_process', fingerprint: fingerprint(sidecarPath), observedAt: opts.now(), action: 'reaped' })
  }
  return audit
}

export async function reconcileOrphanShadowState(
  deps: ReconcileOrphanShadowStateDeps,
  opts: ReconcileOrphanShadowStateOptions
): Promise<OrphanReapAuditEntry[]> {
  const nowMs = Date.parse(opts.now())
  const [worktreeAudit, processAudit] = await Promise.all([
    reconcileOrphanWorktrees(deps, opts, nowMs),
    reconcileOrphanProcesses(deps, opts, nowMs)
  ])
  return [...worktreeAudit, ...processAudit]
}
