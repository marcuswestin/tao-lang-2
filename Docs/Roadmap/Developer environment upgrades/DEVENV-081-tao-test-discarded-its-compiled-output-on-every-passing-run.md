# DEVENV-081 — `tao test` discarded its compiled output on every passing run

- **Status:** Resolved
- **Area:** Test execution
- **Impact:** A passing `tao test` deleted the run root it had just compiled, so the next run
  recompiled a corpus that is usually byte-identical. Compilation is the majority of the suite.
- **Evidence:** `./tao test Apps` on a quiet machine (load 2.1) measured 43.15s: validate 8,934ms,
  compile 16,293ms, Jest 15,183ms. `runTestCommand` called `TestRunRoot.discard` precisely because
  the run passed, keeping the root only when it failed.
- **Workaround:** None.
- **Change made:** A passing run now publishes its root under a fingerprint of everything that can
  change compiled output — scheme version, runtime root, sorted test-path set, devenv profile, every
  file under `packages/`, the generated parser tree, and every file under the tested roots and their
  project roots. The fingerprint fails closed: a packaged CLI outside its own source tree, a stdlib
  outside `packages/`, or any throwing read yields no fingerprint and therefore no reuse.
  `TAO_TEST_NO_CACHE=true` forces the old path, and a `--no-cache` lane sets it for every child.
- **Measured:** ~29s cold to ~6.7s warm, 4.3x. Touching one `.tao` under WordFlower correctly forces
  a recompile; restoring it hits the original fingerprint.
- **Dependencies:** None.
- **Acceptance:** Cache hit skips compilation, a source change misses, a failing run publishes
  nothing, and the opt-out compiles — all asserted in `test-cache.test.ts` and `test-run-root.test.ts`.
- **Not done:** The toolchain component hashes every file under `packages/`, so any unrelated edit in
  a shared checkout invalidates it. Safe but coarse; narrowing it is a separate decision.
- **Source:** 2026-09-19 verification-performance work.
