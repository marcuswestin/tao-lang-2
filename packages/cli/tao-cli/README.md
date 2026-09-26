# Tao CLI

## Run directly on a phone

From a Tao checkout, open an ordinary app in the installed Tao Companion without Studio:

```sh
./tao dev "Apps/Test Apps/Native Bridge" --app NativeBridge --device roPhone
```

`--device <name-or-id>` selects an attached/paired physical iPhone or iPad by name or ID, or an
Android phone by serial. Duplicate names require an ID. iOS uses Tao Companion's development-client
link to this session's Metro server; it applies no Studio scenarios. Keep the phone unlocked and
on the same network as the Mac. `--ios` still selects the simulator, and bare `tao dev` opens no
target. The interactive `p` shortcut opens the sole connected device or presents a device picker.

Install the iOS shell once with `./dev studio-companion-install --device roPhone`. A missing shell
or failed device launch reports what to fix while Metro keeps running; press `p` to retry. Stop any
existing Studio/dev session for that project first: project ownership remains exclusive.

## Generated native bindings (proof of concept)

`tao bridge` imports the public declarations of an already installed package. Expo and React Native
have separate source adapters feeding the same catalog and Tao/TypeScript emitter in
[`@native-bindings`](../../native-bindings/README.md). The CLI only handles arguments and reporting.
From this repository:

```sh
./tao bridge expo-haptics --source expo --from packages/apps/expo-host --out .artifacts/haptics
./tao bridge react-native --source react-native --export Vibration --from packages/apps/expo-host --out .artifacts/vibration
```

Choose a dedicated generated output directory. The command writes `Bindings.tao`, its generated `Bindings.ts`
implementation, and a versioned `bindings.json` catalog with package version, declaration path,
declaration hash, platform annotations and diagnostics. Rerun the same command at any time: identical
files stay untouched, changed files are replaced, and stale files in that directory are removed.
The whole output directory is disposable, so added files and manual edits inside it are discarded.
Keep its generated catalog: it identifies an existing output directory the command may replace.
An unrelated nonempty directory or a symlink is refused.

Generation and validation finish before publication, so unsupported upstream APIs leave the previous
output intact. Publication uses the shared locked file synchronizer with rollback on write failure;
it does not atomically swap the entire directory, and empty stale subdirectories may remain.
The command installs no packages and executes no native code.

Never customize generated files. Improve the generator or put optional custom wrappers in sibling
files outside its output directory, for example:

```text
Native/
├── Feedback.tao          # optional custom wrapper
└── Haptics/              # wholly generated; --out points here
    ├── Bindings.tao
    ├── Bindings.ts
    └── bindings.json
```

Keep all generated files together in the consuming Tao project, where the same upstream package
must be resolvable. Use ordinary Tao imports from a sibling file:

```tao
use SelectionAsync, ImpactAsync, NotificationAsync, PerformAndroidHapticsAsync,
   ImpactFeedbackStyle, NotificationFeedbackType, AndroidHaptics from ./Haptics/Bindings.tao

action Feedback() {
   do SelectionAsync()
   do ImpactAsync()
   do ImpactAsync(Style: Soft)
   do NotificationAsync(Type: Warning)
   do PerformAndroidHapticsAsync(Type: Gesture_Start)
}
```

The complete installed Haptics surface is generated without a Haptics-specific template or mapping:
four methods and all 27 cases across three enums. Missing optional arguments stay omitted at the
upstream call, preserving Expo's own defaults. Tao `none` represents omission here. Async actions
return the native promise to Tao's existing action runtime; native rejection follows its existing
failure channel. Android-only methods retain their upstream behavior; the generator does not add
cross-platform fallbacks or configure native builds.

Supported inputs are non-generic, non-overloaded actions returning `void` or `Promise<void>`, exported
non-const enums with constant member values, primitive parameters, arrays, and primitive unions such as Vibration's number-or-list
pattern. Unsupported result values, callbacks, objects, rest parameters and complex types produce
diagnostics. This is a narrow binding generator, not yet a complete importer for every Expo/RN API.
The catalog and source interface leave room for future metadata readers. A direct Android SDK source
also needs a native execution backend; adding a reader alone does not provide one.

