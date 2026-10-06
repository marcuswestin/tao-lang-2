# Measuring a CI-speed change

A change meant to make the hosted `Verify` workflow faster carries its own before and after.

- After the change's run, `./agent ci-timings` prints a Markdown table of every step's median and
  slowest time across the partitions, beside each job's wall time and the run's. By default it
  compares this branch's newest `Verify` run with `main`'s newest green push; `--run <after>` and
  `--compare <before>` name the runs instead, so a stack of improvements compares each against the
  run before it.
- Separate cache-hit runs from cache misses. If a controlled warm-cache comparison is needed,
  measure a rerun of the same commit after its first run saved the cache; do not hold an otherwise
  verified landing for a benchmark or claim a speedup from unlike workloads.
- Pushing to a pull request cancels its running `Verify`, so wait for the cache-saving steps to
  finish before pushing the next improvement.
- Put the table in the pull request description or the merge message.
- After a landing that moved test cost, or when partition wall times spread beyond about 1.3×,
  refit the seed from CI with `ci-timings --import-durations` (newest green push to `main`, or
  `--run <id>`) and commit `.github/verify/durations.json`; `.github/verify/README.md` owns the
  seeds and that rolling loop. The artifact download needs `GH_TOKEN` or a `gh` login.
- At 20 partitions the floor is the longest unsplittable node plus about 70 s of partition fixed
  cost. Keep each node near 90 s on CI, where tests run 2.5–4× slower than locally. Split a
  heavy file into its own `filePartitions` entry, or split the file itself. Measured on
  2026-10-06, splitting the project-tooling native, receipt and watch files took the slowest
  partition from 393 s (run 37420364467) to 288 s (run 37423624990), with a median of 231 s.
  Nodes still near 100 s are single tests, packer shards that a refit rebalances, and `cli/dev-cli`,
  which is declared unshardable.
- It reads the public API, whose anonymous limit is 60 requests an hour per address and
  `pr-checks --wait` spends quickly; set `GH_TOKEN` when it reports the limit spent.
