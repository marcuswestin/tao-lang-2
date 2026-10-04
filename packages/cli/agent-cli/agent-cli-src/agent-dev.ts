import { runWithCommands } from '@cli-kit/RunWithCommands'
import { CLI, Platform } from '@shared'
import { JUST_COMMANDS, recipeFor } from './AgentCommands'
import { registerAgentHelpCommand } from './cli/agent-help'
import { runAgentCommand } from './runner/AgentRunner'

/**
 * A front-door flag (`--verbose`, `--json`, `--max-lines`) only means something after the command
 * name: `AgentFlags` reads it out of that command's own argument list. Given first, Commander itself
 * rejects it as an unknown top-level option before a command is even chosen; this appends the hint
 * rather than accepting the flags in both positions, which would let their meaning depend on which
 * command's parser saw them first.
 */
const FRONT_DOOR_FLAG_HINT = 'Front-door flags (--verbose, --json, --max-lines) go after the command, not before it: '
  + '`./agent <command> --verbose`.'

/** Agent-facing CLI entrypoint: expose only the repository workflows intended for `./agent`. */
await runWithCommands(commands => {
  commands
    .name('agent')
    .helpOption(false)
    .helpCommand(false)
    .enablePositionalOptions()
    .configureOutput({
      outputError: (message, write) => {
        write(message)
        if (message.startsWith('error: unknown option')) {
          write(`${FRONT_DOOR_FLAG_HINT}\n`)
        }
      },
    })

  registerAgentHelpCommand(commands, JUST_COMMANDS)
  commands
    .command('tao [args...]')
    .allowUnknownOption(true)
    .helpOption(false)
    .passThroughOptions()
    .action(async (args: string[] = []) => {
      const result = await CLI.run('./tao', { args, stdio: 'inherit' })
      Platform.runtimeProcess.setExitCode(result.exitCode ?? 1)
    })
  for (
    const [command, description] of [
      [
        'start-branch',
        'Start a feat/* branch from fetched origin/main after checking checkout writes, then run setup.',
      ],
      ['take-branch', 'Take over a pushed feat/* branch with tracking after checking checkout writes, then run setup.'],
    ] as const
  ) {
    commands
      .command(`${command} <name>`)
      .description(description)
      .action(async (name: string) => {
        const exitCode = await runAgentCommand({
          args: [name],
          command,
          spawnArgs: [command],
          spawnCommand: './dev',
        })
        Platform.runtimeProcess.setExitCode(exitCode)
      })
  }
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
