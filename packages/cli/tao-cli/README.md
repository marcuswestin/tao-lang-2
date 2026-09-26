# Tao CLI

## Experimental visionOS project export

`tao build <project> --visionos` retains a native Xcode project that embeds the compiled Tao web UI
in a SwiftUI window. It exports the project and bundled site; Xcode builds and signs the native
application separately. It does not add spatial language syntax or a native React Native backend.
An optional project-relative `visionos/Tests.swift` supplies app-hosted XCTest coverage in the
exported project. See [Hello Tao on visionOS](../../../Apps/VisionHello/README.md) for the sample,
simulator prerequisites, build steps, and prototype limitations.

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
