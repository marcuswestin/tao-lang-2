# DEVENV-HOSTED-CHROME-STARTUP-TIMES-OUT-BEFORE-DEVTOOLS — Hosted Chrome startup times out before DevTools

- **Status:** Candidate
- **Section:** External
- **Area:** Hosted Linux browser verification.
- **Impact:** An admitted browser gate fails before its UI assertions, without enough startup evidence to distinguish a launcher problem from a slow or blocked Chrome child.
- **Evidence:** After integrating main `43012d7bf`, hosted Verify run [37520296658](https://github.com/tao-dev-org/tao-lang/actions/runs/37520296658) on `ec53f0b0a` passed ten partitions and failed partition 1 in `studio-dialog-browser`. The child wait reported `Timed out waiting for Chrome DevToolsActivePort.` after 20 seconds, with no captured output in that error. This does not establish why Chrome failed to expose its port. The failing job is [112463731500](https://github.com/tao-dev-org/tao-lang/actions/runs/37520296658/job/112463731500).
- **Workaround:** None confirmed. Keep the gate admitted and retain its failure.
- **Proposed change:** Startup diagnostics now include the selected executable, PID, profile and bounded first/recent output. Port, HTTP target and DevTools connection waits observe child failure and deadlines independently; unfinished HTTP probes are aborted. Supervised cleanup joins owned processes even after a natural Chrome exit, and secondary cleanup failures retain the startup failure as their cause. Use the next hosted run to diagnose the remaining startup problem rather than extending the timeout without evidence.
- **Dependencies:** Chrome installed on the hosted Linux runner.
- **Acceptance:** The hosted dialog browser gate reaches DevTools and passes its interaction assertions. Deterministic startup failures retain the original exit or spawn error, return within their bound and release their owned child and probe resources.
- **Source:** Final verification of `feat/test-process-termination`, 2026-10-06; `StudioCdp.launchChrome` and shared process readiness.
