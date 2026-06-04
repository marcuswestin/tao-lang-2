import type { Command } from '@commander-js/extra-typings'
import { FS, Platform, Repo } from '@shared'
import { runQuietly, runWithInheritedOutput } from './commands-util'

/** registerJustCommand registers the repo-root Just command passthrough. */
export function registerJustCommand(commands: Command): void {
  commands
    .command('just [args...]')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .passThroughOptions()
    .description('Run a Just recipe from the repo root.')
    .action(async (args: string[] = []) => {
      Platform.runtimeProcess.setExitCode(await runJust(args))
    })
}

/** runJust runs Just from the repo root with output filtering for successful commands. */
async function runJust(args: readonly string[]): Promise<number> {
  const repoRoot = await Repo.getRoot()
  const commandArgs = ['--justfile', FS.joinPath(repoRoot, 'Justfile'), ...args]

  if (shouldStreamJustOutput(args)) {
    return await runWithInheritedOutput('just', commandArgs, repoRoot)
  }

  return await runQuietly('just', commandArgs, repoRoot)
}

/** shouldStreamJustOutput returns whether a Just invocation needs inherited output. */
export function shouldStreamJustOutput(args: readonly string[]): boolean {
  return args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')
    || args.includes('--list') || args.includes('-l')
}
