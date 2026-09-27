# DEVENV-IOS-BUILDS-LACK-COCOAPODS-METADATA-ACCESS — iOS builds lack CocoaPods metadata access

- **Status:** In progress
- **Section:** External
- **Area:** Native iOS build network policy
- **Impact:** A ready Xcode and simulator installation cannot complete an isolated Tao app build when CocoaPods metadata is blocked.
- **Evidence:** On 2026-09-26, `test-host ios --app hnreader --build-only` targeting iPhone Duo with Xcode27.1 completed prebuild and downloaded pinned React Native and Hermes archives. The host command then failed with `Network access to "cdn.cocoapods.org" was blocked: domain is not on the allowlist for the current sandbox mode.` Log: `.artifacts/logs/agent/test-host/2026-09-26T23-18-34-949Z-14304.log`. The build process14327 no longer existed afterward. Canonical policy allowed Maven and React Native artifact hosts but omitted this CocoaPods origin.
- **Workaround:** Run the named build command in a normal Terminal, or restart with the regenerated policy. Do not change registries or dependency versions to evade a denied origin.
- **Proposed change:** The current iOS setup branch adds only the observed official metadata origin to canonical policy and regenerates both harness adapters. Confirm a native build under the effective policy before declaring the host path complete.
- **Dependencies:** Effective session permissions must include the regenerated origin; see [active network policy](DEVENV-ACTIVE-NETWORK-POLICY-KEEPS-OLD-DOMAINS.md).
- **Acceptance:** The isolated iOS app finishes pod resolution, compiles against the requested SDK, installs, and visibly runs on Duo, with the original default Xcode selection preserved.
- **Source:** iPhone Duo compatibility experiment on `feat/ios-development-setup`.
