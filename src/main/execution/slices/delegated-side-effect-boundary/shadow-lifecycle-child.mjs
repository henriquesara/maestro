// ORCA-S4 §4 "Shadow lifecycle process" / §9.2 step 4 — a SEPARATELY KILLABLE,
// synthetic, self-contained fixture standing in for the real
// `ShadowLifecycleProcessPort` adapter's spawn target (which does not exist
// yet — this is a test-only fixture expressing the contract's shape, mirroring
// `shadow-run-child.mjs`, S1/S2/S3's own pattern). Plain ESM, zero project
// imports (the raw `node` resolver spawning this cannot load the TS Execution
// modules' extensionless imports).
//
// The `--processNonce=<nonce>` argv token is the EXACT stable token §9.2 step 4
// requires: embedded verbatim, on every platform, so the macOS-only restart-
// recovered corroboration (§9.1.3) can read it back from a live process's argv
// via `ps -o command=` without any special-casing in this fixture.
//
// argv: [--processNonce=<nonce>, readyMarkerPath, mode]
//   mode: 'hang' (default) — runs until SIGKILL/SIGTERM.
//         'self-exit'       — writes READY, then exits 0 shortly after.
//         'self-exit-<n>'   — writes READY, then exits with code <n>.

import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const nonceArg = args.find((a) => a.startsWith('--processNonce='))
const rest = args.filter((a) => !a.startsWith('--processNonce='))
const [readyMarker, mode = 'hang'] = rest

if (!nonceArg || !readyMarker) {
  process.stderr.write('shadow-lifecycle-child: missing required argv\n')
  process.exit(2)
}

writeFileSync(readyMarker, 'READY')

if (mode === 'self-exit') {
  setTimeout(() => process.exit(0), 150)
} else if (mode.startsWith('self-exit-')) {
  const code = Number(mode.slice('self-exit-'.length))
  setTimeout(() => process.exit(Number.isFinite(code) ? code : 0), 150)
} else {
  // 'hang' — parent SIGKILLs/SIGTERMs us here, mid-run.
  setInterval(() => {}, 1000)
}
