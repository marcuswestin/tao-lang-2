# Verification seeds

The two files here are what hosted `Verify` plans with before it has run anything. Each partition
job copies them into `.artifacts/timings/` and `.artifacts/test-ledger/` before it plans, and a fresh
checkout reads `durations.json` under its own local store (`RunTimings.load`), so neither a runner
nor a new worktree starts cold.

- `durations.json` — per-node durations in the `TimingsStore` shape of
  `packages/testing/verification/verification-src/RunTimings.ts`: recipe gates, test suites, their
  `suite#k` shards and `suite/part` file partitions, and the `:prepare`/`:finalize` nodes. The planner
  weighs a file partition or a gate by its own entry; it never trusts a shard's own entry, because
  shard membership moves between runs, and instead apportions the suite's total by the ledger's
  per-file cost (`TestNodes.estimateNodeMs`). The suite totals are therefore the entries that decide
  how a sharded suite is split and placed.
- `ledger.json` — per-test history in the `TestLedgerStore` shape: file, cost, flake evidence.

## The rolling refit

The partition plan is only as balanced as its estimates, and the estimates are only right for the
machines that produced them: a seed measured on a developer machine planned twelve CI partitions at
209–210 s each that then ran 133–385 s of wall time. So the seed is refit from CI itself, in a loop
that costs one command:

1. Every partition job uploads its `summary.json` as the `verify-partition-<k>` artifact, with every
   node's wall time on the runner.
2. `./dev ci-timings --import-durations` (`just ci-timings --import-durations`) downloads those
   artifacts from the newest green `Verify` push to `main`, or from `--run <id>`, and folds each
   node's time into `durations.json`: a new node or a single-sample prior takes the measurement, an
   averaged node moves by the wall-time EMA weight, a sharded suite's total becomes the sum of its
   shards, and nodes CI did not run (the host-only complement) keep their entries. It prints the
   measured spread of node time per partition, and warns when the summaries disagree on their plan or
   a partition did not report. It takes the partition count from the summaries, so a change to the
   workflow's `PARTITIONS` needs no change here.
3. Commit the refit `durations.json` with the change it rides on, or on its own; the next `Verify` run
   plans with it, and `./dev ci-timings --run <after> --compare <before>` shows what the partitions
   then measured.

Artifact downloads need GitHub authentication even for a public repository: the command reads
`GH_TOKEN` or `GITHUB_TOKEN`, else the `gh` login, so it runs from a developer shell or wherever
`gh auth token` works; the comparison table (`ci-timings` without `--import-durations`) still needs
neither. Run the refit after a change that moves test cost between suites, when a run's partition
wall times spread beyond about 1.3×, and in any case every few weeks; stale entries for removed
nodes are harmless to the plan and can be deleted by hand.

## Seed provenance

The node durations retain the CI refit from [Verify run 37409494450](https://github.com/tao-dev-org/tao-lang/actions/runs/37409494450),
whose measured nodes are dated October 6, 2026, at 03:42:30 UTC. Host-only entries retain their
previous estimates. Numbered shard histories remain in the snapshot for the refit; the planner
uses current membership and relative file costs when a suite estimate is available.

The ledger retains its existing relative costs and supplements 90 previously unrepresented,
currently present files from the October 5 reconstruction of
[PR15 Verify 37356653198](https://github.com/marcuswestin/tao-lang-2/actions/runs/37356653198)
and [main Verify 37358101885](https://github.com/marcuswestin/tao-lang-2/actions/runs/37358101885).
These supplemental records are derived weights, not individually measured test times: successful
first-pass process elapsed time minus declared startup was distributed across the process's files
in proportion to prior weights, using the mean known weight for unseen files. Equal splits within
formerly grouped native files have low confidence. Records for removed files were not restored.
The older reconstruction's suite totals and inferred CLI retry duration do not replace the newer
CI node measurements.

These snapshots describe scheduling costs, not verification receipts or proof of acceleration.
Compare equivalent cache and coverage runs before drawing performance conclusions, and keep
queue delays, setup, first-pass execution and retries separate.
