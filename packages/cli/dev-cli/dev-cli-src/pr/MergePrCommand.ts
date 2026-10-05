import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { archiveStem } from '@verification/MergeWithMain'
import { PrChecksCommand, type PrChecksOptions } from './PrChecksCommand'
import { reviewedMergeMessage } from './ReviewedMergeMessage'

/*
 * `merge-pr` merges this feature branch's pull request on GitHub once hosted CI has proved it. It
 * follows every check on the pushed head to its conclusion, requires the `Verify` verdict among them,
 * then squash-merges with the reviewed merge message, pinned to the head it watched so a later push
 * cannot slip in unproved. `open-pr` has usually turned on auto-merge, in which case GitHub may merge
 * first; a pull request already merged at the watched head is this command's success too. Afterwards it archives the head at `merged/<name>`, exactly where `land`
 * archives a feature branch, and only then deletes the remote branch, so `landed` and `reclaim` read
 * a merged pull request the same way they read a landing. The Verify workflow marks a draft ready once
 * Verify passes; a draft still waiting when the checks end (the workflow lacked its token) is marked
 * ready here, since GitHub refuses to merge a draft. GitHub may already have deleted the branch on
 * merge, which leaves nothing to delete.
 *
 * It is the hosted alternative to `land`, which verifies on this machine under the landing lock;
 * neither runs the host-only lanes the other skips, so choosing between them is the
 * `verification-lanes` skill's call, not this command's. GitHub never merges on its own: nothing here
 * enables auto-merge; that is `open-pr`'s.
 *
 * Like `open-pr`, every `git` and `gh` call goes through the injected `run` seam so a test can script
 * every answer without a real remote.
 */

const FEATURE_BRANCH_PREFIX = 'feat/'
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
  isDraft: boolean
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
    const message = await reviewedMergeMessage(dependencies, root, branch)
    const local = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    const before = await viewPullRequest(dependencies, root, branch)
    if ((before.state !== 'OPEN' && before.state !== 'MERGED') || before.baseRefName !== 'main') {
      Errors.throwUserInput(`#${before.number} is ${before.state.toLowerCase()} against '${before.baseRefName}'.`)
    }
    if (before.headRefOid !== local) {
      Errors.throwUserInput(
        `#${before.number}'s head is ${before.headRefOid.slice(0, 8)}, not this worktree's ${
          local.slice(0, 8)
        }; push with \`./agent unsandboxed open-pr\` first.`,
      )
    }

    // Already merged at this head means auto-merge got there first, behind the required Verify check.
    let after = before
    if (before.state === 'OPEN') {
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
      after = await viewPullRequest(dependencies, root, String(before.number))
      const verdict = (after.statusCheckRollup ?? []).find(check => check.name === VERDICT_CHECK)
      if (after.headRefOid !== local || verdict?.conclusion !== 'SUCCESS') {
        report(
          after.headRefOid !== local
            ? `FAIL  #${after.number}'s head moved to ${after.headRefOid.slice(0, 8)} while its checks ran; not merged.`
            : `FAIL  #${after.number} has no successful ${VERDICT_CHECK} check on ${local.slice(0, 8)}; not merged.`,
        )
        return { exitCode: 1, lines }
      }
      if (after.state !== 'MERGED') {
        after = await mergeUnlessAutoMerged(dependencies, root, after, local, message)
      }
      if (after.state !== 'MERGED') {
        report(`FAIL  #${after.number} is ${after.state.toLowerCase()} after the merge; not archived.`)
        return { exitCode: 1, lines }
      }
    }
    report(`PASS  #${after.number} merged at ${local.slice(0, 8)} after ${VERDICT_CHECK} passed: ${after.url}`)

    const archive = archiveStem(branch)
    await git(dependencies, root, ['push', REMOTE, `${local}:refs/heads/${archive}`])
    report(`PASS  Archived ${local.slice(0, 8)} at ${archive}.`)
    const remoteBranch = await git(dependencies, root, ['ls-remote', '--heads', REMOTE, `refs/heads/${branch}`])
    if (remoteBranch.stdout.trim() === '') {
      report(`PASS  GitHub already deleted ${branch} on merge; this worktree's branch and files are untouched.`)
    } else {
      await git(dependencies, root, ['push', REMOTE, '--delete', branch])
      report(`PASS  Deleted ${branch} from ${REMOTE}; this worktree's branch and files are untouched.`)
    }
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
 * Auto-merge fires within seconds of Verify passing, so this merge can lose that race; GitHub then
 * refuses it as already merged, and the pull request's state, not the refusal, is the answer. A draft
 * is marked ready first, since GitHub refuses to merge one.
 */
async function mergeUnlessAutoMerged(
  dependencies: MergePrDependencies,
  root: string,
  pr: PullRequestView,
  head: string,
  message: { body: string; title: string },
): Promise<PullRequestView> {
  if (pr.isDraft) {
    await gh(dependencies, root, ['pr', 'ready', String(pr.number)])
  }
  const merged = await dependencies.run('gh', {
    args: [
      'pr',
      'merge',
      String(pr.number),
      '--squash',
      '--match-head-commit',
      head,
      '--subject',
      message.title,
      '--body',
      message.body,
    ],
    cwd: root,
    stdio: 'pipe',
  })
  const after = await viewPullRequest(dependencies, root, String(pr.number))
  if (after.state !== 'MERGED') {
    mustSucceed(dependencies, merged)
  }
  return after
}

/** The first view finds the pull request by branch; later ones by number, since a merge deletes the branch. */
async function viewPullRequest(dependencies: MergePrDependencies, root: string, selector: string) {
  const view = await gh(dependencies, root, [
    'pr',
    'view',
    selector,
    '--json',
    'baseRefName,headRefOid,isDraft,number,state,statusCheckRollup,url',
  ])
  return JSON.parse(view.stdout) as PullRequestView
}

async function git(dependencies: MergePrDependencies, cwd: string, args: readonly string[]) {
  return mustSucceed(dependencies, await dependencies.run('git', { args, cwd, stdio: 'pipe' }))
}

async function gh(dependencies: MergePrDependencies, cwd: string, args: readonly string[]) {
  return mustSucceed(dependencies, await dependencies.run('gh', { args, cwd, stdio: 'pipe' }))
}

/** A failure prints what the tool said first: the thrown error names only the command line. */
function mustSucceed(dependencies: MergePrDependencies, result: CLI.CommandResult): CLI.CommandResult {
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    const said = (result.stderr || result.stdout).trim()
    if (said !== '') {
      dependencies.writeLine(`FAIL  ${result.command} said: ${said}`)
    }
    throw new Errors.CommandExecutionError(result)
  }
  return result
}
