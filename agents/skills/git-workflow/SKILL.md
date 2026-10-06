---
name: git-workflow
description: >-
  Manage Tao Git branches, commits, merges, and checkout ownership. Use for branch inspection,
  worktree creation or cleanup, committing, pushing, squashing, rebasing, history rewriting,
  dirty checkouts, commit-all, /merge-progress, or personal dev branch cycles. Read before any
  merge; after integrating main, inspect what arrived.
---

# Git Workflow

Root `AGENTS.md` owns branch and index constraints and standing authorization to merge other
branches, including its dependency-approval exception. Apply that authorization to all incoming
file changes. The warn-only Git hooks
`./agent setup` installs speak up on a detached HEAD, an unnamed branch, or an attribution trailer.
`verification-lanes` owns the landing route, its evidence, flags, and message-file format.

## Resource review after landing

After every successful landing, inspect the single inventory with `./agent unsandboxed resources --json`.
A local `land` also saves `.artifacts/resources/after-land.json`; read its full entries and
warnings. Include active sessions started by this task as well as stranded resources.
Match this task's receipts and external-directory registrations; a checkout path alone does not
prove task ownership in a shared checkout. Ask the Developer whether to clean the concrete
task-owned items before doing so. If nothing is eligible, say so briefly.

Register each nonstandard external directory when created, in addition to the task-local note:

```sh
./agent resources --register-directory /absolute/path --task '<task identifier>' \
  --purpose '<why it exists>' --cleanup-condition '<when it can be removed>' --json
```

The report is discovery, never removal authority. Recheck identities and task activity after
approval; use existing owned stop/recovery commands for sessions and retained fences, and
`worktree-status` before reclaiming any checkout. Preserve unknown ownership, borrowed devices,
unrelated processes, reusable caches, and evidence still needed for review. Never use broad
`clean-all` or PID/name matching to resolve a retained resource.

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
  leaves and commit the merge. If a direct `git merge` already left `MERGE_HEAD`, use
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

## Merging a feature branch into `main`

For landing a finished slice during a longer task, or `/merge-progress`, read
`references/merge-progress.md` before preparing the partial landing.

Require a clean feature branch with its merge message reviewed; `verification-lanes` owns the
landing route, its evidence, and the message format. After the Developer authorizes landing this
slice, follow that route exactly: `./agent unsandboxed open-pr --auto-merge` with the host-only
gates run locally in parallel, GitHub merging on green `Verify`. Personal `dev/<name>` branches
keep their supported local `land` lifecycle. For that local route, run
`./agent unsandboxed land`: it fetches and integrates current `main`, verifies, and pushes while holding
one lock. Every integration must attempt to fetch `origin/main` first and use the fetched tip when
available, never prefer stale local `main`. If preparation falls back to local `main` because fetching
failed, report that as offline preparation, not current remote integration. Landing requires a successful
fetch inside its lock before merging and verifying; an earlier fetch or merge does not replace it.
Do not fetch and merge `main` beforehand merely to satisfy a stale precondition. If the
landing reports a conflict, resolve it outside the lock; after any merge of `main` into a branch,
skim what arrived: `references/after-merging-main.md`.

Plain `open-pr` without `--auto-merge` is only for CI feedback before landing is authorized. If a
local host-only gate fails after GitHub already merged the pull request, fix it on the branch,
merge the branch into `main` locally after fetching `origin/main`, and push `main` without a full
verification, as the route says. GitHub refuses a pull request that conflicts with `main`, so bring
`main` in with `./agent merge-main` and run `open-pr --auto-merge` again; the checks run on that
push. After it merges, the remote `feat/<name>` is gone and `merged/<name>` holds its head; the
local branch and worktree remain for the resource review below.

A person's branch is `dev/<name>`. `open-pr` and `merge-pr` do not support this branch shape; it
uses the local `./agent unsandboxed land` lifecycle and verification, then the same name is created
again from `main` (`references/personal-dev-branch.md`).
A `feat/<name>` branch lands once and is not recreated for more commits. Pushing is irreversible:
confirm with the Developer before pushing anything the Developer did not ask to be pushed.

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
