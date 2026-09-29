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

From the repository root, inspect the toolchain and headset prerequisites:

```sh
./agent unsandboxed setup-visionos Apps/VisionHello --xcode-version 27.0
```

Add `--apply` to follow the guided setup, select your signing identity, build, install, and launch:

```sh
./agent unsandboxed setup-visionos Apps/VisionHello --xcode-version 27.0 --apply
```

Use the Xcode version you intend to develop with. The command reuses an installed matching Xcode
or guides installation of Apple's signed `.xip` side by side. It preserves the global Xcode
selection and checks first-launch and visionOS SDK readiness. Headset setup does not download or
require a simulator runtime. Downloads, first-launch license acceptance, administrator prompts,
pairing, trust, Developer Mode, and Apple account sign-in require your action where indicated.
Enter requests a fresh check; it never establishes readiness by itself. Type `q` at a guided prompt
to stop, then rerun the same command to resume from the actual host state.

Once Xcode is ready, `--apply` generates the Xcode project **before** headset pairing or signing.
The script prints the retained project path and numbered instructions for opening it, choosing a
simulator or headset, configuring signing, and running. If no headset is ready, it explicitly tells
you to open Remote Devices on the headset and Pair Nearby Device in Device Hub; simply opening
Xcode does not start pairing. Quitting at that prompt keeps the generated project available for a
manual simulator run. Signature and Gatekeeper failures report the specific failed check and a
diagnostic file, rather than asking you to complete an unrelated first-launch step.

To perform the same workflow manually:

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

For repeatable runs, supply `--device <identifier>`, `--team <team-id>`, and
`--bundle-id <your.bundle.identifier>`. The team ID is the ten-character Apple development team ID,
not its display name. Sign in through **Xcode > Settings > Apple Accounts** first. Device builds use
automatic signing and allow Xcode to obtain the required provisioning assets. A rejected team,
unregistered identifier, unavailable device, or signing failure leaves setup incomplete and reports
the next action. Each run exports current Tao source to a retained project; no signing changes are
written into Tao source. A successful launch proves process startup, not visual acceptance: check
the window, Increment, and Reset while wearing the headset.

Optional simulator setup is a separate run and needs no development team:

```sh
./agent unsandboxed setup-visionos Apps/VisionHello --xcode-version 27.0 --simulator --runtime-version 27.0 --apply
```

An installed matching runtime and simulator are reused. `--device` can select a simulator UUID;
otherwise the command guides selection. It does not open the simulator viewer automatically.
Use Device Hub when you want to inspect the window. Reports and build diagnostics are retained
under `.artifacts/visionos-setup/`; inspect the reported paths after a failure. `--json` emits a
structured report without prompts, so supply required choices explicitly when using it with
`--apply`. Inspection does not install, build, or launch anything.

Computer-use automation of Device Hub requires separate app approval. If the harness reports
“Computer Use was not approved to use Device Hub,” enable Device Hub under **Settings > Computer
Use** in the harness app. Shell command approval does not grant that access. You can still complete
the pairing and visual checks yourself in Device Hub.

## Verification

```sh
./agent tao test Apps/VisionHello
```

The Tao journey checks two increments and reset. Native XCTest coverage lives under
`packages/testing/e2e-testing/native/visionos`, next to the watchOS journey sources, and
`tao build --visionos` copies it into the exported Xcode project's app-hosted `TaoAppTests`
target. Xcode's Product > Test runs the compiled JavaScript in a visionOS WKWebView and checks
the same counter interactions. This native test covers bundled resource loading and web runtime
behavior; it does not prove spatial input, window appearance, or physical-device behavior.

Physical-headset acceptance is deferred to the
[pre-MVP device acceptance task](../../Docs/MVP%20Roadmap/Developer%20MVP%20Roadmap.md#pre-mvp-device-acceptance)
by the 2026-09-27 decision. Landing this prototype does not claim that acceptance is complete.

## Scope

This is a windowed web UI hosted by a native visionOS application. Tao syntax is unchanged.
Native Tao controls, volumes, immersive spaces, native datasource bridges, persistence, app icons,
device signing, and store distribution are outside this prototype. Other Tao apps may depend on
web APIs or native services this host does not support. External top-level navigation is disabled.
