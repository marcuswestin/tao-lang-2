# DEVENV-063 — Studio preview needs the materialized Watchman profile in managed task shells

- **Status:** Candidate
- **Section:** External
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
  Regressed on 2026-09-22 in `feat/studio-companion-slice-3`: `./agent studio-smoke`
  passed the Watchman preflight and started Metro, but Metro fell back to Node watchers and failed
  with `EMFILE`. The pinned `list-capabilities --no-spawn` and `get-sockname --no-spawn` succeeded
  afterward, while `watch-list` attempted a denied LaunchAgent write. The no-spawn probes alone do
  not prove a running daemon remains reachable for Metro.
- **Workaround:** Run Studio acceptance from an ordinary host shell where Watchman can use
  `~/Library/LaunchAgents`.
- **Proposed change:** Keep the existing pinned profile and generated-runtime watch preflight, then
  detect a daemon that disappears or becomes unreachable between preflight and Metro's crawler.
  Refuse startup with a host diagnostic when that happens, rather than presenting Node watcher
  `EMFILE` as a product failure. Confirm the same smoke from an ordinary host shell.
- **Dependencies:** DEVENV-015 remains the later Chrome/LaunchServices boundary once Metro starts.
- **Acceptance:** A managed-shell Studio launch either uses the pinned Watchman and reaches browser
  dispatch or stops before Metro with an actionable profile diagnostic; it never ends in Node
  watcher's `EMFILE` fallback.
- **Source:** 2026-09-16 September remediation acceptance.
