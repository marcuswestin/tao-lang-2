# DEVENV-CANCEL-VERIFY-SHORT-SHA-MISREPORTS-ACTIVE-RUN — Cancel Verify misreports an active run for a short SHA

- **Status:** Candidate
- **Section:** External
- **Area:** Hosted verification diagnostics
- **Impact:** An abbreviated commit argument can report that no verification is running while the matching full commit still has an active run, delaying cancellation of work already known to fail.
- **Evidence:** On 2026-10-06, `cancel-verify --sha f0b41622` reported `No Verify run is in flight` while run `37511980109` was active. Repeating with full SHA `f0b41622f1785d608f405cdf2d501cf5e22ffa0b` canceled that run. Logs: `.artifacts/logs/agent/cancel-verify/2026-10-06T18-32-06-015Z-19902.log` and `2026-10-06T18-32-28-994Z-25568.log`. The command passes the provided SHA directly to the workflow filter.
- **Workaround:** Omit `--sha` to use HEAD, or supply the full commit SHA.
- **Proposed change:** Resolve commit arguments to a full local commit SHA before querying workflow runs, or reject abbreviated values with an actionable diagnostic. Preserve exact commit scoping of cancellations.
- **Dependencies:** None.
- **Acceptance:** A short SHA identifying the active commit cancels the same run as its full SHA, or is rejected before reporting absence; another commit's runs remain untouched.
- **Source:** 2026-10-06 verification feedback during test process termination work.
