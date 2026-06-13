import { FS, Platform } from '@shared'
import { registerAgentHelpCommand } from './commands/agent-help'
import { registerAuditInstructionsCommand } from './commands/audit-instructions'
import { runCommand, runWithCommands } from './commands/commands'
import { registerJustCommand } from './commands/just'
import { registerMergeFeaturePreflightCommand } from './commands/merge-feature-preflight'

const AGENT_CLIS: readonly string[] = ['codex', 'claude', 'agy-ide']
const AGENT_SHELL_COMMANDS: readonly string[] = [
  'ls',
  'rg',
  'cat',
  'sed',
  'git',
  'cp',
  'mv',
  'rm',
  'tao',
  'bun',
  ...AGENT_CLIS,
]
const command = Platform.runtimeProcess.argv[2]

if (command && AGENT_SHELL_COMMANDS.includes(command)) {
  const commandPath = command === 'tao' ? FS.repoPath('tao') : command
  const exitCode = await runCommand(commandPath, Platform.runtimeProcess.argv.slice(3))
  Platform.runtimeProcess.exit(exitCode)
}

await runWithCommands(commands => {
  commands
    .name('agent')
    .helpOption(false)
    .helpCommand(false)
    .enablePositionalOptions()

  const helpListedCommands = [...AGENT_SHELL_COMMANDS, 'just']
  registerAgentHelpCommand(commands, { allowlistedCommands: helpListedCommands })
  registerAuditInstructionsCommand(commands)
  registerJustCommand(commands)
  registerMergeFeaturePreflightCommand(commands)
})
