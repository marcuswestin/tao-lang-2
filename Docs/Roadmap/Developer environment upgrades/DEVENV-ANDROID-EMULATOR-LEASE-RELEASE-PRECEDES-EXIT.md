# DEVENV-ANDROID-EMULATOR-LEASE-RELEASE-PRECEDES-EXIT — Android emulator lease release precedes confirmed exit

- **Status:** In progress
- **Section:** External
- **Area:** Owned Android emulator cleanup in `app-dev`.
- **Impact:** A failed stop or startup may leave an emulator running after its resource leases become
  available to another development session. An abrupt parent cancellation reproduced a live orphan
  on 2026-10-01 before durable startup ownership was implemented.
- **Evidence:** On 2026-09-30, `AgentAndroidEmulator.ts` lines 121–157 sends `SIGTERM` after an ADB
  stop failure, a stop timeout, or a startup exception, then releases the serial and AVD leases
  without awaiting that termination. The successful ADB path polls for exit, but its timeout fallback
  does not. The Chrome runner already uses bounded termination and waits for process close.
  On 2026-10-01 cleanup was changed to await authoritative process close and captured descendant
  identities after bounded ADB, TERM, and KILL stages. Unproved shutdown retains both fences under
  a rotated generation; uncertain identity is quarantined. Generation-checked `android recover`
  cannot clear active peers or uncertain descendants. Focused failure and retention tests provide
  source evidence. The host run booted `Tao_Agent_Pixel_1` headlessly and opened the app, but abrupt
  cancellation left `emulator-5554` running with stale parent leases. Startup now publishes a durable
  quarantined AVD intent before spawn, then verified child identities before declaring readiness.
  Death between spawn and identity publication remains quarantined rather than automatically
  recoverable; ownership cannot be reconstructed from an AVD name or recycled serial.
  On 2026-10-02 `android devices` reported no attached emulator, so the pre-fix orphan is no
  longer present. A new owned loop was not started while the harness could not stop its host
  processes through terminal input or sandbox signals.
  The Developer approved managed `dev-loop` controls to remove that terminal-control dependency.
  The new operation is present in generated configuration but remains sandboxed in the current task.
  Existing finite mobile journeys acquire the same exclusive device resource as a dev loop; they
  cannot attach to a live loop without an explicit ownership-sharing mechanism. Preserve that fence.
- **Workaround:** Use the printed generation with `./agent unsandboxed android recover --avd <name>
  --generation <id>` for retained, identifiable owned processes. Quarantined ownership requires
  investigation; do not force-release it from age or ADB absence.
- **Proposed change:** Share a bounded owned-process stop helper across failed startup and normal
  teardown, confirm exit after TERM/KILL escalation, and preserve ownership if stop cannot be proven.
  Keep borrowed devices untouched.
- **Dependencies:** None.
- **Acceptance:** Source tests cover failed startup, bounded escalation, borrowed devices, retained
  ownership, PID reuse, stale recovery generations, and parallel reservations. Still open: real
  graceful shutdown and escalation; a repeat abrupt-parent-exit run with the durable protocol;
  concurrent sessions and port reuse; screenshot/input acceptance; and safe reconciliation of
  uncertain ownership. The pre-fix orphan's absence is confirmed by the later ADB inventory.
- **Source:** Quiet development workflow and skill discovery audit, `dev/ro`, 2026-09-30.
