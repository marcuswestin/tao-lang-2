---
name: git-workflow
description: >-
  Manage Tao Git branches, commits, worktrees, and checkout ownership. Use for branch inspection,
  worktree creation or cleanup, committing, pushing a branch, squashing, rebasing, history
  rewriting, dirty checkouts, commit-all, merge conflicts, or bringing main into a branch; after
  integrating main, inspect what arrived.
---

# Git Workflow

Root `AGENTS.md` owns branch and index constraints and standing authorization to merge other
branches, including its dependency-approval exception. Apply that authorization to all incoming
file changes. The warn-only Git hooks
`./agent setup` installs speak up on a detached HEAD, an unnamed branch, or an attribution trailer.
`landing` owns merging a branch into `main`, the merge message, and the cleanup after it. Pushing is
irreversible: confirm with the Developer before pushing anything the Developer did not ask to be
pushed.

## Worktree ownership

`git worktree list` routinely shows fifteen or more checkouts sharing one object store, worked in concurrently by other agents and the Developer.

- Read `git worktree list` before any operation that moves a ref. A branch checked out elsewhere is not yours to move, and never write to another worktree's files, index, or branch.
- In a linked worktree, `./agent` reuses the primary checkout's pinned devenv profile (run
  `./enter-tao-dev-env` in that worktree when it reports no shared profile), and remove a
  worktree you created once its branch is merged or abandoned.
- Before reclaiming a worktree, use `./agent reclaim` and follow
  `references/reclaim-task-associations.md` for agent task ownership that local metadata cannot prove.
- Git operations that replace protected paths can half-succeed inside the sandbox: HEAD and most
  files move, but protected paths stay dirty. To bring `main` into a feature branch, run
  `./agent merge-main`, which attempts to fetch `origin/main` before selecting the merge tip;
  when it refuses because `main` writes a protected path, run
  `./agent unsandboxed merge-main`, which makes the same merge on the host. Resolve any conflict it
  leaves, commit the merge, and skim what arrived (`references/after-merging-main.md`). If a direct `git merge` already left `MERGE_HEAD`, use
  `./agent unsandboxed merge-recover` to abort it on the host. If Git left no `MERGE_HEAD`, inspect
  status, reflog, and `ORIG_HEAD`; after the Developer authorizes a reset, run
  `./agent unsandboxed merge-recover --reset-to <full pre-merge SHA>`. That uses `git reset --merge`
  to retain unrelated work where Git can; `--hard` discards tracked edits and needs separate explicit
  authorization. To start a new feature branch from current `origin/main`, run
  `./agent start-branch feat/<name>`; to take over a `feat/*` branch someone already pushed, run
  `./agent take-branch feat/<name>`, which tracks `origin/feat/<name>`. When either refuses its
  fetch or its write probe, run the same command as `./agent unsandboxed …`. Both require a clean
  worktree, and both run `./agent setup` after switching; nothing else reruns setup when a worktree
  changes branch, so run it yourself after any other switch. An authorized
  `./agent unsandboxed land` performs its own integration under the landing lock. For any other
  Git operation that half-succeeded, diagnose the exact state read-only, report the write needed,
  and pause for the Developer's explicit approval.

## Moving a branch ref

Use `git merge --ff-only <ref>` from inside the worktree that has the branch checked out; it moves
the ref, index, and working tree together. `git update-ref` writes the ref alone and is correct only
for a branch no worktree has checked out — using it on a checked-out branch leaves that worktree's
index and tree at the old commit, reported as the whole diff staged and inverted; recover with
`git reset --hard` only after confirming nothing uncommitted was there.

## Commit messages

Ordinary commits: a concise summary, then one bullet per line with no blank lines between bullets
(`references/commit-all-chunks.md` for committing everything outstanding this way).

`git merge --squash` stages its result without writing `MERGE_HEAD`, so **`git merge --abort` does
not undo it** — undo with `git reset --hard HEAD` then `rm -f .git/SQUASH_MSG` after checking
`git status`, since the reset also discards unstaged edits; if the staged tree holds work that exists
nowhere else, capture it first with `git commit-tree $(git write-tree) -p HEAD -m backup` and keep
the SHA. It preserves Git's squash appendix on `main` — summary, bullets, a blank line, then
`Squashed commit of the following:` and each squashed commit's own header and indented body — which
`git log <base>..<head>` reproduces by hand.

## Rebuilding history

When collapsing a chain of branches into per-branch squash commits, do not chain `git merge --squash`
— after the first squash its only ancestor is the base, so every later merge-base is that base and
Git re-applies the whole cumulative diff onto content that already holds part of it. Instead, since
each boundary ref's tree is already the desired result, set it directly:

```
git read-tree --reset -u <boundary-ref>
git commit -F <message-file>
```

`read-tree --reset -u` overwrites tracked files unconditionally — run it only in a worktree created
for the rewrite. Assert after each commit that its tree equals the boundary ref's tree, and that the
final branch diffs empty against the original tip before merging. Keep the original branches, or tag
them, until the Developer confirms the rewrite, and resolve any document that cites a commit hash leaving
`main`'s history.
