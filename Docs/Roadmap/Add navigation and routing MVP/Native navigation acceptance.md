# Native navigation acceptance

Implementation and native acceptance are separate. The original acceptance order was iPhone,
iPad, bounded Mac Catalyst feasibility, then Android compatibility. A subsequent authorization
started a separate [Mac Catalyst proof of concept](<Mac Catalyst proof of concept.md>) allowing
small isolated compatibility patches. That experiment does not close outstanding Apple mobile
acceptance or invalidate its completed evidence.

## Implemented scope

- The locked `react-native-screens` 4.26.2 `Tabs.Host`/`Tabs.Screen` contract replaces obsolete
  exports. Stable item keys retain each subtree; native provenance rebases requests and filters
  duplicate/stale notifications. Programmatic acknowledgements never invoke selection commands.
- Repeated selection preserves stack and scroll state. Native selection and stack dismissal are
  prevented while overlays or asked dialogues own interaction.
- Covered page sheets disable native swipe dismissal; stale iOS callbacks cannot remove a later
  layer. Android modal Back removes one semantic layer at a time.
- iOS stack headers use native button/menu descriptors, with two direct commands and an ordered
  `More` suffix. Live command bindings preserve identity, enabled state and current callbacks.
- iPadOS 18+ automatic tabs request system tab/sidebar mode. The generated app host and Companion
  support tablets. Existing logical `SplitNav` behavior is unchanged.
- Android icons reuse the portable mapping. More than five destinations select the complete basic
  surface with a structured warning. Native-host acceptance rejects any fallback.
- Android native headers use system scalar foreground/background colors and portable icon controls
  with 48dp targets. Unsupported icons retain labels; the overflow remains a portable menu.
- Responding-view dismiss handlers may interrupt the suspended ask they settle, as response
  handlers already do, including statically resolved delegated actions; ordinary content dismiss
  actions retain their existing serialization.
- Authored scroll views preserve taps handled by their child controls while the keyboard is open,
  matching the app frame. Drag dismissal uses the platform convention; supplied native props win.
- No new syntax, dependencies, lockfile changes, router or minimum OS change. The explicit basic
  tier and glass toggle remain available. Companion and generated apps retain the same pinned native
  module versions; a rebuilt binary is required for native host configuration changes.

## Deterministic evidence

The Navigation project's `NativeNavigation` fixture has three independent stacks, reactive toolbar
commands, sheet, overlay, asked confirmation, editable content, scrolling and restoration journeys.
The pinned exports are loaded in the Expo test environment, and structural runtime ports are checked
against the real package's types without importing mobile ambient globals into server consumers.

Focused regressions cover event ordering, rejected requests, repeated selection, stale callbacks,
multi-pop/dismissal idempotence, overlay/ask prevention, per-tab lifetime, bitmap loading races and
fallback diagnostics. Mutation checks deliberately break provenance filtering, tab keys, callback
refresh, pop counts, native prevention and bitmap cancellation. These are adapter/semantic proofs,
not visual or device acceptance.

`./agent unsandboxed test-host ios|android --app native-navigation --device <id>` runs the first
authored three-stack journey against a Release app. A process-local receipt brackets the journey
and requires mounted native tabs and stack, with fallback permanently invalidating that process's
receipt. Other fixture journeys run through deterministic Tao tests; the first automated native
journey does not establish gesture, menu, sheet or accessibility acceptance.
HNReader's native stack smoke also requires a mounted-stack receipt. Receipt assertions surround
each relaunch so restarting cannot erase a prior process's fallback failure.

## Platform evidence and remaining work

