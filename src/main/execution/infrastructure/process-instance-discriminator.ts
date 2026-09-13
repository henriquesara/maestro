import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { runProcess, runProcessSync } from '../../../shared/child-process/run-process'
import { queryWindowsProcessIdentity } from '../../daemon/daemon-process-identity-query'
import type { OsStartMarkerSource } from '../domain/dispatch-process-binding'

// Execution bounded context — infrastructure. ORCA-S4 SPEC §4, §9.1, §9.2 step
// 4 — the OS-observable process-instance discriminator: captured once at
// spawn time, re-read from the OS (never from the sidecar or the DB) at
// restart-recovery time for exact comparison. Sourced from the same
// primitives this repository already uses elsewhere for PID-reuse-safe
// identity (§4): Windows process creation-time; POSIX `/proc/<pid>/stat`'s own
// `starttime` field on Linux (stable — ticks since boot); `ps -o lstart=` on
// macOS (reusing the same call shape `getPsProcessIdentity` already performs,
// `daemon-process-identity-query.ts`) — with the accepted hardening: `-ww`
// (unlimited width) so a long command line is never silently truncated into a
// false mismatch. Every subprocess spawn here goes through
// `runProcess`/`runProcessSync` (AGENTS.md: never `child_process` directly) —
// never a raw `execFile`/`execFileSync`.
//
// §9.2 step 4 requires the marker be captured as part of the synchronous
// spawn-time step (obtain pid -> read marker -> rewrite sidecar, all before
// the DB transaction opens), so the capture path is synchronous; restart-
// recovery corroboration (§9.1.2) is not time-critical and reads
// asynchronously to avoid blocking the sweep's event loop on the CIM/`ps` spawn.

const PS_TIMEOUT_MS = 2_000

export type OsMarkerCapture = { osStartMarker: string | null; osStartMarkerSource: OsStartMarkerSource }

const windowsCimScript = (pid: number): string =>
  `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; ` +
  `if ($p -and $p.CreationDate) { [long]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }`

/** §9.2 step 4 — captured synchronously, immediately after spawn() obtains a pid. */
export function captureOsStartMarkerSync(pid: number): OsMarkerCapture {
  if (process.platform === 'win32') {
    try {
      const result = runProcessSync({
        program: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', windowsCimScript(pid)],
        timeoutMs: 3_000
      })
      const stdout = result.stdout.trim()
      return stdout && /^\d+$/.test(stdout)
        ? { osStartMarker: stdout, osStartMarkerSource: 'windows_creation_time' }
        : { osStartMarker: null, osStartMarkerSource: 'unavailable' }
    } catch {
      return { osStartMarker: null, osStartMarkerSource: 'unavailable' }
    }
  }
  if (process.platform === 'darwin') {
    const lstart = captureMacosLstartSync(pid)
    return lstart !== null
      ? { osStartMarker: lstart, osStartMarkerSource: 'posix_ps_lstart' }
      : { osStartMarker: null, osStartMarkerSource: 'unavailable' }
  }
  const starttime = readLinuxProcStatStarttimeSync(pid)
  return starttime !== null
    ? { osStartMarker: starttime, osStartMarkerSource: 'posix_proc_stat_starttime' }
    : { osStartMarker: null, osStartMarkerSource: 'unavailable' }
}

/** Re-read asynchronously at restart-recovery time — never trusted from the sidecar or the DB. */
export async function readCurrentOsStartMarker(pid: number, source: OsStartMarkerSource): Promise<string | null> {
  if (source === 'unavailable') {
    return null
  }
  if (source === 'windows_creation_time') {
    const identity = await queryWindowsProcessIdentity(pid)
    return identity && identity.startedAtMs !== null ? String(identity.startedAtMs) : null
  }
  if (source === 'posix_ps_lstart') {
    return (await readMacosProcessObservation(pid)).lstart
  }
  return (await readLinuxProcStatStarttime(pid)) ?? null
}

/**
 * §9.1.3, accepted hardening #1 — the SAME `ps -p <pid> -o lstart= -o
 * command=` call shape `getPsProcessIdentity` already performs, with `-ww`
 * added so a long command line is never truncated to a terminal-width default
 * into a false argv mismatch.
 */
export async function readMacosProcessObservation(
  pid: number
): Promise<{ lstart: string | null; argv: string | null }> {
  try {
    const result = await runProcess({
      program: 'ps',
      args: ['-ww', '-p', String(pid), '-o', 'lstart=', '-o', 'command='],
      timeoutMs: PS_TIMEOUT_MS
    })
    return parseLstartCommand(result.stdout)
  } catch {
    return { lstart: null, argv: null }
  }
}

function captureMacosLstartSync(pid: number): string | null {
  try {
    const result = runProcessSync({
      program: 'ps',
      args: ['-ww', '-p', String(pid), '-o', 'lstart='],
      timeoutMs: PS_TIMEOUT_MS
    })
    const trimmed = result.stdout.trim()
    return trimmed || null
  } catch {
    return null
  }
}

function parseLstartCommand(stdout: string): { lstart: string | null; argv: string | null } {
  // BSD ps formats lstart as a fixed-width 24-character timestamp.
  const lstart = stdout.slice(0, 24)
  const command = stdout.slice(24).trim()
  return { lstart: lstart.trim() ? lstart : null, argv: command || null }
}

async function readLinuxProcStatStarttime(pid: number): Promise<string | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    return parseLinuxStarttime(stat)
  } catch {
    return null
  }
}

function readLinuxProcStatStarttimeSync(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return parseLinuxStarttime(stat)
  } catch {
    return null
  }
}

function parseLinuxStarttime(stat: string): string | null {
  // Field 2 (comm) is parenthesized and may itself contain ')'; the LAST ')'
  // in the line reliably ends it. Everything after is space-separated fields
  // 3..N. starttime is field 22 overall = the 20th token (1-indexed) in that
  // remainder (proc(5)).
  const lastParen = stat.lastIndexOf(')')
  if (lastParen === -1) {
    return null
  }
  const rest = stat
    .slice(lastParen + 1)
    .trim()
    .split(/\s+/)
  const starttime = rest[19] // 0-indexed 20th token
  return starttime && /^\d+$/.test(starttime) ? starttime : null
}
