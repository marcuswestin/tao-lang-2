# DEVENV-113 — Uncached complete verification has no repeated stable tail

- **Status:** Candidate
- **Section:** External
- **Area:** Test performance
- **Impact:** One uncached complete lane can spend more than a minute on a single suite, but optimizing
  the first observed tail would trade correctness and maintenance for a bottleneck that may disappear
  under the normal warm workflow.
- **Evidence:** On 2026-09-20, `./agent verify --no-cache` ran uncontended on
  `feat/devenv-parser-cache-followups` (`peakLanes: 1`, 18 CPUs) and passed 32 nodes in 95.4s. Its
  95.1s serial floor was `_fix-just-fmt -> _fix-dprint -> _parser-gen -> _fix-tao ->
  _compile-word-flower-app -> tao-cli`; `tao-cli` took 72.5s, while `tao-apps` took 42.8s and
  `studio` 36.6s. The immediate warm `./agent verify` passed in 721ms with 30 recorded-green skips;
  its 461ms schedule reran only `_parser-gen`, `_compile-word-flower-app`, and
  `_ide-extension-build`. That repeat skipped the CLI suite, so it did not establish whether its
  executed tail persisted.
  - On 2026-09-26 the Developer reported a recurring first-checkout CLI tail, 10–30 seconds
    behind the next suite. Two quiet directory runs executed the CLI suite in 24.5s and 20.9s
    with eight shards. The indivisible `test-command-cli.test.ts` and `bridge-metadata.test.ts`
    files each approached 20s. Their 43 test bodies are now partitioned across smaller files,
    preserving the assertions and sequential execution within each process.
  - With scheduling history temporarily absent, the split alone took 24.0s at eight shards;
    twelve initial shards took 21.2s, sixteen took 21.3s, and thirty-two took 22.3s. Keep twelve:
    it reduced the measured first-schedule wall time by about 13% from the original 24.5s,
    with less aggregate process time than the wider alternatives. CPU admission remains bounded
    by the existing scheduler. Parser/compiler/runtime caches were retained: these are fresh
    scheduling-history measurements, not entirely cold checkout or full-lane comparisons.
    All runs reported no lane contention on 16 CPUs. Logs are under
    `.artifacts/logs/dev-test/2026-09-26T19-20-41-785Z-45050-54073b66` (before) and
    `.artifacts/logs/dev-test/2026-09-26T20-09-22-748Z-76502-af2e8cfb` (twelve shards).
- **Fresh-checkout complete-lane evidence (2026-09-26):** `feat/native-tooling-followup` started at `59b4ea8067ef` in the session's initial writable checkout, containing landed `d5bdeaef`. After `./agent setup --environment`, and before any test lane, `.artifacts/testing/tao-home`, `.artifacts/timings`, `.artifacts/verify`, and the task-specific Bun transpiler cache were absent. Both runs used `./agent verify --no-cache` with `BUN_RUNTIME_TRANSPILER_CACHE_PATH` set to the absolute checkout-local `.artifacts/native-tooling-followup/bun-transpiler` path. No other checkout was created and no shared cache was cleared. Nix and Bun package-download caches were retained, and setup had already built CLI entrypoints: this is a fresh checkout with cold Tao/Jest runtime caches and scheduling history, not a globally cold machine.
  - First run: 75.6s end to end at the `./agent` wrapper; 74.435s lane elapsed and 74.217s schedule makespan. All selected test nodes executed; only `studio-smoke` was excluded by the ordinary `verify` scope. Initial history was absent: Tao CLI used 12 shards (slowest 24.375s), Tao apps 2 (slowest 34.124s), Studio 1 (53.027s), and runtime Jest 1 (46.670s). The 60.409s serial floor was `_fix-just-fmt -> _fix-dprint -> _parser-gen -> _fix-tao -> _compile-word-flower-app -> ides/studio`; idle capacity was 298.7 slot-seconds of 16. The preflight board reported no other Tao lane and load 6.4, but the completed run recorded `contended: true`, `peakLanes: 1`, `peakLoadAverage: 27.4`, `cpuCount: 16`.
  - Executed repeat: 164.2s end to end; 162.964s lane elapsed and 162.728s schedule makespan. Runtime caches and first-run scheduling history were retained, with history size/hash recorded before the run. `--no-cache` again caused selected tests to execute rather than reuse green verdicts. Scheduling expanded Tao CLI to 56 shards (slowest 19.486s), Tao apps to 21 (slowest 54.969s; 771.605s aggregate work), and Studio to 8 (slowest 8.797s); runtime Jest took 45.089s. The 80.773s serial floor ended in `tao-apps:prepare -> tao-apps#1 -> tao-apps:finalize` after the same fixer/parser chain; idle capacity was 224.9 slot-seconds of 16. Contention was `contended: true`, `peakLanes: 2`, `peakLoadAverage: 66.7`, `cpuCount: 16`.
  - Evidence: `.artifacts/native-tooling-followup/initial-state.json`, `verify-first-before.json`, and `verify-repeat-before.json`; full schedule/contention blocks and executed nodes are preserved in `.artifacts/logs/verify/2026-09-26T23-23-31-077Z-18287-d16b88ca/summary.json` and `.artifacts/logs/verify/2026-09-26T23-25-12-922Z-28616-6ad689c4/summary.json`. The changing tail and contention do not meet the two-uncontended-run acceptance below. No further performance optimization is justified from this pair.
  - These are `verify` measurements, not `verify-full`. The normal-terminal landing's 124.1s `verify-full` on 2026-09-26 included native/browser/bundle gates but was not a cold-checkout benchmark. The earlier CLI improvement from 24.5s to 21.2s remains a warm-runtime-cache, fresh-scheduling-history result.
- **Workaround:** Preserve and reuse the complete lane's recorded green tree for unchanged work.
  - On October 5, 2026, modern Photos/Files validation at `f7a1379a2` in a fresh
    checkout failed `verify-full` after 863 seconds with no other registered lane
    and peak load 29.6 on 18 CPUs. Several cold whole suites hit their existing
    300-second limits. Isolated compiler validation then passed 334 tests in
    143.4 seconds; Expo host and runtime Jest passed 634 tests in 70.9 seconds.
    These are isolated confirmations, not complete verification or a stable-tail
    measurement. Explicit-path runs intentionally do not teach complete-suite
    timing history. The full-verification recipe now forwards the scheduler's
    optional `--jobs` ceiling for controlled admission without changing its
    default, gate membership, assertions, timeout budgets or permission scope.
- **Proposed change:** The requested file partition and initial scheduling adjustment are implemented.
  Keep this observation open until fresh-checkout complete-lane measurements establish how much
  end-to-end tail remains; a cached skip is not a repeat measurement.
- **Dependencies:** DEVENV-046 tracks WordFlower as the Tao-app shard tail; this observation is
  different because the complete-lane serial floor ended in `tao-cli`. DEVENV-086 owns any future
  correctness proof for narrowing the compiled-output fingerprint.
- **Acceptance:** Two uncontended uncached complete runs identify the same stable tail, with the
  schedule and contention blocks recorded, before an optimization is proposed.
- **Source:** 2026-09-20 requested complete-lane cold/warm measurement; 2026-09-26 request to reduce
  the recurring first-checkout CLI tail.
