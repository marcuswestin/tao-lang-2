# DEVENV-RUNTIME-JOURNEY-OBSERVATION-TEST-TIMES-OUT — Runtime journey observation test can time out in a broad lane

- **Status:** Candidate
- **Section:** External
- **Area:** Runtime journey test lifecycle
- **Impact:** A runtime test can exhaust its 30-second bound and require an isolated suite retry.
- **Evidence:** On 2026-09-26, repetition one of `feat/repair-verification-flakes` timed out `Expo runtime > records only render occurrences mounted by one executed Tao journey` in `tao-test-runtime.jest-test.tsx`. The runtime suite passed its isolated retry. The lane recorded two concurrent lanes and peak load 21.3 on 18 CPUs. Log: `.artifacts/logs/verify-changed/2026-09-26T06-18-26-827Z-62622-a8a7a06b/runtime-jest.initial.log`. The test covers compilation, journey execution and artifact reading; the failing phase was not traced. The fingerprint, Studio artifact and forced Node worker cleanup regressions passed in that same initial run.
- **Workaround:** Use the runner's isolated retry; the test remains enabled.
- **Proposed change:** Capture compile-response, journey-execution and artifact-read boundaries in a recurrence before changing its lifecycle or timeout.
- **Dependencies:** None. No evidence currently ties this 30-second failure to the repaired aggregate subprocess-close defect.
- **Acceptance:** Identify the stalled phase, demonstrate a targeted failing regression, and repeat broad runs with the repaired lifecycle.
- **Source:** Repeated subprocess-repair verification on `feat/repair-verification-flakes`.
