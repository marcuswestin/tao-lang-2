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
        'start-branch <name>',
        'Start a feat/* branch from fetched origin/main after checking checkout writes',
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
  setup: 'Install dependencies and generate agent adapters',
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
  ./agent test-changed
  ./agent test-retry
  ./agent verify-changed
  ./agent verify
  ./agent verify-full-sandbox
  ./agent unsandboxed prepare-release studio --repo OWNER/REPO --version 0.0.1
  ./agent unsandboxed prepare-release ide-extension
  ./agent unsandboxed capabilities
  ./agent unsandboxed setup-ios --xcode-version 27.1 --runtime-version 27.1
  ./agent unsandboxed land --dry-run
  ./agent unsandboxed merge-main
  ./agent unsandboxed merge-recover
  ./agent unsandboxed simulators list booted
  ./agent unsandboxed simulators run <device-udid>
  ./agent unsandboxed app-dev Apps/HNReader --app HNReaderStub --ios
  ./agent unsandboxed studio Apps/HNReader
  ./agent unsandboxed studio-ps --json
  ./agent unsandboxed studio-stop --launch <launch-id>
  ./agent unsandboxed local-instantdb start
  ./agent unsandboxed pods install <ios-directory>
  ./agent setup --refresh-lockfile

unsandboxed accepts only named argv prefixes in .rulesync/permissions.jsonc's agentHostCommands.
Each name runs its fixed host implementation with following arguments forwarded as argv, without
a shell. It fails before dispatch if still sandboxed. Other host operations need the Developer's
explicit approval; plain commands remain sandboxed.

setup installs with a frozen lockfile. After adding, removing, or moving a workspace package, or
changing a package.json dependency, setup --refresh-lockfile is the one install that rewrites
bun.lock.

test takes one optional target and decides by whether it exists on disk: an existing file or
directory is a path, anything else is a test-name pattern. It prints which reading it chose. A bare
test runs the suites the branch diff reaches, which can be green while a suite the change broke
never ran; a name pattern filters those same suites rather than widening back out to all of them.
test-all runs every suite, and takes an optional name pattern of its own.

Each verification scope is its own command rather than a flag: verify-changed runs the gates plus
the test suites the branch diff reaches (iterate with it); verify runs every suite (the gate before
a reviewed commit or a merge); verify-full adds the browser, native, and bundle lanes, two of which
take a machine-wide lease on the window server for as long as they run; verify-full-sandbox runs
that same membership in a managed shell without
claiming its host-only lanes passed. A lane whose tree is already recorded green prints that run's
evidence and stops; --no-cache runs it anyway.

Repository workflow commands capture the child's output rather than inheriting the terminal, write
the full capture to .artifacts/logs/agent/<command>/, and print a
bounded report ending in a verdict line, a Failed: block naming what broke when it did, and the log
path — read that path for anything the report left out. --verbose streams the child's output live
instead of holding it back; --json prints one JSON object and nothing else; --max-lines <n>
overrides how much of the child's own output the report keeps. Named host operations inherit the
terminal so interactive native tools and long-running development servers keep working.
`
}
