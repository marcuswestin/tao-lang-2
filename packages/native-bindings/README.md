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
- `generate.ts`: common Tao declarations, JavaScript calls, and catalog emitter.
- `write-bindings.ts`: source selection, diagnostics, and safe output publication.

`NativeBindings.generate({ source, packageName, fromDirectory, exportName? })` returns the catalog,
diagnostics, and generated text without writing. `generateNativeBindingFiles` is the CLI-facing
writer. New readers implement `NativeApiSource`; they do not require source-specific emitter branches.
The current invocation backend calls JavaScript modules in Expo/React Native. A future direct
Android reader would also need a compatible invocation backend and host packaging; adding a reader
alone does not make Kotlin or Java callable.

The package uses `@shared` and the repository's existing TypeScript toolchain. It has no compiler or
CLI dependency. Source tests live here; generated-source compilation and CLI contract tests remain
with the CLI, and compiled Tao/native-boundary tests remain with the Expo host.

## Generate

From the repository root, with dependencies already installed:

```sh
./tao bridge expo-haptics --source expo --from packages/apps/expo-host --out .artifacts/haptics
./tao bridge react-native --source react-native --export Vibration --from packages/apps/expo-host --out .artifacts/vibration
```

For an app, set `--from` to the project resolving the upstream package and `--out` to a dedicated
generated directory inside that project. The command executes no native package code. Unsupported
API shapes fail before publication, preserving the previous output.

The output directory is wholly disposable. Reruns replace changed files, remove stale files, and
leave identical files untouched. The generated catalog identifies an existing directory as owned;
unrelated nonempty directories and symlinks are refused. Publication uses the shared locked file
synchronizer with rollback, not an atomic directory swap. Empty stale directories may remain.

Never manually edit generated files. Optional custom wrappers belong outside that output directory.
See the [CLI examples](../cli/tao-cli/README.md#generated-native-bindings-proof-of-concept).

## Generated files in Git

For now, the recommendation is to commit the three generated files when they are part of a maintained
app or library, together with its locked upstream dependencies and regeneration command. This makes
API changes reviewable and the source available immediately on checkout. Generation is not yet an
automatic setup/build dependency, so ignoring those files would otherwise leave a missing step.

Do not commit scratch generations, benchmark output, caches, or compiler intermediates. Committing
generated bindings does not make them editable: changes still come from regeneration. Once generation
is integrated into setup/build, reconsider this policy and add a regeneration drift check. The measured
runtime is small enough that speed alone does not justify committing generated bindings.

## Next surface

Start with [Expo Clipboard](https://docs.expo.dev/versions/latest/sdk/clipboard/): text reads and writes
introduce asynchronous string/boolean results and optional named option records. Then extend the same
module to images for required fields, string-literal unions, nullable results, and nested returned
records. This gives smaller steps than Location's permissions and subscriptions or Sensors' instance
methods and disposable callbacks. Decide how Tao exposes result-bearing asynchronous calls before
implementing that slice; the current generator supports only `void` and `Promise<void>` operations.

The [PoC findings](<../../Docs/Roadmap/Bridge React Native and Expo APIs into Tao/Findings - Generated native bindings.md>)
record measurements, current limitations, and the broader research.
