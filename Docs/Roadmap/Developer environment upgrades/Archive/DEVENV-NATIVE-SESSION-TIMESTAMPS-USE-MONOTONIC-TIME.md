# DEVENV-NATIVE-SESSION-TIMESTAMPS-USE-MONOTONIC-TIME — Native session timestamps use monotonic time

- **Status:** Resolved
- **Section:** External
- **Area:** Host proof evidence
- **Impact:** Native session evidence labels process-relative elapsed time as an ISO calendar date,
  preventing reliable comparison with build logs and receipts.
- **Evidence:** `AppiumXcuiTestController.ts` and `AppiumAndroidController.ts` create screenshot
  timestamps with `new Date(Time.nowMs()).toISOString()`. `Time.nowMs()` is a monotonic application
  clock, not epoch time. The native-navigation investigation found this while repairing a separate
  retention-clock regression. Existing session timestamps have not been rewritten.
- **Workaround:** Correlate source-linked proof timelines and run identifiers with the independently
  recorded build logs and corrected artifact lifecycle receipts; do not treat screenshot timestamps
  as calendar evidence.
- **Proposed change:** Give screenshot capture an explicit calendar-clock boundary and retain the
  monotonic clock for durations and polling. Exercise the production default as well as controlled
  test clocks.
- **Dependencies:** None. Artifact retention already uses its separate calendar-clock adapter.
- **Acceptance:** Both real native controllers record capture times consistent with filesystem epoch
  time; a monotonic-clock substitution fails the regression.
- **Source:** 2026-09-26 native-navigation acceptance and host-evidence review.

Resolved 2026-10-06 on `feat/ui-driver-hardening`: both controllers use an injectable calendar
clock, defaulting to the existing named `HostArtifactClock` adapter. Host-free tests exercise
controlled values and current epoch time; substituting the monotonic clock fails all four cases.
Historical evidence is unchanged. This closes the source timestamp defect and does not claim
fresh real-device acceptance.

Archived 2026-10-06.
