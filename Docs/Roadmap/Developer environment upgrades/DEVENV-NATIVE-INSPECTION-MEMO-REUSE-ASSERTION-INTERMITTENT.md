# DEVENV-NATIVE-INSPECTION-MEMO-REUSE-ASSERTION-INTERMITTENT — Native inspection memo reuse assertion is intermittent

- **Status:** Candidate
- **Section:** External
- **Area:** Maintained native-binding inspection tests and broad verification.
- **Impact:** A broad verification run can stop on a memo-hit count assertion even when the inspection returns the correct fresh result.
- **Evidence:** On October 7, 2026, `verify-changed` at `3663209da` failed `maintained-native-bindings-memo.test.ts:60`: expected the memo-hit counter to increase from 0 to 1, but observed 0. Fresh status, identity and output-path assertions preceding it passed. The native inspection implementation and test were unchanged from main. The same file passed all three tests in isolation in 9.4 seconds; an unchanged broad rerun then passed, with this group taking 3.4 seconds. Logs: `.artifacts/logs/agent/verify-changed/2026-10-07T23-37-47-468Z-35832.log`, `.artifacts/logs/agent/test-file/2026-10-07T23-42-50-653Z-67283.log`, and `.artifacts/logs/agent/verify-changed/2026-10-07T23-45-12-118Z-68720.log` in the `feat/chrome-graceful-shutdown` worktree. These observations establish an intermittent reuse miss, not its cause or an incorrect native verdict.
- **Workaround:** Run the affected file in isolation, then rerun the unchanged broad lane. Retain the original failure; a passing retry does not diagnose the miss.
- **Proposed change:** On recurrence, capture whether publication-barrier bypass or watched metadata/manifest fingerprint invalidation rejected the memo. Make a narrow fixture or cache correction only after identifying the cause; preserve conservative publication locking and final freshness checks.
- **Dependencies:** A reproduction with cache rejection evidence.
- **Acceptance:** Explain the observed rejection, retain coverage for changed outputs and publication races, and pass both the affected file and a broad lane without weakening the memo-hit assertion or locking.
- **Source:** Broad and isolated verification during Chrome shutdown qualification.
