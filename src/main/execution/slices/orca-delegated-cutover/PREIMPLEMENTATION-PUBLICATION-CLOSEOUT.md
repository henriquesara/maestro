# ORCA-S5 Pre-Implementation Seam — Publication Closeout

Docs-only closeout record. Does not amend, replace, or supersede the
frozen SPEC or the accepted technical history below.

## Identity

- Frozen architecture HEAD: `7c1796e82c53de53f0a028123defbe53974eb652`
- Published technical HEAD: `eed09b3047db4f71d25763c215335a2f2db0b403`
- This closeout commit: `DOCS_ONLY_CLOSEOUT` — evidence/documentation only,
  never a replacement for the technical HEAD above.

## Complete technical history

```
architecture (7c1796e8)
  → initial RED             (0a1bf4c2)
  → RED completion          (c75a76bd)
  → initial GREEN           (9b31fb6a)
  → focused RED #1          (5e1f355ac0)
  → focused GREEN #1        (ce0521e2)
  → focused RED #2          (5bde27ac)
  → focused GREEN #2        (eed09b30)
```

Linear, zero merge commits, SPEC byte-identical to the frozen architecture
HEAD throughout.

## PRE_IMPLEMENTATION seam status

IMPLEMENTED / ACCEPTED / PUBLISHED.

Full ORCA-S5 delegated cutover: **NOT STARTED**.

## Accepted residuals

- **ASYNC_LATE_SELF_DEPENDENCY** —
  `UNREACHABLE_IN_CURRENT_PRODUCTION_CALLBACK_GRAPH_ACCEPTED_RESIDUAL`.
  See `FOCUSED-REVIEW-BLOCKER-FIX-2-REENTRANT-SELF-DEPENDENCY-EVIDENCE.md`
  for the full record and future-trigger condition.
- **Evidence-baseline scope clarification** — the "16 failed / 32 failed"
  and "15 failed / 864 passed / 5 skipped / 30 failed / 8826 passed / 67
  skipped" figures recorded across `PREIMPLEMENTATION-RED-EVIDENCE.md`,
  `PREIMPLEMENTATION-GREEN-EVIDENCE.md`, and
  `FOCUSED-REVIEW-BLOCKER-FIX-EVIDENCE.md` were scoped sweeps over
  `src/main/providers src/main/ipc/pty src/main/runtime`, not the complete
  repository test suite (repository-wide: 8,058 `*.test.ts`/`*.test.tsx`
  files, directly counted during this closeout). Each file now carries an
  inline ERRATA / PUBLICATION CLARIFICATION note; the historical numbers
  were not erased.

## PRE_LIVE_ACTIVATION dependencies still open

- aiControl R3
- aiControl terminal-projector DIVERGENCE fix
- Optional cancel-route UX hardening

## Authority

- Authority: `AICONTROL_NATIVE`
- `ORCA_DELEGATED`: NOT STARTED
- Fence acquisition: DISABLED
- M5: NOT STARTED
