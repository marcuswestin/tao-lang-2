# Caching and Test Selection

`./agent help` prints each scope's composition and flags; this covers the reasoning it does not.

## Why a green tree can be trusted

Every lane records the tree it proved green, keyed by the whole checkout plus the resolved
`.devenv/profile` toolchain. A byte-identical re-run skips each recorded gate and prints the earlier
evidence; `--no-cache` runs them anyway. A red, interrupted, or tree-changed-mid-run lane records
nothing. Four kinds of node are never skipped on a record, because the tree hash cannot see them: a
generator (its output is Git-ignored), a host-dependent verdict (Studio smokes, native shell, canary,
bundle proof), a test the ledger has seen flip without the file changing, and a reader of a generated
tree in a lane that does not run that tree's generator; a fixer is recordable anyway, because it
additionally checks the prepare phase left the tree byte-identical. The backstop for what a tree
can't describe is a scheduled `./agent unsandboxed verify-full --no-cache` on `main`, never a record time-to-live.
Nothing verifies the same bytes twice: a `verify-full` after `verify --complete` at the same tree
runs only the host-dependent gates, and the merge command compares against the tree `verify-full`
already proved rather than running a second lane.

Per-gate records are shared machine-wide under `~/.cache/tao/green/<toolchain>-<tree>/`, so a gate
another worktree proved at byte-identical content and toolchain is skipped here too, and its evidence
line names that worktree's log. `TAO_GREEN_STORE` points the store elsewhere — the directory CI jobs
restore from and save to their cache, so shards and re-runs share proofs. Whole-lane records stay per
checkout, because their generated evidence describes one checkout's ignored state.

## Test selection

The changed scope selects whole suites from the workspace import graph — a package change selects
that package and its importers, a test file its own suite, an app change its Tao behavior tests, and
an unowned path widens to everything and says so. A test-name pattern narrows a scope rather than
replacing it: `test-all "<name>"` filters every suite and passes the Tao behavior suite on no match,
since a filtered run is never full-run evidence. Bare `test`, `test-changed`, `verify-changed`, and
`test-retry` are iteration aids only — repository gates never consult the ledger, and the runner
itself detects when changed or retry work deserves a complete pass.

## Flake tolerance

A test node whose every failure is one the ledger has already recorded reversing twice at an
unchanged file identity is reported `passed` with its non-zero exit code kept; the summary names each
demoted test, and the verdict ends `— tolerating N known flakes`. Read those names before calling
such a lane green. Tolerance withdraws automatically on a third straight failure or a file change, and
a timeout, crash, or no-per-test-result node is never tolerated.
