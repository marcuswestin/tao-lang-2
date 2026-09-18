---
name: merge-progress
description: >-
  Land the finished part of a long task on main mid-flight and carry the rest on a fresh branch. Use when Ro asks to merge what is done so far and keep going, says to bring the work to a good state and merge now, or invokes /merge-progress.
---

# Merge Progress

Ro uses this when a task is long, part of it is finished and proved, and the rest would keep an
unmerged branch alive for days. The finished part lands on `main` now; the remainder continues on a
new branch from that `main`. Nothing half-done ships: the cut is chosen so every commit that lands
is complete on its own terms.

`git-workflow` owns the mechanics of squashing and merging, and `verification-lanes` owns the
evidence and the merge-message format. This skill owns only the mid-task cut: what may go, what
must stay, and the handoff that keeps the rest moving.

## Choosing the cut

Divide the work already done into what is finished and what is in progress, then move the line until
every item on the finished side is true on its own:

- Its behavior change is complete, not a first half. A refactor that landed without its call sites
  updated is in progress, however green the tree is.
- It has the tests the change deserves, and they pass. A fix proved only by a lane that is still red
  for another reason is in progress.
- It does not depend on anything on the in-progress side. If removing the in-progress work would
  break it, it is not finished.
- Its documents are updated: the roadmap entry, the ledger row, the spec paragraph it changed.

A defect found but not fixed is not a cut boundary. Record it (see **Handing over the rest**) and
land the fixes around it.

If the finished side is empty, say so and do not merge. A merge that lands nothing costs Ro a review
and buys nothing.

## Bringing the branch to a good state

Do this before touching `main`, in the worktree the work is in:

1. Land every finished change as commits on the feature branch, so `git status` is clean. An
   in-progress change that is safe to carry forward may be committed too, but only when it is inert:
   it must not be reachable from anything Ro would run.
2. Reverse anything in progress that is _not_ inert — a half-applied rename, a weakened assertion, a
   quarantine lifted before its journey is green. Restore the previous state rather than leaving a
   worse one behind.
3. Leave loud markers exactly where they were: a quarantine entry stays until the thing it
   quarantines is green, with its note updated to say where the work now stands.
4. Refresh the documents the landed work changed, including the roadmap or ledger entry that tracks
   the larger task. Say in it which items are done and which are open, so the record does not read
   as if the whole task landed.
5. Run `./agent verify --complete`, plus the host lanes the change reaches, and read what still
   fails. A lane that was red before the branch and is red after it does not block this merge; say
   so explicitly in the merge message rather than implying it passed.
6. Write or refresh `.artifacts/merge/<branch>.msg`.

## The merge message for a partial landing

The usual format applies. Two things are specific to this cut:

- The summary names what landed, never the task. `Fix the keyboard narrowing gate and its three
  regressions` is right; `September remediation, part one` is not — a reader of `main`'s history has
  no part two to compare it with.
- One bullet states what is deliberately not in this commit and where it continues, naming the
  follow-up branch. That bullet is what stops a later reader from concluding the task was abandoned.

## Syncing `main` before the cut lands

`merge-with-main`'s preflight requires local `main` to equal `origin/main`, and on a machine running
several agents `main` moves while the cut is being prepared. Sync it deliberately rather than
discovering the mismatch when the landing is refused:

Fetching before and pushing after is part of landing, for every agent. A local `main` left ahead of
the remote is what blocks the next agent, and the block is invisible until their landing is refused.

1. `git fetch origin main` immediately before landing, not once at the start. Another branch can land
   between the verification run and the merge command.
2. **Local `main` behind `origin/main`:** fast-forward it in whichever worktree has `main` checked
   out (`git merge --ff-only origin/main`), never in a worktree that has it borrowed.
3. **Local `main` ahead of `origin/main`:** someone landed and left it unpushed. Landing pushes those
   commits with yours, and that is the intended outcome — an unpushed `main` is the defect, not the
   push. Say in the handover whose commits went up alongside yours.
4. **Both moved:** merge the refreshed `main` into the feature branch, re-run the verification the
   merge invalidated, and refresh the merge message before landing. A green lane from before the
   merge proves a tree that no longer exists.
5. After the landing, confirm `main` and `origin/main` agree again before branching from it, so the
   follow-up branch starts from what the remote actually holds, and no one inherits an unpushed
   `main` from you.

A merge that brought in other people's work is also the moment to re-read what it changed in
`AGENTS.md` and under `agents/skills/`: a landing command or a verification rule can change under
you, and the cut is being made precisely because other work is landing alongside yours.

## Merging and continuing

Follow `git-workflow`'s merge section as written. Then, without waiting to be asked:

1. Create the follow-up branch from the `main` that now holds the merge, in a fresh worktree.
2. Carry the in-progress work onto it. Prefer re-applying it from the landed base to cherry-picking
   a commit whose context has moved.
3. Continue the task. The follow-up branch is an ordinary feature branch from here: it ends at
   `just merge-with-main` like any other, which needs no flag to do its job.

Do not merge the follow-up branch under this skill again out of habit. A second mid-task cut is
Ro's call, not a rhythm.

## Handing over the rest

The remaining work outlives this session's context, so it lives in the repository, not in a reply:

- Every open item goes in the task's roadmap document, each with what is known: the exact
  reproduction, the last thing tried, and why it is still open. A defect found while landing the
  finished side goes here too.
- The follow-up branch's name appears in that document, so the next agent can find the work from
  `main` alone.
- Ro's reply gets the cut and nothing else: what landed, what did not, and what runs next.
