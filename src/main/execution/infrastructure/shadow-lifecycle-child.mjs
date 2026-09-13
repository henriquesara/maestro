// ORCA-S4 SPEC §4 "Shadow lifecycle process" — the explicitly synthetic,
// Execution-spawned fixture `ShadowLifecycleProcessAdapter.spawn()` launches.
// NOT a workload executor. NOT proof of production process-handle acquisition
// (§5). Its sole purpose is to give S4 a real OS process/process-group to
// durably bind, observe, and tear down. Plain ESM, zero project imports (kept
// minimal and dependency-free since it is spawned as a bare `node` process).
//
// The `--processNonce=<nonce>` argv token is embedded verbatim, on EVERY
// platform (§9.2 step 4), so the macOS-only restart-recovered corroboration
// (§9.1.3) can read it back from a live process's argv via `ps -o command=`.
//
// argv: --processNonce=<nonce> [--self-exit-code=<n>]
//   default (no --self-exit-code): hangs until terminated.
//   --self-exit-code=<n>: exits with code <n> shortly after starting — used
//   only by test/self-exit fixtures; a real spawned dispatch never requests this.

const args = process.argv.slice(2)
const selfExitArg = args.find((a) => a.startsWith('--self-exit-code='))

if (selfExitArg) {
  const code = Number(selfExitArg.slice('--self-exit-code='.length))
  setTimeout(() => process.exit(Number.isFinite(code) ? code : 0), 50)
} else {
  // Hangs until the adapter's requestTermination / requestTerminationByPid
  // signals it (or the host process dies with it, per detached: true's own
  // process-group semantics on POSIX / job-object semantics on Windows).
  setInterval(() => {}, 1000)
}
