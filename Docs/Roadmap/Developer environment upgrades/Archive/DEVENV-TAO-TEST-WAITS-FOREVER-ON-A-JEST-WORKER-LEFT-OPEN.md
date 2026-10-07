# DEVENV-TAO-TEST-WAITS-FOREVER-ON-A-JEST-WORKER-LEFT-OPEN — `tao test` waits forever on a Jest worker left open

- **Status:** Resolved
- **Section:** External
- **Area:** `tao test`, the journey Jest harness, provider SDKs.
- **Impact:** A journey that passes but leaves a timer, socket, or port open keeps Jest alive, and `tao test` has no deadline of its own, so the run never ends. In the default quiet mode it prints nothing past "Running Tao tests", and its log is written only at exit, so the hang looks like a slow journey.
- **Evidence:** On 2026-09-27 the Auth Review InstantDB journey passed in about six seconds and then held `tao test` past six minutes. A live-handle dump showed InstantDB's reactor interval and BroadcastChannel port; Jest's `--detectOpenHandles` reported neither. `journey-lifetime.setup.ts` now cancels a file's timers once its journeys finish and removes Node's BroadcastChannel, and the run exits in 12 seconds. The next SDK that leaves something else open will hang the same way.
- **Workaround:** `TAO_TEST_JEST_PATH` pointing at a wrapper that adds `--forceExit` shows the result; a wrapper that dumps `process.getActiveResourcesInfo()` names the holder.
- **Proposed change:** The final Jest verdict starts a three-second drain deadline. On expiry, report the last resource kinds from the coordinator and workers, stop the owned process group, and await cleanup. Preserve an original failed verdict; fail a passing run that needs forced cleanup. Before a final verdict, a two-minute silence deadline explains an unresponsive runner.
- **Dependencies:** None. Implemented on `feat/test-process-termination`, 2026-10-06.
- **Acceptance:** Real Tao journeys retaining a MessagePort return failure after the three-second drain with the original pass/fail summary, MessagePort diagnostic, retained log, and no fixture PID alive at return. A clean journey succeeds. These three cases passed on `feat/test-process-termination` on 2026-10-06; direct Jest fixtures also passed. Mutation checks rejected dropping the reported original exit code or returning before owned-child cleanup. This proves the deterministic resource fixtures, not every provider SDK's resource behavior.
- **Source:** Provider pairing follow-ups, `feat/provider-pairing-followups`, 2026-09-27.
- **Archived:** 2026-10-06
