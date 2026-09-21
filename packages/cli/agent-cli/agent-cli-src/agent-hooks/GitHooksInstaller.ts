import * as CLI from '@shared/CLI'
import * as FS from '@shared/FS'

/** Writes the repository's warn-only Git hooks into the hooks directory a checkout's worktrees
 * share. The entry script it writes asks the committing worktree for its own copy of the shim and
 * exits silently when that worktree has none. A hook this repository did not write is left alone. */

const GIT_HOOK_MARKER = '# tao-warn-only-git-hook'
const GIT_HOOK_SCRIPT = 'packages/cli/agent-cli/agent-cli-src/cli/agent-git-hooks.zsh'
/** The pre-split location, tried second so a worktree that has not yet merged the split still works. */
const GIT_HOOK_SCRIPT_LEGACY = 'packages/dev/dev-src/cli/agent-git-hooks.zsh'
const GIT_HOOK_EVENTS = ['commit-msg', 'pre-commit'] as const

/** gitHooksDir resolves the directory Git reads this worktree's hooks from, which linked
 * worktrees share. */
export async function gitHooksDir(worktree: string): Promise<string | undefined> {
  const configured = await CLI.run('git', { args: ['-C', worktree, 'config', '--get', 'core.hooksPath'] })
  const configuredPath = configured.exitCode === 0 ? configured.stdout.trim() : ''
  if (configuredPath !== '') {
    return FS.resolvePath(configuredPath, worktree)
  }
  const common = await CLI.run('git', { args: ['-C', worktree, 'rev-parse', '--git-common-dir'] })
  if (common.exitCode !== 0) {
    return undefined
  }
  return FS.resolvePath('hooks', FS.resolvePath(common.stdout.trim(), worktree))
}

/** gitHookEntry returns the entry script text for one hook event. */
function gitHookEntry(event: string): string {
  return `#!/bin/zsh
${GIT_HOOK_MARKER} ${event}
# Written by \`./agent setup\`. Asks the committing worktree for its own copy; never fails a commit.
emulate zsh
worktree="$(git rev-parse --show-toplevel 2>/dev/null)"
script="$worktree/${GIT_HOOK_SCRIPT}"
[[ -x "$script" ]] || script="$worktree/${GIT_HOOK_SCRIPT_LEGACY}"
[[ -n "$worktree" && -x "$script" ]] && "$script" ${event} "$@"
exit 0
`
}

/** isRepositoryHook reports whether a hook file is one this repository wrote, by its marker. */
async function isRepositoryHook(path: string): Promise<boolean> {
  const head = (await FS.readText(path)).split('\n').slice(0, 3).join('\n')
  return head.includes(GIT_HOOK_MARKER)
}

/** installGitHooks writes an entry script per event, leaving any hook this repository did not
 * write in place. It returns one line per event saying what it did. */
export async function installGitHooks(hooksDir: string): Promise<string[]> {
  try {
    await FS.mkdir(hooksDir)
  } catch {
    return [`Skipped Git hooks: ${hooksDir} is not writable.`]
  }

  const report: string[] = []
  for (const event of GIT_HOOK_EVENTS) {
    const target = FS.resolvePath(event, hooksDir)
    if (await FS.exists(target) && !(await isRepositoryHook(target))) {
      report.push(`Left ${event} in place: it was not written by this repository.`)
      continue
    }
    try {
      await FS.writeText(target, gitHookEntry(event))
      await FS.chmod(target, 0o755)
    } catch {
      report.push(`Skipped ${event}: ${target} is not writable.`)
      continue
    }
    report.push(`Installed ${event}.`)
  }
  return report
}
