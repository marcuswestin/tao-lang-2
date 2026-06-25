import type { Command } from '@commander-js/extra-typings'
import { Platform, Repo } from '@shared'
import { runCommand } from './commands'

/** registerAgentTestCommand registers the agent-friendly test runner. */
export function registerAgentTestCommand(commands: Command): void {
  commands
    .command('test [pattern]')
    .description('Run package tests with prefixed interleaved line output.')
    .action(async (pattern = '') => {
      Platform.runtimeProcess.setExitCode(await runAgentTest(pattern))
    })
}

/** runAgentTest runs dev tests with line-oriented output for agent terminals. */
export async function runAgentTest(pattern = ''): Promise<number> {
  const compileExitCode = await runCommand('just', [
    '--justfile',
    Repo.resolvePath('Justfile'),
    '_compile-kitchen-sink-app',
  ], { cwd: Repo.getRoot() })
  if (compileExitCode !== 0) {
    return compileExitCode
  }

  return await runCommand('bun', [
    'run',
    Repo.resolvePath('packages/dev/dev-src/dev.ts'),
    'test',
    '--output',
    'lines',
    ...(pattern === '' ? [] : [pattern]),
  ], { cwd: Repo.getRoot() })
}
