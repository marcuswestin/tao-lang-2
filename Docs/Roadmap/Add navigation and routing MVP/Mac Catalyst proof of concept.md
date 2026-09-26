# Mac Catalyst proof of concept

This is an isolated, local trial authorized after the earlier unchanged-module experiment.
It is not production Catalyst support, physical mobile acceptance, or release authorization.
The branch starts at navigation implementation `1f2710f221844d0ebe0058440dd00c39d83f8687`.

## Reproduce

From the repository root:

```sh
./agent unsandboxed test-host catalyst --app native-navigation
./agent unsandboxed test-host catalyst --app hnreader
```

Each invocation retains inputs, command receipts, an Xcode result bundle and, when successful,
`NativeNavigation.app` or `HNReader.app` under `.artifacts/catalyst/<run-id>/`.
The HNReader trial uses the existing deterministic `HNReaderStub` host subject.
Build completion requires the binary to report `MACCATALYST` and the bundle to declare Mac device
family 6. The visible runtime receipt must additionally report Catalyst and the Mac interface idiom.
The existing native navigation receipt must report mounted tabs and stack for NativeNavigation,
or mounted stack for HNReader; any fallback permanently invalidates that process's receipt.

## Configuration and patch inventory

| Item                         | Trial change                                                                                                        | Production implication                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target                       | Mac Catalyst, Mac device family 6 (Optimize Interface for Mac), existing Apple Development identity, Release bundle | Local builds require exactly one available development identity. Distribution signing, entitlements and supported Mac versions need their own support proposal. |
| Deployment                   | Trial build explicitly supplies iOS 16.4 / macOS 13.3                                                               | Existing mobile project settings are unchanged; the trial does not establish minimum-version runtime acceptance.                                                |
| Expo modules                 | Source-module build mode; CocoaPods Catalyst post-install enabled                                                   | Pinned precompiled Expo frameworks were unsuitable for this target in the earlier trial.                                                                        |
| React Native                 | Supported `RCT_USE_RN_DEP=0` and `RCT_USE_PREBUILT_RNCORE=0` source-build switches                                  | The first compiled trial reached signing, where the pinned prebuilt React framework's flattened directory layout was rejected as ambiguous.                     |
| Unused authentication module | Generated Podfile excludes `@clerk/expo` from native autolinking                                                    | These two fixtures do not exercise auth; no auth compatibility claim. Manifest remains byte-identical.                                                          |
| Slider 5.2.0                 | Copied package only: private `_isSliding` ivar changes from `BOOL` to `bool`, matching its property                 | Exact version/hash guarded. Upstreaming or replacing this maintained patch is needed before support.                                                            |
| Screens 4.26.2               | Copied package only: tile Catalyst sidebar and size its direct child stack from the native pane                     | Exact version/hash guarded; must maintain or upstream the native/Fabric adaptation. Other parent hierarchies are outside this patch.                            |
| Native tabs                  | Existing iPadOS 18+ tab/sidebar selection also recognizes `Platform.isMacCatalyst`                                  | Focused regression preserves iPhone and older-iPad mode selection. No Tao navigation semantic change.                                                           |
| App menu                     | Generated AppDelegate adds File → Save note / Command-S                                                             | Fixed-fixture label/class lookup is experimental; production needs command identity and availability design.                                                    |
| Diagnostics                  | Generated entrypoint adds actual Catalyst/interface-idiom text beside native-host evidence                          | Trial instrumentation, not production chrome.                                                                                                                   |

The slider and screens patches and primary-source provenance live in
`packages/testing/e2e-testing/native/catalyst/`. The reviewed 5.2.1 and upstream main still have the
same property/ivar mismatch. The property and underlying slider already use `bool`; assigning
`YES`/`NO` retains boolean behavior. Shared installed sources are never patched.

The menu resolves the current visible, enabled native Save item again at dispatch and forwards its
target/action. This reaches the existing react-native-screens event callback and Tao interaction
binding. Presented controllers, transitions and ambiguous matches disable dispatch. This adds no
direct state mutation, command syntax, router or restoration behavior.

## Evidence and acceptance

Build, runtime, visual and developer appearance acceptance are separate. No appearance acceptance
is inferred from compilation or the focused mobile regression.

On 2026-09-26, run `f1360b84-d74d-4667-8334-509753325f36` built and locally signed NativeNavigation
with Xcode 27. Both arm64 and x86_64 Mach-O slices report `MACCATALYST`; the bundle declares device
family 6. Source-integrity and generated-manifest receipts confirm unchanged protected inputs.
The source was `1f2710f2` plus this branch's pending trial changes, retained in `source-diff.log`
and `CatalystBuild.ts` beside the generated native inputs and compiled-app digest.

### Launch repair and runtime observations

Manual launch of the original `NativeNavigation.app` **failed** before Tao started on macOS
27.0 (26A428), Mac17,6. DYLD rejected the embedded `ExpoModulesJSI` signature: ad hoc signing
passed static verification but lacked a team identity for Hardened Runtime library validation.
The original app, `launch-failed.ips` and `launch-failed.png` remain in the run directory.

The workflow now uses an existing Apple Development identity and retains Hardened Runtime.
The separately copied `NativeNavigation-development.app` launched successfully through computer
control. Both app and embedded framework report the same development team. Visible receipts read
`Catalyst: true · Interface: mac` and `Native navigation host: tabs and stack`.
Temporary diagnostic variants are separate copies; they are not the final review app.

Observed on the development/diagnostic variants:

- Native title, Back and sidebar selection work. Returning from Library to a Notes detail retained
  its tap counter; Library retained its visit counter.
