# DEVENV-069 — An in-flight edit to a shared package fails other agents' test runs and names the wrong file

- **Status:** Candidate
- **Section:** External
- **Area:** Concurrent worktrees
- **Impact:** While several workstreams share one checkout, a momentarily half-applied edit in a shared
  package fails whatever suite another agent is running, reporting a bare `ReferenceError` from the
  broken module with nothing to say the module is not the one under test. Two agents each spent time
  debugging their own unrelated code.
- **Evidence:** Half-applied edits in `packages/shared/shared-src/CLI.ts` and in
  `packages/shared/shared-src/testing/Test.ts` each produced a bare `ReferenceError` naming a symbol in
  that file, attributed to the suite being run. One agent saw
  `ReferenceError: createSuiteState is not defined` pointing at
  `packages/dev/dev-src/repository-tests/TestRunner.ts` while running a `packages/shared` test; the same
  mid-migration state is still visible in this checkout, where `TestRunner.createSuiteState` is called by
  `packages/dev/dev-tests/test-runner.test.ts` and defined nowhere.
- **Workaround:** `bun test --cwd packages/<name> <relative-test-path>` resolves `@shared/test` correctly
  and shows the real stack; otherwise wait for the shared module to load again, for example
  `until bun test <file> 2>&1 | grep -q 'expect() calls'; do sleep 5; done`.
- **Proposed change:** Have the test runner say when a failure came from a module outside the requested
  suite — that a shared module failed to load and a worktree-mate may be mid-edit — and record the
  `--cwd` idiom where agents will find it. Expect this routinely now that parallel workstreams share a
  checkout.
- **Dependencies:** DEVENV-061 owns the root-cwd `bun test` caveat that constrains the fallback.
- **Acceptance:** A deliberately broken shared module produces a failure that names the module that
  failed to load and distinguishes it from the suite under test.
- **Source:** 2026-09-17 branch-wide agent findings.
