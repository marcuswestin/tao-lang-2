import type { Command } from '@commander-js/extra-typings'
import { FS } from '@shared'
import { REPO_ROOT, runQuietly, runWithInheritedOutput } from './commands-util'

export const MAIN_JUSTFILE = FS.joinPath(REPO_ROOT, 'Justfile')

/** registerJustCommand registers the repo-root Just command passthrough. */
export function registerJustCommand(commands: Command): void {
  commands
    .command('just [args...]')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .passThroughOptions()
    .description('Run a Just recipe from the repo root.')
    .action(async (args: string[] = []) => {
      process.exitCode = await runJust(args)
    })
}

/** runJust runs Just from the repo root with output filtering for successful commands. */
export async function runJust(args: readonly string[]): Promise<number> {
  const commandArgs = ['--justfile', MAIN_JUSTFILE, ...args]

  if (shouldShowJustOutput(args)) {
    return await runWithInheritedOutput('just', commandArgs, REPO_ROOT)
  }

  return await runQuietly('just', commandArgs, REPO_ROOT)
}

function shouldShowJustOutput(args: readonly string[]): boolean {
  return args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')
    || args.includes('--list') || args.includes('-l')
}
