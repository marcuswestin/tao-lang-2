# DEVENV-010 — Preview publication and per-session bundler cache

- **Status:** Resolved
- **Area:** Studio preview startup
- **Impact:** A bundler can crawl before the preview app exists, and shared file-map state can survive a
  closed session.
- **Evidence:** Fixed on `poc/semantic-agent-implementation` by commits `84511589` and `1dcf99d6`.
- **Workaround:** Restart the affected preview session.
- **Proposed change:** Re-verify the incoming ordering and lifecycle fixes after merge; do not reimplement.
- **Dependencies:** Resolved on current `main`; equivalent behavior landed through the current Studio
  startup and runtime Metro-cache implementation.
- **Acceptance:** Reproduction tests remain green on merged `main` with isolated session caches.
- **Resolution (2026-09-20):** Reverified at `7b7dc0bc`: the focused Studio development suite passed
  56/56 and the runtime Metro configuration suite passed 7/7. The current implementation compiles the
  preview before Metro starts and keeps Metro's disposable file-map cache inside the session runtime.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
- **Archived:** 2026-09-20
