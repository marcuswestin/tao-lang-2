# DEVENV-063 — Studio preview needs the materialized Watchman profile in managed task shells

- **Status:** Candidate
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
- **Workaround:** Run Studio acceptance from a shell that has loaded the materialized devenv profile;
  in a managed task shell, prepend this checkout's `.devenv/profile/bin` once before launching the
  lane.
- **Proposed change:** Make the Studio launch preflight resolve the pinned Watchman executable or fail
  early with the exact profile remediation before Metro falls back to the launchd-limited watcher.
- **Dependencies:** DEVENV-015 remains the later Chrome/LaunchServices boundary once Metro starts.
- **Acceptance:** A managed-shell Studio launch either uses the pinned Watchman and reaches browser
  dispatch or stops before Metro with an actionable profile diagnostic; it never ends in Node
  watcher's `EMFILE` fallback.
- **Source:** 2026-09-16 September remediation acceptance.
