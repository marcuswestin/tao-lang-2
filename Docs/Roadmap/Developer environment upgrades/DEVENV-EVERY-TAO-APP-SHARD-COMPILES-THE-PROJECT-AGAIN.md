# DEVENV-EVERY-TAO-APP-SHARD-COMPILES-THE-PROJECT-AGAIN — Every Tao app shard compiles the project again

- **Status:** Candidate
- **Section:** External
- **Area:** Test scheduling
- **Impact:** The Tao app behaviour suite is sharded across several `tao test` invocations, and each
  invocation builds its own `TestRunRoot` and runs its own validation workers before it executes a
  single test. Sharding a suite is supposed to divide its work; here it multiplies the fixed part of
  it, so adding shards buys less than the shard count suggests and past some point costs more than it
  saves.
- **Evidence:** `packages/tao-cli/cli-src/test-command.ts:269-280` creates the run root and compiles
  the test plans per invocation. Measured on this branch: `./tao test "Apps/WordFlower/1 - Current"`
  completes in **3.58s wall warm** for 29 tests (Jest 2.76s; roughly 9.2s cold), against a ledger
  that recorded the same work at 66.2s — a figure produced by one observation per invocation across
  cold, contended shards rather than by the tests themselves.
- **Workaround:** None. Reducing the shard count trades one fixed cost for less parallelism.
- **Proposed change:** Compile once per lane and hand the built run root to every shard, so a shard
  carries only its own tests. `SuiteTuning.fixedMs` already exists to express the per-process fixed
  cost that caps shard count; this entry is about removing that cost rather than declaring it.
- **Dependencies:** Re-measure after the timing-measurement fix on this branch, which replaces
  wall-clock spans under `--concurrent` with CPU time; the shard numbers this entry would be tuned
  against were themselves produced by the corrupted measurement.
- **Acceptance:** Wall time for the Tao app suite falls when shards are added, up to the point where
  test work rather than compile work bounds it.
- **Source:** 2026-09-21 landing-lock performance branch, found while rewriting DEVENV-046's premise.
