# DEVENV-017 — Studio snapshot command consistency

- **Status:** Planned
- **Area:** Semantic Studio tooling
- **Impact:** The CLI validates a snapshot differently from the server, diagnostic counts are not
  comparable, and entry paths can fail as raw host `ENOENT`s.
- **Evidence:** Snapshot CLI validates before parsing while the server parses directly; project-relative
  entry resolution is unspecified in the current branch implementation.
- **Workaround:** Use an absolute existing entry and compare raw diagnostics manually.
- **Proposed change:** Share one validated snapshot loader and resolve CLI entry paths against the named
  project root with typed user-facing errors.
- **Dependencies:** None; the semantic-agent implementation landed in `40be904f`. The shared loader and
  pinned relative-path behavior remain unimplemented.
- **Acceptance:** CLI and server return the same diagnostic model for identical input; relative and invalid
  entries have pinned behavior.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
