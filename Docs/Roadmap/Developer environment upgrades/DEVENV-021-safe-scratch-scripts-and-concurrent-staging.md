# DEVENV-021 — Safe scratch scripts and concurrent staging

- **Status:** Planned
- **Area:** Repository hygiene
- **Impact:** Package-aware diagnostic scripts have no ignored location with normal alias resolution;
  source-tree scratch files can be accidentally committed by broad staging during concurrent work.
- **Evidence:** Intermediate semantic-agent commits contained scratch files after a read-only reviewer
  wrote into the tree and another process used broad directory staging.
- **Workaround:** Put scripts under `.artifacts`, supply explicit resolver configuration, and stage exact
  paths only.
- **Proposed change:** After active `.gitignore` changes land, add a package-local ignored scratch
  convention and durable exact-path staging guidance.
- **Dependencies:** Companion `.gitignore` changes must land first. The freehand prerequisite landed in
  `13d2577c`; the package-local scratch convention and exact-staging guidance remain open.
- **Acceptance:** A package scratch script resolves aliases/dependencies, stays untracked, and the workflow
  documentation forbids broad staging around concurrent writers.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
