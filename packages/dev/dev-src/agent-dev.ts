import { FS, Platform } from '@shared'
import { registerAgentHelpCommand } from './commands/agent-help'
import { registerAuditInstructionsCommand } from './commands/audit-instructions'
import { runCommand, runWithCommands } from './commands/commands'
import { registerJustCommand } from './commands/just'
import { registerMergeFeaturePreflightCommand } from './commands/merge-feature-preflight'

const AGENT_CLIS: readonly string[] = ['codex', 'claude', 'agy-ide']
const AGENT_SHELL_COMMANDS: readonly string[] = ['ls', 'rg', 'cat', 'sed', 'git', 'cp', 'mv', 'rm', ...AGENT_CLIS]
// Repo root scripts are not on PATH, so they run via their repo-root path from the invocation cwd.
const AGENT_REPO_SCRIPTS: readonly string[] = ['tao']
const command = Platform.runtimeProcess.argv[2]

if (command && AGENT_SHELL_COMMANDS.includes(command)) {
  const exitCode = await runCommand(command, Platform.runtimeProcess.argv.slice(3))
  Platform.runtimeProcess.exit(exitCode)
}

if (command && AGENT_REPO_SCRIPTS.includes(command)) {
  const exitCode = await runCommand(FS.repoPath(command), Platform.runtimeProcess.argv.slice(3))
  Platform.runtimeProcess.exit(exitCode)
}

await runWithCommands(commands => {
  commands
    .name('agent')
    .helpOption(false)
    .helpCommand(false)
    .enablePositionalOptions()

  const helpListedCommands = [...AGENT_SHELL_COMMANDS, ...AGENT_REPO_SCRIPTS, 'just']
  registerAgentHelpCommand(commands, { allowlistedCommands: helpListedCommands })
  registerAuditInstructionsCommand(commands)
  registerJustCommand(commands)
  registerMergeFeaturePreflightCommand(commands)
})
