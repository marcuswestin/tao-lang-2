# Background app commands

The macOS proof of concept keeps the installed app as server. The existing Tao CLI and a generated,
Bun-bundled app-specific executable share the RPC client; neither creates another app runtime.
`just agents-demo` exposes build, discovery, and invocation as three explicit shell commands.
The first packaged background ping-pong gate precedes hidden runtime discovery and execution.
The current contract and usage live in [Tao Actions](../../Spec/Tao%20Actions.md#app-command-exposure)
and the [CLI README](../../../packages/cli/tao-cli/README.md).

Remaining product work is deferred: CloudKit integration, entity retrieval/search and entity inputs,
view-local commands, arbitrary return values, promotion into a visible window, interactive sign-in,
and migration of earlier random-origin desktop storage. These require separate decisions and acceptance.

The native acceptance lane is `./agent unsandboxed test-host agents`. It supplements focused
compiler/runtime/lifecycle tests; mocked requests alone cannot prove background window and focus behavior.
It leaves the hidden app idle before separate bundled-client discovery and execution, then verifies
shutdown and persistence after a visible relaunch. Hidden host requests use Electrobun's native
JavaScript delivery path so an idle WebKit view wakes without showing a window; requests are sent once.
Client failures identify the failed RPC method. Failed discovery explicitly reports that execution
was never submitted, and a shutdown failure cannot replace a command's execution receipt.
Generated app hooks use module-scope aliases so Fast Refresh preserves app state during Studio edits.
