# DEVENV-016 — Studio process ownership and status

- **Status:** Planned
- **Area:** Studio lifecycle
- **Impact:** `studio-stop --all` can report success while a Browser-pane server survives, and
  `studio-ps` can report `UNDETERMINED` when process inspection is denied.
- **Evidence:** Reproduced during semantic-agent development; a surviving server can make later
  verification exercise stale code.
- **Workaround:** Check lifecycle logs and ports from an unrestricted terminal before trusting a restart.
- **Proposed change:** Give every launch durable ownership metadata, stop by that ownership rather than
  unrestricted process listing, and distinguish denied inspection from stopped state.
- **Dependencies:** All Studio lifecycle branches must land first.
- **Acceptance:** Stop-all removes every owned server in browser and native modes; status never reports a
  stale process as stopped.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
