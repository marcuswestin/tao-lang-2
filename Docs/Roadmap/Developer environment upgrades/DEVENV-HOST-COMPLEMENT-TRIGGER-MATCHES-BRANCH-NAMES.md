# DEVENV-HOST-COMPLEMENT-TRIGGER-MATCHES-BRANCH-NAMES — Host complement trigger parser matches branch names

- **Status:** Candidate
- **Section:** External
- **Area:** Host verification admission.
- **Impact:** A push-only workflow with a branch named `pull_request` can be mistaken for a workflow that proves host gates on pull requests. Its admitted gates would then be omitted from local proof.
- **Evidence:** Source review on 2026-10-06 found that `VerifyComplement.runsOnPullRequests` searches the entire `on:` block for the `pull_request` token, including nested values. The block `on:\n  push:\n    branches: [pull_request]\n` matches that expression while declaring only `push`. Current `ci-macos.yml` uses `branches: [main]` and admits no host gates, so this observation does not establish a missing gate in the present workflow.
- **Workaround:** Keep that token out of nested trigger values; the current workflow already does.
- **Proposed change:** Read declared event names rather than matching tokens in their configuration. Preserve the supported block, flow and scalar trigger spellings.
- **Dependencies:** None.
- **Acceptance:** Push-only branch-name fixtures retain all host gates locally; a real pull-request trigger still removes admitted gates. Existing real-workflow membership and trigger-spelling fixtures continue to pass.
- **Source:** Review of main integration during `feat/test-process-termination`, 2026-10-06; `packages/testing/verification/verification-src/VerifyComplement.ts`.
