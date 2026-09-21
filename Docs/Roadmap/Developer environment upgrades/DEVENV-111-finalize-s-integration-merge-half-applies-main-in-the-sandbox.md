# DEVENV-111 — `finalize`'s integration merge half-applies `main` in the sandbox and names no conflicting path

- **Status:** In progress
- **Partly addressed, 2026-09-20:** `Finalize.ts` now asks `git merge-tree --write-tree --name-only`
  what would conflict _before_ attempting the merge, and separates the two failures. A merge that
  recorded unmerged entries still says to resolve it by hand and names them. A merge that failed
  without recording any says so in those words, quotes Git's stderr, names what `merge-tree` says
  would conflict — it answers read-only, so it works where the merge itself could not — and points at
  running `git merge main` as a top-level command. The empty conflict list is gone. **What remains**
  is the half-written tree itself: the merge is still attempted inside the sandbox, so it can still
  stop partway and leave modifications the reader did not make. That needs the sandbox-inheritance
  fix under Dependencies, not another change here.
- **Area:** Verification and landing
- **Impact:** `./agent finalize` run from a sandboxed agent shell leaves the worktree in a state no
  Git command describes. Its integration merge is denied partway on the paths the sandbox
  write-protects, so the tree ends up holding `main`'s content for every writable file and the
  branch's content for `agents/skills/**` and `.claude/settings.json`, with no `MERGE_HEAD`, no
  unmerged index entries, and `HEAD` unmoved. The report says `Integrating main conflicted; resolve
  it by hand and finalize again. Conflicting paths:` and then lists nothing, so the one instruction
  it gives cannot be followed. An agent reading `git status` sees fifty-odd modifications and
  deletions it did not make and cannot tell a real conflict from a denied write; the obvious recovery,
  `git checkout -f`, is itself denied in the sandbox and reads to a permission classifier as
  discarding work.
- **Evidence:** 2026-09-20, `feat/misc-followups-66ff38` against `main` at `8c88d071`. `./agent
  finalize` exited 1 with the empty conflict list above. Afterwards `git status --porcelain` counted
  17 `M`, 37 `D` and 3 `??`; `git diff --name-only --diff-filter=U` was empty; `git rev-parse
  MERGE_HEAD` printed `fatal: Needed a single revision`; `git rev-parse HEAD` was still the branch
  tip. Hashing the protected files showed them at the branch's blobs while the rest of the tree held
  `main`'s. A read-only `git merge-tree --write-tree HEAD origin/main` named the two paths that
  genuinely conflicted — `agents/skills/delegation/SKILL.md` and
  `agents/skills/parallel-implementation/SKILL.md` — which the command never printed. Re-running the
  same integration as a top-level `git merge origin/main`, which
  `.rulesync/permissions.jsonc` excludes from the sandbox, reported both conflicts correctly and
  produced a tree that verified green. Independently reproduced the same day on
  `feat/agent-context-optimization-421aa5` against the same `main`: the same empty conflict list, 61
  dirty tracked paths of which 60 were byte-identical to `main`, 5 untracked paths all present in
  `main`, no `MERGE_HEAD`, and a plain `git merge main` afterwards that named the one real conflict.
  A different branch and a different conflicting path, so this is the command and not one branch.
- **Workaround:** Set the debris aside with `git stash push -u -m '<unique-tag>'` rather than
  `git checkout -f`, which is both sandbox-denied and classifier-denied; then run `git merge
  origin/main` yourself as a top-level command and resolve by hand. `git merge-tree --write-tree HEAD
  origin/main` is a read-only way to learn what actually conflicts before touching anything.
- **Proposed change:** Run the integration merge the way a top-level `git merge` already runs — the
  policy exclusion exists precisely because this operation writes sandbox-protected paths — or detect
  the denial and say so instead of calling it a conflict. Independently, a failed integration should
  print the paths it is talking about, taken from the index or from `merge-tree`, and should leave the
  worktree as it found it rather than partially written; a message naming no path is worse than no
  message, because it sends the reader looking for a conflict that may not exist.
- **Dependencies:** Same root cause as `DEVENV-088` and `DEVENV-068`: a grandchild process inherits
  the sandbox that its top-level command is excluded from, so the exclusion does not reach the git
  invocation that needs it. Fixing that generally would fix this; fixing the empty conflict list is
  worth doing either way.
- **Acceptance:** `./agent finalize` in a sandboxed shell, on a branch that genuinely conflicts with
  `main`, names every conflicting path and leaves the worktree either cleanly conflicted or untouched;
  on a branch that does not conflict, it integrates `main` and proceeds. Neither case leaves a tree
  with no `MERGE_HEAD` and no unmerged entries.
- **Source:** 2026-09-20 landing of `feat/misc-followups-66ff38`.
