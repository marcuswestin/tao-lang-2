# DEVENV-WDA-DIAGNOSTIC-FIXTURE-EXCEEDS-SOCKET-PATH-LIMIT — WDA diagnostic fixture exceeds socket path limit

- **Status:** Resolved
- **Area:** Native registration diagnostic test isolation.
- **Impact:** A long worktree path makes the missing-socket diagnostic fixture exercise channel-too-long instead of channel-connect, blocking verification.
- **Evidence:** After integrating main 20bbeff06, verify-changed on feat/hosted-provider-acceptance-evidence failed reports native barrier failure categories without printing registration credentials or paths: expected channel-connect, received channel-too-long.
- **Workaround:** None required after the fixture repair.
- **Proposed change:** Keep the fixture build in worktree scratch but choose a short UUID-based nonexistent socket path under /private/tmp. Assert it does not exist; create no external file or directory. Preserve production behavior and exact diagnostic assertions.
- **Dependencies:** Main native registration diagnostic tests.
- **Acceptance:** The focused studio-mac2-test-isolation.test.ts suite passes all 55 tests, including the actual native diagnostic helper. The original missing-credential, mismatch, and channel-connect assertions remain.
- **Source:** .artifacts/logs/verify-changed/2026-10-04T18-39-53-895Z-88034-a252af72/ides_studio-tooling.log and .artifacts/logs/dev-test/2026-10-04T18-43-09-088Z-27533-27ab3139/ides_studio-tooling.log.
- **Archived:** 2026-10-04
