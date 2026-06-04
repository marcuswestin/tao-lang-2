import { CLI, Platform } from '@shared'

/** runWithInheritedOutput runs a command while inheriting stdio and returns its exit code. */
export async function runWithInheritedOutput(command: string, args: readonly string[], cwd: string): Promise<number> {
  const result = await CLI.run({
    command,
    args,
    cwd,
    stdio: 'inherit',
  })

  if (result.error !== undefined) {
    Platform.runtimeProcess.stderr.write(
      `Error: Failed to execute ${CLI.formatCommand({ command, args })}: ${result.error.message}\n`,
    )
  }

  return result.error ? 1 : (result.exitCode ?? 1)
}

/** runQuietly runs a command and only replays captured output on failure. */
export async function runQuietly(command: string, args: readonly string[], cwd: string): Promise<number> {
  const result = await CLI.run({ command, args, cwd })

  if (result.exitCode !== 0 || result.error !== undefined) {
    Platform.runtimeProcess.stdout.write(result.stdout)
    Platform.runtimeProcess.stderr.write(result.stderr)

    if (result.error !== undefined) {
      Platform.runtimeProcess.stderr.write(
        `Error: Failed to execute ${CLI.formatCommand({ command, args })}: ${result.error.message}\n`,
      )
    }
  }

  return result.error ? 1 : (result.exitCode ?? 1)
}
