# DEVENV-MANAGED-COMMIT-DENIES-WORKTREE-GIT-METADATA — Managed commit denies worktree Git metadata

- **Status:** Candidate
- **Section:** External
- **Area:** Managed shell, Git worktrees, commit permissions
- **Impact:** Git metadata writes are denied during authorized staging/commit preparation, blocking
  the reviewed baseline required by implementation worktrees and landing. Permission to perform the
  task does not grant a denied filesystem operation.
- **Evidence:** On 2026-10-04 in `feat/bare-render-syntax`, exact-path `git add` succeeded and status
  showed the eight owned model-routing paths staged. The subsequent ordinary `git commit` exited
  128 with `fatal: Unable to create '/Users/ro/code/tao-lang-2/.git/worktrees/tao-lang-25/index.lock':
  Operation not permitted`. A later exact-path staging attempt for the reviewed documents failed at
  the same path. The same commit denial was recorded earlier in this task. The task's named
  `./agent unsandboxed capabilities` probe reported no sandbox for supported host operations and
  available process/Watchman/Nix/simulator capabilities; that does not grant an unlisted commit
  operation. No commit or ref movement occurred.
- **Workaround:** Commit the exact reviewed staged paths from a normal terminal, then resume the
  authorized named landing workflow. This intervention is prepared but not yet verified here.
- **Proposed change:** Diagnose the linked-worktree metadata denial, including why staging initially
  succeeded but later failed. Provide a supported commit path or correct the permission boundary;
  do not weaken unrelated protections or route around the denial with alternate Git spellings.
- **Dependencies:** Managed shell and linked-worktree Git permission configuration.
- **Acceptance:** In a disposable linked worktree, exact-path staging and an ordinary commit both
  succeed under the intended managed profile; the index and unrelated work remain intact. Verify
  the ordinary host landing path separately.
- **Source:** 2026-10-04, Syntax2 design baseline commit preparation.
