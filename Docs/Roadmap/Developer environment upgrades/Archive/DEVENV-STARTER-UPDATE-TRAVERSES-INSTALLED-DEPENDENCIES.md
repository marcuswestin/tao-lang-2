# DEVENV-STARTER-UPDATE-TRAVERSES-INSTALLED-DEPENDENCIES — Starter update traverses installed dependencies

- **Status:** Resolved
- **Area:** Starter regeneration
- **Impact:** Updating shipped skill examples could not regenerate installed starter projects: whole-directory synchronization rejected dependency symlinks.
- **Evidence:** On 2026-09-26, `TAO_UPDATE_STARTERS=1 ./agent test-file packages/cli/tao-cli/cli-tests/creation-starter-notebook.test.ts` and the Pantry counterpart failed on `node_modules/@tao/runtime`. Logs: `.artifacts/logs/agent/test-file/2026-09-26T15-25-28-360Z-91582.log` and `2026-09-26T15-25-28-340Z-91581.log`. The scoped updater regression exercises retained dependency links/content, removed stale authored files, and rejected unexpected source/destination project links before writes.
- **Workaround:** None needed after the scoped updater repair.
- **Proposed change:** The starter updater uses the same authored-file inventory as its byte-for-byte comparison, preserves installed dependencies, and checks ordinary source/destination entries under a repository mutation lock. Shared directory synchronization remains unchanged.
- **Dependencies:** None.
- **Acceptance:** Both reference starters regenerate and compare byte-for-byte, with installed dependency trees preserved. Unexpected authored symlinks remain rejected.
- **Source:** Auth/account-data example migration on `feat/auth-account-data`, 2026-09-26.
- **Archived:** 2026-09-26
