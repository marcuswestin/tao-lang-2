import * as CLI from './CLI'
import { runtimeProcess } from './Platform'

const rootByCwd = new Map<string, string>()

/** getRoot returns the root directory of the current Git worktree. */
export function getRoot(cwd = runtimeProcess.cwd()): string {
  const cached = rootByCwd.get(cwd)
  if (cached !== undefined) {
    return cached
  }

  const result = CLI.mustRunSync('git', {
    args: ['rev-parse', '--show-toplevel'],
    cwd,
  })

  const root = result.stdout.trim()
  rootByCwd.set(cwd, root)
  return root
}
