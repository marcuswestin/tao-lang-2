import { CLI, Platform, Repo } from '@shared'
import { registerAgentHelpCommand } from './cli/agent-help'
import { runWithCommands } from './cli/run-with-commands'

const JUST_COMMANDS = ['check', 'fix', 'fmt', 'language-performance', 'setup', 'test', 'verify'] as const

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
        const result = await CLI.run('just', {
          args: [command, ...args],
          cwd: Repo.getRoot(),
          stdio: 'inherit',
        })
        Platform.runtimeProcess.setExitCode(result.error === undefined ? result.exitCode ?? 1 : 1)
      })
  }
})
