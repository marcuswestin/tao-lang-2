# Generated native bindings proof of concept

## Implemented boundary

The experimental `tao bridge` command imports **both Expo and React Native** through separate source
adapters. Both currently read installed public TypeScript declarations using Tao's existing TypeScript
compiler API. They feed a common catalog and one Tao/TypeScript emitter. No dependency was added.

The first surfaces are `expo-haptics` 57.0.3 (all four functions and all 27 enum cases) and React Native
0.86.3 `Vibration` (`vibrate` and `cancel`). There is no handwritten Haptics binding, per-case mapping,
default table or call into the curated `TR.Haptic` implementation. Tests supply an independent native
boundary oracle; application bindings are regenerated directly from installed declarations.

The catalog records package/version, resolved declaration, a hash of reached declarations in that
package, enums and constant values, operations, parameter types/optionality, async completion, and
platform tags. It excludes prose documentation and hashes of external dependency declarations.
The emitter preserves object receivers, translates exact Tao enum identities through upstream enum
exports, omits absent trailing arguments, and returns native promises to existing Tao action handling.

The TypeScript resolver follows public reexports and the importing project's compiler conditions.
The source adapters do not inspect rendered HTML. Expo's documentation generator already reads TS
with TypeDoc; its processed JSON is useful supplemental data but loses some symbol identity/import
context. React Native's public declarations are a better callable contract than its handwritten API
pages or native Codegen schemas. See Expo's [documentation generator](https://github.com/expo/expo/blob/d604db1f29009bf5979d1907a2988f016dec26e2/tools/src/commands/GenerateDocsAPIData.ts)
and React Native's [package exports](https://github.com/facebook/react-native/blob/main/packages/react-native/package.json).

## Tao changes and examples

No new syntax is required for Haptics. The existing parser/compiler already support nullable
parameters, enum cases, defaults, foreign actions and awaited `Promise<void>` completion. The type
resolver was dropping `?` on parameter declarations; this slice repairs that omission for named and
shorthand parameters, retaining the existing rule that omission requires a default.

Generated declarations include:

```tao
public action ImpactAsync(Style ImpactFeedbackStyle? default none) from ./Bindings.ts
public action NotificationAsync(Type NotificationFeedbackType? default none) from ./Bindings.ts
public action PerformAndroidHapticsAsync(Type AndroidHaptics) from ./Bindings.ts
public action SelectionAsync() from ./Bindings.ts
```

Usage covers each API kind and both defaulted calls:

```tao
use SelectionAsync, ImpactAsync, NotificationAsync, PerformAndroidHapticsAsync,
   ImpactFeedbackStyle, NotificationFeedbackType, AndroidHaptics from ./Bindings.tao

action Feedback() {
   do SelectionAsync()
   do ImpactAsync()
   do ImpactAsync(Style: Rigid)
   do NotificationAsync()
   do NotificationAsync(Type: Success)
   do PerformAndroidHapticsAsync(Type: Segment_Frequent_Tick)
}
```

Defaulted parameters require labels when overridden. `default none` preserves absence instead of
copying documentation's Medium/Success defaults. Native enum values come from enum exports rather
than assumptions that Tao cases are strings. The existing curated `@tao/device` Haptic remains a
separate portable convenience API.

## Evidence and remaining work

Tests were written before the generator and initially failed because it did not exist. The optional
parameter regression also failed before its correction. Generation tests compile/check untouched
generated Haptics and RN files, verify full Haptics coverage and deterministic output, reject unsupported
signatures, follow public reexports, and exercise the CLI's refusal to overwrite output. Runtime tests
exercise all Haptics values, actual omitted arguments, promise ordering and contained native failure
through the compiled Tao program. Native package behavior is mocked only at its module boundary.

This does not prove physical haptic feedback or linking on iOS/Android, nor the packaged CLI's resource
layout. No dependency or native host configuration changed. Unsupported exported values fail the CLI
instead of producing a silently incomplete binding. Current support excludes result-bearing actions,
records, callback subscriptions, overloads, generic functions and complex unions.

