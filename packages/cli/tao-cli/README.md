# Tao CLI

## Project secrets

`tao secrets` is available in development builds; public releases omit it until it ships.
It keeps encrypted values in `.tao/store/secrets.jsonc` beside the nearest Tao project
declaration. Commit that file so collaborators can use it. Secret names and recipient public keys are
readable; values are encrypted with `age`. On macOS, install `age` and `age-plugin-se` (for example,
`brew install age age-plugin-se`). Tao creates one machine identity backed by the Secure Enclave and
asks for Touch ID or the Mac passcode when it unlocks a project store. There is no shared password.

```sh
tao secrets init [project-path]
tao secrets set INSTANT_APP_ADMIN_TOKEN [project-path]
tao secrets list [project-path]
tao secrets get INSTANT_APP_ADMIN_TOKEN [project-path]
tao secrets remove INSTANT_APP_ADMIN_TOKEN [project-path]
```

`set` prompts without echoing the value. `get` writes the exact plaintext to stdout, so use it only
where that output is intended; avoid transcript or command log capture. `tao instantdb push` reads
`INSTANT_APP_ADMIN_TOKEN` from the environment first, then from the project store, and otherwise
prompts at a terminal. It does not print the token.

For another developer, run `tao secrets identity` on their Mac. Verify the public recipient with
them, then an existing collaborator runs `tao secrets grant <recipient> [project-path]` and commits
the updated store. Every enrolled recipient can read every secret. Adding a recipient to a text file
alone does not grant access, and a later `grant` wraps the store key only to machines already
granted plus the one named. The committed file is trusted as far as your repository is: review
changes to its `storeKey` like any other code change. If the last enrolled machine is lost, Tao cannot recover the store key;
restore access from another enrolled machine or replace the provider credentials. Removing a value
from the current file does not remove Git history or revoke the credential at its provider.

## Report a problem

From an installed CLI, `tao doctor --json` prints a privacy-filtered environment fingerprint with
the Tao release, OS and architecture, available tool versions, Xcode on macOS, and the installed
resource bundle hash. `tao doctor` presents the same facts for a person to read.

Run `tao bug-report` for a short report draft, links to the two feedback issue forms, and an optional
fingerprint to paste into the Environment field. The command reads the local environment but sends
nothing; review the draft before submitting it. Neither command requires a source checkout.

## Experimental visionOS project export

`tao build <project> --visionos` retains a native Xcode project that embeds the compiled Tao web UI
in a SwiftUI window. It exports the project and bundled site; Xcode builds and signs the native
application separately. It does not add spatial language syntax or a native React Native backend.
For VisionHello, app-hosted XCTest coverage comes from
`packages/testing/e2e-testing/native/visionos/VisionHelloTests.swift` and is copied into the
exported project. See [Hello Tao on visionOS](../../../Apps/VisionHello/README.md) for the sample,
simulator prerequisites, build steps, and prototype limitations.

## Run directly on a phone

From a Tao checkout, open an ordinary app in the installed Tao Companion without Studio:

```sh
./tao run "Apps/Test Apps/Native Bridge" --app NativeBridge --device roPhone
```

`--device <name-or-id>` selects an attached/paired physical iPhone or iPad by name or ID, or an
Android phone by serial. Duplicate names require an ID. iOS uses Tao Companion's development-client
link to this session's Metro server; it applies no Studio scenarios. Keep the phone unlocked and
on the same network as the Mac. `--ios` selects the simulator and installs its compatible runtime
automatically when needed: a compatible Tao Companion when available, otherwise the Expo Go client
published for this Tao version's SDK. Bare `tao run` opens no target. The interactive `p` shortcut
opens the sole connected device or presents a device picker.

Install the iOS shell once with `./dev studio-companion-install --device roPhone`. A missing shell
or failed device launch reports what to fix while Metro keeps running; press `p` to retry. Stop any
existing Studio/dev session for that project first: project ownership remains exclusive.

## Generated native bindings (proof of concept)

`tao bridge` imports the public declarations of an already installed package. Expo and React Native
have separate source adapters feeding the same catalog and Tao/TypeScript emitter in
[`@native-bindings`](../../apps/native-bindings/README.md). The CLI only handles arguments and reporting.
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

## Firebase management

The commands below use the installed official Firebase CLI and locally signed-in Google accounts.
Credentials remain local; `FIREBASE_TOKEN` is refused. Use `--account email` to select a signed-in
account explicitly. Otherwise multiple accounts appear as `1`–`9`, then `a`–`z`; Enter selects the first.
`--json` prints known public fields on stdout and progress/prompts on stderr. If no account is signed
in, first run `tao firebase projects list` in an interactive local terminal, then retry with `--json`.
Server management refuses emulator routing and endpoint overrides. Each official CLI request uses an
isolated empty config and alias file, so local project aliases cannot change the requested project.

```sh
tao firebase projects list
tao firebase projects info <project-id>
tao firebase projects create [project-id]
tao firebase apps list --project <project-id>
tao firebase apps info <app-id> --project <project-id>
tao firebase apps config <web-app-id> --project <project-id>
tao firebase apps create "My App" --project <project-id>
tao firebase data reset --project <project-id> --uid <uid> --store <StorageKey> --dry-run
```

Project creation proposes a globally unique ID when omitted; Enter accepts it. Creation still
requires a local numbered confirmation. App listing includes all platforms; app creation registers
WEB because Tao uses the Web SDK. Configuration contains public connection identity, including the
Web SDK API key. Project, app registration, and Auth user deletion are not implemented; scoped server data deletion is provided by reset.

Find the UID in the selected project at
`https://console.firebase.google.com/project/<project-id>/authentication/users`, under
**Authentication → Users → User UID**. Find the store in the authored Tao **Datasource Firebase
StorageKey**, such as HostedFirebase’s `hosted-firebase-notes`; it is not the web app ID.

Reset takes the original authored `StorageKey` text, including slashes or percent characters, and applies `s_` plus URI encoding, and recursively deletes
exactly `users/<uid>/stores/s_<encoded StorageKey>` in the `(default)` database. The dry-run builds
that plan locally without sign-in, network calls, confirmation, or changes. Remove `--dry-run` to
review the exact plan and choose `1. Continue (default)` or `2. Stop`; Enter selects Continue.

**Stop clients and clear their local stores before reconnecting.** Server reset does not clear local
offline replicas, which can republish data. It preserves Auth users, other users and stores, project
settings, app registrations, and indexes. It does not reset the whole project or all collections.
