# DEVENV-TESTS-THAT-SPAWN-GIT-HANG-THEIR-WHOLE-TIMEOUT-IN-LANES — Tests that spawn `git` hang for their whole timeout in half of the lanes that run them

- **Status:** Candidate
- **Section:** External
- **Area:** Test execution
- **Impact:** `verify-changed` failed in 5 of 10 runs on one branch, on tests its diff never touched,
  and each failed run took about 135 seconds instead of 35, all of it one test's 120-second bound.
  A rerun on the same tree passes, so every commit gate costs two runs by the odds, and a landing's
  `verify-full` meets the same tests.
- **Evidence:** On 2026-09-24, gating `feat/standalone-version-pin`, the failures were always a
  subset of four tests: `merge-with-main > recovers an accepted atomic push whose process result was
  lost`, `merge-with-main > lands safely in disposable real Git worktrees`, and the two
  `environment-fingerprint` host-probe tests. Each hit exactly 120,000ms. Host load average was 5 to
  14 on 18 CPUs, well below the load 22 DEVENV-098 recorded for the fingerprint pair, and no landing
  was running. Straight after a failing lane, `./agent test-file
  packages/testing/verification/verification-tests` ran all 733 tests in 7.6s, and
  `merge-with-main.test.ts` alone ran 57 tests in 1.1s. The two `merge-with-main` tests call real
  `git` (`init --bare`, `clone`, `worktree add`, `push --atomic`) through `CLI.run` in disposable
  repositories, with `just` faked and no output capture, so DEVENV-098's capture queue does not
  explain them; the fingerprint probes also spawn `git`. No global Git configuration sets
  `core.fsmonitor`, `core.hooksPath`, or commit signing.
- **Workaround:** Rerun the lane; a passing run on the same tree is the gate.
- **Proposed change:** Find what the spawned `git` waits on when other suites run beside it — a
  lock, an inherited environment variable, an open stdin, or the child's exit never reaching Bun —
  and fix that rather than raising the bound. Recording which command was still running when a test
  times out would name it on the next occurrence.
- **Dependencies:** Overlaps DEVENV-098 for the fingerprint pair; the `merge-with-main` pair has no
  output capture, so it is the cleaner case to start from.
- **Acceptance:** Ten consecutive `verify-changed` runs that select `testing/verification` and
  `cli/dev-cli` pass without a 120-second timeout.
- **Source:** 2026-09-24 `feat/standalone-version-pin`, while gating the standalone CLI's version pin.
