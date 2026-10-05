# CI planning seeds

Every Verify partition copies these committed snapshots before planning. Runner-local timing
history must not change membership: all partitions must derive the same coverage and digest.

The snapshots describe process costs for scheduling, not verification receipts or proof of speed.
Suite totals are one-process equivalents. Test nodes derive estimates from their current file
membership and relative file weights; exact numbered shard histories are deliberately not committed.

## October 5, 2026 refresh

Sources:

- [PR15 Verify37356653198](https://github.com/marcuswestin/tao-lang-2/actions/runs/37356653198),
  head `e038312816822669fa7e0d6a330c34276006bc47`.
- [Main Verify37358101885](https://github.com/marcuswestin/tao-lang-2/actions/runs/37358101885),
  head `63e70f0f49460a272dfe26eb8d64e6182d1eccff`.

The relevant inventory, tuning, prior seeds and app source were identical across these heads.
Membership reconstructed from those committed inputs matched all 280 observed test nodes.
Prerequisite recipes that execute on every runner use the median per run, then the mean of the
available run estimates. Complete suite totals sum successful first-pass process elapsed times
and subtract `(processes - 1) × declared startup`; available complete run totals are averaged.
Scopes without a complete first-pass observation retain their previous estimate unless noted below.

Per-file weights are **derived**, not newly measured per-file times. Each successful process's
elapsed time minus startup is distributed among its files in proportion to the prior relative
weights, with the mean-known-weight fallback for unknown files. Concurrent suites do not contribute
attributable per-test costs. The six formerly grouped native files had unknown/equal weights:
their measured cohort cost is useful, but the internal equal split has low confidence.

Combined failed-attempt plus isolated-retry times are excluded. The CLI suite is the one explicit
exception to retaining an incomplete whole-suite estimate: main's first-pass CLI processes plus
the successful isolated build-dependencies retry yield an inferred one-process total of
2,372,226ms. The retry contributes 62,212ms, obtained from the artifact's combined184,612ms minus
the log's rounded122,400ms failed attempt (±50ms rounding); the file's relative work weight is
61,612ms after declared600ms startup. This inference excludes the failed attempt and is not a
first-pass measurement or performance verdict.

Re-measure after a scheduling change. Keep queue delays, setup, first-pass execution and retry
overhead separate; compare equivalent cache/coverage runs before claiming an acceleration.

