# DEVENV-ANDROID-EMULATOR-LEASE-RELEASE-PRECEDES-EXIT — Android emulator lease release precedes confirmed exit

- **Status:** Candidate
- **Section:** External
- **Area:** Owned Android emulator cleanup in `app-dev`.
- **Impact:** A failed stop or startup may leave an emulator running after its resource leases become
  available to another development session. This is a code-derived risk; no live leak was reproduced.
- **Evidence:** On 2026-09-30, `AgentAndroidEmulator.ts` lines 121–157 sends `SIGTERM` after an ADB
  stop failure, a stop timeout, or a startup exception, then releases the serial and AVD leases
  without awaiting that termination. The successful ADB path polls for exit, but its timeout fallback
  does not. The Chrome runner already uses bounded termination and waits for process close.
- **Workaround:** None.
- **Proposed change:** Share a bounded owned-process stop helper across failed startup and normal
  teardown, confirm exit after TERM/KILL escalation, and preserve ownership if stop cannot be proven.
  Keep borrowed devices untouched.
- **Dependencies:** None.
- **Acceptance:** Focused tests cover failed ADB stop, ignored TERM, failed startup, and borrowed-device
  preservation; host acceptance confirms that concurrent sessions cannot claim an emulator still
  owned by an earlier session.
- **Source:** Quiet development workflow and skill discovery audit, `dev/ro`, 2026-09-30.
