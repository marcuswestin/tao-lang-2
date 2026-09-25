# DEVENV-METRO-STALLS-AFTER-ANDROID-DEV-STOP — iOS dev loop can stall after an Android loop stops

- **Status:** Candidate
- **Section:** External
- **Area:** Tao dev loop, Metro and port lifecycle
- **Impact:** A developer switching from Android to iOS can wait indefinitely after the app compiles, with no actionable distinction between a stale Metro listener, a port reservation, and a simulator launch that has stopped progressing.
- **Evidence:** In the A9 device-loop work, an Android `./agent unsandboxed app-dev` run was stopped; the next `tao dev --ios` compiled and then hung with Metro on port 8081. A retry selected port 55415 and opened successfully. On 2026-09-25 in a fresh checkout, no process listened on 8081, but the requested Android-to-iOS reproduction could not start: `./agent unsandboxed android ensure` and `./agent unsandboxed simulators boot` were rejected by the task tool with `Network access to "127.0.0.1" was blocked: domain is not on the allowlist for the current sandbox mode.` This is not evidence that the original stall is fixed or that the dev loop caused the rejection.
- **Workaround:** Retry the iOS loop so it can select another port; this worked for the one observed stall.
- **Proposed change:** Reproduce Android start, graceful stop, then iOS start in a host session that permits the named operations. Before retrying a stall, capture the 8081 listener and owner, Expo log, port reservation state, Metro readiness, and current simulator state. Fix the stage that holds the loop or give it a bounded failure with a clear remedy.
- **Dependencies:** A host session able to run the named emulator, simulator, and app-dev operations.
- **Acceptance:** The Android-stop-to-iOS sequence repeatedly opens the Companion, or fails within a bounded wait that names the blocked stage and its owner; no stale 8081 listener remains after a normal stop.
- **Source:** 2026-09-25 A9 follow-up handoff and reproduction attempt.
