# DEVENV-ACCOUNT-SERVICE-READINESS-JSON-RACE — Account service readiness JSON race

- **Status:** Candidate
- **Section:** External
- **Area:** Account service launcher verification.
- **Impact:** Full verification can fail while reading a readiness file before its JSON is complete.
- **Evidence:** On 2026-09-26, `feat/native-navigation-acceptance` finalization failed at `packages/services/account-server/account-server-tests/serve.test.ts:74` with `Unexpected EOF`. The test waits only for file existence before reading JSON. Log: `.artifacts/logs/verify/2026-09-26T19-35-25-838Z-86447-94f112fb/services_account-server.log`. An exact-file retry and subsequent full finalization passed without account-service source changes. Concurrent load was observed, but is not established as the cause.
- **Workaround:** Retry the exact file and then the required full lane; a passing retry does not repair the race.
- **Proposed change:** Investigate readiness publication and make the file visible atomically after complete serialization, with coverage that deliberately delays publication.
- **Dependencies:** None.
- **Acceptance:** A forced partial-write schedule cannot expose incomplete readiness JSON; process failure remains distinguishable from readiness.
- **Source:** Native navigation preparation, preserved while continuing the Mac Catalyst proof of concept.
