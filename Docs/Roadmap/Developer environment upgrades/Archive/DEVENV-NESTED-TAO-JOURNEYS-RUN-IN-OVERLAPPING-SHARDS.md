# DEVENV-NESTED-TAO-JOURNEYS-RUN-IN-OVERLAPPING-SHARDS — Nested Tao journeys run in overlapping shards

- **Status:** Resolved
- **Area:** Tao app test sharding and shared prepared runs
- **Impact:** A useful authored journey executes twice when its folder and a parent folder become separate shard units, adding work and inflating execution totals.
- **Evidence:** Final sandbox verification `2026-10-03T20-13-34-785Z-45391-7714d24a` passes, but `tao-apps_19.log` executes both Read Net cases and the nested Runtime Default case; `tao-apps_24.log` executes Runtime Default again. That older tree had 142 distinct ordinary journeys and 143 executions. `TestRunner.ts` created a unit for every journey directory; `test-command.ts` `shardTestPaths` recursively selected every prepared path beneath each root, deduplicating only within a shard. On `feat/unique-journey-shards`, the 2026-10-06 focused regression passes: a real rendered parent/nested/sibling fixture produces each expected passing journey exactly once at one, two and three outer shard counts. Parent/child overlap, child-only selection and name filtering preserve their scoped raw results. The current full app corpus passes all 164 journeys in 45 files. This proves coverage and eliminated work, not a measured wall-time improvement.
- **Workaround:** None required; the nested authored journey is retained.
- **Proposed change:** Recursive execution roots now exclude descendants already owned by a selected parent, including explicit overlapping selections. Detailed nested source-size units remain in the estimation inventory, and shard packing combines their subtree costs. Shared compilation, failure policy, resource cleanup and per-file evidence behavior are unchanged.
- **Dependencies:** None.
- **Acceptance:** `tao-app-shard-ownership.test.ts` pins disjoint execution ownership, combined subtree packing costs, child-only estimates, changed/file selection scope and name-filter arguments. Its real CLI/shared-run fixture compares raw passing records without deduplication across one, two and three shards and scoped selections. Existing runner/shard tests and all current ordinary app journeys pass.
- **Source:** Serial test reduction final registration reconciliation on `feat/test-responsibility`, 2026-10-03.
- **Archived:** 2026-10-06
