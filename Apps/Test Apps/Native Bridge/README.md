# Native Bridge device demo

One app for exercising generated native bindings on physical devices. This replaces the temporary
Haptics runner. The home screen opens separate Expo Haptics, React Native Vibration, and Expo
Clipboard scenes. More native surfaces should join this app as they become supported.

## Open on roPhone

From the repository root, in your regular terminal:

```sh
./dev studio "Apps/Test Apps/Native Bridge" --app NativeBridge
```

Unlock roPhone. In Studio's Device panel, choose **roPhone → Open this app on device · cable** (or
**· LAN**). The installed Tao Companion opens this session and launches the app directly. Keep the
terminal running. This demo intentionally declares no scenarios: opening it applies no scenario
fixtures, environment overrides, preparation or replay steps.

If Tao Companion is not installed, install it once before starting Studio:

```sh
./dev studio-companion-install --device roPhone
```

`./tao dev --ios` opens a simulator; the physical-phone workflow above uses Studio. A simulator
cannot prove physical haptic feedback. Native operations happen only after pressing a control.

## What to try

- **Haptics:** the original default calls, every impact and notification case, and selection. Expand
  the Android group on an Android device for every Android haptic case. `No_Haptics` intentionally
  produces no pulse. Status reports completion of the API call, not actuator output.
- **Vibration:** request a vibration and cancel it. Platforms control their supported behavior;
  iOS chooses its vibration duration, and cancellation applies to Android.
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
  Native Bridge.test.tao
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

The Tao journey checks navigation and initial UI without calling native operations. Package tests
exercise generated native contracts against mocks. Physical-device behavior needs the interactions
above; neither check substitutes for the other.
