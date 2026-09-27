# DEVENV-IOS-BUILD-HIDES-POD-INSTALL-FAILURES — iOS build hides pod install failures

- **Status:** Candidate
- **Section:** Deferred
- **Area:** Native host build diagnostics
- **Impact:** Expo continues into Xcode after failed pod installation, so the final report emphasizes an out-of-sync Podfile.lock instead of the first actionable failure.
- **Evidence:** On 2026-09-26, isolated HNReader builds failed first on CocoaPods Ruby ASCII-8BIT normalization, then on React Native's Swift-package hook dereferencing a missing Clerk target. Both ended with the same Xcode Manifest.lock error. Logs: `.artifacts/logs/agent/test-host/2026-09-26T23-24-45-364Z-27467.log` and `2026-09-26T23-25-24-971Z-30338.log` in that directory.
- **Workaround:** Read the earlier pod output. The iOS setup branch now supplies UTF-8 to Apple host commands and sets the generated test host's iOS minimum to 17, matching its installed Clerk dependency. The subsequent `2026-09-26T23-31-05-043Z-82961.log` confirms pod installation completed and both Clerk Swift products attached successfully; this alone does not prove app compilation or launch.
- **Proposed change:** Make native preparation, pod installation, and compilation explicit failure boundaries, preserving the first failed phase in the command report. Reuse the existing Catalyst phase-reporting approach where appropriate.
- **Acceptance:** An injected pod-install failure stops before compilation and reports its original error and phase log; successful native builds retain existing target isolation and cleanup behavior.
- **Source:** iPhone Duo compatibility experiment on `feat/ios-development-setup`.