Recommended next slices:

1. Run the generated Haptics fixture on iOS and Android; verify each supported platform's real behavior
   and deliberate unsupported-platform outcomes. Preserve raw upstream semantics in this import layer.
2. Add records and result-bearing APIs with one representative module. Decide the Tao outcome/resource
   surface before hiding a result in mutable state. Then add callbacks with explicit disposal/lifetimes.
3. Add regeneration/diff review for locked package versions and persistent naming policy. Check compiler
   condition and dependency provenance, source licensing, and shipped CLI packaging before broad rollout.
4. Add an Android metadata reader only when its invocation backend is chosen. The source-neutral catalog
   permits a new reader; direct Kotlin/Java calls also require a backend and packaging/linking support.

## Community project assessment

Snapshot from GitHub REST at **2026-09-26 16:03 UTC**. Contributors are cached associated GitHub
accounts (including bots, excluding anonymous authors), not active human maintainers. Commits are
default-branch totals including merges and dependency chores. Stars/forks indicate attention, not use.

| Project                                                                                               |  Stars | Forks | Contributors | Commits 30d / 90d | Assessment                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | -----: | ----: | -----------: | ----------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| [NativeScript](https://github.com/NativeScript/NativeScript)                                          | 25,655 | 1,738 |          255 |          64 / 166 | Active framework; latest core release September 14. Study platform metadata for later native readers.                          |
| [Nitro](https://github.com/margelo/nitro)                                                             |  1,953 |   117 |           47 |          41 / 104 | Active; latest stable release August 27. Useful native backend reference, not an arbitrary Expo/RN importer.                   |
| [ts2fable](https://github.com/fable-compiler/ts2fable)                                                |    233 |    35 |           16 |            4 / 20 | Recent commits are dependency maintenance. Stable npm release remains from 2020; mapping/tests are useful references.          |
| [ReScript Bindgen](https://github.com/juspay/rescript-bindgen)                                        |      9 |     0 |            3 |            9 / 80 | Small, active since June 2026; real extractor fixes. Closest checker/IR/emitter reference, presently React-component oriented. |
| [React Native–NativeScript prototype](https://github.com/shirakaba/react-native-nativescript-runtime) |     18 |     0 |            1 |             0 / 0 | Last commit September 2021; README still describes an incomplete bridge. Historical inspiration only.                          |

NativeScript's old standalone [ios-metadata-generator](https://github.com/NativeScript/ios-metadata-generator)
repository is dormant (10 stars, 3 forks, 8 contributors; last commit May 2020). The maintained
[NativeScript iOS runtime](https://github.com/NativeScript/ios) has 150 stars, 43 forks, 25 contributors,
18/96 commits over 30/90 days, and recent metadata-generator fixes. The old repository alone gives the
wrong impression about current metadata work.

Use Tao's existing TypeScript compiler API directly. Learn from ReScript Bindgen's checker-based
resolution, naming manifest, diagnostics and compilation tests, and ts2fable's mapping fixtures.
Neither emits Tao or supplies its enum identity/runtime semantics. Nitro's HybridObject authoring and
NativeScript's runtime would add a different integration boundary; neither is needed for this PoC.
ReScript Bindgen stable 1.3.0 accepts TypeScript ^5.6.0; its current beta/main requires ^6.0.3, unlike
Tao's installed 5.9.3. No upstream library was installed or claimed to be execution-compatible.

Primary evidence: linked project sources, [ts2fable package history](https://registry.npmjs.org/ts2fable),
[ReScript Bindgen package history](https://registry.npmjs.org/@juspay%2frescript-bindgen), and GitHub's
[contributor endpoint caveats](https://docs.github.com/en/rest/repos/repos#list-repository-contributors).
The task-local research archive retains exact API URLs, pagination headers and response snapshots.
