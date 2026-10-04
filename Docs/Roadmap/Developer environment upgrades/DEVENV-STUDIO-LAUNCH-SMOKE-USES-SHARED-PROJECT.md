# DEVENV-STUDIO-LAUNCH-SMOKE-USES-SHARED-PROJECT — Studio launch smoke uses a shared project

- **Status:** Candidate
- **Section:** External
- **Area:** Studio launch smoke and full landing verification
- **Impact:** Landing fails while the Developer uses HNReader in the same worktree, even though the launch check needs only an isolated project. Stopping that live session interrupts ongoing work.
- **Evidence:** On 2026-10-04, authorized landing of `feat/studio-preview-speed` passed its cheap barrier, then failed in `studio-launch.test.ts:38-42`. Its `startStudioSmokeLaunch` call points at `Apps/HNReader`; that project was owned by Studio session `164d430d-6601-4351-8a2d-7d6c82118171`, PID 88594. The command released its landing lock without pushing. Log: `.artifacts/logs/agent/land/2026-10-04T22-18-20-432Z-81663.log`; exact launch failure: `.artifacts/logs/verify-full/2026-10-04T22-19-11-789Z-88315-4e9cb648/studio-smoke.log`. Other activation-related smoke failures from that run have separate focused passing evidence in the preview-speed roadmap.
- **Workaround:** Obtain explicit authorization to stop the identified live Studio launch through `./agent unsandboxed studio-stop --launch <launch-id>`, then retry the authorized landing. Do not reclaim the project lease or kill unrelated processes.
- **Proposed change:** Run the launch-contract check against a disposable authored project, using existing isolated fixture and shutdown-receipt conventions. Preserve its real CLI readiness, session page, launch record, owned process/port, and complete teardown assertions. Copy no personal state or generated caches.
- **Dependencies:** The Developer's pending host-failure intervention choice. Archived `DEVENV-STUDIO-STOP-MISSING-FROM-HOST-COMMANDS` supplies the authorized-stop front door; that resolved command-availability issue is not reopened.
- **Acceptance:** With a live Studio project session present, the isolated launch smoke passes and drains all resources it owns, while the original session and its project lease remain live and unchanged. Then complete the ordinary full landing lane without skipping its host checks.
- **Source:** Studio preview speed landing continuation, 2026-10-04; `packages/ides/studio-tooling/studio-smoke/studio-launch.test.ts` and the logs above.
