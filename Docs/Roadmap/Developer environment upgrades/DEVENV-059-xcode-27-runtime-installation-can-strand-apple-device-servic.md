# DEVENV-059 — Xcode 27 runtime installation can strand Apple device services

- **Status:** In progress
- **Section:** External
- **Area:** iOS simulator workflow
- **Impact:** After installing the iOS 27 simulator runtime, Tao cannot discover, boot, install, or
  launch any simulator even though Xcode reports the iOS 27 SDK as installed.
- **Evidence:** On macOS 27.0 with Xcode 27.0, both sandboxed and unsandboxed `xcrun simctl list
  devices available --json` failed because CoreSimulatorService became invalid and `simdiskimaged`
  was not responding. `xcrun devicectl list devices` separately timed out waiting for
  CoreDeviceService. Xcode 27 contains DeviceHub.app and no standalone Simulator.app.
- **Workaround:** Restart macOS after the runtime download, open Device Hub once, and confirm
  `./agent unsandboxed simulators list available --json` succeeds before launching Tao.
- **Proposed change:** Implemented: Tao presents Device Hub when the standalone Simulator app is absent,
  keeps simulator discovery on `simctl`, and diagnostics distinguish unavailable Apple services from
  sandbox denial. Reverify the real simulator journey after the host services recover.
- **Dependencies:** The host restart remains a manual recovery step; the implementation landed in
  `6722026d`.
- **Acceptance:** On macOS/Xcode 27, `tao dev` can present Device Hub and open HNReader on an iOS 27
  simulator; `./agent doctor` names a stuck Apple service and its recovery when discovery fails.
  On 2026-09-20 `./agent capabilities` completed and classified CoreSimulator as unavailable with
  restart-and-open-Device-Hub guidance, but the service remained invalid, so the real HNReader launch
  could not be proved and this entry stays open. A later same-day fresh-shell probe still found
  `CoreSimulatorService connection became invalid`, `simdiskimaged` unresponsive, and
  `CoreDeviceService` initialization timeout. This is a host-service failure rather than a repository
  sandbox classification defect; no simulator can be discovered until the machine is restarted and
  Device Hub has initialized the runtime.
- **Source:** 2026-09-15 HNReader simulator recovery.
