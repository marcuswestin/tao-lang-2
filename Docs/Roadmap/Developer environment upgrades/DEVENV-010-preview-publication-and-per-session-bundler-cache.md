# DEVENV-010 — Preview publication and per-session bundler cache

- **Status:** Incoming
- **Area:** Studio preview startup
- **Impact:** A bundler can crawl before the preview app exists, and shared file-map state can survive a
  closed session.
- **Evidence:** Fixed on `poc/semantic-agent-implementation` by commits `84511589` and `1dcf99d6`.
- **Workaround:** Restart the affected preview session.
- **Proposed change:** Re-verify the incoming ordering and lifecycle fixes after merge; do not reimplement.
- **Dependencies:** Semantic-agent branch must land.
- **Acceptance:** Reproduction tests remain green on merged `main` with isolated session caches.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
