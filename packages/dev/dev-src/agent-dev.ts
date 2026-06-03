import { runWithCommands } from './commands/commands'

import { registerAgentHelpCommand } from './commands/agent-help'
import { runWithInheritedOutput } from './commands/commands-util'
import { registerJustCommand } from './commands/just'

const AGENT_SHELL_COMMANDS: readonly string[] = ['ls', 'rg', 'cat', 'sed', 'git', 'cp', 'mv', 'rm']
const invocationCwd = process.env['TAO_AGENT_CWD'] ?? process.cwd()
const command = Bun.argv[2]

if (command && AGENT_SHELL_COMMANDS.includes(command)) {
  const exitCode = await runWithInheritedOutput(command, Bun.argv.slice(3), invocationCwd)
  process.exit(exitCode)
}

await runWithCommands(commands => {
  commands
    .name('agent')
    .helpOption(false)
    .helpCommand(false)
    .enablePositionalOptions()

  const helpListedCommands = [...AGENT_SHELL_COMMANDS, 'just']
  registerAgentHelpCommand(commands, { allowlistedCommands: helpListedCommands })
  registerJustCommand(commands)
})
