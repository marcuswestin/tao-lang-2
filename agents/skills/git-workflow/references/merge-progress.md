# Merge Progress

Land the finished part of a long task on `main` mid-flight and carry the rest on a fresh branch.
Reach for this whenever a long task crosses a slice boundary, not only when the Developer asks to merge what is
done so far, says to bring the work to a good state and merge now, or invokes `/merge-progress`.

A branch that sits un-integrated gets more expensive every hour: `main` moves several times a day
here, and the files a long task most often touches — root `AGENTS.md`, the skills, the developer
environment ledger — are exactly the ones every other branch also edits, so they conflict and
renumber on every round. Landing the finished half early is what keeps that bill small.

The finished part lands on `main` now; the remainder continues on a new branch from that `main`.
Nothing half-done ships: the cut is chosen so every commit that lands is complete on its own terms.
The rest of `git-workflow` owns squashing, merging, and syncing `main`, and `verification-lanes` owns
the evidence and message format; this reference owns only the mid-task cut.

## When a slice is worth proposing

GitHub CI is the default for final portable proof and hosted landing; local landing uses a
machine-wide lock and remains the `dev/<name>` path. `verification-lanes` owns the route and
offline fallback. Propose a landing only when
all four hold, and it is then the Developer's to accept or defer:

- The finished side is independently complete by the cut rule below.
- It is at least two commits, or one that touches a surface other branches also edit: root
  `AGENTS.md`, a skill, `.rulesync/`, a generated harness file, or the developer environment ledger.
- At least half an hour of work has gone into it, or `main` has moved since this branch last matched
  it. Both are reasons the merge gets dearer by waiting.
- You have not proposed a landing in the last half hour. One proposal per boundary, not per commit.

Say in the proposal which of these made it worth asking and which verification route applies. For
local landing, check `./agent board` and report any lock wait; an already verified hosted PR does
not need that local lock. Never land on the strength of this section alone — root `AGENTS.md` requires the Developer's explicit
yes, which may have been given in advance for a named slice.

## Choosing the cut

Move the line until every item on the finished side is true on its own: its behavior change is
complete, not a first half; it has the tests it deserves, and they pass; it does not depend on
anything still in progress; and its roadmap entry, ledger row, or spec paragraph is updated. A defect
found but not fixed is not a cut boundary — record it (below) and land the fixes around it. If the
finished side is empty, say so and do not merge.

## Bringing the branch to a good state

Before touching `main`: land every finished change as commits so `git status` is clean (an
in-progress change may be committed too, only if inert — not reachable from anything the Developer would run);
reverse anything in progress that is not inert, restoring the previous state; leave loud markers (a
quarantine entry) exactly where they were, note updated to say where work now stands; refresh the
documents the landed work changed; follow `verification-lanes` for local or hosted proof and the
required host acceptance, saying explicitly if a lane was already red rather than implying it
passed. Write or refresh `.artifacts/merge/<branch>.msg`; do not require broad local verification
before preparing a hosted landing or merging its already verified PR.

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
is an ordinary feature branch from here. A later cut is proposed the same way, against the same four
conditions — the rhythm is the Developer's to set by answering, not yours to set by cutting.

## The checkpoint

`.artifacts/checkpoint/<branch>.md` is what a slice boundary leaves behind, refreshed at every one of
them whether or not a landing is proposed. It exists because the two ways a long task continues —
the Developer compacting the thread, or a fresh thread taking the branch — both destroy conversation and keep
the repository. A model-written summary drops the constraint that mattered; a file does not.

It is ignored by Git and lives only in this worktree, which is the right scope: it carries a branch
across a context boundary, while work that has to survive the branch goes in the roadmap document
under "Handing over the rest". Keep it short enough to stay true: the goal in a sentence; decisions taken and what they rule out;
the evidence already green, with the lane and its timestamp, so the next thread does not re-run it;
paths this branch owns; what is open, each with its next concrete step; and what has been proposed to
the Developer and not yet answered. Replace it rather than appending — a checkpoint is the current state, not a
log — and write it before saying that this is a good point to compact, because after the compaction
it is the only thing that remembers.

## Handing over the rest

The remaining work lives in the repository, not in a reply: every open item goes in the task's
roadmap document with the exact reproduction, the last thing tried, and why it is still open (a
defect found while landing the finished side goes here too); the follow-up branch's name appears
there so the next agent can find the work from `main` alone. The Developer's reply gets the cut and nothing
else: what landed, what did not, and what runs next.
