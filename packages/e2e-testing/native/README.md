# Native host proof

The current simulator and emulator commands build an isolated Release application and execute a
compiled Tao journey through Appium:

```sh
./agent test-host ios --app hnreader --device <simulator-UDID>
./agent test-host android --app hnreader --device <emulator-serial>
```

Each run uses an explicit target and a run-scoped `dev.tao.taohost…` application identifier. The iOS
path uses XCUITest; the Android path uses UiAutomator2. Both perform real input, application
termination and relaunch, source-linked assertions, screenshots, and deliberate-fault classification.
The app's run-scoped control link advances deterministic time, and the visible receipt must appear
before countdown-dependent assertions continue.

Target and driver ports are protected by machine-wide generation-fenced leases. The iOS allocation
owns WebDriverAgent and MJPEG ports plus a derived-data path. Android owns UiAutomator2 system and
MJPEG ports. Each run has a private Appium home and server port beneath its artifact root.

Cleanup attempts every owned step independently: write the Appium server log, stop the server,
uninstall the isolated application, and release the target lease. The platform controller first
deletes the remote WebDriver session and releases its platform-specific port leases. If remote
session deletion is ambiguous, the target lease is retained so another process cannot reuse a
possibly live simulator or emulator. Worktree deletion is not a substitute for this runtime cleanup.

The physical `device` mode remains distinct. It discovers the explicit iOS device, builds and installs
the isolated Release app, records that milestone, and reports `physical-ios-ui-driver-unsupported`.
No physical-device UI assertion is inferred from installation. Physical iOS and Android Appium
acceptance are planned in the next slice set.

The old Maestro runner and YAML flows are not reached by the current `ios` or `android` commands.
They remain in the repository only until their removal is approved.
