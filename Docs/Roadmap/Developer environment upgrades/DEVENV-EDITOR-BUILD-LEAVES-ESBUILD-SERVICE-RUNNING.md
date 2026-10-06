# DEVENV-EDITOR-BUILD-LEAVES-ESBUILD-SERVICE-RUNNING — Editor build leaves an esbuild service running

- **Status:** In progress
- **Section:** External
- **Area:** Build process ownership
- **Impact:** Strict owned-child supervision fails a successful cold editor build because a child service is still running when its command exits.
- **Evidence:** Hosted Verify run `37510440337` on `ac83d7fa9` failed `_ide-extension-build` in partitions 5 and 10 with `Owned child processes outlived the command`; the supervisor stopped one child in each. The builder disposes its context but does not stop esbuild's shared service. The installed esbuild implementation unrefs that service and its pipes. A local cold build with explicit stop and exact-identity joining passes its node in `.artifacts/logs/check/2026-10-06T18-26-02-479Z-36110-070c3e7b/summary.json`; the enclosing source-check run is not green evidence because fixture files changed during it. Hosted proof of the fix remains pending.
- **Workaround:** None; preserve the cleanup failure rather than accepting a leaked child as successful verification.
- **Proposed change:** The standalone one-shot builder snapshots its owned descendants, stops esbuild, and joins their exact identities before exiting. Watch mode and callers of the exported build function retain their existing service lifetime. If cleanup fails after a build failure, report it while retaining the original build error.
- **Dependencies:** `feat/test-process-termination` supplies strict owned-child supervision.
- **Acceptance:** Cold editor builds pass hosted verification and leave no owned child; failed builds retain their original error and useful cleanup diagnostics; watch mode remains live.
- **Source:** 2026-10-06 hosted verification of test process termination.
