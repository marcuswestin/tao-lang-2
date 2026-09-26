# DEVENV-STUDIO-ARTIFACT-SHELL-LOSES-COMPLETION — Studio artifact shell still stalls after promise assertion repair

- **Status:** Candidate
- **Section:** External
- **Area:** Studio tooling test subprocesses
- **Impact:** A trivial shell fixture can consume the Studio tooling suite's entire 120-second hang bound during parallel verification.
- **Evidence:** On 2026-09-26, repetition five of `feat/git-test-timeout` timed out `Studio test process output > requests and retains the versioned live-render artifact from tao test` at 120000ms. Its isolated retry passed in 85.18ms. The test runs `/bin/sh` to write one JSON artifact, through `StudioTestProcessRunner` and `StudioProcessTree`; stdin is ignored, and the close listener is registered without an intervening await. Log: `.artifacts/logs/verify-changed/2026-09-26T04-33-43-937Z-72369-9b6b4ed9/ides_studio-tooling.initial.log`. The same failure predates this fix in worktree `4ccd`'s `verify-full/2026-09-26T04-08-13-874Z-4079-acafac9a/ides_studio-tooling.initial.log`. Git tests passed in the new failing lane.
- **Workaround:** Preserve the failed initial log; an isolated retry can finish. Do not infer that all subprocess stalls are fixed from the Git assertion regression alone.
- **Proposed change:** Trace this child's PID, artifact creation, exit and stream-close events under the concurrent native/browser bundling tests. In-process build-plugin waits are a possible remaining event-loop reentry source, not an established cause. Compare with bundling isolated into another process before changing production close semantics.
- **Dependencies:** Follow-up to [Git subprocess timeouts](DEVENV-TESTS-THAT-SPAWN-GIT-HANG-THEIR-WHOLE-TIMEOUT-IN-LANES.md); the shared promise-assertion repair has a causal regression but does not establish this fixture's cause.
- **Acceptance:** Reproduce the remaining cause, show the targeted repair fails when removed, and repeatedly run the Studio tooling suite alongside broad verification without a close-event stall. Preserve complete captured output and owned process cleanup.
- **Source:** Git-test timeout investigation and repeated full-scope verification on `feat/git-test-timeout`.
