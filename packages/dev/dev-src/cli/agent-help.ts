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
  const commandSet = new Set(commands)
  return output.split('\n').filter(line => commandSet.has(line.trimStart().split(/\s+/, 1)[0] ?? ''))
}

/** formatAgentHelpText renders the `./agent help` output. */
function formatAgentHelpText(justLines: readonly string[]): string {
  return `
Usage:
  ./agent help
  ./agent <just-command> [args...]

Just passthrough commands:
${Text.indentLines(justLines.join('\n'), 2)}

Examples:
  ./agent language-performance
  ./agent language-performance 25
  ./agent test
  ./agent test "formats imports"
  ./agent verify
`
}
