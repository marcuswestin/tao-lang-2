# DEVENV-018 — Semantic facts and coverage commands

- **Status:** Resolved
- **Area:** Semantic Studio tooling
- **Impact:** Feature agents lack direct CLI access to the fact and coverage views they need for grounded
  planning and review.
- **Evidence:** The semantic-agent branch had no fact/coverage CLI. On `feat/devenv-host-followups`,
  `tao facts` and `tao coverage` expose the shared semantic model as `tao-semantic-facts-v1` and
  `tao-semantic-coverage-v1` JSON. Focused CLI tests exercise real facts, the complete coverage
  envelope, typed missing-app behavior, and Git-ignored stale sources; they passed 4/4.
- **Workaround:** Call internal modules from temporary scripts or inspect Studio output.
- **Proposed change:** Implemented: add stable read-only CLI commands over the merged semantic model.
- **Dependencies:** DEVENV-017, settled in the same branch.
- **Acceptance:** Commands produce versioned machine-readable output and focused tests exercise real
  project facts and coverage.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
- **Archived:** 2026-09-20
