# Tao Companion

The Expo development build that renders a Tao project on a real iPhone or iPad while Tao Studio runs
on the Mac. It is a shell: Studio's own Metro serves the bundle, Studio's device gateway carries
control, and nothing in this package knows about either. Its identity (`Tao Companion`,
`tao-studio-companion`, `taostudiocompanion://`, `dev.tao-lang.studio.companion`) is fixed in
`packages/ides/studio-tooling/studio-tooling-src/StudioCompanionIdentity.ts`; `app.json` repeats the same values and a
test keeps them equal.

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

Run Studio as usual (`just studio <project>` or `just studio-native <project>`) and press **Open on
device**, or scan the QR code Studio shows. Studio launches the installed shell on this project's
Metro, the shell pairs with Studio, and Tao edits reach the device through Fast Refresh. Nothing in
this package is touched.

## Rebuild only when native code changes

Run the install again only after a native dependency, config plugin, entitlement, or `app.json`
change. Tao, TypeScript, and UI changes never need a rebuild.

## The local-network prompt

iOS asks once whether Tao Companion may find and connect to devices on the local network. That
permission is how the shell reaches Studio's Metro and device gateway on the Mac; without it the
shell cannot load anything. `app.json` declares the reason (`NSLocalNetworkUsageDescription`) and
allows plain HTTP to local hosts (`NSAllowsLocalNetworking`), which development builds need.
