import type { Command } from '@commander-js/extra-typings'
import { CLI, HCI, Platform, Repo, Text } from '@shared'

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

  HCI.write(formatAgentHelpText(justHelpLines(result.stdout, justCommands)))
  return 0
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
    if (command === 'setup') {
      return ['    setup                                   # Install dependencies and generate parser and agent adapters']
    }
    return []
  })
}

/** formatAgentHelpText renders the `./agent help` output. */
function formatAgentHelpText(justLines: readonly string[]): string {
  return `
Usage:
  ./agent help
  ./agent <just-command> [args...]

Agent commands:
${Text.indentLines(justLines.join('\n'), 2)}

Examples:
  ./agent bench
  ./agent bench 25
  ./agent test
  ./agent test "formats imports"
  ./agent test packages/parser/parser-tests/Parser.test.ts
  ./agent test-all
  ./agent test-file packages/parser/parser-tests/Parser.test.ts
  ./agent test-changed
  ./agent test-retry
  ./agent verify-changed
  ./agent verify
  ./agent verify-full-sandbox

test takes one optional target and decides by whether it exists on disk: an existing file or
directory is a path, anything else is a test-name pattern. It prints which reading it chose. A bare
test runs the suites the branch diff reaches, which can be green while a suite the change broke
never ran; a name pattern filters those same suites rather than widening back out to all of them.
test-all runs every suite, and takes an optional name pattern of its own.

Each verification scope is its own command rather than a flag: verify-changed runs the gates plus
the test suites the branch diff reaches (iterate with it); verify runs every suite (the gate before
a reviewed commit or a merge); verify-full adds the browser, native, and bundle lanes and needs the
machine to itself; verify-full-sandbox runs that same membership in a managed shell without
claiming its host-only lanes passed. A lane whose tree is already recorded green prints that run's
evidence and stops; --no-cache runs it anyway.
Every lane writes .artifacts/logs/<lane>/latest/ — one <node>.log per gate plus summary.json.
On a failure, read summary.json first: it names the first failing gate and its log.
`
}
