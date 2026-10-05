import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { archiveStem, validateMergeMessage } from '@verification/MergeWithMain'
import { PrChecksCommand, type PrChecksOptions } from './PrChecksCommand'

/*
 * `merge-pr` merges this feature branch's pull request on GitHub once hosted CI has proved it. It
 * follows every check on the pushed head to its conclusion, requires the `Verify` verdict among them,
 * then squash-merges with the reviewed merge message, pinned to the head it watched so a later push
 * cannot slip in unproved. Afterwards it archives the head at `merged/<name>`, exactly where `land`
 * archives a feature branch, and only then deletes the remote branch, so `landed` and `reclaim` read
 * a merged pull request the same way they read a landing.
 *
 * It is the hosted alternative to `land`, which verifies on this machine under the landing lock;
 * neither runs the host-only lanes the other skips, so choosing between them is the
 * `verification-lanes` skill's call, not this command's. GitHub never merges on its own: nothing here
 * enables auto-merge.
 *
 * Like `open-pr`, every `git` and `gh` call goes through the injected `run` seam so a test can script
 * every answer without a real remote.
 */

const FEATURE_BRANCH_PREFIX = 'feat/'
const DRAFT_PREFIX = 'DRAFT: '
const REMOTE = 'origin'
/** The workflow job whose success is the hosted verdict; the partitions report into it. */
const VERDICT_CHECK = 'Verify'

/** MergePrDependencies isolates process, filesystem, check-following, and output effects for testing. */
export type MergePrDependencies = {
  exists: (path: string) => Promise<boolean>
  followChecks: (options: PrChecksOptions) => Promise<{ exitCode: number }>
  readText: (path: string) => Promise<string>
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
  writeLine: (line: string) => void
}

const defaultDependencies: MergePrDependencies = {
  exists: FS.exists,
  followChecks: options => PrChecksCommand.run(options),
  readText: FS.readText,
  run: CLI.run,
  writeLine: HCI.writeLine,
}

/** MergePrOptions is the flags-ready input accepted by the development CLI command. */
export type MergePrOptions = {
  /** How often to poll the checks while they run. */
  intervalMs?: number
  repositoryRoot?: string
}

type PullRequestView = {
  baseRefName: string
  headRefOid: string
  number: number
  state: string
  statusCheckRollup?: { conclusion?: string; name?: string }[]
  url: string
}

/** MergePrCommand is the CLI wiring surface consumed by `dev.ts`. */
export const MergePrCommand = {
  async run(
    options: MergePrOptions = {},
    dependencies: MergePrDependencies = defaultDependencies,
  ): Promise<{ exitCode: number; lines: string[] }> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const lines: string[] = []
    const report = (line: string): void => {
      lines.push(line)
      dependencies.writeLine(line)
    }

    const branch = await requireFeatureBranch(dependencies, root)
    const status = (await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
    if (status !== '') {
      Errors.throwUserInput(`The worktree has uncommitted changes; commit and push them first:\n${status.trimEnd()}`)
    }
    const message = await reviewedMessage(dependencies, root, branch)
    const local = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    const before = await viewPullRequest(dependencies, root, branch)
    if (before.state !== 'OPEN' || before.baseRefName !== 'main') {
      Errors.throwUserInput(`#${before.number} is ${before.state.toLowerCase()} against '${before.baseRefName}'.`)
    }
    if (before.headRefOid !== local) {
      Errors.throwUserInput(
        `#${before.number}'s head is ${before.headRefOid.slice(0, 8)}, not this worktree's ${
          local.slice(0, 8)
        }; push with \`./agent unsandboxed open-pr\` first.`,
      )
    }

    const checks = await dependencies.followChecks({
      intervalMs: options.intervalMs,
      pr: before.number,
      repositoryRoot: root,
      wait: true,
    })
    if (checks.exitCode !== 0) {
      report(`FAIL  #${before.number} is not merged: its checks did not all pass.`)
      return { exitCode: 1, lines }
    }
    const after = await viewPullRequest(dependencies, root, branch)
    const verdict = (after.statusCheckRollup ?? []).find(check => check.name === VERDICT_CHECK)
    if (after.headRefOid !== local || verdict?.conclusion !== 'SUCCESS') {
      report(
        after.headRefOid !== local
          ? `FAIL  #${after.number}'s head moved to ${after.headRefOid.slice(0, 8)} while its checks ran; not merged.`
          : `FAIL  #${after.number} has no successful ${VERDICT_CHECK} check on ${local.slice(0, 8)}; not merged.`,
      )
      return { exitCode: 1, lines }
    }

    const [title, , ...body] = message.split('\n')
    await gh(dependencies, root, [
      'pr',
      'merge',
      String(after.number),
      '--squash',
      '--match-head-commit',
      local,
      '--subject',
      title!,
      '--body',
      body.join('\n'),
    ])
    report(`PASS  Squash-merged #${after.number} at ${local.slice(0, 8)} after ${VERDICT_CHECK} passed: ${after.url}`)

    const archive = archiveStem(branch)
    await git(dependencies, root, ['push', REMOTE, `${local}:refs/heads/${archive}`])
    report(`PASS  Archived ${local.slice(0, 8)} at ${archive}.`)
    await git(dependencies, root, ['push', REMOTE, '--delete', branch])
    report(`PASS  Deleted ${branch} from ${REMOTE}; this worktree's branch and files are untouched.`)
    return { exitCode: 0, lines }
  },
} as const

async function requireFeatureBranch(dependencies: MergePrDependencies, root: string): Promise<string> {
  const result = await dependencies.run('git', {
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd: root,
    stdio: 'pipe',
  })
  const branch = result.exitCode === 0 ? result.stdout.trim() : ''
  if (!branch.startsWith(FEATURE_BRANCH_PREFIX)) {
    Errors.throwUserInput(`merge-pr needs a feat/<name> branch checked out, not '${branch || 'a detached HEAD'}'.`)
  }
  return branch
}

/**
 * The squash commit's message is the one an author reviewed at `finalize`'s path, held to the same
 * shape `land` requires; a mechanical `DRAFT:` is refused exactly as `land` refuses it.
 */
async function reviewedMessage(dependencies: MergePrDependencies, root: string, branch: string): Promise<string> {
  const messageFile = FS.resolvePath(`.artifacts/merge/${branch}.msg`, root)
  if (!await dependencies.exists(messageFile)) {
    Errors.throwUserInput(`Write and review the merge message first: ${messageFile}`)
  }
  const message = validateMergeMessage(await dependencies.readText(messageFile))
  if (message.startsWith(DRAFT_PREFIX)) {
    Errors.throwUserInput(`Review the drafted merge message and remove its '${DRAFT_PREFIX}' prefix: ${messageFile}`)
  }
  return message
}

async function viewPullRequest(dependencies: MergePrDependencies, root: string, branch: string) {
  const view = await gh(dependencies, root, [
    'pr',
    'view',
    branch,
    '--json',
    'baseRefName,headRefOid,number,state,statusCheckRollup,url',
  ])
  return JSON.parse(view.stdout) as PullRequestView
}

async function git(dependencies: MergePrDependencies, cwd: string, args: readonly string[]) {
  return mustSucceed(await dependencies.run('git', { args, cwd, stdio: 'pipe' }))
}

async function gh(dependencies: MergePrDependencies, cwd: string, args: readonly string[]) {
  return mustSucceed(await dependencies.run('gh', { args, cwd, stdio: 'pipe' }))
}

function mustSucceed(result: CLI.CommandResult): CLI.CommandResult {
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    throw new Errors.CommandExecutionError(result)
  }
  return result
}
