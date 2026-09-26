# DEVENV-RESERVED-PORT-CLIENT-CLOSE-TIMES-OUT — Reserved port client close can time out during broad tests

- **Status:** Candidate
- **Section:** External
- **Area:** Expo port reservation tests
- **Impact:** An unrelated socket lifecycle test consumed nearly two minutes during subprocess repair experiments.
- **Evidence:** On 2026-09-26, `Expo dev-loop port helpers > drops a client that connects to a reserved port, so releasing it does not wait` timed out after 114961ms. The test awaits the TCP client's close event and then reservation release; no subprocess was pending in the CLI trace. Log: `.artifacts/logs/dev-test/2026-09-26T05-45-17-095Z-84189-415cd91f/apps_expo-host_6.log`. Later broad runs passed this test. This does not establish that the subprocess completion defect causes the socket failure.
- **Workaround:** Retry the focused `expo-dev-loop.test.ts`; the test remains enabled.
- **Proposed change:** Trace reservation acceptance, client end/close and server release separately during a recurrence, then repair the demonstrated lifecycle gap without extending the timeout.
- **Dependencies:** None
- **Acceptance:** A targeted regression fails before its repair, and repeated broad runs complete client and reservation cleanup.
- **Source:** Subprocess completion investigation on `feat/repair-verification-flakes`.
