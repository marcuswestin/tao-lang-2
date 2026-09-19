# DEVENV-020 — Companion lifecycle and diagnostics

- **Status:** Planned
- **Area:** Companion development
- **Impact:** Multiple-app selection omits the `--app` remedy, successful installation can print an
  automation-permission stack, stale companions can remain blank after Metro changes, and simulator
  failures do not clearly distinguish sandbox denial.
- **Evidence:** Four open findings from the companion implementation review. The stale-companion case
  has a cause: every Studio launch takes a fresh preview-Metro port and a fresh gateway port, and the
  companion derives both from the bundle it loaded, so a phone left running against a dead Metro shows
  a blank white screen, dials nothing, and logs nothing anywhere. Trust already survives restarts, so
  this is discovery rather than pairing. `StudioSmoke.reserveResources` is prior art for holding a port
  block. The multiple-app half is addressed on `feat/companion-app-implementation-85b689`, which reads
  the project's `DefaultApp` instead of refusing until `--app` is passed.
- **Workaround:** Pass `--app`, run device tooling from a normal terminal, and re-point a stale
  development client with `xcrun simctl openurl booted "taostudiocompanion://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A<metroPort>"` from an
  unsandboxed shell, which is faster than reinstalling.
- **Proposed change:** Reproduce after merge, improve typed remedies, suppress handled automation errors,
  and add stale-client recovery/status.
- **Dependencies:** Companion and Studio branches must land first.
- **Acceptance:** Each failure mode has a focused test or physical-device proof and names the exact user
  action.
- **Source:** 2026-09-03 companion implementation briefing.
