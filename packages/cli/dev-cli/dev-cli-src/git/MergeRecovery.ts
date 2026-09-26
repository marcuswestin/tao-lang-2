import { CLI, Errors, HCI, Repo } from '@shared'

/** Recover a direct Git merge from a host shell when protected worktree files blocked sandboxed Git. */
export const MergeRecovery = {
  async run(options: { hard?: boolean; resetTo?: string; root?: string } = {}): Promise<void> {
    const root = options.root ?? Repo.getRoot()
    const branch = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    if (branch.exitCode !== 0 || branch.stdout.trim() === 'main') {
      Errors.throwUserInput('merge-recover requires a checked-out branch other than main.')
    }

    const mergeHead = await git(root, ['rev-parse', '--verify', '-q', 'MERGE_HEAD'])
    if (mergeHead.exitCode === 0) {
      if (options.resetTo !== undefined || options.hard === true) {
        Errors.throwUserInput('A merge is in progress. Run `./agent unsandboxed merge-recover` to abort it first.')
      }
      await gitOrThrow(root, ['merge', '--abort'])
      HCI.writeLine('Aborted the in-progress merge on the host.')
      return
    }

    const target = options.resetTo
    if (target === undefined) {
      if (options.hard === true) {
        Errors.throwUserInput('--hard requires --reset-to with the full pre-merge commit SHA.')
      }
      Errors.throwUserInput(
        'No merge is in progress. If a direct merge partially changed HEAD or the index, inspect '
          + '`git status`, `git reflog -1`, and `git rev-parse ORIG_HEAD`; then run '
          + '`./agent unsandboxed merge-recover --reset-to <pre-merge-sha>`.',
      )
    }
    if (!/^[0-9a-f]{40}$/u.test(target)) {
      Errors.throwUserInput('--reset-to requires the full 40-character pre-merge commit SHA.')
    }
    const original = await gitOrThrow(root, ['rev-parse', '--verify', 'ORIG_HEAD^{commit}'])
    if (original.stdout.trim() !== target) {
      Errors.throwUserInput("--reset-to must equal this checkout's ORIG_HEAD; inspect the reflog before resetting.")
    }
    const mode = options.hard === true ? '--hard' : '--merge'
    const reset = await git(root, ['reset', mode, target])
    if (reset.error !== undefined || reset.exitCode !== 0) {
      Errors.throwHostEnvironment(
        `${reset.stderr.trim() || reset.error?.message || 'git reset failed.'}`
          + (mode === '--merge'
            ? ' Review the remaining edits before considering --hard, which discards tracked work.'
            : ''),
      )
    }
    HCI.writeLine(`Restored the pre-merge commit ${target} with git reset ${mode}.`)
  },
} as const

async function git(root: string, args: readonly string[]): Promise<CLI.CommandResult> {
  return await CLI.run('git', { args, cwd: root })
}

async function gitOrThrow(root: string, args: readonly string[]): Promise<CLI.CommandResult> {
  const result = await git(root, args)
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment(result.stderr.trim() || result.error?.message || `git ${args[0]} failed.`)
  }
  return result
}
