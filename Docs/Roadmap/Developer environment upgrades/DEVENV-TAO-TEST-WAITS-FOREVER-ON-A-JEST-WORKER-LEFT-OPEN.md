# DEVENV-TAO-TEST-WAITS-FOREVER-ON-A-JEST-WORKER-LEFT-OPEN — `tao test` waits forever on a Jest worker left open

- **Status:** Candidate
- **Section:** External
- **Area:** `tao test`, the journey Jest harness, provider SDKs.
- **Impact:** A journey that passes but leaves a timer, socket, or port open keeps Jest alive, and `tao test` has no deadline of its own, so the run never ends. In the default quiet mode it prints nothing past "Running Tao tests", and its log is written only at exit, so the hang looks like a slow journey.
- **Evidence:** On 2026-09-27 the Auth Review InstantDB journey passed in about six seconds and then held `tao test` past six minutes. A live-handle dump showed InstantDB's reactor interval and BroadcastChannel port; Jest's `--detectOpenHandles` reported neither. `journey-lifetime.setup.ts` now cancels a file's timers once its journeys finish and removes Node's BroadcastChannel, and the run exits in 12 seconds. The next SDK that leaves something else open will hang the same way.
- **Workaround:** `TAO_TEST_JEST_PATH` pointing at a wrapper that adds `--forceExit` shows the result; a wrapper that dumps `process.getActiveResourcesInfo()` names the holder.
- **Proposed change:** Give the Jest child a deadline after its last journey reports, and on expiry name the open resource kinds and stop it, failing the run with that message rather than waiting.
- **Dependencies:** None.
- **Acceptance:** A fixture journey that opens a MessagePort it never closes fails `tao test` within the deadline, and the message names the open timer.
- **Source:** Provider pairing follow-ups, `feat/provider-pairing-followups`, 2026-09-27.
