# DEVENV-024 — Branch-local semantic cleanup

- **Status:** Blocked
- **Area:** Worktree hygiene
- **Impact:** The semantic-agent worktree contains a modified WordFlower design file, and its intermediate
  history included scratch artifacts that must not reach a squash.
- **Evidence:** `Apps/WordFlower/1 - Current/Design.tao` was intentionally left modified; the briefing names
  the intermediate scratch commits.
- **Workaround:** Preserve the worktree and review its exact final squash diff.
- **Proposed change:** The owning branch decides the design-file disposition and verifies the squash omits
  scratch artifacts.
- **Dependencies:** Owned exclusively by `poc/semantic-agent-implementation`; this project must not edit
  that worktree.
- **Acceptance:** The branch lands with an intentional Design change or a clean restoration, and no scratch
  file appears in the squash.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
