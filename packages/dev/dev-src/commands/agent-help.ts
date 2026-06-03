import type { Command } from '@commander-js/extra-typings'
import { CLI } from '@shared'
import { REPO_ROOT } from './commands-util'
import { MAIN_JUSTFILE } from './just'

/** AgentHelpOptions declares the command names printed by agent help. */
export type AgentHelpOptions = {
  allowlistedCommands: readonly string[]
}

/** registerAgentHelpCommand registers `./agent help`. */
export function registerAgentHelpCommand(commands: Command, opts: AgentHelpOptions): void {
  commands.action(async () => {
    process.exitCode = await printAgentHelp(opts.allowlistedCommands)
  })
  commands
    .command('help')
    .description('Print available recipes and allowlisted commands.')
    .action(async () => {
      process.exitCode = await printAgentHelp(opts.allowlistedCommands)
    })
}

async function printAgentHelp(allowlistedCommands: readonly string[]): Promise<number> {
  const justList = await CLI.run({
    command: 'just',
    args: ['--justfile', MAIN_JUSTFILE, '--list'],
    cwd: REPO_ROOT,
  })

  if (justList.exitCode !== 0) {
    process.stdout.write(justList.stdout)
    process.stderr.write(justList.stderr)
    return justList.exitCode ?? 1
  }

  process.stdout.write(`
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
  ./agent just check
  ./agent just test
  ./agent rg -n "pattern" packages

Just recipes:
${indent(justList.stdout.trimEnd())}

Allowlisted shell commands:
`)

  for (const command of allowlistedCommands) {
    process.stdout.write(`    ${command}\n`)
  }

  return 0
}

function indent(text: string): string {
  return text.split('\n').map(line => `  ${line}`).join('\n')
}
