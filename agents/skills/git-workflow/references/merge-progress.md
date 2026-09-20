# Merge Progress

Land the finished part of a long task on `main` mid-flight and carry the rest on a fresh branch. Use
when Ro asks to merge what is done so far and keep going, says to bring the work to a good state and
merge now, or invokes `/merge-progress`.

The finished part lands on `main` now; the remainder continues on a new branch from that `main`.
Nothing half-done ships: the cut is chosen so every commit that lands is complete on its own terms.
The rest of `git-workflow` owns squashing, merging, and syncing `main`, and `verification-lanes` owns
the evidence and message format; this reference owns only the mid-task cut.

## Choosing the cut

Move the line until every item on the finished side is true on its own: its behavior change is
complete, not a first half; it has the tests it deserves, and they pass; it does not depend on
anything still in progress; and its roadmap entry, ledger row, or spec paragraph is updated. A defect
found but not fixed is not a cut boundary — record it (below) and land the fixes around it. If the
finished side is empty, say so and do not merge; a merge that lands nothing costs Ro a review and
buys nothing.

## Bringing the branch to a good state

Before touching `main`: land every finished change as commits so `git status` is clean (an
in-progress change may be committed too, only if inert — not reachable from anything Ro would run);
reverse anything in progress that is not inert, restoring the previous state rather than leaving a
worse one; leave loud markers (a quarantine entry) exactly where they were, note updated to say where
work now stands; refresh the documents the landed work changed, saying which items are done and open;
run `./agent verify --complete` plus the reachable host lanes, and say explicitly if a lane was
already red rather than implying it passed; then write or refresh `.artifacts/merge/<branch>.msg`.

## The merge message for a partial landing

The usual format applies, with two differences: the summary names what landed, never the task
(`Fix the keyboard narrowing gate and its three regressions`, not `September remediation, part one` —
a reader of `main`'s history has no part two to compare it with); and one bullet states what is
deliberately not in this commit and where it continues, naming the follow-up branch.

## Merging and continuing

Sync `main` as any landing does (`git-workflow`'s fetch/fast-forward/merge-if-both-moved sequence),
then, without waiting to be asked: create the follow-up branch from the `main` that now holds the
merge, in a fresh worktree; carry the in-progress work onto it, preferring to re-apply it from the
landed base over cherry-picking a commit whose context has moved; and continue — the follow-up branch
is an ordinary feature branch from here. Do not merge it under this workflow again out of habit; a
second mid-task cut is Ro's call, not a rhythm.

## Handing over the rest

The remaining work lives in the repository, not in a reply: every open item goes in the task's
roadmap document with the exact reproduction, the last thing tried, and why it is still open (a
defect found while landing the finished side goes here too); the follow-up branch's name appears
there so the next agent can find the work from `main` alone. Ro's reply gets the cut and nothing
else: what landed, what did not, and what runs next.
