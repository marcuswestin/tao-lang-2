# Rep Counter for Apple Watch

WatchHello is an experimental native SwiftUI target for Tao. The same Tao source can compile to
React Native. The watch export contains Swift source and a standalone Xcode project; it needs no
JavaScript runtime, web view, Expo server, or companion iPhone app.

From the repository root:

```sh
./agent tao build Apps/WatchHello --watchos
```

The command prints the retained `TaoWatch.xcodeproj` path and a build record. Open that project in
Xcode, choose the **TaoWatch** scheme and a watch simulator, then Run. Install a watchOS simulator
runtime in **Xcode → Settings → Components** if none is available. `--compile-only` retains only
the generated Swift sources. Rebuild after editing Tao; each export is a frozen source snapshot.

For a physical watch, enable Developer Mode on the watch, pair it with the development iPhone and
make it available to Xcode, then choose your signing team and a unique bundle identifier in the
generated target's Signing & Capabilities tab. The bundle identifier comes from that target
setting; the displayed app name comes from Tao's `Name` property. Select the watch as the
destination and Run.
Physical-watch signing, installation, and visual acceptance are separate from simulator evidence.

## Behavior and tests

The app records repetitions from zero to twelve and resets to zero. At twelve the Rep button is
disabled; the action also guards the upper bound. The shared Tao journey exercises increments,
the upper bound, another press at that bound, and reset.

```sh
./agent tao test Apps/WatchHello
./agent unsandboxed test-host watchos --app watchhello
./agent unsandboxed simulators list available
./agent unsandboxed test-host watchos --app watchhello --device <watch-simulator-UUID>
```

The first command exercises React Native behavior. The second exports and builds the native
watch app and UI-test bundle with the simulator SDK; it does not run the UI. Supplying a watch simulator UUID runs
the Tao journey through the repository's reusable XCUI interpreter. Swift test code lives under
`packages/testing/e2e-testing/native/watchos`, not in this app. The generated test plan retains
Tao source locations. Results and the generated test project live under `.artifacts/watchos-proof`.

## Proof-of-concept boundary

The native target supports this app's root StackNav scene, numeric state and constants,
synchronous guarded actions, interpolated text, a scrolling column, buttons, and basic spacing.
Unsupported reachable features produce target diagnostics rather than silently disappearing.
General navigation, asynchronous actions, data providers, persistence, arbitrary TypeScript
bridges, Crown input, haptics, complications, and store distribution remain future work.

The compiler keeps React Native and SwiftUI generation in separate folders, with shared target
selection above them. SwiftUI's `app/` directory owns the AST emitters. The small runtime under
`packages/apps/runtime/swiftui` preserves Tao value formatting; public view names still come
from the existing Tao standard library.
