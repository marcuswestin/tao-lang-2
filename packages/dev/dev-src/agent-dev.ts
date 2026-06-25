import { Platform, Repo } from '@shared'
import { registerAgentHelpCommand } from './commands/agent-help'
import { registerAgentTestCommand } from './commands/agent-test'
import { registerAiUsageCommand } from './commands/ai-usage'
import { registerAuditInstructionsCommand } from './commands/audit-instructions'
import { registerReviewCommand } from './commands/code-review'
import { runCommand, runWithCommands } from './commands/commands'
import { registerJustCommand } from './commands/just'
import { registerMergeFeaturePreflightCommand } from './commands/merge-feature-preflight'

const AGENT_CLIS: readonly string[] = ['codex', 'claude', 'agy', 'cursor', 'gemini', 'codexbar']
const AGENT_SHELL_COMMANDS: readonly string[] = [
  'ls',
  'rg',
  'nl',
  'cat',
  'sed',
  'git',
  'cp',
  'mv',
  'rm',
  'tao',
  'bun',
  'find',
  ...AGENT_CLIS,
]
const command = Platform.runtimeProcess.argv[2]

if (command && AGENT_SHELL_COMMANDS.includes(command)) {
  const commandPath = command === 'tao' ? Repo.resolvePath('tao') : command
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
  registerAgentTestCommand(commands)
  registerAiUsageCommand(commands)
  registerAuditInstructionsCommand(commands)
  registerJustCommand(commands)
  registerMergeFeaturePreflightCommand(commands)
  registerReviewCommand(commands)
})
