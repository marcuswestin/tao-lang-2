import { CLI, Errors, FS, HCI, Repo } from '@shared'
import type { FinalizeState } from '@verification/Finalize'
import { type BoardWorktree, readCurrentWorktreeStatus } from './Board'

type ChangedPaths = {
  conflicts: string[]
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

/** Read only the checkout in hand, leaving its index, refs, and other worktrees alone. */
export async function readMyStatus(root: string = Repo.getRoot(), run: typeof CLI.run = CLI.run): Promise<string> {
  const [worktree, status, head] = await Promise.all([
    readCurrentWorktreeStatus(root, run),
    run('git', { args: ['status', '--porcelain=v1', '--untracked-files=all'], cwd: root, stdio: 'pipe' }),
    run('git', { args: ['rev-parse', 'HEAD'], cwd: root, stdio: 'pipe' }),
  ])
  if (status.exitCode !== 0 || status.error !== undefined) {
    throw new Errors.CommandExecutionError(status)
  }
  if (head.exitCode !== 0 || head.error !== undefined) {
    throw new Errors.CommandExecutionError(head)
  }
  const branch = worktree.branch
  const headSha = head.stdout.trim()
  const state = branch === undefined
    ? undefined
    : await FS.readJson<Partial<FinalizeState>>(FS.resolvePath(`.artifacts/merge/${branch}.state.json`, root))
      .catch(() => undefined)
  return formatMyStatus(root, worktree, changedPaths(status.stdout), headSha, state)
}

function changedPaths(porcelain: string): ChangedPaths {
  const changes: ChangedPaths = { conflicts: [], staged: [], unstaged: [], untracked: [] }
  for (const line of porcelain.trimEnd().split('\n').filter(Boolean)) {
    const code = line.slice(0, 2)
    const path = line.slice(3)
    if (code === '??') {
      changes.untracked.push(path)
    } else if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code)) {
      changes.conflicts.push(path)
    } else {
      if (code[0] !== ' ') {
        changes.staged.push(path)
      }
      if (code[1] !== ' ') {
        changes.unstaged.push(path)
      }
    }
  }
  return changes
}

function formatMyStatus(
  root: string,
  worktree: BoardWorktree,
  changes: ChangedPaths,
  headSha: string,
  state: Partial<FinalizeState> | undefined,
): string {
  const branch = worktree.branch
  const behind = worktree.behindMain
  const ahead = worktree.aheadOfMain
  const divergence = behind === undefined || ahead === undefined
    ? 'unknown'
    : `ahead ${ahead}, behind ${behind}`
  const verification = worktree.verification === undefined
    ? 'none recorded'
    : `${worktree.verification.lane} at ${worktree.verification.at} (${
      worktree.verification.status === 'current'
        ? 'current tree and toolchain'
        : worktree.verification.status === 'tree-changed'
        ? 'tree changed'
        : worktree.verification.status === 'toolchain-changed'
        ? 'toolchain changed'
        : 'current state unknown'
    })`
  const message = !worktree.mergeMessagePresent
    ? 'absent'
    : state?.messageHeadSha === headSha
    ? 'present; recorded for current HEAD'
    : state?.messageHeadSha
    ? `present; recorded for ${state.messageHeadSha.slice(0, 10)}`
    : 'present; HEAD coverage unknown'
  const lines = [
    `Checkout: ${root}`,
    `Branch: ${branch ?? '(detached HEAD)'}`,
    `Local main: ${divergence}`,
    `Verification: ${verification}`,
    `Merge message: ${message}`,
  ]
  const groups = [
    ['Conflicts', changes.conflicts],
    ['Staged', changes.staged],
    ['Unstaged', changes.unstaged],
    ['Untracked', changes.untracked],
  ] as const
  if (groups.every(([, paths]) => paths.length === 0)) {
    lines.push('Changes: clean')
  } else {
    for (const [label, paths] of groups) {
      if (paths.length > 0) {
        lines.push(`${label} (${paths.length}):`, ...paths.map(path => `  ${path}`))
      }
    }
  }
  const dirty = groups.some(([, paths]) => paths.length > 0)
  const next = branch === undefined || branch === 'main'
    ? 'Run `just my-branch` before editing.'
    : changes.conflicts.length > 0
    ? 'Resolve the conflicts in this checkout.'
    : dirty
    ? 'Coordinate ownership, then stage and commit only your intended paths.'
    : behind !== undefined && behind > 0
    ? 'Run `just my-sync` when you are ready to bring in main.'
    : ahead !== undefined && ahead > 0
    ? 'Review this branch for landing when you choose.'
    : 'No pending local work.'
  lines.push(`Next: ${next}`)
  return lines.join('\n')
}

/** MyStatusCommand is the read-only `./dev my-status` entry point. */
export const MyStatusCommand = {
  async run(): Promise<number> {
    try {
      HCI.writeLine(await readMyStatus())
      return 0
    } catch (error) {
      HCI.writeErrorLine(Errors.formatForUser(error))
      return 1
    }
  },
} as const