- Empty draft disables Save. Toolbar Save clears the draft and updates the saved text.
- File → Save note and Command-S work after accounting for Catalyst's native Mac toolbar: a
  `UINavigationBar` adapted into `NSToolbar` is not itself a visible UIKit bar. Validation now uses
  its nonempty `currentNSToolbarSection` for `.mac` behavior, retaining the current-item guards.
- More orders Show overlay before Confirm note. Sheet opens with the editor focused. Command-S
  while the sheet is open leaves the draft unsaved. Overlay dismissal leaves its covered sheet
  present, then the sheet closes explicitly.
- Confirmation blocks tab changes and Command-S. Approve changed the counter from zero to one;
  Cancel retained that count and the draft, with normal controls restored.
- A focused editor accepted individual/short typed input (`a`, then `bcd`). Bulk paste timed out in
  computer control and earlier bulk typing was incomplete; ordinary manual editing remains open.

### HNReader smoke

Run `515157cc-1905-4dd3-8d94-704b3206e316` built `HNReader.app` using the corrected workflow.
Actual launch showed Catalyst/Mac and native stack receipts. Both deterministic stories opened and
native Back returned to the list. Reading showed two opened stories. Quitting and launching a
fresh process retained those two entries. This proves the tested history persistence smoke, not
arbitrary route restoration, network behavior, or chronological ordering with the fixture clock.

### Current review builds

The clean navigation app is retained at:

```text
.artifacts/catalyst/6922415c-ddea-4e2f-9993-957d889a22d5/NativeNavigation.app
```

Its first build compiled the native patch, then failed JavaScript bundling because the copied
screens package no longer resolved its installed `warn-once` dependency. The workflow now retains
links to its existing declared dependencies (`warn-once` and `react-freeze`) inside the owned copy;
versions and manifests are unchanged. The named Xcode retry retained
`Dependency-links-retry.xcresult` and built the app. Recursive strict signature verification passed,
both binary slices report Catalyst, and actual launch again reported Mac idiom and native tabs and
stack. The original failed receipt is preserved separately from this retry.

Fresh HNReader run `ffc68857-0999-420e-9986-077a26cf439b` completed the whole corrected build
workflow, including source-integrity and signature checks, producing `HNReader.app`. This latest
copy has not been launched; the runtime/restoration observations above belong to the earlier build.

Launch either review app only when ready for a visible window:

```sh
open '.artifacts/catalyst/6922415c-ddea-4e2f-9993-957d889a22d5/NativeNavigation.app'
open '.artifacts/catalyst/ffc68857-0999-420e-9986-077a26cf439b/HNReader.app'
```

Fullscreen in the earlier screenshots was an explicit expanded-layout test, not an application
launch requirement. It was exited; the clean review app launched windowed. Interactive checks were
then stopped when the developer requested quiet desktop workflows. No window-manager or system
appearance settings were changed. Remaining visible checks are manual until review is convenient.

### Unresolved layout and appearance

With the sidebar shown, its 220-point width covers the leading content. Native measurements show
that the selected tab's safe area includes that inset while the Fabric content still spans the
complete tabs host. Hiding the sidebar reveals the content. An explicit `.tile` experiment moves
content into the correct pane but leaves the nested stack at the original width, clipping its
trailing edge. The isolated screens patch now synchronizes the direct child stack with its native pane. It
compiled and the clean app launched with native hosts; its repaired edges and resizing still await
manual review. The earlier defective variants are not accepted for sidebar layout.

The generated host currently forces light appearance. Dark adaptation is not accepted. The
transparent overlay places its labels close to the covered sheet's labels and needs appearance
review. Compact window chrome may move direct commands into the system toolbar overflow.

Initial preparation failures were configuration errors: system Ruby lacked CocoaPods' `xcodeproj`
gem, and generated pod targets defaulted to macOS 10.15, rejected by Xcode 27. Project settings now
run within CocoaPods' Ruby environment and the trial explicitly supplies its deployment targets.
The failed runs retained source-integrity receipts confirming protected inputs were unchanged.

The prebuilt React framework signing failure matches
[upstream React Native issue 55540](https://github.com/react/react-native/issues/55540): materialized
duplicates replace the versioned framework's expected symlinks. The trial uses the
[documented source-build switches](https://reactnative.dev/blog/2026/02/11/react-native-0.84)
for both React Native core and dependencies, preserving the pinned versions and avoiding an
additional experimental framework-packaging patch.

Pending review includes the repaired compact/expanded sidebar layout, keyboard-only use and manual
editing, final-app screenshots, and light/dark appearance. The developer's visual judgment is
required before appearance is accepted.

## Retention

Trial directories are task-owned and retained for launch and diagnosis. Remove an individual run
directory only when its app/build processes are inactive and its evidence and runnable app are no
longer needed. Standard tool caches remain owned by their tools. No publishing, notarization or
distribution is part of this workflow.

## Current verdict

Working with named limitations: local Catalyst compilation, launch, native navigation and a useful
menu command are established. Appearance is not accepted. The repaired sidebar layout, ordinary
manual typing, keyboard-only operation and final compact/expanded/detail/overflow/sheet screenshots
remain under review; dark adaptation is not implemented by this trial. Earlier inline captures
show the diagnostic variants, not acceptance of the final layout patch.

Production support appears moderate in effort: two isolated native compatibility patches, source
build configuration and development signing made the host viable without a renderer change, but
command identity, native/Fabric layout coverage, desktop focus/accessibility, appearance and supported
OS validation need a production design and test matrix. This is an assessment from this trial, not
a production-support commitment.
