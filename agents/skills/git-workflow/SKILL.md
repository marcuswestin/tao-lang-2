---
name: git-workflow
description: >-
  Work with Git in this repository: create or clean up worktrees, branch, commit, squash, merge a feature branch into main, rewrite history, or inspect branch state. Use when Ro asks to commit, merge, squash, rebase, push, branch, resolve a dirty worktree, or move a branch ref.
---

# Git Workflow

Root `AGENTS.md` owns the hard constraints: never commit from detached HEAD, always be on a named
`feat/<name>` branch first, and never change the Git index unless Ro asks in the current request. Use
`commit-all-chunks` when Ro asks to commit everything outstanding.

## This repository has many worktrees

`git worktree list` routinely shows fifteen or more checkouts sharing one object store, across
`~/.codex/worktrees/`, `.claude/worktrees/`, and sibling directories. Other agents and Ro work in them
concurrently.

- Read `git worktree list` before any operation that moves a ref. A branch checked out elsewhere is
  not yours to move.
- Never write to another worktree's files, index, or branch.
- Worktrunk-created worktrees trust and set up the checkout in a blocking pre-start hook. In other
  linked worktrees, `./agent` reuses the primary checkout's pinned devenv profile; run
  `direnv allow && direnv exec . ./agent setup` only when the wrapper reports no shared profile.
- Remove a worktree you created once its branch is merged or abandoned.
- `git merge` and the two resets that abort a squash (`git reset --merge`, `git reset --hard HEAD`) run outside the sandbox by policy (`.rulesync/permissions.jsonc` excludes them), so they may replace `.claude/settings.json` or a skill under `agents/skills/`. Anything else that writes a sandbox-protected path — `git checkout <ref>`, `git checkout <ref> -- <path>`, every other `git reset` form — still needs an unsandboxed shell: inside the sandbox it fails partway with `unable to unlink old`, records no merge state, and leaves the other branch's new files behind as untracked strays; remove those before retrying.
- A sandboxed `git checkout <ref>` is the trap to know about, because it half-succeeds: HEAD moves and most of the tree changes, but the protected `agents/skills/` files keep the old branch's content and show as modifications, so the checkout looks like a dirty switch rather than a failed one. Recover with `git checkout -f <branch>` from an unsandboxed shell. Switching HEAD to measure another commit's behavior — a before-and-after benchmark, say — therefore needs an unsandboxed shell from the start.

## Moving a branch ref

Use `git merge --ff-only <ref>` from inside the worktree that has the branch checked out. It moves the
ref, index, and working tree together.

Do not use `git update-ref` on a branch that is checked out anywhere. It writes the ref alone, leaving
that worktree's index and working tree at the old commit; `git status` then reports the entire
difference as staged changes, inverted and alarming. Recovering costs a `git reset --hard`, which is
only safe after confirming nothing uncommitted was there.

`git update-ref` is correct only for branches no worktree has checked out.

## Commit messages

Ordinary commits follow `commit-all-chunks`: a concise summary, then one bullet per line with no blank
lines between bullets.

`git merge --squash` stages its result without writing `MERGE_HEAD`, so **`git merge --abort` does not
undo it** — it reports there is nothing to abort. Undo a staged squash with `git reset --hard HEAD`, then
`rm -f .git/SQUASH_MSG`. Check `git status` first: a hard reset also discards every unstaged edit in that
checkout. If the staged tree holds work that exists nowhere else, capture it first —
`git commit-tree $(git write-tree) -p HEAD -m backup` and keep the SHA in a ref.

Squash commits additionally preserve Git's squash appendix, which is how every squash commit on `main`
is written:

```
<Summary line>

- <bullet>
- <bullet>

Squashed commit of the following:

commit <full sha>
Author: ...
Date:   ...

    <subject and four-space indented body>
```

Write the summary and bullets from the branch's actual content. `git merge --squash` generates the
appendix; `git log <base>..<head>` reproduces it when composing a message by hand.

## Merging a feature branch into `main`

Require a clean, validated feature branch with its merge message written or refreshed at
`.artifacts/merge/<branch>.msg`; the `verification-lanes` skill owns that file's format and the human
`just merge-with-main` invocation, which needs no flag to do its job. Run `./agent verify --complete`
before the merge commit; afterwards the command's own tree-equality proof, not a second lane, is what
says the squash is the verified tree. Archive completed roadmap task folders before it, never after.

No worktree needs to be on `main` first. The command stages its squash in one, and makes a temporary
one under `.artifacts/merge/main-worktree` when the repository has none — which is the ordinary state
when the primary checkout is itself on the feature branch. It removes that worktree when the landing
completes and keeps it when the landing fails, because the staged squash inside it is what `--abort`
restores from.

Refresh `main`, merge current `main` back into the feature branch, validate and push again, then
squash onto freshly refreshed `main`. Push `main` before renaming the remote feature branch to
`merged/<name>`. Finish on clean `main` with temporary worktrees and local feature branches removed.

Pushing is outward-facing and effectively irreversible. Confirm with Ro before pushing anything Ro did
not explicitly ask to be pushed.

## Rebuilding history

When collapsing a chain of branches into per-branch squash commits, do not chain `git merge --squash`.
After the first squash the new branch's only ancestor is the base, so every later merge-base is that
base and Git re-applies the whole cumulative diff onto content that already holds part of it, which
conflicts for no reason.

Each boundary ref's tree is already the desired result, so set it directly:

```
git read-tree --reset -u <boundary-ref>
git commit -F <message-file>
```

`read-tree --reset -u` overwrites tracked files unconditionally — run it only in a worktree created
for the rewrite. Assert after each commit that its tree equals the boundary ref's tree, and assert the
final branch diffs empty against the original tip before merging.

Keep the original branches, or tag them, until Ro confirms the rewrite is accepted. Documents that
cite commit hashes go stale when the commits they name leave `main`'s history; search for and resolve
those references as part of the rewrite.
