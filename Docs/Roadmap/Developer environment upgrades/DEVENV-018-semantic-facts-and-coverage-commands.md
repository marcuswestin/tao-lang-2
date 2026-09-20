# DEVENV-018 — Semantic facts and coverage commands

- **Status:** Planned
- **Area:** Semantic Studio tooling
- **Impact:** Feature agents lack direct CLI access to the fact and coverage views they need for grounded
  planning and review.
- **Evidence:** No fact/coverage CLI exists on the semantic-agent branch.
- **Workaround:** Call internal modules from temporary scripts or inspect Studio output.
- **Proposed change:** Add stable read-only CLI commands over the merged semantic model.
- **Dependencies:** DEVENV-017. The underlying Studio fact and coverage tools are present on current
  `main`; only the stable CLI surface remains absent.
- **Acceptance:** Commands produce versioned machine-readable output and focused tests exercise real
  project facts and coverage.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
