# DEVENV-055 — No repository command compiles a native module

- **Status:** In progress
- **Section:** External
- **Area:** Native builds
- **Impact:** The repository now carries native code (`packages/providers/icloud`, an Expo module in
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
- **Workaround:** Run the repository's complete host proof with
  `./agent unsandboxed native-module-check`.
- **Proposed change:** Implemented as typed `./dev native-module-check` orchestration behind the standalone
  `./agent unsandboxed native-module-check` host proof, with bounded phases, isolated build roots, podspec and target
  discovery, retained failure artifacts, the canonical Maven network allowlist, and native-package
  documentation. The mutable repository recipe deliberately remains reviewed outside the sandbox.
- **Dependencies:** None.
- **Acceptance:** Eight focused orchestration tests pass, including real process timeout, phase ordering,
  discovery, missing targets, and retained artifacts. The 2026-09-19 host run completed prebuild and
  reached CocoaPods, then the active task's network policy blocked React Native's Hermes download from
  `repo1.maven.org`; that required domain is now canonical but takes effect in a newly generated task.
  A 2026-09-20 rerun from the task that generated the committed adapters reached the isolated iOS host
  again, but the already-running task's immutable network profile still denied the same domain and
  retained `.artifacts/native-module-check/run-q8wMIW`. This needs a newly started task or an ordinary
  host shell; regenerating files cannot mutate the permissions of the process already running.
  A fresh `feat/devenv-landing-followups` checkout on 2026-09-20 again completed prebuild, discovered
  the native packages, and reached CocoaPods. The active managed shell then denied SSH host-key access;
  Hermes fell back to source and CocoaPods reported missing `cmake`. The exact failed build is retained
  at `.artifacts/native-module-check/run-nK3ugj`; no simulator compilation occurred. The final fresh
  checkout reproduced the same CocoaPods boundary and retained the complete isolated host at
  `/private/tmp/tao-devenv104-after/.artifacts/native-module-check/run-4Y6F8O`.
  A 2026-09-20 host-profile retry on `feat/devenv-host-followups` again completed isolated Expo
  prebuild and reached CocoaPods. The task's immutable network proxy returned `403
  blocked-by-allowlist` for the exact Hermes Maven artifact, so React Native fell back to a source
  build and then reported missing `cmake`; target discovery and simulator compilation did not run.
  The complete isolated host is retained at
  `.artifacts/native-module-check/run-ouRMif`. Adding `cmake` would mask the denied prebuilt-artifact
  path rather than prove the intended host lane, so no repository change is justified from this run.
  On 2026-09-26, `./agent unsandboxed test-host ios --app native-bridge --device
  4E0DEA16-953F-4269-B8BB-91D1D38993D1` likewise completed Expo prebuild and native codegen, then the
  active task's immutable network profile blocked `cdn.cocoapods.org`. The tool terminated the
  process before the ordinary report/cleanup completed; no native Clipboard assertion ran.
  Evidence: `.artifacts/logs/agent/test-host/2026-09-26T23-49-08-853Z-91922.log` and isolated run
  `.artifacts/host-testing/b8b5ffa3-8afe-4b9c-9c6b-9fe7c28d3d93` on `feat/native-binding-poc`.
  No policy or dependency version was changed. Re-run this native proof from an ordinary developer
  shell; existing host-free checks cannot substitute for its result.
  Keep this entry open until a fresh host run compiles `TaoICloudNative` successfully.
- **Source:** 2026-09-05 iCloud datasource provider implementation.
