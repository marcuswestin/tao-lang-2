---
name: git-workflow
description: >-
  Work with Git in this repository: create or clean up worktrees, branch, commit, squash, merge a feature branch into main, rewrite history, or inspect branch state. Use when the Developer asks to commit, merge, squash, rebase, push, branch, resolve a dirty worktree, or move a branch ref, and whenever `main` is merged into a branch, to skim what arrived (`references/after-merging-main.md`); also covers committing every outstanding change in small chunks (`references/commit-all-chunks.md`) and landing the finished part of a long task mid-flight (`references/merge-progress.md`, or `/merge-progress`).
---

# Git Workflow

Root `AGENTS.md` owns the hard constraints on branches and the Git index; the warn-only Git hooks
`./agent setup` installs speak up on a detached HEAD, an unnamed branch, or an attribution trailer.
`verification-lanes` owns `merge-with-main`'s evidence, flags, and message-file format.

## This repository has many worktrees

`git worktree list` routinely shows fifteen or more checkouts sharing one object store, worked in concurrently by other agents and the Developer.

- Read `git worktree list` before any operation that moves a ref. A branch checked out elsewhere is not yours to move, and never write to another worktree's files, index, or branch.
- In a linked worktree, `./agent` reuses the primary checkout's pinned devenv profile (run
  `direnv allow && direnv exec . ./agent setup` only when it reports no shared profile), and remove a
  worktree you created once its branch is merged or abandoned.
- Git operations that replace protected paths can half-succeed inside the sandbox: HEAD and most
  files move, but protected paths stay dirty. To bring `main` into a feature branch, run
  `./agent merge-main`; when it refuses because `main` writes a protected path, run
  `./agent unsandboxed merge-main`, which makes the same merge on the host. Resolve any conflict it
  leaves and commit the merge. If a direct `git merge` already left `MERGE_HEAD`, use
  `./agent unsandboxed merge-recover` to abort it on the host. If Git left no `MERGE_HEAD`, inspect
  status, reflog, and `ORIG_HEAD`; after the Developer authorizes a reset, run
  `./agent unsandboxed merge-recover --reset-to <full pre-merge SHA>`. That uses `git reset --merge`
  to retain unrelated work where Git can; `--hard` discards tracked edits and needs separate explicit
  authorization. To start a new feature branch from current `origin/main`, run
  `./agent start-branch feat/<name>`; if its write probe refuses, run
  `./agent unsandboxed start-branch feat/<name>`. Both require a clean worktree. An authorized
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

## Merging a feature branch into `main`

Require a clean feature branch with its merge message reviewed; `verification-lanes` owns the
landing command's mechanics, evidence, and message format. After the Developer authorizes landing this slice,
run `./agent unsandboxed land`: it fetches and integrates current `main`, verifies, and pushes while holding
one lock. Do not fetch and merge `main` beforehand merely to satisfy a stale precondition. If the
landing reports a conflict, resolve it outside the lock; after any merge of `main` into a branch,
skim what arrived: `references/after-merging-main.md`.

A person's branch is `dev/<name>` and lands exactly as `feat/<name>` does, through the `Mine`
`Justfile` recipes. Pushing is irreversible: confirm with the Developer before pushing anything the Developer did not ask
to be pushed.

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
