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
- It reads the public API, whose anonymous limit is 60 requests an hour per address and
  `pr-checks --wait` spends quickly; set `GH_TOKEN` when it reports the limit spent.
