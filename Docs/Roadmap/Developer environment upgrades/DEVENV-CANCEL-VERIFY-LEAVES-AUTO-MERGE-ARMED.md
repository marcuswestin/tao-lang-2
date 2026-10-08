# DEVENV-CANCEL-VERIFY-LEAVES-AUTO-MERGE-ARMED — Cancel Verify leaves auto-merge armed

- **Status:** Candidate
- **Section:** External
- **Area:** Landing failure recovery and command guidance.
- **Impact:** A caller following the landing skill can believe cancelling a failed run also disables auto-merge, while the pull request retains its armed state. Failed required checks still prevent merging.
- **Evidence:** On October 7, 2026, PR #83's partition 18 failed in run `37706188245`. `cancel-verify` cancelled the remaining run successfully, but the following `pr-checks` still reported auto-merge on. `CancelVerifyCommand` only calls `cancelVerifyRuns`; the landing skill describes it as equivalent to the complement failure handler, which also disables auto-merge. All remaining jobs were confirmed cancelled. The required aggregate Verify failed and prevented landing.
- **Workaround:** Retain the failed required check and confirm the pull request state. Continue an authorized repair through `open-pr --auto-merge`; do not bypass the repository merge route.
- **Proposed change:** Align the cancellation command and landing guidance. Decide whether cancellation should disarm auto-merge for this head, or provide a documented named disarm operation; cover exact-head ownership and failure recovery.
- **Dependencies:** A scoped developer-automation change with its host behavior authorized.
- **Acceptance:** The documented recovery operation reports and proves its cancellation and auto-merge effects, without touching another branch's runs or pull request.
- **Source:** `CancelVerify.ts`, `OpenPrCommand.ts`, `agents/skills/landing/SKILL.md`, and PR #83 landing logs.
