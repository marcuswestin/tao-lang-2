# Native bindings

`@native-bindings` is the private workspace package `tao-native-bindings`. It owns native API
extraction, the common catalog, Tao/TypeScript generation, and publication of generated files.
The compiler consumes the generated Tao as ordinary source; the CLI owns command arguments and
reporting. Neither owns the generator.

## Architecture

```text
Installed public TypeScript declarations
    ├── ExpoApiSource
    └── ReactNativeApiSource
             ↓
       NativeApiCatalog
             ↓
       NativeBindings.generate
             ↓
       generateNativeBindingFiles
             ↓
       Bindings.tao + Bindings.ts + bindings.json
```

The sole public entry is `native-bindings-src/native-bindings.ts`. Implementation files are:

- `native-api.ts`: source interface and source-neutral catalog types.
- `native-binding-sources.ts`: Expo and React Native adapters.
- `typescript-api-source.ts`: TypeScript symbol resolution and supported-shape extraction.
- `typescript-api-types.ts`: structural value reflection and adapter-declared resource contracts.
- `generate.ts`: common Tao declarations, JavaScript calls, and catalog emitter.
- `emit-values.ts`: generated enum, record, callback, and resource conversions.
- `emit-associated-actions.ts`: reference-owned instance/static actions sharing the checked flat wrappers.
- `write-bindings.ts`: source selection, diagnostics, and safe output publication.

`NativeBindings.generate({ source, packageName, fromDirectory, exportName?, exclude? })` returns the catalog,
diagnostics, and generated text without writing. `generateNativeBindingFiles` is the CLI-facing
writer. New readers implement `NativeApiSource`; they do not require source-specific emitter branches.
The current invocation backend calls JavaScript modules in Expo/React Native. A future direct
Android reader would also need a compatible invocation backend and host packaging; adding a reader
alone does not make Kotlin or Java callable.

Reference methods and properties publish associated actions; constructors publish static actions.
For example, `do File.Construct(...)` creates a reference and `do Handle.ReadBytes(...)` reads through
its captured receiver. Generated `Owner_Member` exports forward to the existing checked wrappers,
and flat actions remain compatible. `ReleaseReference()` invalidates only the Tao wrapper; native
`Close`, `Cancel` and `Release` operations retain their separate upstream meanings. Register cleanup
with `defer` at acquisition so it also runs on failure.

The package uses `@shared` and the repository's existing TypeScript toolchain. It has no compiler or
CLI dependency. Source tests live here; generated-source compilation and CLI contract tests remain
with the CLI, and compiled Tao/native-boundary tests remain with the Expo host.

## Generate

From the repository root, with dependencies already installed:

```sh
./tao bindings generate expo-haptics --source expo --from packages/apps/expo-host --out .artifacts/haptics
./tao bindings generate react-native --source react-native --export Vibration --from packages/apps/expo-host --out .artifacts/vibration
./tao bindings generate expo-clipboard --source expo --from packages/apps/expo-host --out .artifacts/clipboard/Generated --exclude ClipboardPasteButton isPasteButtonAvailable
```

For an app, set `--from` to the project resolving the upstream package and `--out` to a dedicated
generated directory inside that project. The command executes no native package code. Unsupported
API shapes fail before publication, preserving the previous output. `--exclude` explicitly records
omitted exported names in the catalog; it does not silently ignore unsupported exports.

The output directory is wholly disposable. Reruns replace changed files, remove stale files, and
leave identical files untouched. The generated catalog identifies an existing directory as owned;
unrelated nonempty directories and symlinks are refused. Publication uses the shared locked file
synchronizer with rollback, not an atomic directory swap. Empty stale directories may remain.

Never manually edit generated files. Optional custom wrappers belong outside that output directory.
See the [CLI examples](../../cli/tao-cli/README.md#generated-native-bindings-proof-of-concept).

The maintained [Native Bridge device demo](<../../../Apps/Test Apps/Native Bridge/README.md>) combines
Haptics, React Native Vibration, and Clipboard in one app, with generation and phone-launch commands.
Conversion helpers are emitted only in the directions operations use, so generated files also pass
projects that enable TypeScript's unused-local checks.

## Generated files in Git

For now, the recommendation is to commit the three generated files when they are part of a maintained
app or library, together with its locked upstream dependencies and regeneration command. This makes
API changes reviewable and the source available immediately on checkout. Generation is not yet an
automatic setup/build dependency, so ignoring those files would otherwise leave a missing step.

Do not commit scratch generations, benchmark output, caches, or compiler intermediates. Committing
generated bindings does not make them editable: changes still come from regeneration. Once generation
is integrated into setup/build, reconsider this policy and add a regeneration drift check. The measured
runtime is small enough that speed alone does not justify committing generated bindings.

## Clipboard coverage

[Expo Clipboard](https://docs.expo.dev/versions/latest/sdk/clipboard/) generation supports its 11
text, image, URL, and listener operations from the installed TypeScript declarations. Returned strings,
booleans, nullable images, nested records, optional option fields, enums, and string-literal cases pass
through the shared catalog and emitter. Omitted optional fields preserve upstream defaults.
Colliding enum cases receive their type name as a prefix: `StringFormat_HTML` and
`ContentType_HTML` remain distinct Tao cases with their original native values. Tao code uses the
unqualified cases after importing their types.

Foreign actions declare `returns T`; an action body uses `let Result = do SetStringAsync("Hi")`
followed by `set Copied = Result` to await a boolean and update writable boolean state. This is an
illustrative fragment using the implemented result-binding syntax. Native Tao action bodies cannot
return values, and result-bearing foreign actions cannot use `runs latest`.

Reading and writing need no subscription. Listeners observe changes and belong to the lexical mounted
view owning the calling action. They dispose on unmount or through the returned subscription's `Remove`
action. Deprecated `RemoveClipboardListener` uses the same idempotent disposal. Disposed listeners
ignore arriving events and queued callbacks; already executing callbacks are not cancelled. Registration
outside an owned mounted view fails before native registration, and failed transactions or savepoints
dispose subscriptions created by the rolled-back work.

The command above explicitly excludes `ClipboardPasteButton` and `isPasteButtonAvailable`;
components and exported constants remain unsupported. This is operation coverage, not full Clipboard
package coverage. Nested resources, arbitrary callback values, recursive/generic records, and required
values containing `undefined` are rejected with diagnostics. Resource lifetime semantics come from the
Expo adapter's reusable `expo-modules-core.EventSubscription` contract; TypeScript method signatures
alone cannot infer ownership. No Clipboard-specific sidecar code is handwritten.

Generated-binding tests compile the untouched output and exercise it in a mounted Tao app against a
mock native module. Host/device acceptance remains outstanding. No dependencies were added.

The [PoC findings](<../../../Docs/Roadmap/Bridge React Native and Expo APIs into Tao/Findings - Generated native bindings.md>)
record measurements, current limitations, and the broader research.