| Platform | Current result                                                                                                                         | Remaining acceptance                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone   | Native three-stack simulator journey and HNReader smoke passed; physical installation/launch confirmed separately.                     | Physical Liquid Glass, gestures, menus, sheets, keyboard/insets and accessibility review.                                                                                                         |
| iPad     | Native three-stack simulator journey passed with tab/sidebar controller mode.                                                          | Inline title visibility, compact/expanded windows, rotation, sidebar switching, pointer, keyboard, VoiceOver and sheet/menu placement.                                                            |
| macOS    | **Working with named limitations**: Catalyst/Mac native hosts, Save menu/shortcut and HNReader history smoke observed.                 | Repaired sidebar sizing, manual typing, keyboard-only and appearance review; dark adaptation unimplemented. See the separate proof-of-concept record for build-specific evidence.                 |
| Android  | **Working with named limitations**: Release emulator journey passed with native tabs/stacks, ordinary Back and retained per-tab state. | Portable toolbar/menu and modal fidelity; root exit, keyboard-dismissal precedence, modal precedence, relaunch/background/resume, predictive Back and physical-device acceptance remain unproven. |

The successful iPhone run was `8c7a2f77-2418-482e-8f2c-507557ea2754`; its source-linked event
receipt and screenshot are preserved under `.artifacts/native-navigation-evidence/iphone-proof.json`
and `iphone.png`. HNReader also passed its native-stack journey, including relaunch and reading-history
restoration, in run `30131cd6-6ba9-4750-bea9-5ea22e817fb3` (`hnreader-proof.json` and `hnreader.png`).
This follows a real failure where the authored nested scroll view consumed the
first button tap to dismiss the keyboard. After applying the app frame's handled-tap default to
authored scroll views, the unchanged three-stack journey passed.

The initial iPhone run was `3e575a29-922b-4de3-b77b-c05e34632c7e`, using iPhone 17 Pro
`8A15CD89-8F42-4AB4-A80D-B9C5A5C98AC7` and Xcode 27. The runner initially pruned its oversized
failed build together with its screenshot; evidence-retention repair precedes a diagnostic rerun.
The physical roPhone and iPad were unavailable at the initial device probe. Installation alone
will not close their UI acceptance. Direct Device Hub computer control was not approved in this
session; no consent bypass is part of the workflow.

The later physical iPhone run `f1ebb2a5-acf6-4076-bd03-6961ef7d3de7` successfully built and signed
a Release app, but its wrapper timed out after 90 seconds without output while connecting to
roPhone. A subsequent named device-app inventory found the exact run-scoped bundle identifier, and
the named device-launch operation succeeded. The receipt remains failed; separate inventory/launch
evidence establishes installation, not UI acceptance. This snapshot preceded the final multi-pop,
covered-sheet and scroll keyboard fixes. The physical iPad remained unavailable.

The final implementation was rebuilt and installed successfully on roPhone in run
`c532ca18-8e48-43d6-a817-aefa8db53e83`; its installation receipt is preserved as
`.artifacts/native-navigation-evidence/physical-install-final.json`. The named device-launch
operation then launched `dev.tao.taohostnativenavigationc532ca188e4843d6a817aefa8db53e83` successfully.
This replaces the earlier snapshot for subsequent manual review, but still does not establish
physical-device UI acceptance.

Every Apple mobile acceptance pass still needs light/dark appearance, large text, long labels, RTL,
VoiceOver, reduced motion/transparency and increased contrast. Native appearance inherits system
settings; deterministic prop assertions cannot prove the resulting visibility or focus behavior.

On iPhone, two long text-only direct commands plus `More` exhausted UIKit's navigation-bar title
space. The fixture now uses its existing icon metadata for the two direct commands and retains
their accessibility labels. Applications with long text-only commands retain this layout limitation;
the fixed two-direct-command policy does not guarantee a visible title at every text size.

