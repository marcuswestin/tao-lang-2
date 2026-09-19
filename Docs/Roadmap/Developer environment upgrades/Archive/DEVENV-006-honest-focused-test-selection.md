# DEVENV-006 — Honest focused-test selection

- **Status:** Resolved
- **Area:** Test runner
- **Impact:** A mistyped name pattern can execute zero tests and still report success; running one Jest
  file requires an undiscoverable local command.
- **Evidence:** Bun suites use `--pass-with-no-tests` so package-local zero matches do not fail the
  aggregate, and no exact-file repository command exists.
- **Workaround:** Read raw runner output and invoke package-local Jest with `--no-watchman` manually.
- **Proposed change:** Count reporter test cases across suites, fail a filtered aggregate at zero, and
  add exact-file routing for Bun and runtime Jest.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `f5705e9f`.
- **Acceptance:** A nonexistent name exits nonzero; Bun and Jest file paths run through the shared lane
  with repository-local tools and Watchman disabled.
- **Source:** 2026-09-03 semantic-agent and companion implementation notes.
- **Archived:** 2026-09-19
