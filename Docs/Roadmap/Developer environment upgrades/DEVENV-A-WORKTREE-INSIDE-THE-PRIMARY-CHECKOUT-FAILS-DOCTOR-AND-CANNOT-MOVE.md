# DEVENV-A-WORKTREE-INSIDE-THE-PRIMARY-CHECKOUT-FAILS-DOCTOR-AND-CANNOT-MOVE — A worktree inside the primary checkout fails doctor and cannot be moved

- **Status:** Candidate
- **Section:** External
- **Area:** Linked worktree placement, `./agent doctor`'s watchman-root check, Tao npm alias links, `start-branch`.
- **Impact:** The one place an agent shell can create a writable worktree without host access, under the primary checkout, fails `verify-full` at its first gate; moving the worktree out then fails `setup`; and a fresh sibling worktree cannot run `start-branch`.
- **Evidence:** On 2026-10-06, a worktree at `~/code/tao-lang-2/.artifacts/worktrees/repo-transfer-urls` failed `verify-full` in 7 s on `_doctor-json`: "Watchman watches ~/code/tao-lang-2, which encloses this checkout". After `git worktree move` to `~/code/tao-lang-2.worktrees/`, `./agent unsandboxed setup` failed with "Cannot update npm alias 'expo-clipboard': …/Apps/Test Apps/Native Bridge/node_modules/expo-clipboard is no longer Tao-managed", because the alias links are absolute paths into the old location. A fresh `git worktree add` sibling then failed `./agent unsandboxed start-branch` with "Unexpected while resolving package 'wrap-ansi'" until `./agent unsandboxed setup` ran first; the nested worktree had resolved packages from the primary checkout's `node_modules` instead.
- **Workaround:** Create worktrees beside the primary checkout (`~/code/tao-lang-2.worktrees/<name>`) with host access, run `./agent unsandboxed setup` before `start-branch`, and delete the two stale alias links after a move.
- **Proposed change:** Give `start-branch` (or a sibling `new-worktree` command) the job of creating the worktree in the standard location, installing before it builds the agent CLI; have the Tao installer replace an alias link that points into a moved copy of the same project; make doctor's watchman-root failure name the move as the remedy when the checkout is a linked worktree.
- **Dependencies:** None.
- **Acceptance:** An agent creates, starts, and verifies a fresh worktree with front-door commands only, and a moved worktree passes `setup`.
- **Source:** First merge-queue landing, `feat/repo-transfer-urls`, 2026-10-06.
