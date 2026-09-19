# DEVENV-029 — Materialized development profile and writable caches

- **Status:** Resolved
- **Area:** Managed worktrees
- **Impact:** Re-resolving devenv and writing Watchman or tool caches outside permitted roots can fail.
- **Evidence:** Root instructions use the materialized `.devenv/profile`; repository runners disable
  Watchman and use named writable cache roots. Expo's remaining cache move is incoming as DEVENV-013.
- **Workaround:** Export the materialized profile path in a managed shell as documented in `AGENTS.md`.
- **Proposed change:** Keep new tools inside the same cache/profile conventions.
- **Dependencies:** DEVENV-013 for Expo.
- **Acceptance:** Setup, focused tests, and formatting run without user-cache overrides.
- **Source:** 2026-09-03 consolidated implementation notes.
- **Archived:** 2026-09-19
