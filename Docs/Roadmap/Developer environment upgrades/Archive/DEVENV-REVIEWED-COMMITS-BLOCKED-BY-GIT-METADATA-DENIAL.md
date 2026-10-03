# DEVENV-REVIEWED-COMMITS-BLOCKED-BY-GIT-METADATA-DENIAL — Reviewed commits blocked by Git metadata denial

- **Status:** Resolved
- **Section:** External
- **Area:** Managed task Git writes in linked worktrees
- **Impact:** A reviewed change with a passing per-commit gate cannot be staged or committed through the current task shell.
- **Evidence:** On 2026-10-02 on `feat/test-responsibility`, staging exact reviewed parser/audit paths failed with `fatal: Unable to create '/Users/ro/code/tao-lang-2/.git/worktrees/tao-lang-210/index.lock': Operation not permitted`. Git status confirms no files were staged. The shared commit `edfeb4fa2` already exists, and `./agent unsandboxed capabilities` succeeds and reports no sandbox for its named host operation; this does not grant raw Git writes. Parser focused tests, independent review and `verify-changed` passed before staging.
- **Resolution evidence:** On 2026-10-03, the Developer changed the task's approval setting and authorized a retry. The guarded reviewed-commit script ran through an approved escalation, passed `verify-changed` (`2026-10-03T21-18-30-926Z-35801-ac5f8fb7`), rechecked all 472 content hashes and the empty index, and committed only those paths as `d5f602442`. Read-only Git inspection then confirmed a clean worktree and index. No repository permission configuration or alternate Git metadata path was used.
- **Workaround:** None needed in this task after the approved escalation; sessions that deny escalation can still require a Developer-run reviewed commit.
- **Proposed change:** Use the task's approved escalation boundary for authorized reviewed Git writes. The configured Git write root alone does not replace approval for protected metadata.
- **Dependencies:** None for this task; the resolution depends on the task approval setting rather than a repository permission change.
- **Acceptance:** Exact-path staging and a reviewed commit succeed in the intended task session, unrelated changes remain unstaged, and no alternate Git metadata tree is used.
- **Source:** Serial test reduction follow-up on `feat/test-responsibility`, parser package boundary, 2026-10-02.
- **Archived:** 2026-10-03
