import { runWithCommands } from '@cli-kit/RunWithCommands'
import { Platform } from '@shared'
import { JUST_COMMANDS, recipeFor } from './AgentCommands'
import { registerAgentHelpCommand } from './cli/agent-help'
import { runAgentCommand } from './runner/AgentRunner'

/** Agent-facing CLI entrypoint: expose only the repository workflows intended for `./agent`. */
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
        const exitCode = await runAgentCommand({
          args,
          command,
          spawnArgs: [recipeFor(command)],
          spawnCommand: 'just',
        })
        Platform.runtimeProcess.setExitCode(exitCode)
      })
  }
})
