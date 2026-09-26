# Slider Catalyst trial patch

## Scope and verified source

Checked on 2026-09-26 in this worktree. Installed
`packages/apps/expo-host/node_modules/@react-native-community/slider/package.json:3`
reports version **5.2.0**. Its `ios/RNCSliderComponentView.h:18` declares
`@property (nonatomic, assign) bool isSliding`, while
`ios/RNCSliderComponentView.mm:26` declares `BOOL _isSliding`.
`ios/RNCSlider.h:13` also declares its separate slider property as `bool`.

The installed package is a symlink into
`node_modules/.bun/@react-native-community+slider@5.2.0/node_modules/@react-native-community/slider`.
Apply `slider-bool.patch` only to a task-owned physical copy of the package,
using the copied package root as the patch root. Do not write through the
installed package symlink or modify shared package storage. This artifact does
not change a dependency version, manifest, lockfile, or installed source.

## Provenance and upstream status

This is a locally derived one-line compatibility patch, not an upstream
backport. The source inspected in upstream main and release 5.2.1 retains the
`bool` property / `BOOL` backing-ivar mismatch:

- [Main header](https://raw.githubusercontent.com/callstack/react-native-slider/main/package/ios/RNCSliderComponentView.h)
- [5.2.1 header](https://raw.githubusercontent.com/callstack/react-native-slider/v5.2.1/package/ios/RNCSliderComponentView.h)
- [5.2.1 implementation](https://raw.githubusercontent.com/callstack/react-native-slider/v5.2.1/package/ios/RNCSliderComponentView.mm)
- [5.2.1 release](https://github.com/callstack/react-native-slider/releases/tag/v5.2.1)

At the check date, the GitHub API's latest-release response identified 5.2.1;
its release note concerns thumb-image rendering on React Native 0.84+.
Repository issue/PR searches for `catalyst` returned no items; `isSliding`
returned unrelated historical issues. These bounded checks found no published
fix for this mismatch; they do not prove that no unindexed discussion or other
branch contains one.

## Type and behavior rationale

Objective-C property synthesis requires the property and backing ivar types to
agree. When the Catalyst target defines `BOOL` as `signed char`, it differs from
the property's `bool`. Changing the private ivar to `bool` makes the types agree
and preserves the public accessor declaration. The installed implementation
assigns `YES` at line 120 and `NO` at line 128, copies the value to another
`bool` property at line 69, and checks it as a condition at line 72. Those Boolean
values and branches retain their meaning. The patch does not alter event
ordering, slider arithmetic, or the public property's type. Ordinary iOS builds
continue to use the same Boolean state semantics.

## Suggested validation

1. Verify the copied package still reports 5.2.0 and the exact patch context
   matches before applying. Require application without fuzz or offsets.
2. Check that the installed package source remains unchanged after patching the
   physical trial copy, and that the trial build resolves the copied source.
3. Compile the patched component for the failing Catalyst target. Confirm the
   synthesized-property type error disappears; report later errors separately.
4. Compile the ordinary iOS target to check source compatibility.
5. Exercise dragging, drag cancellation/release, and tap-to-seek in the trial
   app, checking value updates and start/complete events. Compilation alone
   does not establish runtime interaction acceptance.

No compile or runtime validation was performed during this provenance task.
