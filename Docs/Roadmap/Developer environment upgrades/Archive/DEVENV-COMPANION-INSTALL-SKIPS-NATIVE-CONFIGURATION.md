# DEVENV-COMPANION-INSTALL-SKIPS-NATIVE-CONFIGURATION — Companion install skips native configuration

- **Status:** Resolved
- **Area:** Companion installation, Expo config plugins, CocoaPods
- **Impact:** Installing a newly added native package could reuse stale iOS project settings and fail before reaching the phone.
- **Evidence:** On 2026-09-26, `studio-companion-install --device roPhone` failed in React Native's SPM integration with `undefined method 'package_product_dependencies' for nil`. Companion lacked the Clerk Expo plugin, leaving iOS16.4 below ClerkExpo's required17.0; the pod was excluded after registering Swift package products. On `feat/clerk-follow-through`, adding the plugin and refreshing native settings made the same CocoaPods step complete and include ClerkExpo.
- **Workaround:** None needed after the repair; rerun the install command.
- **Proposed change:** The named install command now runs Expo prebuild and CocoaPods before `run:ios`, preserving the existing no-Metro behavior and stopping immediately on preparation failure. Companion config enables Clerk's required native settings with Apple Sign In disabled for this email/password review.
- **Dependencies:** Existing pinned Clerk and Expo packages; no version changes.
- **Acceptance:** Focused tests assert preparation order and failure propagation. Reversing the order or ignoring preparation failure breaks the tests. The real phone build passed the formerly failing CocoaPods stage; physical application behavior is a separate auth acceptance item.
- **Source:** Clerk and InstantDB iPhone review preparation, 2026-09-26.
- **Archived:** 2026-09-26
