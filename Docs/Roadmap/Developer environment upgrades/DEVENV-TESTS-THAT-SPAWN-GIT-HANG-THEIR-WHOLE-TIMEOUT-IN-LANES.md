# DEVENV-TESTS-THAT-SPAWN-GIT-HANG-THEIR-WHOLE-TIMEOUT-IN-LANES — Tests that spawn `git` hang for their whole timeout in half of the lanes that run them

- **Status:** In progress
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
- **Workaround:** Temporarily skip the two live-host tests in `environment-fingerprint.test.ts` on `feat/quarantine-verification-flakes`, at the Developer's request. Pure formatting and hostile-input privacy tests remain active. Restore the live-host privacy and doctor attachment checks after diagnosing the probe lifecycle; skips are missing coverage, not evidence of a repair.
- **Proposed change:** Find what the spawned `git` waits on when other suites run beside it — a
  lock, an inherited environment variable, an open stdin, or the child's exit never reaching Bun —
  and fix that rather than raising the bound. Recording which command was still running when a test
  times out would name it on the next occurrence.
- **Dependencies:** Overlaps DEVENV-098 for the fingerprint pair; the `merge-with-main` pair has no
  output capture, so it is the cleaner case to start from.
- **Acceptance:** Ten consecutive `verify-changed` runs that select `testing/verification` and
  `cli/dev-cli` pass without a 120-second timeout.
- **Source:** 2026-09-24 `feat/standalone-version-pin`, while gating the standalone CLI's version pin.

- **Investigation (2026-09-26):** On `feat/git-test-timeout`, the pinned Bun 1.4.2 synchronously re-enters its event loop in pending `.resolves`/`.rejects` assertions. The [upstream diagnosis](https://github.com/oven-sh/bun/issues/33261) describes dropped subprocess pipe/exit notifications. A repository regression reproduces the failure with 34 concurrent `git --version` children and a pending assertion in the first child's completion: batch zero fails its named 30-second close wait. Awaiting the input in the shared `Expect` wrapper before invoking the native matcher makes all 20 batches (680 children) finish in 720ms. The scheduling assertion also fails before the fix and passes afterward. No Git timeout or runtime version was increased. Disabling the repair reproduced the Git stall again. Deep review corrected native handling of custom thenables. Across ten uncached broad `verify-changed` runs, `testing/verification` passed every initial run (18.5–26.8s) without retry. Eight whole lanes passed. Repetition five still timed out the two fingerprint probes and the Studio artifact shell; both passed their isolated retries. Repetitions five and ten failed Node compiler-worker teardown. The original ten-green-lane acceptance is not met, so this combined entry remains open. The fingerprint probe needs per-command lifecycle evidence before calling it the same Git defect. See [Studio completion](DEVENV-STUDIO-ARTIFACT-SHELL-LOSES-COMPLETION.md) and [Node teardown](DEVENV-NODE-WORKER-TEARDOWN-LOADS-BUN-FFI.md).
