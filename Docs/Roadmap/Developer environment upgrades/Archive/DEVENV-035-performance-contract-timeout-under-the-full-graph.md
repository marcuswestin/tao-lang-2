# DEVENV-035 — Performance-contract timeout under the full graph

- **Status:** Resolved
- **Area:** Test reliability
- **Impact:** The sandbox full-verification lane could fail even though the performance-contract test
  only launches four fast `just --dry-run` inspections and passes immediately by itself.
- **Evidence:** The test first hit Bun's default five-second timeout while `_ship-bundle-proof` ran beside
  the package-test node; after receiving an explicit 30-second timeout, it timed out again during a
  normal-terminal `verify-full` while an immediate isolated run completed in 107 milliseconds.
- **Workaround:** Re-run the focused performance-check suite after the full lane becomes quiet.
- **Proposed change:** Replace the four nested `just --dry-run` subprocesses with a deterministic repo-lint
  rule that follows recipe references and `{{ VARIABLE }}` gate lists while keeping actual benchmarks
  outside verification.
- **Dependencies:** Resolved on `feat/freehand-ui-sketching-implementation`; no scheduling policy changed.
- **Acceptance:** Focused tests prove direct and variable-mediated benchmark reachability, `_repo-lint`
  passes, and the full package-test lane no longer launches the nested Just inspection.
- **Source:** 2026-09-04 `verify-full-sandbox` acceptance and 2026-09-04 normal-terminal merge verification.
- **Archived:** 2026-09-19
