# DEVENV-EMULATOR-EXIT-LOG-CAN-REPORT-PRIOR-LAUNCH — Emulator exit can report a prior launch's failure

- **Status:** Candidate
- **Section:** External
- **Area:** Android emulator, dev-loop diagnostics, temporary state
- **Impact:** A newly started emulator that exits before booting can show the reason from an
  earlier attempt, sending the Developer to the wrong remedy. The fast-exit improvement in
  `cdcefefc` makes that stale reason visible immediately.
- **Evidence:** Static review of current `main` at `c4b62744`, 2026-09-24. `ensureEmulator`
  reuses `$TMPDIR/tao-android-emulator.log`; `startEmulator` opens it for append; the exit
  path reads the whole log, and `emulatorExitMessage` chooses the first `Incompatible
  processor` line anywhere in it. A later process that writes no line can therefore report
  that earlier processor failure. No second launch was run to measure frequency.
- **Workaround:** Read the latest launch's own log lines before acting on an exit reason.
  Preserve the shared log until its active writers are known.
- **Proposed change:** Give each newly launched emulator a distinct log and use only that
  file for its exit diagnosis. Account for owner and liveness before bounded retirement
  so failed and interrupted attempts remain inspectable without unbounded accumulation.
- **Dependencies:** Integrate `cdcefefc` into the review branch before applying its repair.
- **Acceptance:** A focused failed-launch regression writes an earlier processor failure,
  then starts a second emulator that exits without that line; the second error reports
  only its own evidence. Concurrent launch and interrupted-run controls prove logs are
  neither mixed nor deleted while live.
- **Source:** September 2026 recurring repository review continuation, 2026-09-24.
