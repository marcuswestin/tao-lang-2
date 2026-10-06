# DEVENV-020 — Companion lifecycle and diagnostics

- **Status:** In progress
- **Section:** Deferred
- **Area:** Companion development
- **Impact:** Multiple-app selection omits the `--app` remedy, successful installation can print an
  automation-permission stack, stale companions can remain blank after Metro changes, and simulator
  failures do not clearly distinguish sandbox denial.
- **Evidence:** The original companion implementation review recorded four findings. The stale-companion case
  has a cause: every Studio launch takes a fresh preview-Metro port and a fresh gateway port, and the
  companion derives both from the bundle it loaded, so a phone left running against a dead Metro shows
  a blank white screen, dials nothing, and logs nothing anywhere. Trust already survives restarts, so
  this is discovery rather than pairing. `StudioSmoke.reserveResources` is prior art for holding a port
  block. Reassessment on 2026-09-20 confirmed the multiple-app remedy, handled Automation-error
  suppression, typed simulator/sandbox remedies, explicit Studio Open/reconnect UI, fresh deep links,
  and client foreground redial have landed with focused coverage. No test or physical journey yet
  reproduces the original old-client/dead-Metro blank screen end to end.
- **Workaround:** Pass `--app`, run device tooling through named host commands, and re-point a
  stale development client with `./agent unsandboxed simulators open-url booted
  "taostudiocompanion://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A<metroPort>"`,
  which is faster than reinstalling.
- **Proposed change:** Run the stale-Metro journey on a simulator or physical device and prove that
  Studio's fresh Open/deep-link action recovers the client. Add persistent or automatic discovery only
  if that real journey shows the explicit recovery is insufficient.
- **Dependencies:** DEVENV-059 blocks simulator proof while CoreSimulatorService is unavailable; the
  previously named companion and Studio branches have landed.
- **Acceptance:** A stale companion pointed at a dead Metro is recovered by the documented Studio
  action on a real simulator or device, with the exact user action visible in Studio.
- **Source:** 2026-09-03 companion implementation briefing.

## Fresh Firebase host observation — October 5, 2026

The isolated Firebase Live Acceptance loop645bfecb-f6bf-473c-b3e2-3e12dae7f557 installed and
opened the task-built Companion, but Appium could not find its managed runtime identity marker.
Metro recorded web bundles and no iOS bundle activity. This is evidence of failed native mounting
or marker exposure, not a confirmed stale-client cause. The initial diagnostic capture failure
was silently discarded, leaving the foreground/transport distinction unproved. Sanitized
capture-failure stages are being added without relaxing foreground or ownership checks.

## Related installation identity finding — 2026-10-05

SimulatorCompanion's installed-build check hashes CFBundleExecutable only. A debug Simulator
build puts its AppDelegate, scene and dev-launcher implementation in TaoCompanion.debug.dylib,
so a matching launcher executable does not establish matching native payload. Broaden the
installation identity in a dedicated lifecycle pass and cover a changed dylib with an unchanged
launcher. This is a source finding, not the cause of the current Firebase startup failure:
read-only hashes of the actual installed dylibs on the two owned test Simulators matched the
cached host exactly. Scene/factory wiring also matched the installed Expo57 implementation.
