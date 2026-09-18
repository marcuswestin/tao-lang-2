---
name: review-fanout
description: >-
  Review many units at once — every squash merge on main, every slice of a tranche, every file of a
  large change — by giving each unit its own read-only agent and reconciling what comes back. Use
  when asked to audit the merges, review a tranche, review every commit, or fan out a review.
---

# Review Fan-out

One review, many units, no writes. `delegation` owns the brief, the tier, and how far to trust a
report; `parallel-implementation` owns agents that write at the same time. This skill owns the shape
in between: dividing a review that is too large for one context, and putting the findings back
together so the result is worth more than the sum of the reports.

## Pick the unit

A unit is the smallest thing a reviewer can judge without reading its neighbours.

- **Squash-merge audit.** One commit on `main`. Each carries its own
  `Squashed commit of the following:` appendix, so the reviewer reads the appendix for what the
  branch claimed and `git show` for what it did, and judges the second against the first.
- **Tranche review.** One vertical: a feature's `.tao` and `.test.tao` in `Apps/WordFlower/1 -
  Current/` against its `.tao-next` counterpart in `2 - Next/`, plus the capability row in
  `Docs/Roadmap/Tao Revolution/Coverage.md` that claims a test covers it.
- **Large change.** One package, or one seam, never one directory-full of unrelated files.

Do not split a unit whose halves only make sense together. Two agents reviewing two ends of one
change will each call the other end missing.

## Two passes, always

The first pass finds candidates. The second pass re-checks each candidate against current `main`,
and it is not optional: September's audit of forty-four commits refuted twenty-one findings that a
later merge had already fixed. Implementing those would have been work done twice, against code that
no longer had the defect.

Give the second pass a different agent from the one that raised the finding, and give it the
finding's own evidence to attack rather than the unit. A verifier that re-reviews the whole unit
will find new things and never settle the question it was asked.

## Run it

- Fan out three to five at a time, each agent read-only, each with one unit and the repository
  boilerplate from `delegation`.
- Keep a finished agent working: hand it the next unit rather than waiting for the batch.
- Ask every reviewer for the same finding shape, because you are about to merge their output:
  severity, `file:line`, what breaks, and the smallest fix. A finding without evidence is a question,
  not a result.
- Reviewers report to you and never to each other. Cross-talk between reviewers produces agreement,
  which is not the same as correctness.

## Reconcile

1. Deduplicate across reports. The same defect reached from two units is one finding with two
   witnesses, and that is stronger than either.
2. Sort by severity, not by the order the agents finished.
3. Check a sample yourself before you act on any of it — open a cited `file:line`, re-run one
   command. A whole batch of reports agreeing is not evidence that any of them looked.
4. Write the findings into a tracked document before the worktree is gone. `.artifacts/` is ignored
   and worktree-local, so a checklist that lives only there dies with the branch; September's audit
   records exactly that loss. The durable home is the roadmap document that owns the work.
