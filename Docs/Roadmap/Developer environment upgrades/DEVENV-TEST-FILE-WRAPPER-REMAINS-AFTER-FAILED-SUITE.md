# DEVENV-TEST-FILE-WRAPPER-REMAINS-AFTER-FAILED-SUITE — Test-file wrapper remains after a failed suite reports

- **Status:** Candidate
- **Section:** External
- **Area:** Focused test execution, process teardown, workflow reporting.
- **Impact:** A completed failed suite can leave `./agent test-file` waiting without its final report, obscuring the verdict and requiring interruption.
- **Evidence:** On 2026-10-03, `feat/studio-preview-speed` observed this twice. The ship transaction suite reported three failures out of six, then its wrapper was interrupted after 123.8 seconds; suite log `.artifacts/logs/dev-test/2026-10-03T21-55-17-300Z-89415-1b5d68c7/cli_tao-cli.log`. The Studio directory reported 865 passes and three obsolete sketch-fixture failures in 250.34 seconds, then its wrapper remained until interruption at 367.9 seconds; suite log `.artifacts/logs/dev-test/2026-10-03T21-58-08-892Z-27801-b0a9ee63/ides_studio.log`, wrapper log `.artifacts/logs/agent/test-file/2026-10-03T21-58-04-629Z-26998.log`. The focused corrected files passed afterward. Named process inventory after interruption showed no remaining owned test child. The held resource and wrapper phase were not captured, so the cause is unconfirmed.
- **Workaround:** Read the completed suite log for its verdict and interrupt only the owned command; inspect the named process inventory before cleaning test-owned output.
- **Proposed change:** Reproduce a completed failed suite and capture runner/child identity, exit state, and open handles while the wrapper waits. Bound teardown after a complete suite report and print the held resource if teardown fails.
- **Dependencies:** None identified; do not infer the cause from older Jest journey or Git subprocess hangs.
- **Acceptance:** A deterministic fixture that fails and retains a resource causes a bounded, explicit teardown failure with the suite verdict preserved and no child left running.
- **Source:** Studio preview speed continuation, `feat/studio-preview-speed`, 2026-10-03.
