# DEVENV-MACOS-STARTUP-AFTER-CACHE-CLEANUP-NEEDS-VERIFICATION — macOS startup after cache cleanup needs verification

- **Status:** Planned
- **Section:** External
- **Area:** Host startup; temporary-file and test-cache lifecycle.
- **Impact:** Repository cache protections and cleanup are complete, but normal macOS startup after cleanup has not been confirmed.
- **Evidence:** The cache lifecycle work landed in `59b4ea8067ef2badb8e6a9813f8e14ca3e6f3141`. On 2026-09-26 at 17:58:45 EDT, the inactive legacy `~/.cache/tao/jest-transform-cache` and `~/.cache/tao/jest-standalone` trees were removed; managed v2 caches were preserved. Earlier startup evidence showed a prolonged `dirhelper` wait, but did not prove Tao caused it. See [the archived cache-growth finding](Archive/DEVENV-JEST-CACHE-IDENTITIES-AND-DIRECT-RUNS-GROW-WITHOUT-BOUND.md). On 2026-09-26 the Developer deferred restarting because many processes were still running.
- **Workaround:** Defer the restart until active work can be saved and jobs stopped normally. No restart is needed to finish the cleanup task.
- **Proposed change:** At a convenient quiet time, complete the manual startup checks below and record the outcome here. If startup still stalls, capture timing and current-boot evidence before choosing another fix.
- **Dependencies:** A Developer-chosen restart window; normal Terminal access to macOS unified logs.
- **Acceptance:** Record restart-to-login and unlock-to-usable-desktop timings after cleanup, then repeat after representative Tao development and test activity to check for recurrence. Confirm there is no prolonged cleanup stall. If a stall recurs, retain this entry with the measured phase and relevant logs; do not infer causality solely from a slow or successful boot.
- **Source:** Summary/cache cleanup task; Developer follow-up on 2026-09-26 explicitly deferring startup confirmation.

## Manual confirmation

1. Save work and stop active jobs when convenient. Use the normal Apple menu **Restart** action.
2. Note how long restart-to-login and unlock-to-usable-desktop take, and where any stall occurs.
3. Within 30 minutes of login, run these commands in a normal Terminal. Each run gets a separate evidence directory:

   ```sh
   cd /Users/ro/code/tao-lang-2
   startup_report_dir=".artifacts/startup-confirmation/$(date +%Y%m%d-%H%M%S)"
   mkdir -p "$startup_report_dir"
   /usr/sbin/sysctl kern.boottime > "$startup_report_dir/boot-time.txt"
   /usr/bin/log show --last 30m --info --style compact \
     --predicate 'process == "dirhelper" OR (process == "launchd" AND (eventMessage CONTAINS[c] "dirhelper" OR eventMessage CONTAINS[c] "boot"))' \
     > "$startup_report_dir/startup.log"
   printf 'Evidence saved in %s\n' "$startup_report_dir"
   ```

4. Record the timings, any visible stall, and the evidence path in this entry. Logs can explain a measured delay; absent log messages alone do not prove startup is healthy.
5. After representative Tao development and test activity, repeat at another convenient restart. Close the entry when both observations meet acceptance, or turn the remaining evidence into a specific follow-up.
