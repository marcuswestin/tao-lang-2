import type { Command } from '@commander-js/extra-typings'
import { CLI, FS, HCI, Platform, Repo, Text } from '@shared'

/** AgentHelpOptions declares the command names printed by agent help. */
type AgentHelpOptions = {
  allowlistedCommands: readonly string[]
}

/** registerAgentHelpCommand registers `./agent help`. */
export function registerAgentHelpCommand(commands: Command, opts: AgentHelpOptions): void {
  commands.action(async () => {
    Platform.runtimeProcess.setExitCode(await printAgentHelp(opts.allowlistedCommands))
  })
  commands
    .command('help')
    .description('Print available recipes and allowlisted commands.')
    .action(async () => {
      Platform.runtimeProcess.setExitCode(await printAgentHelp(opts.allowlistedCommands))
    })
}

async function printAgentHelp(allowlistedCommands: readonly string[]): Promise<number> {
  const repoRoot = Repo.getRoot()
  const justList = await CLI.run('just', {
    args: ['--justfile', FS.repoPath('Justfile'), '--list'],
    cwd: repoRoot,
  })

  if (justList.exitCode !== 0) {
    HCI.write(justList.stdout)
    HCI.writeError(justList.stderr)
    return justList.exitCode ?? 1
  }

  HCI.write(`
Usage:
  ./agent help
  ./agent just <recipe> [args...]
  ./agent <allowlisted-command> [args...]

Behavior:
  - just recipes run from the repo root.
  - successful just recipe output is hidden to save tokens.
  - failed just recipes replay captured stdout/stderr.
  - shell commands run from the directory where ./agent was invoked.
  - use shell cd or tool workdir before invoking ./agent when you need another cwd.

Examples:
  ./agent just prep
  ./agent just test
  ./agent rg -n 'pattern' packages

Just recipes:
${Text.indentLines(justList.stdout.trimEnd(), 2)}

Allowlisted shell commands:
`)

  for (const command of allowlistedCommands) {
    HCI.writeLine(`    ${command}`)
  }

  return 0
}
