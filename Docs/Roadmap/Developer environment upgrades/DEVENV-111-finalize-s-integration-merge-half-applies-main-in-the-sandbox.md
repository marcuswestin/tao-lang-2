# DEVENV-111 — `finalize`'s integration merge half-applies `main` in the sandbox and names no conflicting path

- **Status:** In progress
- **Section:** External
- **Partly addressed, 2026-09-20:** `Finalize.ts` now asks `git merge-tree --write-tree --name-only`
  what would conflict _before_ attempting the merge, and separates the two failures. A merge that
  recorded unmerged entries still says to resolve it by hand and names them. A merge that failed
  without recording any says so in those words, quotes Git's stderr, names what `merge-tree` says
  would conflict — it answers read-only, so it works where the merge itself could not — and points at
  running `git merge main` as a top-level command. The empty conflict list is gone. **What remains**
  is the half-written tree itself: the merge is still attempted inside the sandbox, so it can still
  stop partway and leave modifications the reader did not make. That needs the sandbox-inheritance
  fix under Dependencies, not another change here.
- **Partly addressed, 2026-09-21:** the half-written tree is gone. `Finalize.ts` now probes before
  merging: it takes the directories `main` would write, creates and removes a file in each, and
  refuses with those directories named if any write is denied — so the merge is never attempted
  where it cannot finish, and the worktree is untouched rather than half-written. The probe is an
  actual write rather than a list of protected prefixes, because that list is the harness's: it is
  in neither `.rulesync/permissions.jsonc` nor the generated settings, and a copy kept here would
  rot silently. **What remains** is that finalize still cannot perform the merge itself in that
  case; it hands off to a top-level `git merge`. Excluding `./agent finalize` from the sandbox the
  way `eabe05bc` excluded the landing would fix that, but finalize runs every test suite, which is a
  different order of blast radius from a landing a person has already approved.
- **Correction, 2026-09-21:** the Dependencies note below is wrong about what a general fix would
  look like. A Seatbelt profile is inherited and can only be narrowed by a descendant, never widened,
  so no harness change can lift a nested `git` out of the sandbox its parent runs in. There is no
  general fix waiting to be written; the only lever is which top-level commands are named approval
  boundaries and excluded, which is what `eabe05bc` did for the landing.
- **Follow-up, 2026-09-21:** on `feat/tao-skills`, the new write probe itself failed while removing
  its temporary directory in `Docs/Roadmap` (`EFAULT` from `FS.remove`). Finalize wrapped that as
  `UnexpectedBehaviorError: Something went wrong.` and never reached its blocked-directory report.
  A top-level `git merge main` then succeeded without conflicts. The probe cleanup needs to report
  its path and recovery when removal is denied; the current workaround is the top-level merge.
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
- **Workaround:** Only needed for a tree an older finalize already half-wrote. Set the debris aside
  with `git stash push -u -m '<unique-tag>'` rather than `git checkout -f`, which is both
  sandbox-denied and classifier-denied — confirmed 2026-09-21 on
  `feat/ripgrep-replace-flag-issue-970ab2`, where `checkout -f`, `git merge` and even a
  path-scoped `git restore` were all refused as irreversible local destruction, and the tagged stash
  was not; then run `git merge origin/main` yourself as a top-level command and resolve by hand. `git merge-tree --write-tree HEAD
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
