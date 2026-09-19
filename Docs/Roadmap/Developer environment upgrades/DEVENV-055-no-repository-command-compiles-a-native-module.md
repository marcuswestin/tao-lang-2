# DEVENV-055 — No repository command compiles a native module

- **Status:** Candidate
- **Area:** Native builds
- **Impact:** The repository now carries native code (`packages/icloud-native`, an Expo module in
  Swift), and nothing short of a full `expo run:ios` proves it compiles. An agent has to hand-assemble
  the steps, two of which fail in the Bash sandbox.
- **Evidence:** `expo prebuild packages/runtime-toolchain --platform ios --no-install` works in the
  sandbox. `pod install --project-directory=packages/runtime-toolchain/ios` fails with `cannot load such
  file -- ./scripts/autolinking` because the Podfile's `node --print "require.resolve('expo/package.json')"`
  resolves from the shell's cwd, so the install must run from inside the `ios` directory (a subshell
  `(cd packages/runtime-toolchain/ios && pod install)` keeps the session cwd). `xcodebuild -project
  ios/Pods/Pods.xcodeproj -target TaoICloudNative -sdk iphonesimulator` with `SYMROOT`/`OBJROOT` inside
  the worktree still fails sandboxed with `Could not compute dependency graph … Operation not permitted`
  on its `XCBuildData/PIFCache` write, because Xcode's build service is a separate process the sandbox
  does not cover; unsandboxed it succeeds in about two minutes and proves the Swift module against
  ExpoModulesCore. Autolinking only finds a podspec in a top-level subdirectory of the package
  (`ios/`), never at its root.
- **Workaround:** The three commands above, with `pod install` in a subshell and `xcodebuild`
  unsandboxed.
- **Proposed change:** A `just native-module-check` (or `./agent native-check`) recipe that prebuilds
  the toolchain host, installs pods from the right directory, and compiles every workspace pod target
  for the simulator with build products under `.artifacts/`; list it beside `just session-native` as the
  sanctioned unsandboxed native step.
- **Dependencies:** None.
- **Acceptance:** One documented command compiles `TaoICloudNative` for the simulator from a fresh
  worktree and fails loudly on a Swift error.
- **Source:** 2026-09-05 iCloud datasource provider implementation.
