# DEVENV-ARCHIVE-WORKFLOW-CANNOT-ARCHIVE-A-WORKFLOW-CHANGE — the Archive workflow cannot archive a workflow change

- **Status:** Candidate
- **Section:** Deferred
- **Area:** Landing route, hosted verification
- **Impact:** When a merged pull request's head changes a file under `.github/workflows/`, the post-merge `Archive merged branch` run fails with HTTP 403 creating `merged/<name>`, and `open-pr --auto-merge` then exits 1 after a merge that succeeded. The archive is missing until someone runs `merge-pr` by hand.
- **Evidence:** On 2026-10-06, PR 31 (`feat/ci-macos-matrix`, head `21b70c7a`, which edits `verify.yml`) merged as `374fef5c`; Archive run 37450583927 failed at "Point merged/<name> at the pull request's head" with "gh: Resource not accessible by integration (HTTP 403)", although `archive-merged.yml` grants `contents: write`. The five Archive runs before it, for branches that changed no workflow file, passed. The cause is inferred, not confirmed: GitHub does not let the workflow token create a ref that brings in workflow-file changes without the `workflows` permission, which that token cannot hold.
- **Workaround:** Run `./agent unsandboxed merge-pr` on the branch; it confirms the merge and archives `merged/<name>` with the local credentials (it did for PR 31).
- **Proposed change:** Have `open-pr` treat a failed `Archive` on an already merged pull request as recoverable: archive locally as `merge-pr` does, and report the workflow failure as a warning instead of failing the landing.
- **Dependencies:** None; this changes an `./agent unsandboxed` operation's implementation, so it needs the Developer's approval.
- **Acceptance:** A pull request that edits a workflow lands through `open-pr --auto-merge` with exit 0 and `merged/<name>` present.
- **Source:** Verification speed plan, slice D1 (hosted CI reshape), 2026-10-06, `feat/ci-macos-workflow`.
