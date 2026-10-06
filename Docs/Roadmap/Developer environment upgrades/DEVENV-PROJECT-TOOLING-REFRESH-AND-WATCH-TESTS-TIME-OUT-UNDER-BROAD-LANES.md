# DEVENV-PROJECT-TOOLING-REFRESH-AND-WATCH-TESTS-TIME-OUT-UNDER-BROAD-LANES — Project-tooling refresh and watch tests time out under broad lanes

- **Status:** Candidate
- **Section:** External
- **Area:** `language/project-tooling` tests run by `verify-changed` and `verify-full`.
- **Impact:** A change that touches no project tooling fails its local proof on fixed-wait timeouts, so an agent cannot tell a contention timeout from a regression without reading each log.
- **Evidence:** On 2026-10-06 in `feat/repo-transfer-urls`, which changes only repository URLs, `verify-changed` failed "keeps contracts and diagnostics coherent across two independent refresh writers" at 30239 ms, the disk-watch external-topology case at 112845 ms, and on first attempt the dependency-race watch case at 90000 ms and the receipt-host case at 180001 ms (`.artifacts/logs/verify-changed/2026-10-06T01-59-10-538Z-85306-ea40fd26/`). The host `verify-full` that followed failed the same refresh-writers case again: "Timed out after 30000ms waiting for both refresh processes completed phase 0." (`language_project-tooling_1.log`), and its `watch-files` node failed the saved-edits case at 120000 ms and the dependency-race case at 90001 ms (`language_project-tooling_watch-files.log`, under `.artifacts/logs/verify-full/2026-10-06T02-23-37-580Z-85528-c3e31204/`). Hosted `Verify` passed the same tree.
- **Workaround:** Read the node log; when every failure is one of these waits and hosted `Verify` is green on the same head, treat it as contention and rerun the node alone.
- **Proposed change:** Wait on the processes' own progress events with a deadline scaled to measured machine load, or admit these suites under a lease that keeps them off a saturated machine, so a timeout means the processes stopped progressing.
- **Dependencies:** DEVENV-073-gate-runner-tests-assume-an-idle-machine-so-contention-handl.
- **Acceptance:** A broad local lane on an unchanged project-tooling tree passes these cases while other lanes run.
- **Source:** First merge-queue landing, `feat/repo-transfer-urls`, 2026-10-06.
