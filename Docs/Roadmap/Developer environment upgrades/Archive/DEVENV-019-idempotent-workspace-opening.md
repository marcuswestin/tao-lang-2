# DEVENV-019 — Idempotent workspace opening

- **Status:** Resolved
- **Area:** Language workspace
- **Impact:** Opening the same root twice can misbehave or hang, which affects long-lived tools and
  performance checks.
- **Evidence:** The reported hang no longer reproduced on current `main`: the existing lifecycle suite
  passed 19/19. Inspection showed explicit semantics already exist: `Workspace.open` creates independent
  in-memory contexts and `Workspace.shared` is the resolved-root process cache. A mutation-tested
  concurrent duplicate-open case now pins two independent contexts parsing the same project without a
  hang; the focused suite passed 20/20.
- **Workaround:** Reuse one open workspace per root or close it before reopening.
- **Proposed change:** Implemented: retain explicit fresh-context `open` and opt-in cached `shared`
  semantics, with a bounded concurrent lifecycle proof.
- **Dependencies:** None.
- **Acceptance:** A focused lifecycle test opens the same root twice without a hang or leaked service.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
- **Archived:** 2026-09-20
