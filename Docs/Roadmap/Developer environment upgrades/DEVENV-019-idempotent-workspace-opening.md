# DEVENV-019 — Idempotent workspace opening

- **Status:** Planned
- **Area:** Language workspace
- **Impact:** Opening the same root twice can misbehave or hang, which affects long-lived tools and
  performance checks.
- **Evidence:** Observed during semantic-agent development; not isolated from concurrent Workspace work.
- **Workaround:** Reuse one open workspace per root or close it before reopening.
- **Proposed change:** Reproduce on merged `main`, then define and enforce reuse or explicit duplicate-open
  semantics.
- **Dependencies:** None; the freehand and semantic-agent prerequisites are present on current `main`.
  The duplicate-open lifecycle semantics and proof remain open.
- **Acceptance:** A focused lifecycle test opens the same root twice without a hang or leaked service.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
