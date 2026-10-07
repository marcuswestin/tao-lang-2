# DEVENV-EDITOR-BUILD-LEAVES-ESBUILD-SERVICE-RUNNING — Editor build leaves an esbuild service running

- **Status:** Resolved
- **Section:** External
- **Area:** Build process ownership
- **Impact:** Strict owned-child supervision fails a successful cold editor build because a child service is still running when its command exits.
- **Evidence:** Hosted Verify run `37510440337` on `ac83d7fa9` failed `_ide-extension-build` in partitions 5 and 10 with `Owned child processes outlived the command`; the supervisor stopped one child in each. The builder disposed its context without stopping esbuild's unreferenced shared service. After explicit stop and exact-identity joining, both cold build nodes pass in run `37514077055` on `9de16daef`: partition 5 in 36.7 seconds (job `112442437723`) and partition 10 in 17.5 seconds (job `112442437910`), and both partitions pass. The aggregate run fails on an unrelated fixture type error, so these are build-node proof rather than a green branch claim. The local build node also passes in `.artifacts/logs/verify-changed/2026-10-06T18-39-13-914Z-12533-212006fe/ide-extension-build.log`.
- **Workaround:** None; preserve the cleanup failure rather than accepting a leaked child as successful verification.
- **Proposed change:** The standalone one-shot builder snapshots its owned descendants, stops esbuild, and joins their exact identities before exiting. Watch mode and callers of the exported build function retain their existing service lifetime. If cleanup fails after a build failure, report it while retaining the original build error.
- **Dependencies:** `feat/test-process-termination` supplies strict owned-child supervision.
- **Acceptance:** Cold editor builds pass hosted verification and leave no owned child; failed builds retain their original error and useful cleanup diagnostics; watch mode remains live.
- **Source:** 2026-10-06 hosted verification of test process termination.
