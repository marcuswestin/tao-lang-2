# Tao Companion

The Expo development build that renders a Tao project on a real iPhone or iPad while Tao Studio runs
on the Mac, and the prebuilt host `tao dev` opens emulator and simulator apps in. It is a shell: a Metro
server serves the bundle, and nothing in this package knows which one. Its identity (`Tao
Companion`, `tao-studio-companion`, `taostudiocompanion://`, and `com.devtao.studio.companion`, the
reverse of Tao's domain devtao.com, on both iOS and Android) is fixed in
`packages/apps/expo-host/expo-host-src/dev-loop/prebuilt-host/CompanionIdentity.ts`; `app.json`
repeats the same values and a test keeps them equal.

This is also, today, the only way a Tao app reaches a physical iPhone or iPad. Since 2026-09-03,
Expo Go 57 on iOS requires the developer to be logged in to both the Expo CLI and the Expo Go app,
and `tao dev`'s Metro server runs under a repository-local Expo home directory that a developer's
own `expo login` session in `~/.expo` never reaches, so that login can never be satisfied. Physical
Android keeps using Expo Go, and so do the Android emulator and the iOS Simulator until a host for
them is built or downloaded (below).

The `just` commands below are for a person at a host terminal. Agents use a listed
`./agent unsandboxed` operation for host work; a companion build or publish needs a named entry
before agent use.

## What the shell carries

Because a development build runs the bundle Metro serves it, the shell — not the bundle — decides
which native modules exist and which entitlements are granted. Two consequences are worth knowing
before a Tao app is run here.

Its dependencies must cover every native module a Tao app can require.
The iOS host requires iOS 17 or later, matching its Clerk native dependency. Its deployment target
is explicit so CocoaPods installs that dependency before attaching its Swift packages.
`packages/testing/verification/verification-tests/companion-native-parity.test.ts` fails when a
dependency of `packages/apps/expo-host/package.json` that ships native code is missing here or
pinned to a different version, because the alternative is a crash at require time rather than a
readable failure. A built host records the same set as its native kit (see below).

Its entitlements are the ones Tao is experimenting with: `app.json` applies the `tao-icloud` plugin
with both iCloud services, which grants iCloud Documents, CloudKit, the ubiquity containers, and the
`aps-environment` that CloudKit's silent pushes need. The container is derived from this shell's own
bundle identifier, so **a Tao app run in the Companion reads and writes
`iCloud.com.devtao.studio.companion`, never the container the app itself declares** — iCloud
container identifiers admit no wildcard, so no host binary can lend an app its own. That is
sufficient for exercising the iCloud code paths in development and is not a substitute for running
the app's own build.

This costs something on the Apple side: the app id needs the iCloud capability with that container,
and CloudKit brings Push Notifications with it, so a build signed by a team without push enabled
will fail to provision.

## Install once

```sh
just studio-companion-install device="<name>"
```

`<name>` is the device name Finder and Xcode show. The command lists the connected physical
iPhones and iPads, then runs `expo run:ios --device "<name>" --no-bundler` here: Expo prebuilds the
`ios/` project when needed, CocoaPods resolves pods (the `pod` binary comes from the repository's
devenv profile), Xcode builds and installs. No Metro starts; Studio stays the only Metro owner.
The first build takes minutes; the device must be unlocked and must trust this Mac, and the Xcode
project needs a development team selected once.

## Daily loop

Run Studio as usual (`just studio <project>` or `just studio-native <project>`) and press **Open this
app on device** in Studio's Device panel, or scan the QR code Studio shows. Use that action again
after changing projects; selecting another Studio project does not switch the phone automatically.
Studio launches the installed shell on this project's Metro, the shell pairs with Studio, and Tao
edits reach the device through Fast Refresh. Nothing in
this package is touched. This local development path loads Studio's bundle from the same Tao checkout,
so the JavaScript host and Tao runtime use the exact same version. A separately distributed Companion
and its update compatibility are still release questions.

The Device panel can download a full runtime capture and restore the current capture or a saved JSON
file into the same app and scenario. Named fixture captures in the scenario canvas save provider data
into Tao source; they are separate from the device's complete runtime state. Trusted device console
lines appear with device labels in Studio's Logs drawer.

## Rebuild only when native code changes

Run the install again only after a native dependency, config plugin, entitlement, or `app.json`
change. Tao, TypeScript, and UI changes never need a rebuild.

## Prebuilt hosts for emulators and simulators

```sh
just companion-host-build                           # Android, arm64-v8a and x86_64
just companion-host-build --abi arm64-v8a
just companion-host-build --platform ios-simulator  # needs Xcode and an unsandboxed shell
just companion-host-publish                         # needs gh signed in
```

CocoaPods, `xcodebuild`, and Gradle all need the host, so an agent runs the build as the named host
operation `./agent unsandboxed companion-host-build [--platform ios-simulator] [--abi <abi>]`.

For a side-by-side Xcode, add `--developer-dir /Applications/Xcode-27.1.app/Contents/Developer`
to the iOS simulator build. This selects Xcode only for that command and its children; it does not
change the machine-wide selection. Then `tao dev Apps/HNReader --app HNReaderStub --ios` installs
the built Companion and starts the live app. Repository development Studio can subsequently open
that installed Companion using the selected simulator's **Open this app in simulator** action in its
Device panel. The packaged Studio app does not yet connect that panel to the simulator launcher.

For Android, Expo prebuilds the `android/` project here and Gradle assembles a debug APK. For the
iOS Simulator, CocoaPods and `xcodebuild` build a debug app for both simulator architectures, signed
ad hoc: the simulator reads an app's entitlements from a section Xcode writes only while signing, and
without them CloudKit aborts the app at its first container request, so the build refuses an app that
lacks them. Either binary lands in `.artifacts/hosts/<version>-<kit digest>/<platform>/` beside
`tao-host.json`, a manifest naming the native kit it was built with: every native-code dependency and
the version it was built from, plus a hash of the native sources of Tao's own unpublished packages,
whose versions never move.

From then on `tao dev --android` and `tao dev --ios`, or `a` and `i` in a running dev loop, install
that host (only when the installed build differs) and open the app in it rather than in Expo Go. A
host whose kit does not cover the one `tao dev` computes from `packages/apps/expo-host` is passed
over by name and Expo Go is used instead; the directory name decides nothing.

Publishing puts each built platform's manifest and binary — the simulator app zipped — on a GitHub
release tagged `companion-host-<version>-<kit digest>`, marked as a prerelease and never as latest.
When no cached host fits, `tao dev` lists those releases without signing in, downloads the newest
whose kit covers its own into the Tao home's `hosts/` (`~/.local/share/tao/hosts`, or under
`$TAO_HOME` or `$XDG_DATA_HOME/tao`), and uses it. While the repository
is private that listing answers 404, which `tao dev` reports in one line before falling back to Expo
Go.

Gradle ignores `HTTPS_PROXY`, so the build hands it to the JVM itself, which lets it run behind a
proxy and inside the agent sandbox. The first Android launch shows the development client's one-time
menu introduction over the app.

## The local-network prompt

iOS asks once whether Tao Companion may find and connect to devices on the local network. That
permission is how the shell reaches Studio's Metro and device gateway on the Mac; without it the
shell cannot load anything. `app.json` declares the reason (`NSLocalNetworkUsageDescription`) and
allows plain HTTP to local hosts (`NSAllowsLocalNetworking`), which development builds need.
