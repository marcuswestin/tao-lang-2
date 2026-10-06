import type { Command } from '@commander-js/extra-typings'
import { CLI, HCI, Platform, Repo, Text } from '@shared'
import { agentHostCommands } from '../agent-config/HostCommandPolicy'

/** registerAgentHelpCommand registers `./agent help`. */
export function registerAgentHelpCommand(commands: Command, justCommands: readonly string[]): void {
  commands.action(async () => {
    Platform.runtimeProcess.setExitCode(await printAgentHelp(justCommands))
  })
  commands
    .command('help')
    .description('Print agent workflow and automation commands.')
    .action(async () => {
      Platform.runtimeProcess.setExitCode(await printAgentHelp(justCommands))
    })
}

async function printAgentHelp(justCommands: readonly string[]): Promise<number> {
  const result = await CLI.run('just', { args: ['help'], cwd: Repo.getRoot() })
  if (result.error !== undefined || result.exitCode !== 0) {
    HCI.write(result.stdout)
    HCI.writeError(result.stderr)
    return result.error === undefined ? result.exitCode ?? 1 : 1
  }

  const permissions = Bun.JSONC.parse(await Bun.file(Repo.resolvePath('.rulesync/permissions.jsonc')).text()) as {
    agentHostCommands?: unknown
  }
  const hostOperations = agentHostCommands(permissions).map(prefix => prefix.join(' '))
  HCI.write(formatAgentHelpText(
    [
      ...justHelpLines(result.stdout, justCommands),
      fallbackLine('tao [args...]', 'Run the Tao CLI inside the sandbox'),
      fallbackLine(
        'resources [--json]',
        'Inspect sessions, retained assets, worktrees and temporary directories without cleanup',
      ),
      fallbackLine(
        'start-branch <name>',
        'Start a feat/* branch from fetched origin/main after checking checkout writes, then run setup',
      ),
      fallbackLine(
        'take-branch <name>',
        'Take over a pushed feat/* branch with tracking after checking checkout writes, then run setup',
      ),
    ],
    hostOperations,
  ))
  return 0
}

/**
 * FALLBACK_DESCRIPTIONS covers a command whose recipe `just --list` never names: `setup` runs the
 * private `_setup`, and `typecheck`, `parser-gen`, and `ledger-index` run a recipe spelled
 * differently from the command (`_typecheck`, `_parser-gen`, `_fix-ledger-index`).
 */
const FALLBACK_DESCRIPTIONS: Partial<Record<string, string>> = {
  'ledger-index': 'Regenerate the developer-environment ledger index from its entry files',
  'parser-gen': 'Regenerate the parser from the grammar',
  setup: 'Install dependencies and generate agent adapters; offer optional developer shell activation',
  typecheck: 'Type-check every package',
}

function fallbackLine(command: string, description: string): string {
  return `    ${command.padEnd(39)} # ${description}`
}

function justHelpLines(output: string, commands: readonly string[]): string[] {
  const linesByCommand = new Map(
    output.split('\n').map(line => [line.trimStart().split(/\s+/, 1)[0] ?? '', line]),
  )
  return commands.flatMap(command => {
    const line = linesByCommand.get(command)
    if (line !== undefined) {
      return [line]
    }
    const fallback = FALLBACK_DESCRIPTIONS[command]
    return fallback === undefined ? [] : [fallbackLine(command, fallback)]
  })
}

