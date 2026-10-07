# DEVENV-CHROME-FORKED-CHILD-CRASHES-DURING-SHUTDOWN — Chrome forked child crashes during shutdown

- **Status:** Resolved
- **Area:** Owned headless Studio browser lifecycle on macOS.
- **Impact:** A successful browser test can leave a macOS Chrome crash alert when a short-lived child receives a shutdown signal during its pre-exec fork window.
- **Evidence:** The October 7, 2026 report records Chrome 154.0.8037.98 child PID 34614, launched at 17:49:46.8236 EDT and trapped at 17:49:46.8907 EDT. It says `crashed on child side of fork pre-exec`. Offline disassembly of the installed framework with the report's matching UUID identifies the failed `g_pipe_pid == getpid()` check in the graceful-shutdown signal handler; the literal address and length match the crashed registers. An October 6 report has the identical offsets and UUID. The October 7 trap falls between the Studio measurement report at 17:49:46.714 and Studio shutdown at 17:49:46.975, when browser cleanup runs. The shutdown signal sender and original fork producer were not recorded, so attributing the trigger to the whole-tree SIGTERM remains strongly supported inference.
- **Workaround:** None required for normal owned Studio browser close after this change.
- **Proposed change:** Studio sends CDP `Browser.close` while the connection remains open, first arming a supervised one-second natural-shutdown grace. The supervisor retains exact process/output ownership and waits for children after parent exit; only surviving owned processes receive SIGKILL at the deadline. Generic process callers keep their existing shutdown policy. With a repository or explicit artifact root, browser shutdown journals retain the executable, process start identity, profile, phases, direct exit status, and bounded stderr on successful and failed closes. Standalone callers outside Git keep their existing support. Ownership-capture failures retain the profile for diagnosis.
- **Dependencies:** Installed Chrome/Chromium for host acceptance; macOS diagnostic reports for the crash-report observation.
- **Acceptance:** Real-process regressions prove no premature SIGTERM, cleanup after a successful root exits with a live descendant, preservation of exit 7 with surviving children, a bounded stalled-root fallback, and invalid grace rejection. Removing the exit-time grace guard fails the lifecycle regression; inserting an early CDP disconnect fails the ordering regression. Two explicit headless `studio-chrome-shutdown` proofs completed 40 launch/navigation/close cycles each in 45.1 and 40.0 seconds: 80 natural code-0 exits, no forced cleanup, no matching stderr assertion and no new Chrome reports. All four HNReader browser journeys also passed in 90.0 seconds, including edits, undo, persisted state and preview refresh. These observations qualify the normal close path, not every possible future Chrome crash.
- **Source:** Developer-provided October 7 crash report; `StudioCdp`, shared `CLI` supervision, `process-supervision.test.ts`, `studio-cdp.test.ts`, and `studio-chrome-shutdown.test.ts`.
- **Archived:** 2026-10-07

## Remaining boundaries

The four older Chrome Helper SIGABRT reports and the separate October 2 Crashpad
handler SIGTRAP have not been established as this failure. The app-dev Chrome
launcher has a separate lifecycle. Abrupt outer-runner cancellation can also
bypass an orderly browser close. Retain and correlate new reports and shutdown
journals before attributing those paths to this resolved normal-close defect.

Chromium documents the inherited-handler guard in its
[shutdown signal implementation](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/shutdown_signal_handlers_posix.cc);
[CDP Browser.close](https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-close)
requests graceful browser shutdown. The binary matching the supplied report,
rather than upstream HEAD alone, established the exact trap.

Repeat the explicit host acceptance from the feature worktree root:

```sh
just studio-chrome-shutdown chrome-shutdown-check
```
