# DEVENV-OPEN-PR-REPORTS-NO-CHECKS-WHILE-RUNNERS-ARE-BUSY — open-pr reports no checks while runners are busy

- **Status:** Candidate
- **Section:** Repository
- **Area:** Landing route, hosted verification
- **Impact:** `open-pr --auto-merge` fails before starting the local complement when GitHub has created the `Verify` run but not yet any check run for the head, which happens when the account's runners are all busy. The pull request keeps auto-merge on, so `Verify` can go green and merge it with no host-only proof unless the agent notices and runs `open-pr` again.
- **Evidence:** On 2026-10-06, `feat/ci-macos-matrix` (PR 31) pushed `09a027b9`; GitHub created Verify run 37421561311 at 06:02:11Z, and `open-pr` reported "No checks appeared on 09a027b9 within 90s of the push. Actions may be disabled for this repository, or no workflow matches this branch." A minute later the pull request showed `Contributor agreement`, `Plan the partitions`, and `CI macOS` as queued. Twenty `Verify` partitions (`VERIFY_PARTITIONS` = 20) and two Companion hosts jobs were occupying the runners at the time. `awaitChecksOnHead` in `packages/cli/dev-cli/dev-cli-src/pr/OpenPrCommand.ts` counts only check runs on the head.
- **Workaround:** Confirm a run exists for the head with `gh run list --branch <branch>`, then run `./agent unsandboxed open-pr --auto-merge` again; it reuses the pull request and starts the complement.
- **Proposed change:** Treat a workflow run for the head SHA as the checks having appeared, or keep waiting while one exists and is queued; keep the failure for the case where no run exists at all, and name runner saturation in the message when a run is queued.
- **Dependencies:** None; this changes an `./agent unsandboxed` operation's implementation, so it needs the Developer's approval.
- **Acceptance:** With a queued run and no check runs on the head, `open-pr` waits and then starts the complement; with no run at all, it still fails with the current message.
- **Source:** Verification speed plan, slice D1 (hosted CI reshape), 2026-10-06, `feat/ci-macos-matrix`.
