# DEVENV-SANDBOXED-BRANCH-CHECKOUT-STOPS-HALF-SWITCHED — Sandboxed branch checkout stops half-switched

- **Status:** Candidate
- **Section:** Deferred
- **Area:** Worktrees, Git and the sandbox
- **Impact:** An agent asked to take over an existing remote `feat/*` branch has no front door for it. `git fetch` needs the host, because the credential helper reads a path the sandbox denies, and a sandboxed `git switch` to a branch that changes harness-protected files (`.claude/settings.json`, `agents/skills/**`) fails partway: the index moves to the target, HEAD stays put, the protected files keep their old content and removed protected files linger as untracked. Recovering takes a forced host-side switch and a host-side delete, which permission review reasonably reads as destructive.
- **Evidence:** On 2026-10-04, taking over `feat/tao-install-offer` in a fresh harness worktree: `git switch -c feat/tao-install-offer --track origin/feat/tao-install-offer` reported `unable to unlink old '.claude/settings.json': Operation not permitted` for 21 files and could not write the upstream config; HEAD stayed on the worktree branch with the target staged. `git switch -f` on the host completed it and left `agents/skills/quiet-ui-workflows/references/interaction-surfaces.md` untracked, which the Developer removed by hand. The branch switch also did not rerun setup, so the checkout kept the base commit's install until `./agent setup` was run again.
- **Workaround:** Fetch and `git switch -f <branch>` on the host after confirming `git diff --cached --stat <branch>` is empty, delete any leftover protected files whose content matches the previous commit, then run `./agent setup`.
- **Proposed change:** Add a named host operation, beside `start-branch`, that fetches an existing `origin/feat/*` branch, refuses a dirty tree, switches to it with upstream tracking, and runs `./agent setup`.
- **Dependencies:** `git-workflow` owns branch takeover; `.rulesync/permissions.jsonc` owns the new host operation.
- **Acceptance:** A sandboxed agent takes over a remote feature branch whose diff touches protected harness files with one command, leaving a clean tree on the branch with setup passing.
- **Source:** Landing `feat/tao-install-offer`, 2026-10-04.
