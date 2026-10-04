# DEVENV-NESTED-TAO-JOURNEYS-RUN-IN-OVERLAPPING-SHARDS — Nested Tao journeys run in overlapping shards

- **Status:** Open
- **Section:** Deferred
- **Area:** Tao app test sharding and shared prepared runs
- **Impact:** A useful authored journey executes twice when its folder and a parent folder become separate shard units, adding work and inflating execution totals.
- **Evidence:** Final sandbox verification `2026-10-03T20-13-34-785Z-45391-7714d24a` passes, but `tao-apps_19.log` executes both Read Net cases and the nested Runtime Default case; `tao-apps_24.log` executes Runtime Default again. The unsharded changed run confirms 142 ordinary journeys; the sharded logs report 143 executions. `TestRunner.ts` creates a unit for every journey directory; `test-command.ts` `shardTestPaths` selects every prepared path beneath each requested root. Deduplication applies inside a shard, not across shards. This is source and reporter evidence, not a performance measurement.
- **Workaround:** Treat 143 as executions of 142 distinct ordinary journeys. Retain the nested authored test: its runtime-default contract is useful and deletion would conceal the scheduler overlap.
- **Proposed change:** Give nested test directories disjoint scheduling ownership without widening changed or targeted selections. Keep shared compilation, failure policy, resource cleanup and per-file evidence behavior.
- **Dependencies:** A separately reviewed scheduling repair; the serial reduction pass preserves the completed scheduler changes.
- **Acceptance:** A fixture with parent and child test directories runs each authored journey exactly once across multiple shard counts; selected/changed roots remain scoped; all ordinary journeys still execute and raw results reflect actual unique coverage.
- **Source:** Serial test reduction final registration reconciliation on `feat/test-responsibility`, 2026-10-03.
