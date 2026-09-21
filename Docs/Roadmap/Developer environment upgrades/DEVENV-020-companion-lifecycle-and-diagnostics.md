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
- **Workaround:** Pass `--app`, run device tooling from a normal terminal, and re-point a stale
  development client with `xcrun simctl openurl booted "taostudiocompanion://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A<metroPort>"` from an
  unsandboxed shell, which is faster than reinstalling.
- **Proposed change:** Run the stale-Metro journey on a simulator or physical device and prove that
  Studio's fresh Open/deep-link action recovers the client. Add persistent or automatic discovery only
  if that real journey shows the explicit recovery is insufficient.
- **Dependencies:** DEVENV-059 blocks simulator proof while CoreSimulatorService is unavailable; the
  previously named companion and Studio branches have landed.
- **Acceptance:** A stale companion pointed at a dead Metro is recovered by the documented Studio
  action on a real simulator or device, with the exact user action visible in Studio.
- **Source:** 2026-09-03 companion implementation briefing.
