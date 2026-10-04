# DEVENV-WATCHMAN-COOKIES-INVALIDATE-VERIFICATION-EVIDENCE — Watchman cookies invalidate verification evidence

- **Status:** Resolved
- **Section:** External
- **Area:** Repository artifact exclusions
- **Impact:** A temporary watcher synchronization file can invalidate otherwise passing complete
  verification when it disappears between the initial and final tree snapshots.
- **Evidence:** Complete verification passed 42 checks with zero failed checks, but rejected green
  evidence because `.watchman-cookie-Ros-MacBook-Pro.local-992-34` disappeared during the run.
  Log: `.artifacts/logs/verify/2026-10-01T19-59-26-856Z-49771-70f0917e/summary.json`.
  [Watchman's synchronization contract](https://facebook.github.io/watchman/docs/cookies) identifies
  these as temporary tool-owned files, created in the watched root when no VCS directory is suitable.
  The repository did not ignore their reserved filename prefix.
- **Workaround:** Repeat broad verification after adding the artifact exclusion; the rejected run
  is retained as test evidence and is not promoted to green proof.
- **Proposed change:** Implemented: ignore `.watchman-cookie-*` through the repository's existing
  artifact policy. The fingerprint still checks authored and other visible untracked files.
- **Dependencies:** None. The watcher, drift guard, and permission reach are unchanged.
- **Acceptance:** Git identifies the reported cookie name as ignored by this rule; complete
  verification can prove the repaired tree without treating watcher synchronization as source drift.
- **Source:** 2026-10-01 complete verification of the test responsibility audit.
