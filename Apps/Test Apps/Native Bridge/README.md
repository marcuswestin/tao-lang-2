# Native Bridge device demo

One app for exercising generated native bindings on devices and simulators. This replaces the temporary
Haptics runner. The home screen opens separate Expo Haptics, React Native Vibration, and Expo
Clipboard scenes. More native surfaces should join this app as they become supported.

## Open on roPhone

From the repository root, in your regular terminal:

```sh
./tao dev "Apps/Test Apps/Native Bridge" --app NativeBridge --device roPhone
```

Unlock roPhone, trust this Mac, and keep both on the same network. The command opens the installed
Tao Companion directly, starts the ordinary app, and watches source changes. Keep the terminal
running. If Studio already has this project open, stop that session first with Ctrl+C. Only one
development session may own the project.

If Tao Companion is not installed, install it once:

```sh
./dev studio-companion-install --device roPhone
```

`--device` accepts a phone name or ID; `--ios` opens a simulator. A simulator cannot prove physical
haptic feedback. Native operations happen only after pressing a control. This demo declares no
scenarios, and ordinary `tao dev` applies no scenario preparation or replay.

For the Studio editor and device inspector, the separate workflow remains:

```sh
./dev studio "Apps/Test Apps/Native Bridge" --app NativeBridge
```

Choose **Device → roPhone → Open this app on device** in Studio.

## What to try

- **Haptics:** the original default calls, every impact and notification case, and selection. Expand
  the Android group on an Android device for every Android haptic case. `No_Haptics` intentionally
  produces no pulse. Status reports completion of the API call, not actuator output.
- **Vibration:** request a vibration and cancel it. Android honors the requested duration; iOS
  uses a fixed system pulse. Cancellation stops patterns on both platforms, but cannot shorten
  an iOS pulse already underway.
- **Clipboard:** copy/read text and HTML; check availability; copy a one-pixel sample image, or copy
  a photo in another app and read it as PNG/JPEG; copy/read/check URLs on iOS or macOS. Reads may
  trigger an OS paste prompt. A missing image produces “No image read.”
- **Clipboard listener:** start listening, copy something, and observe the event counter. Stop with
  the returned subscription's `Remove` or the deprecated upstream removal API. Back removes the
  scene and its listener automatically. Reads and writes do not require listening.

Clipboard's `ClipboardPasteButton` and `isPasteButtonAvailable` exports are explicitly excluded until
component and constant generation are supported. All 11 generated Clipboard operations have controls.

## Ownership and regeneration

```text
Native Bridge/
  App.tao, Project.tao, Design.tao
  Native Bridge.test.tao    # no native effects
  .host-tests/Clipboard.test.tao       # explicit iOS host journey
  Haptics/
    Haptics.tao
    Generated/             # generated Tao, TypeScript and catalog
  Vibration/
    Vibration.tao
    Generated/
  Clipboard/
    Clipboard.tao
    ClipboardImagePreview.tao
    Generated/
```

Each `Generated/` directory is disposable. Never edit its files by hand. These maintained bindings
are committed; regenerate from the installed host declarations with:

```sh
./tao bridge expo-haptics --source expo --from packages/apps/expo-host --out "Apps/Test Apps/Native Bridge/Haptics/Generated"
./tao bridge react-native --source react-native --export Vibration --from packages/apps/expo-host --out "Apps/Test Apps/Native Bridge/Vibration/Generated"
./tao bridge expo-clipboard --source expo --from packages/apps/expo-host --out "Apps/Test Apps/Native Bridge/Clipboard/Generated" --exclude ClipboardPasteButton isPasteButtonAvailable
./tao fix "Apps/Test Apps/Native Bridge"
./dev gates _fix-dprint
```

The last two commands apply the repository's canonical Tao and TypeScript/JSON formatting; they are
part of the repeatable generation pipeline. `_fix-dprint` is the repository-wide formatter. No
handwritten binding changes are needed. Compiler-produced `Bindings.tao.ts` metadata is ignored.

The UI is authored separately. `ClipboardImagePreview.tao` contains a small injected renderer for a
nullable image record, because direct nullable-record field inspection is not yet supported in Tao.
It only renders returned data and invokes no native APIs.

For the next supported API, add `<Surface>/<Surface>.tao` beside `<Surface>/Generated/`, generate its
bindings, and add a home-screen button. Keep platform-specific controls labeled. Android can use the
same app; future source/target adapters belong in `packages/native-bindings`, not in this demo.

The Tao journey checks navigation and initial UI without calling native operations. The
`native-bridge-demo.jest-test.tsx` suite compiles this maintained app and operates its controls with
native substitutes. It checks edited and submitted clipboard text, HTML options, availability,
image previews and absent results, URLs, listener controls/events and cleanup on Back, every
Haptics control, and vibration/cancellation. A pending clipboard write must finish before its
completion status appears. The substitutes leave the real clipboard and device hardware untouched.

Separate generated-binding tests exercise the native contracts. The opt-in iOS host journey compiles
this app without native substitutes, installs an isolated Release build, and drives text/HTML,
PNG/JPEG image metadata, URLs, availability, and listener controls through Appium. Its hidden `.host-tests/` directory
keeps real clipboard writes out of ordinary in-process test discovery.

```sh
./dev test-host ios --app native-bridge --device <simulator-UDID>
```

Use an idle iOS simulator. The run changes that simulator's pasteboard, disables automatic Mac
clipboard synchronization, and uninstalls its uniquely identified test app during cleanup. Native
scrolling brings off-screen controls and results into view. Android and physical-device journeys
are not admitted under this subject because it includes iOS-specific URL operations.

The journey passed on an iPhone 17e simulator running iOS 27 on 2026-09-27, using the real native
module. The first attempt had stopped at a CocoaPods network boundary; after integrating the isolated
build fixes from main, the build, installation, assertions, and cleanup completed successfully.
Evidence: `.artifacts/host-testing/bbc9132e-1cf6-4252-96bf-247a219d058a/appium-ios/proof.receipt.json`.

HTML checks establish successful write/read calls and recovery of the distinct sample's plain text.
iOS re-serializes HTML, so the native journey does not assert markup byte equality or bold styling.
The listener check requires a change after a cleared count; native notifications are not assumed to
arrive exactly once per write. The demo's reset control changes the count without removing the listener.
Image assertions check returned dimensions and presence, not encoded bytes or native image decoding.
Late-event disposal is established by the mocked suite, not by an immediate unchanged native counter.

Cross-app paste permission scenarios remain pending. Physical haptic feel is deliberately excluded.
Neither mocked UI tests nor this same-app Clipboard journey establishes those behaviors; listener
cleanup against late events is additionally covered by the mocked maintained-app suite.
