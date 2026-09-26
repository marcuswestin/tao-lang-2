# Generated native bindings proof of concept

## Implemented boundary

The experimental `tao bridge` command imports **both Expo and React Native** through separate source
adapters. Both currently read installed public TypeScript declarations using Tao's existing TypeScript
compiler API. They feed a common catalog and one Tao/TypeScript emitter. The generator, catalog,
adapters, and output writer now live in the private [`@native-bindings` package](../../../packages/native-bindings/README.md).
The CLI owns arguments/reporting; the compiler consumes generated Tao as ordinary source. No third-party
dependency was added.

The first surfaces are `expo-haptics` 57.0.3 (all four functions and all 27 enum cases) and React Native
0.86.3 `Vibration` (`vibrate` and `cancel`). There is no handwritten Haptics binding, per-case mapping,
default table or call into the curated `TR.Haptic` implementation. Tests supply an independent native
boundary oracle; application bindings are regenerated directly from installed declarations.

The output directory is entirely generator-owned. Repeating `tao bridge` replaces changed files,
removes stale files and leaves identical files untouched. No generated code needs manual edits;
optional wrappers or extensions live in separate files outside that directory. Its `bindings.json`
catalog identifies an existing output as disposable; unrelated nonempty directories are refused.
Generation finishes before the shared locked synchronizer publishes files, with rollback on write
failure. Publication is per file, not an atomic directory swap; empty stale directories may remain.

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
signatures, follow public reexports, and exercise CLI reruns, stale-file removal, preserved custom
siblings, failed-generation retention, and concurrent publication. Runtime tests
exercise all Haptics values, actual omitted arguments, promise ordering and contained native failure
through the compiled Tao program. Native package behavior is mocked only at its module boundary.

The Developer exercised the generated Haptics demo on a connected physical iPhone and reported that
the feedback works. This is a manual device observation, not exhaustive acceptance of all API cases;
Android and the packaged CLI's resource layout remain unverified. No third-party dependency or native host
configuration changed. Unsupported exported values fail the CLI
instead of producing a silently incomplete binding. That initial proof of concept excluded
result-bearing actions, records, and callback subscriptions; the Clipboard extension below adds them.
Overloads, generic functions, and arbitrary complex unions remain outside this coverage.

Recommended next slices:

1. Complete the generated Haptics fixture's iOS acceptance and run it on Android; verify each supported platform's real behavior
   and deliberate unsupported-platform outcomes. Preserve raw upstream semantics in this import layer.
2. Complete host/device acceptance for the Clipboard text, image, URL, and listener extension below,
   including visible state changes from returned values and subscription disposal on view unmount.
3. Add generated-diff review for locked package versions and persistent naming policy. Check compiler
   condition and dependency provenance, source licensing, and shipped CLI packaging before broad rollout.
4. Add an Android metadata reader only when its invocation backend is chosen. The source-neutral catalog
   permits a new reader; direct Kotlin/Java calls also require a backend and packaging/linking support.

## Generation cost and repository policy

Measured on this arm64 development machine on **2026-09-26**, with installed dependencies and warm OS
caches. Each sample starts a fresh process and includes the repository command wrapper, CLI startup,
TypeScript extraction, generation, and file publication. Five samples per surface/mode:

| Surface                | New-directory median (range) | Rerun median (range)    |
| ---------------------- | ---------------------------- | ----------------------- |
| Expo Haptics           | 0.541 s (0.540–0.588 s)      | 0.543 s (0.538–0.555 s) |
| React Native Vibration | 0.708 s (0.690–0.848 s)      | 0.641 s (0.639–0.711 s) |

These are local measurements, not cold-install or CI budgets. Every generated file in all samples
matched the pre-extraction package-move baseline byte for byte. The task-local measurement artifact is
`.artifacts/native-api-research/package-timing/cli.json`.

Recommendation: commit `Bindings.tao`, `Bindings.ts`, and `bindings.json` for maintained apps/libraries
for now, with locked upstream dependencies and the regeneration command. This provides reviewable API
diffs and a usable checkout while generation is still an explicit command. Keep all manual code in
separate files; committed generated files remain entirely disposable. Do not commit experimental
outputs, caches, or compiler intermediates. Reconsider ignoring bindings once setup/build reliably
regenerates them; the measured runtime itself is not a reason to commit them. A future drift check should
regenerate and compare against committed output.

## Clipboard extension

[Expo Clipboard](https://docs.expo.dev/versions/latest/sdk/clipboard/) is already installed in the host
at 57.0.2. The generator now supports all 11 text, image, URL, and listener operations in its installed
public TypeScript declarations through the same source adapter, catalog, and emitter:

1. `getStringAsync(options?): Promise<string>`, `setStringAsync(text, options?): Promise<boolean>`,
   and `hasStringAsync(): Promise<boolean>` add usable asynchronous results. `GetStringOptions` and
   `SetStringOptions` add optional named records with enum fields. Preserve omitted fields and upstream
   defaults. Acceptance must use results to change visible Tao state through generated bindings.
2. `getImageAsync(options): Promise<ClipboardImage | null>` adds required/optional record fields,
   a `'png' | 'jpeg'` literal union, nullable results, and a nested `{ data, size: { width, height } }`
   result. This extends the same adapter/catalog/emitter instead of introducing another source.
3. Event listeners add callback argument conversion and subscription disposal. The subscription owns
   a generated `Remove` action; deprecated `RemoveClipboardListener` invokes the same idempotent
   lifetime. Reading and writing Clipboard do not require subscribing.

The Developer chose `action Read() returns text from ./Bindings.ts` and local
`let Pasted = do Read()` result binding: await completion, then expose an immutable value to following
statements with ordinary joined transaction/failure semantics. Native Tao action bodies cannot return
values, and result-bearing foreign actions cannot use `runs latest`.

Listeners belong to the lexical mounted view owning the calling action and dispose automatically on
unmount. Registration without such an owner fails before native registration. Disposal ignores newly
arriving events and queued callbacks that have not started; already executing callbacks continue.
Failed transactions and savepoints dispose subscriptions created by their rolled-back work.

Use explicit exclusions for the unsupported component and constant:

```sh
./tao bridge expo-clipboard --source expo --from packages/apps/expo-host --out .artifacts/clipboard/Generated --exclude ClipboardPasteButton isPasteButtonAvailable
```

The catalog records those excluded names. This does not claim full Clipboard package coverage;
components and exported constants remain unsupported. Generated files are regenerated, never edited by
hand. No dependencies were added. Automated tests compile the untouched output and exercise text,
image, and listener behavior through a mounted Tao app with a mocked native module. Host/device
acceptance remains outstanding; these tests do not prove native clipboard behavior.

Colliding enum names receive a generated type prefix (`StringFormat_HTML`, `ContentType_HTML`).
The Expo adapter identifies the shared `expo-modules-core.EventSubscription` disposal contract;
the emitter has no Clipboard-specific method implementations. Nested resources, arbitrary callback
values, recursive/generic records, and required `undefined` values are explicitly rejected.

Location can next exercise permissions and richer records; Accelerometer can exercise exported instances
and inherited generic sensor methods.

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
