# Hello Tao on visionOS

A minimal Tao counter in a native visionOS window. The UI and counter behavior are authored in
`VisionHello.tao`; the experimental visionOS exporter packages Tao's existing web runtime inside
SwiftUI and WKWebView. The exported app includes its HTML, JavaScript, and assets and runs without
Metro or a web server. No additional package dependency is required.

## Build

From the repository root:

```sh
./agent tao build Apps/VisionHello --visionos
```

The command prints a retained `TaoApp.xcodeproj` path under this project's `.tao/builds/` directory.
Open that project in Xcode, choose the `TaoApp` scheme and an Apple Vision Pro simulator, then Run.
Install the visionOS Simulator runtime in Xcode's Components settings if no simulator is available.
The project targets visionOS 2 or later and has been built with the visionOS 27 SDK.

The exporter retains an Xcode project, not a signed device application. Xcode performs the native
build. Simulator builds need no development team; physical-device builds require your own team
and bundle identifier. Every export is a fresh snapshot: edit the Tao source and export again.

The screen displays `Hello from Tao` and `Count: 0`. Increment changes the count; Reset returns it
to zero. State lasts for the current mounted scene.

## Run on a headset

1. In Xcode, open **Xcode > Open Developer Tool > Device Hub** and pair the Vision Pro. Keep the
   Mac and headset on the same network; the headset's **Settings > General > Remote Devices**
   exposes wireless pairing.
2. Enable **Settings > Privacy & Security > Developer Mode** on the headset and complete its
   restart and confirmation.
3. In the exported Xcode project, select the **TaoApp** target, open **Signing & Capabilities**,
   select your development team, and choose your own bundle identifier.
4. Select the paired Vision Pro as the run destination and Run. Xcode builds and installs the
   device version; a simulator `.app` cannot run on the headset.

See Apple's [Device Hub guide](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub)
and [Developer Mode guide](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
This prototype has simulator evidence only; physical-device signing and interaction remain unverified.

## Verification

```sh
./agent tao test Apps/VisionHello
```

The Tao journey checks two increments and reset. The optional `visionos/Tests.swift` file is copied
into the exported Xcode project's app-hosted `TaoAppTests` target. Xcode's Product > Test runs the
compiled JavaScript in a visionOS WKWebView and checks the same counter interactions. This native
test covers bundled resource loading and web runtime behavior; it does not prove spatial input,
window appearance, or physical-device behavior.

## Scope

This is a windowed web UI hosted by a native visionOS application. Tao syntax is unchanged.
Native Tao controls, volumes, immersive spaces, native datasource bridges, persistence, app icons,
device signing, and store distribution are outside this prototype. Other Tao apps may depend on
web APIs or native services this host does not support. External top-level navigation is disabled.
