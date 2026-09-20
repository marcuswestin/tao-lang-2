# DEVENV-063 — Studio preview needs the materialized Watchman profile in managed task shells

- **Status:** Resolved
- **Area:** Studio preview host
- **Impact:** Studio can reach Expo successfully and then fail before browser dispatch with
  `EMFILE: too many open files, watch`, preventing the browser and native acceptance lanes from
  distinguishing product behavior from host watcher exhaustion.
- **Evidence:** During September-remediation acceptance, the task shell omitted the linked
  `.devenv/profile/bin` from `PATH`, so Metro could not find Watchman and fell back to Node watching.
  The shell reported a high `ulimit -n`, but `launchctl limit maxfiles` retained a 256 soft limit.
  The pinned `.devenv/profile/bin/watchman --version` succeeded as `2026.01.19.00`.
  Reproduced again on 2026-09-20 after fresh `./agent setup`: the real HNReader smoke passed its
  compile/edit/undo case, then Watchman failed opening its LaunchAgent plist and Metro fell back to
  Node watching, ending in `EMFILE` before browser dispatch.
  The 2026-09-20 fix first reproduced that fallback from a fresh worktree. The same smoke then stopped
  before Metro with `HostEnvironmentError`: the pinned Watchman could not establish a watch because
  macOS denied its LaunchAgent write, and the diagnostic directed the developer to an ordinary host
  shell. A later real-app smoke exposed that Metro's separate no-spawn capability/socket discovery
  could still choose Node watching after a successful `watch-project`. The completed fix mirrors that
  capability probe, passes its proven socket as `WATCHMAN_SOCK`, then verifies `watch-project`; the
  real-app smoke now stops before Metro with the actionable host diagnostic and no `EMFILE`.
- **Workaround:** Run Studio acceptance from an ordinary host shell where Watchman can use
  `~/Library/LaunchAgents`.
- **Proposed change:** Implemented: Studio proves Metro's no-spawn capability and socket path, proves the
  generated preview runtime is watchable with the repository-pinned Watchman, places the profile first
  in Metro's child `PATH`, and refuses to start Metro with an actionable host diagnostic rather than
  allowing the Node watcher fallback.
- **Dependencies:** DEVENV-015 remains the later Chrome/LaunchServices boundary once Metro starts.
- **Acceptance:** A managed-shell Studio launch either uses the pinned Watchman and reaches browser
  dispatch or stops before Metro with an actionable profile diagnostic; it never ends in Node
  watcher's `EMFILE` fallback.
- **Source:** 2026-09-16 September remediation acceptance.
- **Archived:** 2026-09-20
