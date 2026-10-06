# DEVENV-PROJECT-TOOLING-RECEIPT-TESTS-BRUSH-THE-CI-TEST-BUDGET — Project-tooling receipt tests brush CI's 45-second test budget

- **Status:** Candidate
- **Section:** External
- **Area:** `packages/language/project-tooling` receipt suites, `TEST_BUDGET_MS` in `packages/testing/verification/verification-src/TestRunner.ts`, hosted Verify.
- **Impact:** Verify on `main` goes red on a change that touched neither suite, and the next pull request inherits a red baseline to explain.
- **Evidence:** On 2026-10-05 two of three Verify pushes to `main` failed on a single test past the 45-second budget, each failing again on its isolated retry: run 37342863911 at `b4c88165` in `ProjectNativeRefreshReceipt.test.ts` (`rechecks pure Tao native signatures when a verified wrapper publication change…`), and run 37351405259 at `792b4ff7` in `ProjectRefreshReceipt.test.ts` (`invalidates saved publication inputs and preserves authoritative cold parity`). The passing tests beside it in that file ran 16–43 seconds each, and the suite took 488s against 482s on the green run 37348974464 between them, so the suite did not slow down; its tests already sit at the edge of the budget on a hosted runner.
- **Workaround:** Rerun the failed Verify run; the partition usually passes.
- **Proposed change:** Split or shrink the slowest receipt scenarios so each test finishes well inside the budget on a hosted runner, or give these suites a declared per-test budget that matches their measured cost rather than the shared default.
- **Dependencies:** None.
- **Acceptance:** Ten consecutive Verify pushes to `main` pass both receipt suites without an isolated retry.
- **Source:** CI Tao install cache, `feat/ci-tao-install-cache`, 2026-10-05.
