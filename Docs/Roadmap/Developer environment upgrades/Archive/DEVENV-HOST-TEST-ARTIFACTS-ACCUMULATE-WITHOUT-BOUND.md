# DEVENV-HOST-TEST-ARTIFACTS-ACCUMULATE-WITHOUT-BOUND — Host-test artifacts accumulate without bound

- **Status:** Resolved
- **Update:** This review branch adds per-run receipts and same-checkout pruning during ordinary
  host-test invocations. Successful proof runs shed generated build and export trees at completion while retaining
  named logs; explicit `prepare` and `export` outputs remain inspectable within count, age, and byte
  bounds. Recent failures have separate count, age, and byte bounds. Focused lifecycle controls and
  a real Clockwork `prepare` output passed, but a real native/browser proof has not yet proved
  completed-build cleanup end to end. Older unmarked roots remain for owner-reviewed
  migration because they have no reliable liveness receipt.
- **Update, 2026-09-24:** Independent review found a kill window between run-directory
  creation and receipt publication. This continuation publishes the independent
  receipt first and uses it when a local receipt is missing. A mutation-tested
  interrupted-allocation control passed through `./agent unsandboxed test-host check`.
  A real browser/native success cleanup remains unproved; 31.3 GiB of receipt-less
  output in another worktree was left for owner review.
- **Section:** External
- **Update, 2026-09-26:** The native-navigation iPhone failure occupied 40.6 GB apparent size,
  exceeding the 4 GiB failed-run budget; pruning removed its diagnostic screenshot together with
  the build. Eligible failed roots now shed generated native/export/driver trees before applying
  the existing budget, retaining compact screenshots, logs and proof receipts. Live, recent,
  unmarked and symlink protections remain. A second real failure retained its screenshot.
  Persisted retention timestamps now use a dedicated calendar-clock adapter. A production-default
  clock test compares the receipt against filesystem epoch time; substituting the monotonic app
  clock fails it. Temporary 1970-dated receipts created during this repair were not rewritten and
  may already have been pruned by normal startup maintenance.
- **Acceptance evidence, 2026-09-26:** On `feat/native-navigation-implementation`, the successful
  iPhone native journey `8c7a2f77-2418-482e-8f2c-507557ea2754` retained its proof receipt and PNG
  screenshot while leaving no generated `host-*` build tree. Together with the lifecycle controls
  and retained screenshot from the preceding real failure, this closes the outstanding native
  cleanup acceptance from `d296b239`. Historical receipt-less output remains with its owners.
- **Area:** Host testing and temporary artifacts
- **Impact:** Each `./agent test-host` invocation creates a fresh `.artifacts/host-testing/<run-id>` tree. Browser exports and native builds can occupy hundreds of megabytes per run. The command has no retention or cleanup path, so repeated normal runs fill an otherwise live worktree until someone removes it by hand.
- **Evidence:** On 2026-09-23, `/Users/ro/.codex/worktrees/40f2/tao-lang-2/.artifacts/host-testing` held 234 run directories occupying about 31 GB; individual directories occupied up to 2.1 GB. Their top-level modification times ranged from 2026-09-19 to 2026-09-20. `packages/testing/e2e-testing/HostTestingCommand.ts` creates a UUID root and dispatches the request without a completion cleanup or later-run prune; `HostBuild.ts` places generated app builds and web exports under that root. No files were deleted during this inspection.
- **Workaround:** An owner can inspect and manually remove finished run directories after preserving any needed failure evidence. Do not sweep another active worktree's artifacts.
- **Proposed change:** Make `runHostTesting` own the artifact lifecycle. Record an atomic run receipt with owner process identity, mode, start time, and final status. On successful completion, retain compact receipts and named proof outputs but remove bulky generated builds/exports. On failure, retain a small bounded set of recent full runs for diagnosis. At startup and completion, prune only this checkout's UUID-shaped finished runs beyond an explicit age and byte/count budget; reclaim a crashed run only after its owner is demonstrably gone and a grace period has passed. Keep active and manually named directories untouched, and run the same bounded prune during ordinary `test-host` use rather than relying on a one-time purge.
- **Dependencies:** None. `DEVENV-JEST-CACHE-IDENTITIES-AND-DIRECT-RUNS-GROW-WITHOUT-BOUND` covers a separate host-temporary Jest cache.
- **Acceptance:** Focused host-testing lifecycle tests show repeated successful runs remain bounded, failure evidence remains available within the declared budget, concurrent live runs are never pruned, and a dead interrupted run is reclaimed on a later normal invocation. A real host run confirms large generated builds disappear after success while its receipt remains.
- **Source:** 2026-09-23 recurring repository pass temporary-state inspection.
- **Archived:** 2026-09-26
