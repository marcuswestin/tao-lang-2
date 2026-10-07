# DEVENV-STUDIO-AGENT-BROWSER-FAILS-ON-HOSTED-LINUX-RUNNERS — `studio-agent-browser` fails on hosted Linux runners

- **Status:** Candidate
- **Section:** External
- **Area:** `studio-agent-browser.test.ts`, the hosted `Verify` Linux partitions, the local complement
- **Impact:** Eight of the nine browser gates run or could run inside hosted `Verify`;
  `studio-agent-browser` is the one that passed solo on a runner and then failed every time it ran
  as a partition node, so it stays in the local complement, where it also times out under load.
  Until it is understood, the complement cannot shrink to `studio-proof-real-app` and
  `studio-canary`.
- **Evidence:** 2026-10-06. Solo on `ubuntu-24.04` (one gate per job, run 37499414529): pass in
  28 s. As a cost-1 node (PR 67, run 37529644139): attempt 1 timed out after about 90 s waiting for
  the approval box to settle (`studio-agent-browser.test.ts:272`); attempt 2 (`rerun --failed`)
  timed out after 38 s waiting for Chrome's `DevToolsActivePort`, with load near 10 on four vCPUs.
  Reserving the whole runner (PR 72) did not help: it failed alone in 83.4 s at the same settle
  wait. `main`'s `24d3f72f4` changed the test between the solo pass and the failures. Locally the
  gate passed every landing but twice timed out under load above 50 waiting for the chat line
  "Undo refused because the source changed."; both passed alone.
- **Workaround:** The gate stays in the local complement; a timeout there is rerun alone.
- **Proposed change:** Diagnose the approval box's settle wait on a slow CPU (what it waits for,
  and whether a quiet-frames rule or a fixed delay stops it settling when frames arrive late), fix
  the cause, and port the gate with the runner reservation (`HOSTED_BROWSER_LANE_COST`) that the
  other five browser gates use. Do not widen the timeout without a measured reason.
- **Dependencies:** None.
- **Acceptance:** The gate passes two consecutive hosted runs as a reserved partition node and
  leaves the complement by the catalog flag alone, as the others did.
- **Source:** Slice C2 of the CI completion project, 2026-10-06.
