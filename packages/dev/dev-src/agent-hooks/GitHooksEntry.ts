import { CLI, FS, HCI, Platform } from '@shared'
import { branchWarnings, commitMessageWarnings } from './CommitChecks'
import { gitHooksDir, installGitHooks } from './GitHooksInstaller'

/** The dispatch entry the `agent-git-hooks.zsh` shim runs once per Git hook event: `commit-msg`
 * and `pre-commit` report what a commit will carry into history or which branch it lands on, and
 * `install` writes the shared entry scripts. All three only warn; the shim always exits 0. */

/** currentBranch reports the branch this worktree's HEAD names, or undefined for a detached HEAD. */
async function currentBranch(worktree: string): Promise<string | undefined> {
  const result = await CLI.run('git', { args: ['-C', worktree, 'symbolic-ref', '--quiet', '--short', 'HEAD'] })
  return result.exitCode === 0 ? result.stdout.trim() : undefined
}

function reportWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    HCI.writeErrorLine(`warning: ${warning}`)
  }
}

if (import.meta.main) {
  const [event, ...args] = Platform.runtimeProcess.argv.slice(2)
  const toplevel = await CLI.run('git', { args: ['rev-parse', '--show-toplevel'] })
  const worktree = toplevel.exitCode === 0 ? toplevel.stdout.trim() : undefined

  if (worktree !== undefined) {
    if (event === 'commit-msg') {
      const path = args[0]
      const message = path !== undefined && (await FS.exists(path)) ? await FS.readText(path) : ''
      reportWarnings(commitMessageWarnings(message))
    } else if (event === 'pre-commit') {
      reportWarnings(branchWarnings(await currentBranch(worktree)))
    } else if (event === 'install') {
      const hooksDir = args[0] ?? (await gitHooksDir(worktree))
      if (hooksDir !== undefined) {
        for (const line of await installGitHooks(hooksDir)) {
          HCI.writeLine(line)
        }
      }
    }
  }
}
