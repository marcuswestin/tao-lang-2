# DEVENV-059 — Xcode 27 runtime installation can strand Apple device services

- **Status:** Incoming
- **Area:** iOS simulator workflow
- **Impact:** After installing the iOS 27 simulator runtime, Tao cannot discover, boot, install, or
  launch any simulator even though Xcode reports the iOS 27 SDK as installed.
- **Evidence:** On macOS 27.0 with Xcode 27.0, both sandboxed and unsandboxed `xcrun simctl list
  devices available --json` failed because CoreSimulatorService became invalid and `simdiskimaged`
  was not responding. `xcrun devicectl list devices` separately timed out waiting for
  CoreDeviceService. Xcode 27 contains DeviceHub.app and no standalone Simulator.app.
- **Workaround:** Restart macOS after the runtime download, open Device Hub once, and confirm
  `xcrun simctl list devices available --json` succeeds before launching Tao.
- **Proposed change:** Support Device Hub anywhere Tao presents a simulator, keep the workspace on
  an Expo CLI with Xcode 27 support, and teach `./agent doctor` to distinguish an absent runtime
  from failed CoreSimulator/CoreDevice services with restart guidance.
- **Dependencies:** Owned by unmerged branch `feat/macos-27-device-hub`; the host restart remains a
  manual recovery step.
- **Acceptance:** On macOS/Xcode 27, `tao dev` can present Device Hub and open HNReader on an iOS 27
  simulator; `./agent doctor` names a stuck Apple service and its recovery when discovery fails.
- **Source:** 2026-09-15 HNReader simulator recovery.
