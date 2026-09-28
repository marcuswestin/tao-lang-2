# DEVENV-GIT-WORKTREE-TIMEOUTS-RECUR-AFTER-COMPLETION-REPAIR — Git worktree timeouts recur after completion repair

- **Status:** Candidate
- **Section:** External
- **Area:** Verification subprocess lifecycle
- **Impact:** Unrelated real-Git tests can fail a commit gate and require investigation and a rerun.
- **Evidence:** On 2026-09-26, `feat/ios-development-setup` at `309970ed` with only iOS setup source, tests and README edits failed three `merge-with-main` tests: `lands safely in disposable real Git worktrees`, `an atomic lease rejection preserves all landing refs and a legacy snapshot can be aborted`, and `recovers an accepted atomic push whose process result was lost`. Each reported about 196 seconds against its 120-second bound. The lane recorded no contention, peak load 6.3 on 16 CPUs. Its summary elapsed time was 13.9 seconds, but scheduling makespan was 209.4 seconds; the discrepancy is unexplained. Log: `.artifacts/logs/verify-changed/2026-09-26T22-34-34-810Z-77015-dc19df08/testing_verification.log`. The focused file then passed in 824ms, and the unchanged broader lane passed in 14 seconds at `.artifacts/logs/verify-changed/2026-09-26T22-38-43-582Z-80409-3c5adfed`. No stalled subprocess state was captured, so this does not establish the earlier root cause recurred.
- **Workaround:** Inspect the failure, run the named test file, then rerun the required lane. One successful retry does not establish a repair.
- **Proposed change:** Capture process exit, pipe closure, assertion scheduling and host suspension timing on a recurrence before changing the implementation or timeout.
- **Dependencies:** Follow-up to the [archived Git completion repair](Archive/DEVENV-TESTS-THAT-SPAWN-GIT-HANG-THEIR-WHOLE-TIMEOUT-IN-LANES.md); preserve its demonstrated repair and distinguish this observation from that diagnosis.
- **Acceptance:** Identify the stalled phase or explain the timing discrepancy with recorded evidence, then prove any resulting repair with a targeted regression and repeated affected lanes.
- **Source:** iOS development setup verification on `feat/ios-development-setup`.