The first iPad run `b7ef396d-b680-4950-a92b-4cc1fa986385` mounted native tabs and stack and displayed
UIKit's top tab/sidebar control, but its inline root navigation title was absent. Apple documents
that [iPad tabs share navigation-bar space](https://developer.apple.com/documentation/uikit/elevating-your-ipad-app-with-a-tab-bar-and-sidebar);
that does not by itself prove this omission is intended. The missing inline title remains a
presentation limitation. The shared native state-retention journey now identifies pages by their
existing content, leaving title assertions in the separate semantic/restoration journeys. Passing
that interaction journey does not close the title-visibility issue. Run
`0d3a130f-d272-418d-92b6-8419140caa09` passed; `ipad-proof.json` and `ipad.png` preserve the event
record and resulting native screen under `.artifacts/native-navigation-evidence/`.

Android's first run exposed uppercase native button text; the driver now resolves exact authored
button accessibility labels without weakening text assertions. Subsequent runs exposed immediate
lookups during native transitions. Press and input readiness use the existing bounded assertion
budget; dispatched interactions are never retried. The Settings detail assertion subsequently
passed, ruling out the initially suspected swallowed button tap in that flow. The header color
repair uses scalar `colorForeground`: the pinned React Native resolver does not decode the
`textColorPrimary` color-state-list attribute correctly. Screenshot `android-latest.png` shows
visible native title/Back chrome after that repair. These corrections do not establish dark-mode
or accessibility acceptance.

Android run `09e705e7-6449-4bc4-b8f3-1d6e81fa3f4d` passed on the API 36 emulator `emulator-5554`.
`android-proof.json` and `android.png` retain the source-linked journey and final Notes screen under
`.artifacts/native-navigation-evidence/`. All three native stacks preserved their positions,
counter and drafts; hardware Back returned to each root. The screenshot confirms readable title
and portable toolbar icons, plus the native Material tab bar. Its top diagnostic banner overlaps
the system status area; that is test-wrapper instrumentation, not acceptance of production insets.
The trial did not exercise portable overflow invocation or modal/sheet appearance on Android.
Semantic modal precedence and restoration remain covered by deterministic journeys, not this
emulator receipt. No physical Android device was available. Native Material menus/sheets, rails,
system predictive Back and interactive in-stack prediction are not claimed by this result.

## Bounded platform gates

Catalyst is the only first candidate. The pinned React Native scripts contain Catalyst post-install
and bundle support, and Hermes includes Catalyst framework build support. Expo's generated Podfile
defaults `mac_catalyst_enabled` to false and precompiled frameworks need compatible slices. This is
a build-configuration investigation, not proof that all pinned modules support Catalyst. Stop if
success requires a renderer change, React Native macOS, dependency forks, substantial native-module
edits or a desktop navigation redesign. A webview shell or an iPad app merely running on Mac does
not satisfy the gate. Native Mac chrome, usable menus, keyboard and window resizing must all be
reviewed after a successful build.

The earlier unchanged-module Catalyst attempt enabled `SUPPORTS_MACCATALYST`, CocoaPods' Catalyst post-install mode,
an iOS 16.4/Catalyst 13.3 deployment target in the isolated trial target, and Expo's supported
source-module build switch because its precompiled Expo frameworks lacked Catalyst slices. React
Native and Hermes already supplied Catalyst slices. The source build then failed in the unchanged
`@react-native-community/slider` 5.2.0: `RNCSliderComponentView.h` declares `bool isSliding`, whereas
`RNCSliderComponentView.mm` declares its synthesized `_isSliding` ivar as `BOOL` (`signed char` on
Catalyst). This fails the requirement that pinned native modules build unchanged. No dependency
source, manifest or lockfile was modified. Build evidence is retained in the task-local
`.artifacts/native-navigation-catalyst/Build-expo-source.xcresult` and `conclusion.md`.

The later authorized proof of concept uses a task-owned copy of the pinned slider with a one-line
type correction. Its separate record owns the new build and UI evidence; the historical failed
trial above remains valid for the stricter unchanged-module requirement.

Android results must report tabs/stacks, toolbar/menu fidelity and sheet behavior separately.
The iOS descriptor API is not an Android toolbar implementation; current Android commands remain
portable and iOS page-sheet hosting does not establish a Material sheet. Ordinary hardware Back,
system predictive Back and interactive in-stack prediction are distinct evidence. Full predictive
Back, native rail adaptation and additional Material controls remain follow-ups under the pinned
stack. End the trial with working, working with named limitations, or blocked; do not expand it into
a platform rewrite.

Search tabs, badges, accessories, custom minimization, large-title controls, richer detents,
navigation guards and public routes remain deferred. Landing and publication require separate
authorization.
