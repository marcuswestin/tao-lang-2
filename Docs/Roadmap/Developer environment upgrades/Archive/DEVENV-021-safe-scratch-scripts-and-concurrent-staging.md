# DEVENV-021 — Safe scratch scripts and concurrent staging

- **Status:** Resolved
- **Area:** Repository hygiene
- **Impact:** Package-aware diagnostic scripts have no ignored location with normal alias resolution;
  source-tree scratch files can be accidentally committed by broad staging during concurrent work.
- **Evidence:** Intermediate semantic-agent commits contained scratch files after a read-only reviewer
  wrote into the tree and another process used broad directory staging. Before the fix,
  `git check-ignore --no-index packages/compiler/.scratch/diagnostic.ts` exited 1. On
  `feat/devenv-host-followups`, `packages/*/.scratch/` is ignored, a disposable script resolved both
  package aliases and a workspace dependency, the focused ignore test passed 1/1, and root guidance
  forbids broad staging around concurrent writers.
- **Workaround:** Put scripts under `.artifacts`, supply explicit resolver configuration, and stage exact
  paths only.
- **Proposed change:** Implemented: add a package-local ignored scratch convention and durable exact-path
  staging guidance.
- **Dependencies:** None.
- **Acceptance:** A package scratch script resolves aliases/dependencies, stays untracked, and the workflow
  documentation forbids broad staging around concurrent writers.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
- **Archived:** 2026-09-20
