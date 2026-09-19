# DEVENV-008 — Collision-proof test artifacts

- **Status:** Resolved
- **Area:** Test logging
- **Impact:** Concurrent `./agent test` processes can target the same millisecond-named log directory.
- **Evidence:** `RunArtifacts.runStamp` currently contains only an ISO timestamp.
- **Workaround:** Start runs in different milliseconds.
- **Proposed change:** Add PID and random entropy while retaining deterministic injected stamps in tests.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `5512f785`.
- **Acceptance:** Concurrent location creation produces distinct run roots and both summaries survive.
- **Source:** 2026-09-03 freehand implementation notes.
- **Archived:** 2026-09-19
