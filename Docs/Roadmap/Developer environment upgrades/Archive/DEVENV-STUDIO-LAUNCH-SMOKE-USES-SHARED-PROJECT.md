# DEVENV-STUDIO-LAUNCH-SMOKE-USES-SHARED-PROJECT — Studio launch smoke uses a shared project

- **Status:** Resolved
- **Section:** External
- **Area:** Studio launch smoke and full landing verification
- **Impact:** Landing fails while the Developer uses HNReader in the same worktree, even though the launch check needs only an isolated project. Stopping that live session interrupts ongoing work.
- **Evidence:** On 2026-10-04, authorized landing of `feat/studio-preview-speed` passed its cheap barrier, then failed in `studio-launch.test.ts:38-42`. Its `startStudioSmokeLaunch` call points at `Apps/HNReader`; that project was owned by Studio session `164d430d-6601-4351-8a2d-7d6c82118171`, PID 88594. The command released its landing lock without pushing. Log: `.artifacts/logs/agent/land/2026-10-04T22-18-20-432Z-81663.log`; exact launch failure: `.artifacts/logs/verify-full/2026-10-04T22-19-11-789Z-88315-4e9cb648/studio-smoke.log`. Other activation-related smoke failures from that run have separate focused passing evidence in the preview-speed roadmap.
- **Workaround:** None needed after fixture isolation. Do not reclaim a live project lease or stop unrelated launches.
- **Proposed change:** Run the launch-contract check against a disposable authored project, using existing isolated fixture and shutdown-receipt conventions. Preserve its real CLI readiness, session page, launch record, owned process/port, and complete teardown assertions. Copy no personal state or generated caches.
- **Dependencies:** Fixed on `feat/studio-preview-speed` using the existing disposable-project and cleanup-receipt helper. No dependency or lockfile changes and no live-session stop were needed. Archived `DEVENV-STUDIO-STOP-MISSING-FROM-HOST-COMMANDS` remains resolved.
- **Acceptance:** With a live Studio project session present, the isolated launch smoke passes and drains all resources it owns, while the original session and its project lease remain live and unchanged. Then complete the ordinary full landing lane without skipping its host checks.
- **Source:** Studio preview speed landing continuation, 2026-10-04; `packages/ides/studio-tooling/studio-smoke/studio-launch.test.ts` and the logs above.
- **Resolution:** The isolated real CLI launch passes all 14 assertions in 6.7s (`.artifacts/logs/agent/studio-smoke/2026-10-05T00-40-42-397Z-76891.log`). Its source fixture receipt records confirmed removal after shutdown. A subsequent `studio-ps --json` still reports the original launch `native-0f73cb04-2582-4820-b8a6-784239bbe863` live with PID 88594 and port 63440. Independent review confirms the readiness, process, port, record-removal and endpoint-refusal assertions remain intact. The full landing lane still runs normally before any push.
- **Archived:** 2026-10-05
