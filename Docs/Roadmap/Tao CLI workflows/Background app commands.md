# Background app commands

The macOS proof of concept keeps the installed app as server and the existing Tao CLI as client.
The first packaged background ping-pong gate precedes hidden runtime discovery and execution.
The current contract and usage live in [Tao Actions](../../Spec/Tao%20Actions.md#app-command-exposure)
and the [CLI README](../../../packages/cli/tao-cli/README.md).

Remaining product work is deferred: CloudKit integration, entity retrieval/search and entity inputs,
view-local commands, arbitrary return values, promotion into a visible window, interactive sign-in,
and migration of earlier random-origin desktop storage. These require separate decisions and acceptance.

The native acceptance lane is `./agent unsandboxed test-host agents`. It supplements focused
compiler/runtime/lifecycle tests; mocked requests alone cannot prove background window and focus behavior.
