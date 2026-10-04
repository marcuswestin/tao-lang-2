# DEVENV-SANDBOXED-GIT-XCRUN-CACHE-WARNING-FAILS-STDERR-ASSERTIONS — Sandboxed git's xcrun cache warning fails stderr assertions

- **Status:** Candidate
- **Section:** External
- **Area:** `contributor-linux-test` and other tests that assert an empty stderr from a child running
  `git`
- **Impact:** A `verify-changed` run can fail a test unrelated to the change under review, which
  costs a rerun and invites dismissing a real failure as flaky.
- **Evidence:** On 2026-09-29, `verify-changed` on a feature branch that does not touch the
  contributor Linux runner failed `contributor Linux container runner > recovers only an exited owned
  run after collecting its complete guest evidence` at
  `packages/cli/dev-cli/dev-cli-tests/contributor-linux-test.test.ts:140`
  (`Expect(result.stderr).toBe('')`). The received stderr was one line from Apple's `git` shim:
  `git: error: couldn't create cache file '/var/folders/…/T/xcrun_db-…' (errno=Operation not permitted)`.
  The lane ran sandboxed with two Tao lanes at once and load at 71.9 on 18 CPUs; the same file
  passed alone minutes later (`./agent test-file …contributor-linux-test.test.ts`, 93.9s).
  Which child's environment pointed `xcrun` at the per-user `/var/folders` temporary directory, and
  why only sometimes, is not established.
- **Workaround:** Rerun the named file alone; treat a pass as confirming this cause only when the
  failed stderr is exactly the `xcrun_db` line.
- **Proposed change:** Find the child that inherits a temporary directory outside the sandbox's
  writable set and give it the lane's own `TMPDIR`, or make the fixture's `git` resolve to the
  toolchain binary rather than the `/usr/bin` shim. Do not filter the warning out of assertions.
- **Dependencies:** None known.
- **Acceptance:** A sandboxed `verify-changed` under concurrent lanes never shows the `xcrun_db`
  warning in a test's captured stderr, with a focused check that fails when a child inherits the
  host temporary directory.
- **Source:** 2026-09-29 staged-release QA branch verification log
  `.artifacts/logs/verify-changed/2026-09-29T16-25-33-184Z-37185-8d28d46b/cli_dev-cli.log`.
