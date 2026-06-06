import type { Command } from '@commander-js/extra-typings'
import { FS, Platform, Repo } from '@shared'
import { runCommand } from './commands'

const STREAMED_JUST_RECIPES = new Set(['android', 'dev'])

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
  const commandArgs = ['--justfile', FS.repoPath('Justfile'), ...args]
  const repoRoot = Repo.getRoot()
  return await runCommand('just', commandArgs, {
    cwd: repoRoot,
    runQuietly: !shouldStreamJustOutput(args),
  })
}

/** shouldStreamJustOutput returns whether a Just invocation needs inherited output. */
export function shouldStreamJustOutput(args: readonly string[]): boolean {
  return args.length === 0 || args[0] === 'help' || STREAMED_JUST_RECIPES.has(args[0] ?? '')
    || args.includes('--help') || args.includes('-h')
    || args.includes('--list') || args.includes('-l')
}
