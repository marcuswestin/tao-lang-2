---
name: git-workflow
description: >-
  Work with Git in this repository: create or clean up worktrees, branch, commit, squash, merge a feature branch into main, rewrite history, or inspect branch state. Use when Ro asks to commit, merge, squash, rebase, push, branch, resolve a dirty worktree, or move a branch ref; also covers committing every outstanding change in small chunks (`references/commit-all-chunks.md`) and landing the finished part of a long task mid-flight (`references/merge-progress.md`, or `/merge-progress`).
---

# Git Workflow

Root `AGENTS.md` owns the hard constraints: never commit from detached HEAD, always be on a named
`feat/<name>` branch first, and never change the Git index unless Ro asks in the current request.
`verification-lanes` owns `merge-with-main`'s evidence, flags, and message-file format.

## This repository has many worktrees

`git worktree list` routinely shows fifteen or more checkouts sharing one object store, worked in concurrently by other agents and Ro.

- Read `git worktree list` before any operation that moves a ref. A branch checked out elsewhere is not yours to move, and never write to another worktree's files, index, or branch.
- In a linked worktree, `./agent` reuses the primary checkout's pinned devenv profile (run
  `direnv allow && direnv exec . ./agent setup` only when it reports no shared profile), and remove a
  worktree you created once its branch is merged or abandoned.
- `git merge` and the squash-aborting resets (`git reset --merge`, `git reset --hard HEAD`) run
  outside the sandbox by policy and may replace a sandbox-protected file such as `agents/skills/*`.
  Every other ref-moving command (`git checkout <ref>`, `git checkout <ref> -- <path>`, any other
  `git reset`) needs an unsandboxed shell too: sandboxed, it half-succeeds — HEAD and most of the
  tree move, but protected paths keep their old content and read as dirty rather than failed, and the
  other branch's new files are left as untracked strays. Recover with `git checkout -f <branch>`
  unsandboxed.

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

Require a clean, validated feature branch with `.artifacts/merge/<branch>.msg` written or refreshed;
`verification-lanes` owns the landing command's mechanics, evidence, and message format. Sync `main`
deliberately: `git fetch origin main` immediately before landing, since another branch can land
between the verification run and the merge command; fast-forward a behind local `main` only where it
is checked out, never in a borrowed worktree; an ahead local `main` pushes forward alongside yours,
which is correct; if both moved, merge refreshed `main` into the feature branch and re-verify.

A person's branch is `dev/<name>` and lands exactly as `feat/<name>` does, through the `Mine`
`Justfile` recipes. Pushing is irreversible: confirm with Ro before pushing anything Ro did not ask
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
them, until Ro confirms the rewrite, and resolve any document that cites a commit hash leaving
`main`'s history.
