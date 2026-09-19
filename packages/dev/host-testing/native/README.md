# Native host proof

`runNativeHostProof` receives an isolated Expo build callback, an unsigned 32-bit seed, and both entry-source and
compiled-artifact digests. It validates the exact run-scoped `dev.tao.taohost…` bundle identifier before any install
or cleanup action, then installs that project with
`expo run:ios --device <UDID> --configuration Release --no-bundler` so the JavaScript bundle is standalone
and Expo exits after installation instead of retaining its development server/log stream, then runs a
subject-specific Maestro flow. Its receipt
is the proof record: blocked and failed runs are never green.

The first flow targets an iOS simulator. The physical-device option requires an explicit identifier and performs
physical-device discovery plus the isolated Release build/install, then returns `physical-ios-ui-driver-unsupported`:
Maestro cannot establish an on-device UI proof. A physical milestone therefore needs a separate physical-device UI
driver; it must not reuse the simulator lane's result.

`reset.yaml` uses `clearState: true` only on the isolated PoC bundle ID before each test. The HNReader
flow subsequently uses OS `killApp`/`launchApp` without clearing state, so the final Reading
assertion proves both persistence and most-recent ordering rather than a fake relaunch. Its detail
checks name the stub's actual comment and empty-thread states, not merely a story title rendered on
both screens. Clockwork checks the seeded sequence across real native taps before advancing its
controlled clock.

Maestro requires Java 17 or later. `runNativeHostProof` honors `JAVA_HOME`; when it is unset, its
Maestro child process discovers a Homebrew JDK 17 (then the current Homebrew JDK) at either standard
Apple Silicon or Intel prefix. This scoped fallback avoids a machine-global `sudo` JDK symlink. It
also disables Maestro analytics for the proof process, because a managed host may not grant write
access to `~/.maestro`.
