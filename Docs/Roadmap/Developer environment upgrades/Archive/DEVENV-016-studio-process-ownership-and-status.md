# DEVENV-016 — Studio process ownership and status

- **Status:** Resolved
- **Area:** Studio lifecycle
- **Impact:** `studio-stop --all` can report success while a Browser-pane server survives, and
  `studio-ps` can report `UNDETERMINED` when process inspection is denied.
- **Evidence:** Reproduced during semantic-agent development; a surviving server can make later
  verification exercise stale code.
- **Workaround:** Check lifecycle logs and ports from an unrestricted terminal before trusting a restart.
- **Proposed change:** Give every launch durable ownership metadata, stop by that ownership rather than
  unrestricted process listing, and distinguish denied inspection from stopped state.
- **Dependencies:** Resolved by the manifest-backed lifecycle implementation on current `main`.
- **Acceptance:** Stop-all removes every owned server in browser and native modes; status never reports a
  stale process as stopped.
- **Resolution (2026-09-20):** The focused Studio launch-manifest and lifecycle suite passed 25/25 at
  `7b7dc0bc`. It proves ownership before signaling, refuses unknown or reused PIDs, preserves manifests
  when a process survives, requires `--all` for multiple launches, and reports indeterminate state
  instead of declaring an uninspectable process stopped.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
- **Archived:** 2026-09-20
