# DEVENV-NONAUTH-FIXTURES-AUTOLINK-CLERK-SWIFT-PACKAGES — Non-auth fixtures autolink Clerk Swift packages

- **Status:** Resolved
- **Section:** External
- **Area:** Native host-test fixture preparation / Expo autolinking
- **Impact:** A fresh NativeNavigation iPad simulator build fails before app launch, blocking native navigation acceptance.
- **Evidence:** On 2026-09-26, named `test-host ios --app native-navigation` run `0f1c8d32-06ef-4014-98b7-6be5272c866d` failed in CocoaPods post-install: React Native's SPM manager tried to attach ClerkKit/ClerkKitUI to a missing pod target (`undefined method 'package_product_dependencies' for nil`). The three host subjects do not use authentication. On `feat/ipad-navigation-appearance`, generated fixture manifests now exclude only `@clerk/expo` from iOS autolinking. The host controls lane verifies unchanged production manifest bytes and dependencies. Retry `ff1cacd4-2c05-43db-8068-40ea12439691` completed CocoaPods, native compilation and the three-stack Appium journey on the iPad simulator with native host receipts.
- **Workaround:** Catalyst already excludes the unused module in its isolated generated Podfile. Do not alter installed packages or dependency versions.
- **Proposed change:** Keep the exclusion in each isolated non-auth fixture manifest through Expo's supported `expo.autolinking.ios.exclude` configuration; retain existing configuration and dependency declarations. Production/auth app hosts remain unchanged.
- **Dependencies:** None.
- **Acceptance:** Generated fixture test passes with production manifest unchanged; a fresh named iOS host build completes after the exclusion. Physical installation remains separate evidence.
- **Source:** iPad navigation follow-up, 2026-09-26.
- **Archived:** 2026-09-26
