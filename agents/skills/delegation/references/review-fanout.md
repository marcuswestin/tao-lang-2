# Review Fan-out

Review many units at once — every squash merge on main, every slice of a tranche, every file of a
large change — by giving each unit its own read-only agent and reconciling what comes back. Use when
asked to audit the merges, review a tranche, review every commit, or fan out a review. One review,
many units, no writes: `delegation` owns the brief, the tier, and how far to trust a report;
`references/parallel-implementation.md` owns agents that write at the same time.

## Pick the unit

A unit is the smallest thing a reviewer can judge without reading its neighbours: one commit on
`main` for a squash-merge audit (the reviewer reads its own `Squashed commit of the following:`
appendix for what the branch claimed and `git show` for what it did); one vertical for a tranche
review (a feature's `.tao` and `.test.tao` against its `.tao-next` counterpart, plus the capability
row in `Docs/Roadmap/Tao Revolution/Coverage.md` that claims coverage); one package or seam, never a
directory-full of unrelated files, for a large change. Do not split a unit whose halves only make
sense together.

## Two passes, always

The first pass finds candidates; the second re-checks each candidate against current `main` and is
not optional, since a later merge can already have fixed what an earlier pass found. Give the second
pass a different agent from the one that raised the finding, and give it the finding's own evidence
to attack rather than the whole unit.

## Run it and reconcile

Fan out three to five at a time, each agent read-only, each with one unit and `delegation`'s
repository boilerplate; give the next unit a fresh agent, since units are independent and a reused
agent re-reads its previous unit's whole history on every request. Ask every reviewer
for the same finding shape: severity, `file:line`, what breaks, and the smallest fix — a finding
without evidence is a question, not a result. Reviewers report to you and never to each other.

To reconcile: deduplicate across reports (the same defect from two units is one finding with two
witnesses, stronger than either alone); sort by severity, not by finishing order; check a sample
yourself before acting on any of it; and write the findings into a tracked document before the
worktree is gone, since `.artifacts/` is ignored and worktree-local.
