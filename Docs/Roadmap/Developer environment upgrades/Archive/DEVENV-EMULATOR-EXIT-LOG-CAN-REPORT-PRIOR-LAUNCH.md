# DEVENV-EMULATOR-EXIT-LOG-CAN-REPORT-PRIOR-LAUNCH — Emulator exit can report a prior launch's failure

- **Status:** Resolved
- **Area:** Android emulator, dev-loop diagnostics, temporary state
- **Impact:** A newly started emulator that exits before booting can show the reason from an
  earlier attempt, sending the Developer to the wrong remedy. The fast-exit improvement in
  `cdcefefc` makes that stale reason visible immediately.
- **Evidence:** Static review of `main` at `c4b62744`, 2026-09-24. `ensureEmulator`
  reuses `$TMPDIR/tao-android-emulator.log`; `startEmulator` opens it for append; the exit
  path reads the whole log, and `emulatorExitMessage` chooses the first `Incompatible
  processor` line anywhere in it. A later process that writes no line can therefore report
  that earlier processor failure. No second launch was run to measure frequency. The repair in
  `04831016` uses a distinct log for each launch and ownership receipts before opening it. A
  focused regression writes two different failure logs and reads only the later one; liveness,
  PID-reuse, interruption, and bounded-retention controls passed. Real emulator use remains
  unmeasured.
- **Workaround:** Read the latest launch's own log lines before acting on an exit reason.
  Preserve the shared log until its active writers are known.
- **Proposed change:** Each newly launched emulator now has a distinct log used only for its exit
  diagnosis. A sidecar receipt records the owner and detached child identities; ordinary startup
  prunes dead owned logs to the two newest failures within seven days and 16 MiB while preserving
  live, uncertain, and unowned state. The legacy shared log is left untouched.
- **Dependencies:** `cdcefefc` was integrated into the review branch before this repair.
- **Acceptance:** A focused failed-launch regression writes an earlier processor failure,
  then starts a second emulator that exits without that line; the second error reports
  only its own evidence. Concurrent launch and interrupted-run controls prove logs are
  neither mixed nor deleted while live.
- **Source:** September 2026 recurring repository review continuation, 2026-09-24.
- **Archived:** 2026-09-25