/** formatAgentHelpText renders the `./agent help` output. */
function formatAgentHelpText(justLines: readonly string[], hostOperations: readonly string[]): string {
  return `
Usage:
  ./agent help
  ./agent <just-command> [args...]
  ./agent tao [args...]
  ./agent unsandboxed <operation> [args...]

Agent commands:
${Text.indentLines(justLines.join('\n'), 2)}

Allowed host operations (use after ./agent unsandboxed):
${Text.indentLines(hostOperations.join('\n'), 2)}

Examples:
  ./agent bench
  ./agent bench 25
  ./agent test
  ./agent test "formats imports"
  ./agent test packages/language/parser/parser-tests/Parser.test.ts
  ./agent test-all
  ./agent test-file packages/language/parser/parser-tests/Parser.test.ts
  ./agent test-source-file packages/language/parser/parser-tests/Parser.test.ts
  ./agent test-changed
  ./agent test-retry
  ./agent verify-changed
  ./agent verify
  ./agent unsandboxed verify-full
  ./agent verify-full-sandbox
  ./agent unsandboxed open-pr --auto-merge
  ./agent unsandboxed verify-complement
  ./agent unsandboxed verify-full-ci --ci-host-gates studio-canary
  ./agent unsandboxed cancel-verify
  ./agent unsandboxed land-fix
  ./agent unsandboxed merge-pr
  ./agent unsandboxed prepare-release studio --repo OWNER/REPO --version 0.0.1
  ./agent unsandboxed prepare-release ide-extension
  ./agent unsandboxed ide-extension-acceptance
  ./agent unsandboxed capabilities
  ./agent unsandboxed setup-ios --xcode-version 27.1 --runtime-version 27.1
  ./agent unsandboxed setup-visionos Apps/VisionHello --xcode-version 27.0
  ./agent unsandboxed setup-watchos Apps/WatchHello --xcode-version 27.0 --runtime-version 27.0 --apply
  ./agent unsandboxed watchman status
  ./agent unsandboxed watchman start
  ./agent unsandboxed land --dry-run
  ./agent unsandboxed merge-main
  ./agent unsandboxed merge-recover
  ./agent unsandboxed simulators list booted
  ./agent unsandboxed simulators run <device-udid>
  ./agent unsandboxed simulators launch <device-udid> <bundle-id>
  ./agent unsandboxed app-dev Apps/HNReader --app HNReaderStub --ios
  ./agent unsandboxed app-dev Apps/HNReader --app HNReaderStub --ios --show-simulator
  ./agent unsandboxed app-dev Apps/HNReader --app HNReaderStub --android
  ./agent unsandboxed app-dev Apps/HNReader --app HNReaderStub --web
  ./agent unsandboxed dev-loop start Apps/HNReader --app HNReaderStub --web --json
  ./agent unsandboxed dev-loop status --json
  ./agent unsandboxed dev-loop logs --session <session-id>
  ./agent unsandboxed dev-loop reload --session <session-id>
  ./agent unsandboxed dev-loop restart --session <session-id>
  ./agent unsandboxed dev-loop stop --session <session-id>
  ./agent unsandboxed test-watch Apps/HNReader
  ./agent unsandboxed standalone-cli-acceptance
  ./agent unsandboxed studio Apps/HNReader
  ./agent unsandboxed studio-ps --json
  ./agent unsandboxed studio-stop --launch <launch-id>
  ./agent unsandboxed studio-canary
  ./agent unsandboxed studio-manual-checks --show-studio
  ./agent unsandboxed test-host managed-loop --case lifecycle
  ./agent unsandboxed test-host managed-loop-recover --invocation <uuid>
  ./agent unsandboxed studio-smoke --native --show-studio packages/ides/studio-tooling/studio-smoke/studio-host-control.test.ts
  ./agent unsandboxed studio-smoke --native --show-studio packages/ides/studio-tooling/studio-smoke/studio-mac2-acceptance.test.ts
  ./agent unsandboxed local-instantdb start
  ./agent unsandboxed pods install <ios-directory>
  ./agent setup --refresh-lockfile

unsandboxed accepts only named argv prefixes in .rulesync/permissions.jsonc's agentHostCommands.
Each name runs its fixed host implementation with following arguments forwarded as argv, without
a shell. It fails before dispatch if still sandboxed. Other host operations need the Developer's
explicit approval; plain commands remain sandboxed.

dev-loop manages background app loops through start, status, logs, stop, restart, and reload.
Start returns a session ID in starting state; status reports readiness, target URLs, devices,
warnings, and cleanup outcomes. Loops have no default runtime or idle timer. Agents decide
when to keep a useful loop running and report its session ID and stop command at handoff.
Select recorded sessions explicitly for logs and control; restart preserves configuration,
while reload asks the current Metro server to reload connected apps. Stop waits for owned
cleanup. Server-only, web, iOS, and Android targets are supported. app-dev remains foreground.

Agent app-dev --ios reserves a reusable simulator across worktrees, boots it without a viewer,
and shuts down only a device it selected and booted. Add --show-simulator for an inactive viewer,
or --simulator <udid> to reserve a specific available device. A dev loop started without --ios
must be restarted with --ios before its interactive i shortcut can open a simulator.
Agent app-dev --android reserves a reusable AVD across worktrees, boots it without a window,
and stops only the emulator it started. Add --show-emulator for a visible window, or
--emulator <serial> to reserve a specific booted device without stopping it afterward.
Agent app-dev web opens Google Chrome with an isolated profile and no window. Add
--show-browser when a visible Chrome window is requested. Attach a CDP-capable client to the
printed DevTools URL for automation/screenshots of that Chrome session. For interactive in-app
review, open the printed app URL; it uses a separate browser session. Chrome closes with the loop.
Native Studio uses Electrobun and opens windows. Its --no-browser option is not a hidden mode.
The two native smoke examples above exercise semantic host control and external
accessibility/physical input respectively; Mac2 may activate the app and needs
native automation/accessibility consent. Obtain permission for visible native testing, then pass
--show-studio. The hidden canary probe remains quiet without that option.
Verification and landing accept --show-studio and forward it only to scoped test children.
Visible workflow warnings appear before execution and remain in final text/JSON reports.
After failed Android cleanup, retained fences name a generation. Recover only stopped owned
processes with ./agent unsandboxed android recover --avd <name> --generation <id>; uncertain
descendant ownership stays quarantined for investigation.

Watchman is one shared daemon per user. status does not start it; start is idempotent;
watchman stop disconnects subscriptions in every worktree. Startup uses the primary checkout's
pinned client so removing a linked worktree does not break the daemon's launch path.

setup --environment builds this checkout's pinned Nix environment, then runs setup without opening
an interactive shell. Use it when native tools such as Hutch are missing or the toolchain changed.
At a developer terminal, successful setup ends with an optional direnv activation prompt. The choice
is shared by this repository's worktrees under ~/.tao-dev. Noninteractive setup never prompts or
changes personal shell settings. Run ./agent shell-setup to change a saved choice.
setup installs with a frozen lockfile. After adding, removing, or moving a workspace package, or
changing a package.json dependency, setup --refresh-lockfile is the one install that rewrites
bun.lock.

test takes one optional target and decides by whether it exists on disk: an existing file or
directory is a path, anything else is a test-name pattern. It prints which reading it chose. A bare
test runs the suites the branch diff reaches, which can be green while a suite the change broke
never ran; a name pattern filters those same suites rather than widening back out to all of them.
test-all runs every suite, and takes an optional name pattern of its own.

test-source-file runs an explicit file/directory after parser generation, without building the
reference app. Use it for language bootstrap when the new parser cannot compile that app yet;
it is focused source evidence, never app or merge acceptance. Other test and verification lanes
keep their existing reference-app prerequisite.

Broad checks, verification, bare test/test-changed, and unfiltered test-all stop admitting new work
after a definite failure. Running work is cancelled, with three seconds for cleanup before force-stop.
The lane releases its leases only after its owned processes have stopped.
Explicit file/directory/name targets and test-retry collect failures in that scope; a repository-root
target remains broad. Individual checkers retain their diagnostics. Filtered or aborted runs are
never complete coverage: diagnose the failed scope, fix it, then repeat broad verification.

Each verification scope is its own command rather than a flag: verify-changed runs the gates plus
the test suites the branch diff reaches (iterate with it); verify runs every suite locally when
useful or when CI is unreachable. Hosted CI is the default portable final proof; ./agent unsandboxed
verify-full adds the browser, native, and bundle
lanes, two of which take a machine-wide lease on the window server for as long as they run;
verify-full-sandbox runs that same membership in a managed shell without claiming its host-only
lanes passed. A lane whose tree is already recorded green prints that run's
evidence and stops; --no-cache runs it anyway. When new CI is starting for an authorized, ready
landing, run open-pr --auto-merge: it also runs verify-complement, the host-only gates hosted
Verify does not admit, beside the hosted run, and cancels that run if the complement fails first
(cancel-verify does the same by hand). verify-full-ci is the CI macOS workflow's lane: the host
gates its CI_HOST_GATES admits plus the prepare nodes they read, the rest reported
pending; it records no green tree. merge-pr finishes from wherever the pull request stands:
it archives one GitHub already merged, squash-merges one that is green with auto-merge off, and
otherwise turns auto-merge on for this head. land-fix pushes a fix committed after GitHub merged
straight to main, with a receipt and no full verification. Plain open-pr keeps auto-merge off for
verification before landing readiness. Offline local proof does not push or land.

Repository workflow commands capture the child's output rather than inheriting the terminal, write
the full capture to .artifacts/logs/agent/<command>/, and print a
bounded report ending in a verdict line, a Failed: block naming what broke when it did, and the log
path — read that path for anything the report left out. --verbose streams the child's output live
instead of holding it back; --json prints one JSON object and nothing else; --max-lines <n>
overrides how much of the child's own output the report keeps. Named host operations inherit the
terminal so interactive native tools and long-running development servers keep working.
`
}
