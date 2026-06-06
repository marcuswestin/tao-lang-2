import { Command } from '@commander-js/extra-typings'
import { CLI, HCI, Platform } from '@shared'

/** RunCommandOptions configures agent command execution. */
export type RunCommandOptions = {
  cwd?: string
  runQuietly?: boolean
}

/** runCommand runs a command and returns its exit code. */
export async function runCommand(
  command: string,
  args: readonly string[],
  opts: RunCommandOptions = {},
): Promise<number> {
  const result = await CLI.run(command, {
    args,
    cwd: opts.cwd,
    stdio: opts.runQuietly ? undefined : 'inherit',
  })

  if (opts.runQuietly && (result.exitCode !== 0 || result.error !== undefined)) {
    HCI.write(result.stdout)
    HCI.writeError(result.stderr)
  }
  if (result.error !== undefined) {
    HCI.writeError(
      `Error: Failed to execute ${CLI.formatCommand(command, { args })}: ${result.error.message}\n`,
    )
  }

  return result.error ? 1 : (result.exitCode ?? 1)
}

/** runWithCommands runs a Commander program configured by `fn`. */
export async function runWithCommands(fn: (commands: Command) => void): Promise<void> {
  const commands = new Command()
  fn(commands)
  await commands.parseAsync(Platform.runtimeProcess.argv, { from: 'node' })
}
