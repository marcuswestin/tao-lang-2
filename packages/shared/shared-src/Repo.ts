import * as CLI from './CLI'
import { runtimeProcess } from './Platform'

/** getRoot returns the root directory of the current Git worktree. */
export async function getRoot(cwd = runtimeProcess.cwd()): Promise<string> {
  const result = await CLI.mustRun({
    command: 'git',
    args: ['rev-parse', '--show-toplevel'],
    cwd,
  })

  return result.stdout.trim()
}
