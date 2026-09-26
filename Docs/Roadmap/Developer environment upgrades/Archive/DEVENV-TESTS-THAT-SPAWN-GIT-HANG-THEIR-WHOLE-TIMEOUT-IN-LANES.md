# DEVENV-TESTS-THAT-SPAWN-GIT-HANG-THEIR-WHOLE-TIMEOUT-IN-LANES — Tests that spawn `git` hang for their whole timeout in half of the lanes that run them

- **Status:** Resolved
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
- **Workaround:** None needed for the repaired paths; both live-host checks are enabled again.
- **Proposed change:** Await pending assertion inputs before native matchers, and join subprocess exit with closed output pipes rather than relying solely on the missing aggregate close notification.
- **Dependencies:** Overlaps DEVENV-098 for the fingerprint pair; the `merge-with-main` pair has no
  output capture, so it is the cleaner case to start from.
- **Acceptance:** Ten consecutive `verify-changed` runs that select `testing/verification` and
  `cli/dev-cli` pass without a 120-second timeout.
- **Source:** 2026-09-24 `feat/standalone-version-pin`, while gating the standalone CLI's version pin.

- **Investigation (2026-09-26):** On `feat/git-test-timeout`, the pinned Bun 1.4.2 synchronously re-enters its event loop in pending `.resolves`/`.rejects` assertions. The [upstream diagnosis](https://github.com/oven-sh/bun/issues/33261) describes dropped subprocess pipe/exit notifications. A repository regression reproduces the failure with 34 concurrent `git --version` children and a pending assertion in the first child's completion: batch zero fails its named 30-second close wait. Awaiting the input in the shared `Expect` wrapper before invoking the native matcher makes all 20 batches (680 children) finish in 720ms. The scheduling assertion also fails before the fix and passes afterward. No Git timeout or runtime version was increased. Disabling the repair reproduced the Git stall again. Deep review corrected native handling of custom thenables. Across ten uncached broad `verify-changed` runs, `testing/verification` passed every initial run (18.5–26.8s) without retry. Eight whole lanes passed. Repetition five still timed out the two fingerprint probes and the Studio artifact shell; both passed their isolated retries. Repetitions five and ten failed Node compiler-worker teardown. The original ten-green-lane acceptance is not met, so this combined entry remains open. The fingerprint probe needs per-command lifecycle evidence before calling it the same Git defect. See [Studio completion](DEVENV-STUDIO-ARTIFACT-SHELL-LOSES-COMPLETION.md) and [Node teardown](DEVENV-NODE-WORKER-TEARDOWN-LOADS-BUN-FFI.md).

- **Completion repair (2026-09-26, feat/repair-verification-flakes):** Retaining JavaScript children alone did not fix the remaining fingerprint stall. In the retained-child trace, `uname -srm` (PID 16853, parent 15721) had exit code 0 and both output streams were ended, closed, destroyed and empty, but the aggregate child `close` event never arrived. The shared completion observer now joins exit with both closed output pipes; native close still handles spawn errors and auxiliary descriptors/IPC. Disposing removes its listeners and ownership root. No timeout increased. The live fingerprint tests are restored. A controlled regression omits aggregate close, forces collection between exit and trailing output, and proves output preservation and release; removing the join fails. Native-child fault injection independently verifies the same behavior through CLI and Studio. The runtime trigger for the missing aggregate event is not established; the completed-process state and recovery are demonstrated. Evidence: `.artifacts/investigation/retained-pending-cli.jsonl`, `.artifacts/investigation/missing-close-mutation.log`.

- **Acceptance evidence (2026-09-26):** Ten consecutive uncached `./agent verify-changed --no-cache` runs passed on the repair branch, selecting both verification and developer CLI suites. No original 120-second subprocess timeout recurred; the repaired suites passed their initial attempts. Run one separately recorded a 30-second runtime-journey timeout that passed its isolated retry; that observation has its own open entry. Repetitions are recorded in `.artifacts/investigation/repair-acceptance.json`.
- **Archived:** 2026-09-26
