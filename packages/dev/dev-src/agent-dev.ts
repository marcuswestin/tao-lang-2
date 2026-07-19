import { CLI, Platform, Repo } from '@shared'
import { registerAgentHelpCommand } from './commands/agent-help'
import { registerAiUsageCommand } from './commands/ai-usage'
import { registerReviewCommand } from './commands/code-review'
import { runWithCommands } from './commands/commands-utils'
import { registerMergeFeaturePreflightCommand } from './commands/merge-feature-preflight'

const JUST_COMMANDS = ['check', 'fix', 'fmt', 'test', 'verify'] as const

await runWithCommands(commands => {
  commands
    .name('agent')
    .helpOption(false)
    .helpCommand(false)
    .enablePositionalOptions()

  registerAgentHelpCommand(commands, JUST_COMMANDS)
  for (const command of JUST_COMMANDS) {
    commands
      .command(`${command} [args...]`)
      .allowUnknownOption(true)
      .helpOption(false)
      .passThroughOptions()
      .action(async (args: string[] = []) => {
        const result = await CLI.run('just', {
          args: [command, ...args],
          cwd: Repo.getRoot(),
          stdio: 'inherit',
        })
        Platform.runtimeProcess.setExitCode(result.error === undefined ? result.exitCode ?? 1 : 1)
      })
  }
  registerAiUsageCommand(commands)
  registerMergeFeaturePreflightCommand(commands)
  registerReviewCommand(commands)
})
