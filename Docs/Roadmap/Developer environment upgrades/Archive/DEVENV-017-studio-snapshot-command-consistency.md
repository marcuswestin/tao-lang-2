# DEVENV-017 — Studio snapshot command consistency

- **Status:** Resolved
- **Area:** Semantic Studio tooling
- **Impact:** The CLI validates a snapshot differently from the server, diagnostic counts are not
  comparable, and entry paths can fail as raw host `ENOENT`s.
- **Evidence:** Snapshot CLI previously validated before parsing while the server parsed directly;
  project-relative entry resolution was unspecified. On `feat/devenv-host-followups`, the Tao CLI and
  real `StudioProjectSession` now call the same `loadSemanticSnapshot` orchestration, with Studio
  supplying its live workspace validator. A real-session parity test pins identical ordered diagnostics,
  and CLI tests pin project-relative and invalid entry behavior without raw `ENOENT` leakage.
- **Workaround:** Use an absolute existing entry and compare raw diagnostics manually.
- **Proposed change:** Implemented: share one validated snapshot loader and resolve CLI entry paths against
  the named project root with typed user-facing errors.
- **Dependencies:** Settled on `feat/devenv-host-followups`.
- **Acceptance:** CLI and server return the same diagnostic model for identical input; relative and invalid
  entries have pinned behavior.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
- **Archived:** 2026-09-20
