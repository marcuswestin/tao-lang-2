# DEVENV-LAND-REFUSES-A-MERGE-MESSAGE-WRITTEN-BEFORE-ITS-FIRST-CALL — Land refuses a merge message written before its first call

- **Status:** Candidate
- **Section:** External
- **Area:** Landing, merge messages
- **Impact:** `verification-lanes` tells an agent to write `.artifacts/merge/<branch>.msg` when a
  branch becomes merge-ready. A message written that way always costs one refused `./agent land`:
  the review record exists only for a message the landing drafted or already saw, so a hand-written
  one reads as kept from an unknown HEAD — "Confirm the kept merge message still describes this
  branch (nothing records which HEAD it was written for)" — and the agent must edit it and run again.
  A merge commit made to resolve a landing conflict costs the same round again.
- **Evidence:** Four times on 2026-09-22 and 2026-09-23 in one worktree, for
  `feat/prebuilt-host-5b51f1`, `feat/devenv-emulator-sandbox-f57a8c`,
  `feat/host-publish-download-29e5d3`, and `feat/ios-simulator-host-26f553`; each message was written
  after the branch's last commit and each first `./agent land` refused it. Letting `land` draft first
  and then editing the draft passed without the extra round.
- **Workaround:** Run `./agent unsandboxed land` once to draft the message, edit the draft, and run
  it again through the same named operation.
- **Proposed change:** Treat a message file modified after the branch's newest commit as reviewed for
  that HEAD, or say in `verification-lanes` to let the landing draft first rather than writing the
  file ahead of it.
- **Dependencies:** None.
- **Acceptance:** Writing the message after the last commit and running `./agent unsandboxed land` once takes the
  lock, and a message older than the newest commit is still refused.
- **Source:** 2026-09-23, landing the prebuilt-host slices for `A9`.
