# DEVENV-NATIVE-MODULE-CHECK-CANNOT-LIST-SWIFT-PACKAGE-PODS — native module check cannot list Swift package Pods

- **Status:** Candidate
- **Section:** Deferred
- **Area:** Native module verification
- **Impact:** `native-module-check` stops after a successful CocoaPods install when Xcode's legacy build-location target listing encounters a Pods project with Swift packages. It therefore cannot report its own pod compilation result for the current Expo host.
- **Evidence:** On 2026-09-28, `./agent unsandboxed native-module-check` failed during `xcodebuild -project Pods.xcodeproj -list -json` with `Packages are not supported when using legacy build locations, but the current project has them enabled.` Log: `.artifacts/logs/agent/native-module-check/2026-09-28T06-02-02-301Z-14474.log`; isolated host: `.artifacts/native-module-check/run-wKVHaa`. The same generated host's JazzRn scheme and full TaoRuntime iOS Simulator app compiled with the named `./agent unsandboxed xcode build-workspace` operation, so the target-listing phase is the observed blocker.
- **Workaround:** Compile an identified native module or app scheme through the named `xcode build-workspace` host operation. Retain the failed isolated host for diagnosis; compilation alone does not prove app launch or hosted sign-in.
- **Proposed change:** Discover targets through a workspace-compatible Xcode invocation or a validated Pods project parser, then compile each declared module without relying on the incompatible legacy build-location listing.
- **Acceptance:** A fixture with CocoaPods and Swift package products completes `native-module-check`, compiles each declared native module, and still fails with a clear phase and retained artifacts when a target is missing or compilation fails.
- **Source:** Hosted provider first slice on `feat/hosted-provider-candidates`.
