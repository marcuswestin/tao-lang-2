# DEVENV-046 — WordFlower remains the tail of the sharded Tao app tests

- **Status:** Candidate
- **Area:** Test performance
- **Impact:** App-root sharding and compiled-run caching already exist. WordFlower's indivisible
  workspace still leaves a long tail after sibling shards finish; increasing its reservation alone
  cannot give its current compiler or Jest run more work to distribute.
- **Evidence:** The 2026-09-20 baseline verify run
  `.artifacts/logs/verify/2026-09-20T16-35-46-656Z-96541-45b684e1` scheduled ten Tao-app shards.
  WordFlower started after 15.463s of dependencies and ran for 56.922s (53.702s expected), including
  12.29s in Jest. Makespan was 72.389s, dependency/resource serial floor 72.369s, reservation idle
  capacity 415.1 slot-seconds, and peak load 20.8 on 18 CPUs with one registered lane.
  Uncached host probes with budgets 2, 4, and 8 took 24.93s, 29.17s, and 26.52s respectively; each
  passed the same five files and 29 journeys with one compiler worker and one Jest entrypoint.
  These are single observations with warm filesystem caches, and brief dashboard test runs overlapped
  early probes, so they are not a controlled scaling benchmark. They provide no evidence for a
  larger reservation. Raw logs and metric definitions live under `.artifacts/verification-scheduling/`.
- **Workaround:** Use changed-scope tests for iteration and reuse compiled runs when fresh compilation
  is not the purpose. Complete uncached verification remains required for scheduling comparisons.
- **Proposed change:** First time validation, test-plan compilation, app generation, and Jest separately
  inside `tao test`; the aggregate pre-Jest duration cannot identify the expensive stage. Then measure
  a targeted improvement while preserving the shared workspace and per-run app deduplication.
  Keep two slots per app shard until a measured change can use more. Do not split one app root across
  independent compiler processes or add elastic reservations without proving safety and benefit.
- **Dependencies:** `TestNodes` keeps app roots indivisible. `test-command.ts` groups files by directory,
  and `TestHarnessFiles` gives 29 journeys one entrypoint at its 16-journey-per-shard floor.
- **Acceptance:** The original target remains open: the complete test phase under 20s on an otherwise
  idle machine with unchanged inventory. Reduced dependency waits or clearer reporting alone do not
  meet it; the WordFlower tail has not been improved by this change.
- **Source:** 2026-09-04 development-speed review; refreshed from 2026-09-20 scheduling measurements.
