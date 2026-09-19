# DEVENV-027 — Watchman-free package-local Jest

- **Status:** Resolved
- **Area:** Focused Jest execution
- **Impact:** Global Jest selection and Watchman state can fail in managed environments.
- **Evidence:** The repository runner already invokes its pinned local Jest through the materialized Node
  profile with `--no-watchman`; DEVENV-006 makes the exact-file path discoverable.
- **Workaround:** Use the repository test commands.
- **Proposed change:** Keep local-tool and no-Watchman routing centralized in `TestRunner`.
- **Dependencies:** DEVENV-006 for the public exact-file command.
- **Acceptance:** Runtime Jest file selection never invokes a global binary or Watchman.
- **Source:** 2026-09-03 repository inspection and companion notes.
