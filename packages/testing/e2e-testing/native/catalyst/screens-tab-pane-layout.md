# Experimental Catalyst tab pane adaptation

This patch applies only to an isolated copy of `react-native-screens` 4.26.2. The helper verifies both original and replacement SHA-256 digests, retains the exact patch, and records source integrity. Package declarations and shared dependency sources are unchanged. The copied package retains links to its existing Bun-installed declared dependencies; peers resolve through the host.

The trial measured a 220-point sidebar safe-area inset with automatic layout. Explicit tiled layout moved the selected tab pane correctly and reduced its width, but its direct `RNSScreenStackView` retained the full-window width. Native view diagnostics confirmed that the stack is an immediate child of `RNSTabsScreenComponentView` in this fixture.

The Catalyst-only adaptation selects tiled sidebar layout and synchronizes that direct child stack with its native parent's bounds on attachment, native layout, and Fabric layout updates. Flexible autoresizing handles pane resizing. Moving the stack elsewhere restores its previous autoresizing mask. Existing screen bounds publication remains responsible for laying out React descendants. No public prop or navigation action changes.

Pointer diagnostics then found a separate horizontal measurement discrepancy: an inside-button pointer at page X 771.5 was compared with a shadow-measured right edge of 605, omitting the native pane's 220-point translation. The patch computes the tab pane's native origin in its original React parent's coordinates, subtracts its Fabric origin, and publishes that difference through the existing screen state's horizontal content offset. It requires both views in the same window and applies only when the screen's navigation controller belongs directly to a tab screen. Nested stacks inherit the outer screen's correction rather than adding it again. Existing vertical offsets and non-Catalyst behavior are preserved.

The retained push screens' vertical Yoga positioning is a separate runtime adapter correction. This native patch does not change press retention, synthesize interactions, or bypass movement cancellation.

## Primary sources

- [Apple sidebar layout](https://developer.apple.com/documentation/uikit/uitabbarcontroller/sidebar-swift.class/layout): tiled layout shifts and resizes the selected controller alongside the sidebar.
- [Apple preferredLayout](https://developer.apple.com/documentation/uikit/uitabbarcontroller/sidebar-swift.class/preferredlayout): supported UIKit configuration seam.
- [Screens 4.26.2 stack implementation](https://github.com/software-mansion/react-native-screens/blob/4.26.2/ios/RNSScreenStack.mm): the navigation controller takes the stack view's bounds.
- [Screens 4.26.2 screen implementation](https://github.com/software-mansion/react-native-screens/blob/4.26.2/ios/RNSScreen.mm): native screen sizing is published to shadow state.

## Acceptance boundary

Experimental: native compilation and clean-app launch observed; repaired pane edges and resizing remain pending running-Mac UI validation. Confirm both leading and trailing content edges, sidebar hide/show, window resizing, tab changes, text editing followed by a Fabric update, push/Back, and modal presentation/dismissal. A successful patch or build is not that acceptance. The direct-parent guard deliberately does nothing for different native hierarchies; do not generalize it to arbitrary ancestors without another measured case.

The horizontal correction compiled and passed the reproduced pointer checks on a diagnostic Mac build: an inside pointer at X 771.5 measured against the corrected right edge 825 and activated once; moving outside vertically canceled. Hiding and restoring the sidebar changed the measured left edge from 248 to 28 and back, with inside presses succeeding each time. Root/detail controls, tab state retention and Back/re-push were checked. The developer confirmed tapping works on the final clean build. Narrow controls and window resizing remain separate acceptance. This scoped correction covers tab-owned native stacks, not arbitrary content placed directly in a tab.
