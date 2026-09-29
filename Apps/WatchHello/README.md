# Rep Counter for Apple Watch

WatchHello is an experimental native SwiftUI target for Tao. The same Tao source can compile to
React Native. The watch export contains Swift source and a standalone Xcode project; it needs no
JavaScript runtime, web view, Expo server, or companion iPhone app.

From the repository root:

```sh
./agent unsandboxed setup-watchos Apps/WatchHello --xcode-version 27.0 --runtime-version 27.0 --apply
```

The setup command inspects Xcode, installs the exact watchOS simulator runtime from Apple's
command-line tools when needed, exports `TaoWatch.xcodeproj`, and builds, installs, and launches
the app on an available Apple Watch simulator. When several are available, enter the number shown
beside the one you want; scripts can pass `--device <UUID>`. Setup rechecks the runtime after
installation and the simulator after any prompt. If no simulator exists, create one in **Xcode → Open Developer
Tool → Device Hub**, then rerun the command. The global Xcode selection is preserved. Omit
`--apply` to inspect prerequisites without changing them. The runtime installer can request
Apple sign-in, license acceptance, or administrator access in Xcode; complete the requested step
and rerun the same command.

To export a project without running setup, use `./agent tao build Apps/WatchHello --watchos`.
Open the retained project in Xcode, choose the **TaoWatch** scheme and a watch simulator, then
Run. `--compile-only` retains only generated Swift sources. Rebuild after editing Tao; each export
is a frozen source snapshot.

For a physical watch, run
`./agent unsandboxed setup-watchos Apps/WatchHello --xcode-version 27.0 --physical --apply`.
It exports the project and prints the remaining person-led steps. Pair the companion iPhone with
the Mac in Device Hub and enable Developer Mode on both iPhone and watch. Choose your signing team
and a unique bundle identifier in the generated target's Signing & Capabilities tab. The bundle
identifier comes from that target setting; the displayed app name comes from Tao's `Name` property.
Select the watch as the destination and Run.
Physical-watch signing, installation, and visual acceptance are separate from simulator evidence.

## Behavior and tests

The app records repetitions from zero to twelve and resets to zero. At twelve the Rep button is
disabled; the action also guards the upper bound. The shared Tao journey exercises increments,
the upper bound, another press at that bound, and reset.

```sh
./agent tao test Apps/WatchHello
./agent unsandboxed test-host watchos --app watchhello
./agent unsandboxed test-host watchos --app watchhello --developer-dir /Applications/Xcode.app/Contents/Developer
./agent unsandboxed simulators list available
./agent unsandboxed test-host watchos --app watchhello --device <watch-simulator-UUID>
```

The first command exercises React Native behavior. The second exports and builds the native
watch app and UI-test bundle with the simulator SDK; it does not run the UI. Supplying a watch simulator UUID runs
the Tao journey through the repository's reusable XCUI interpreter. Swift test code lives under
`packages/testing/e2e-testing/native/watchos`, not in this app. The generated test plan retains
Tao source locations. Results and the generated test project live under `.artifacts/watchos-proof`.
Pass `--developer-dir` to build against a specific Xcode installation for this command without
changing the global Xcode selection.

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
