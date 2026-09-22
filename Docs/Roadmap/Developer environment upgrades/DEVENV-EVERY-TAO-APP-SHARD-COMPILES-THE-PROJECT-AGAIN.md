# DEVENV-EVERY-TAO-APP-SHARD-COMPILES-THE-PROJECT-AGAIN — Every Tao app shard compiles the project again

- **Status:** In progress on `feat/verification-throughput`; quiet full-lane timing remains to be measured.
- **Section:** External
- **Area:** Test scheduling
- **Impact:** The Tao app behaviour suite is sharded across several `tao test` invocations, and each
  invocation builds its own `TestRunRoot` and runs its own validation workers before it executes a
  single test. Sharding a suite is supposed to divide its work; here it multiplies the fixed part of
  it, so adding shards buys less than the shard count suggests and past some point costs more than it
  saves.
- **Evidence:** `packages/cli/tao-cli/cli-src/test-command.ts` created the run root and compiled
  the test plans per invocation. Measured on this branch: `./tao test "Apps/WordFlower/1 - Current"`
  completes in **3.58s wall warm** for 29 tests (Jest 2.76s; roughly 9.2s cold), against a ledger
  that recorded the same work at 66.2s — a figure produced by one observation per invocation across
  cold, contended shards rather than by the tests themselves. On `feat/verification-throughput`,
  `test-command-cli.test.ts` proves one prepared corpus runs across two roots without recompilation;
  `tao-app-shared-run.test.ts` proves the graph publishes it only after both shards pass. These focused
  checks do not yet establish the wall-time acceptance below on an idle machine. The 2026-09-22 full
  lane could not exercise real app execution: both shared preparation and an ordinary single-app
  `./tao test Apps/HNReader` failed when the host returned `EPERM` renaming a generated directory
  into `_gen_tao-app-test/tao-test-command/.compiled`; the same operation failed in a reviewed
  unsandboxed invocation. The lane's typecheck and verification-package tests passed, but the lane
  was not green.
- **Workaround:** None. Reducing the shard count trades one fixed cost for less parallelism.
- **Proposed change:** Compile once per lane and hand the built run root to every shard, so a shard
  carries only its own tests. `SuiteTuning.fixedMs` already exists to express the per-process fixed
  cost that caps shard count; this entry is about removing that cost rather than declaring it.
- **Dependencies:** Re-measure after the timing-measurement fix and shared compile on
  `feat/verification-throughput`; cold, contended shards produced the older timing estimates.
- **Acceptance:** Wall time for the Tao app suite falls when shards are added, up to the point where
  test work rather than compile work bounds it.
- **Source:** 2026-09-21 landing-lock performance branch, found while rewriting DEVENV-046's premise.
