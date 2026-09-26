# Tao CLI

## Background app commands (macOS proof of concept)

From the repository root, run the complete example with:

```sh
just agents-demo
```

This builds an isolated copy of the Local-backed `Agent Commands` test app, starts it in the background,
prints its available commands, and invokes `AppendEntry` through a separate CLI process. It prints the
transaction receipt and stops the app afterward. Each run retains its build and request logs under
`.artifacts/scratch/background-app-rpc/`.

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
specified and requires a packaged desktop build. The existing Tao CLI is the client; the app contains
the server. Running the artifact needs no Metro or Expo server. Dependency versions are unchanged.

Every request command writes one JSON response to stdout. Diagnostics go to stderr; failures exit
nonzero. Start waits for an authenticated host handshake. Discovery initializes the normal app in a
hidden, inactive webview and waits for its configured data stores. The app may have a Dock icon.
The app's provider configuration and authentication apply in that webview.

Copy canonical command IDs from discovery. `--args` is a JSON object with case-sensitive slot names;
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

Repository acceptance: `./agent unsandboxed test-host agents` builds actual pinned-toolchain apps,
checks background launch and RPC, and exercises the dedicated Local-backed command app.