Generation tests run Tao validation and sidecar checking against installed declarations. Runtime
tests feed untouched generated files through compilation and exercise the Expo module boundary.
Physical-device feedback, native linking and packaged CLI acceptance remain separate checks.
See [findings and next steps](../../../Docs/Roadmap/Bridge%20React%20Native%20and%20Expo%20APIs%20into%20Tao/Findings%20-%20Generated%20native%20bindings.md).

## Background app commands (macOS proof of concept)

From the repository root, run the complete example with:

```sh
just agents-demo
```

The recipe contains these three shell commands:

```sh
./tao build "Apps/Test Apps/Agent Commands" --agents --app AgentCommandsProof --output .artifacts/agents-demo
./.artifacts/agents-demo/agents commands
./.artifacts/agents-demo/agents run AppendEntry --args '{"Message":"Hello from just agents-demo","Quantity":3,"Marked":true}' --stop-after
```

The first line builds the Local-backed example app and a Bun-bundled native client executable.
The second starts the app in the background and lists its exposed commands. The third invokes
`AppendEntry` in a separate client process, prints the transaction receipt, and stops the app.
Builds remain in dated directories under `.artifacts/agents-demo`; `agents` links to the latest
successful build’s executable. Each dated build retains its own executable, which can stop that
build if it is still running after a rebuild. Repeated demo runs append another entry to the same Local store.
Keep the executable beside its retained builds when moving the output directory.

Build an app whose `AgentCommands` property explicitly lists the supported module commands:

```sh
tao build --agents --app MyApp
tao agents start --app "/path/MyApp.app"
tao agents ping --app "/path/MyApp.app"
tao agents commands --app "/path/MyApp.app"
tao agents run '<canonical-command-id>' --app "/path/MyApp.app" --args '{"Value":"hello"}'
tao agents stop --app "/path/MyApp.app"
```

Use the `.app` artifact path printed by the build. `--agents` selects desktop when no target is
specified and requires a packaged desktop build. It also builds an `agents` client executable beside
the retained builds; `--output <directory>` chooses their root. Both clients use the same RPC code;
the app contains the server. Running the executable needs no separate Bun installation, Metro, or
Expo server. Dependency versions are unchanged.

`commands` prints a readable catalog by default, including names, titles, descriptions, canonical IDs,
argument types, and requiredness (`?` marks optional arguments). Enabled state is shown only when known.
Use `agents commands --json` or `tao agents commands --app "/path/MyApp.app" --json` for the original
JSON response envelope. Other request commands write one JSON response to stdout. Diagnostics go to
stderr; failures exit nonzero. Start waits for an authenticated host handshake. Discovery initializes the normal app in a
hidden, inactive webview and waits for its configured data stores. The app may have a Dock icon.
The app's provider configuration and authentication apply in that webview.

Copy canonical command IDs from discovery;
the bundled client also accepts an unambiguous exposed command name. Its `commands` and `run`
operations start the app on demand; `run --stop-after` stops it after the request, and `stop` can
be used separately. Execution is never automatically retried.
`--args` is a JSON object with case-sensitive slot names;
only text, finite numbers, and booleans are accepted, without coercion. Omitted optional slots retain
their defaults. Transaction failures are returned as failures even when the app contains the original
action error. Completion waits for queued provider persistence, not remote synchronization or detached
work. A timeout is an unknown outcome, not cancellation: inspect app state before deciding to retry.

Repeated starts reuse a verified matching instance. A different live build must be stopped first.
Only one runtime owns an app identity. Launching another instance does not promote a background app
into a visible window. Stop waits for work and persistence; if its deadline expires it reports busy
and leaves the app running.

Session records and launcher logs live in a private per-user directory under
`~/Library/Caches/Tao/agents/`. The session contains a random capability; do not share it. The bridge
listens only on loopback and rejects browser-origin requests. The stable origin is retained across
visible and background launches so Local storage uses the same browser data. An occupied saved port
fails explicitly. Earlier desktop installs with random origins are not migrated or deleted.

CloudKit integration, entity discovery/retrieval, entity arguments, view-local commands, arbitrary
return values, and interactive authentication flows are outside this proof of concept.

The regular CLI suite includes `agent-client-build.test.ts`: it builds and relocates the native
client, lists commands in readable and JSON formats, and runs a fixture command through the real
loopback RPC server in a separate process. It checks the received scalar arguments and execution receipt.

Repository acceptance: `./agent unsandboxed test-host agents` builds actual pinned-toolchain apps,
checks background launch and RPC, and exercises the dedicated Local-backed command app.
