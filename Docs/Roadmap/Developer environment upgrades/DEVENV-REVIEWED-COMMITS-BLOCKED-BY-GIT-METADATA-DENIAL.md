# DEVENV-REVIEWED-COMMITS-BLOCKED-BY-GIT-METADATA-DENIAL — Reviewed commits blocked by Git metadata denial

- **Status:** Blocked
- **Section:** External
- **Area:** Managed task Git writes in linked worktrees
- **Impact:** A reviewed change with a passing per-commit gate cannot be staged or committed through the current task shell.
- **Evidence:** On 2026-10-02 on `feat/test-responsibility`, staging exact reviewed parser/audit paths failed with `fatal: Unable to create '/Users/ro/code/tao-lang-2/.git/worktrees/tao-lang-210/index.lock': Operation not permitted`. Git status confirms no files were staged. The shared commit `edfeb4fa2` already exists, and `./agent unsandboxed capabilities` succeeds and reports no sandbox for its named host operation; this does not grant raw Git writes. Parser focused tests, independent review and `verify-changed` passed before staging.
- **Workaround:** The Developer can commit the exact reviewed batch in an ordinary terminal, or resume in a session that permits the required Git index and ref writes. No alternate metadata path, command spelling or host execution route was attempted.
- **Proposed change:** Diagnose why the task execution boundary denies shared Git metadata writes despite the declared writable Git root, then align that execution boundary with authorized reviewed commits without broadening repository permission reach as part of the test reduction pass.
- **Dependencies:** Task execution permission recovery or a Developer-run reviewed commit.
- **Acceptance:** Exact-path staging and a reviewed commit succeed in the intended task session, unrelated changes remain unstaged, and no alternate Git metadata tree is used.
- **Source:** Serial test reduction follow-up on `feat/test-responsibility`, parser package boundary, 2026-10-02.
