# DEVENV-TEST-RUNS-CANNOT-BE-CPU-PROFILED — Test runs cannot be CPU-profiled

- **Status:** Candidate
- **Section:** External
- **Area:** Verification diagnostics, performance measurement
- **Impact:** A profiling instruction of the form "run `bun --cpu-prof-md` on this test file" cannot be followed; the per-process taxes a test file pays (bindings hashing, repository discovery, engine load) have to be reconstructed in a scratch driver before they can be seen in a profile.
- **Evidence:** On 2026-10-05, `feat/verification-speed-memo` ran `bun --cpu-prof --cpu-prof-md --cpu-prof-dir=<dir> test <file>` under Bun 1.4.2 and no profile was written; the same flags on `bun run <script>` wrote `<name>.cpuprofile` and `<name>.md`. The test runner is a separate entry point that does not honour the profiler flags. A scratch driver that imported `Workspace.validate` and `ProjectTooling.refresh` by absolute path and ran them against fresh host temp projects profiled as expected; the validator driver showed 57% of total time under `FS.walkDirectory` from the maintained-bindings inventory walk, which the memo in that branch removed. Counts were taken with a temporary file-backed counter because `process.on('exit')` output from a test process never reached the terminal.
- **Workaround:** Profile a scratch script that reproduces the test's fixture and calls the same entry point, under `bun run`; count work (hash passes, spawns) with a temporary counter that appends to a file keyed by process id rather than printing at exit.
- **Proposed change:** Give the repository a documented way to profile one test file: either a `./agent profile-test <file>` operation that runs the suite's test entry under a profiler Bun honours, or a recipe in `verification-lanes` that names the scratch-driver route and where the drivers for the common entry points live.
- **Dependencies:** Whether a future Bun honours `--cpu-prof` for `bun test`; if it does, the operation is a thin wrapper.
- **Acceptance:** One command produces a CPU profile of a named test file, or the skill names the scratch-driver route with a checked-in driver for the validator and project-tooling entry points.
- **Source:** Verification speed plan, slice C (memoise per-process taxes), 2026-10-05, `feat/verification-speed-memo`.
