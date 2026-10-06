import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { archiveStem } from '@verification/MergeWithMain'
import { gitHubPulls, isMerged, mustSucceed, type PullRequest, requirePrBranch } from './GitHubPulls'
import { PrChecksCommand, type PrChecksOptions } from './PrChecksCommand'
import { reviewedMergeMessage } from './ReviewedMergeMessage'

/*
 * `merge-pr` merges this branch's pull request on GitHub once hosted CI has proved it. It follows
 * every check on the pushed head to its conclusion, requires the `Verify` verdict among them, then
 * squash-merges with the reviewed merge message, pinned to the head it watched so a later push
 * cannot slip in unproved. `open-pr` leaves auto-merge off unless `--auto-merge` is requested, in
 * which case GitHub may merge first; a pull request already merged at the watched head is this
 * command's success too. Afterwards it archives the head at `merged/<name>`, exactly where `land`
 * archives a feature branch, and only then deletes the remote branch, so `landed` and `reclaim` read
 * a merged pull request the same way they read a landing. The Verify workflow marks a draft ready once
 * Verify passes; a draft still waiting when the checks end (the workflow lacked its token) is marked
 * ready here, since GitHub refuses to merge a draft. GitHub may already have deleted the branch on
 * merge, which leaves nothing to delete.
 *
 * Where `main`'s rules require a merge queue, GitHub refuses a direct merge from anyone outside the
 * ruleset's bypass list, and from anyone on it the merge would skip the queue's own Verify run on the
 * combined tree. So there it enqueues the pull request instead, through `gh pr merge --auto`, pinned to
 * the watched head with `--match-head-commit`, after setting its title and description to the reviewed
 * message, which is what the queue's squash commit carries. It then waits for the queue to merge it,
 * and fails if the queue drops it. A pull request `open-pr --auto-merge` already queued is not queued
 * again, only waited for.
 *
 * It is the hosted alternative to `land`, which verifies on this machine under the landing lock;
 * neither runs the host-only lanes the other skips, so choosing between them is the
 * `verification-lanes` skill's call, not this command's. Outside the merge queue GitHub never merges
 * on its own: nothing here enables auto-merge there; `open-pr` only does so when explicitly requested.
 *
 * Like `open-pr`, every `git` and `gh` call goes through the injected `run` seam so a test can script
 * every answer without a real remote, and every GitHub read and the merge itself go through REST
 * (`GitHubPulls`), so it works where a host's proxy refuses `gh pr`'s GraphQL.
 */

const REMOTE = 'origin'
/** The workflow job whose success is the hosted verdict; the partitions report into it. */
const VERDICT_CHECK = 'Verify'
const MAIN_BRANCH = 'main'
/** How often to read a queued pull request's state; a merge group runs Verify for many minutes. */
const QUEUE_POLL_MS = 60_000

/** MergePrDependencies isolates process, filesystem, check-following, and output effects for testing. */
export type MergePrDependencies = {
  exists: (path: string) => Promise<boolean>
  followChecks: (options: PrChecksOptions) => Promise<{ exitCode: number }>
  readText: (path: string) => Promise<string>
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
  sleep: (ms: number) => Promise<void>
  writeLine: (line: string) => void
}

const defaultDependencies: MergePrDependencies = {
  exists: FS.exists,
  followChecks: options => PrChecksCommand.run(options),
  readText: FS.readText,
  run: CLI.run,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  writeLine: HCI.writeLine,
}

/** MergePrOptions is the flags-ready input accepted by the development CLI command. */
export type MergePrOptions = {
  /** How often to poll the checks while they run. */
  intervalMs?: number
  repositoryRoot?: string
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

    const branch = await requirePrBranch(dependencies.run, root, 'merge-pr')
    const status = (await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
    if (status !== '') {
      Errors.throwUserInput(`The worktree has uncommitted changes; commit and push them first:\n${status.trimEnd()}`)
    }
    const message = await reviewedMergeMessage(dependencies, root, branch)
    const local = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    const github = gitHubPulls(dependencies.run, root, dependencies.writeLine)
    const before = (await github.forBranch(branch, 'all'))[0]
    if (before === undefined) {
      Errors.throwUserInput(`No pull request has ${branch} as its head; open one with \`./agent unsandboxed open-pr\`.`)
    }
    if ((before.state !== 'open' && !isMerged(before)) || before.base.ref !== 'main') {
      Errors.throwUserInput(`#${before.number} is ${before.state} against '${before.base.ref}'.`)
    }
    if (before.head.sha !== local) {
      Errors.throwUserInput(
        `#${before.number}'s head is ${before.head.sha.slice(0, 8)}, not this worktree's ${
          local.slice(0, 8)
        }; push with \`./agent unsandboxed open-pr\` first.`,
      )
    }

    // Already merged at this head means auto-merge got there first, behind the required Verify check.
    let after = before
    if (before.state === 'open') {
      const checks = await dependencies.followChecks({
        expectedHead: local,
        ghAuth: true,
        intervalMs: options.intervalMs,
        pr: before.number,
        repositoryRoot: root,
        wait: true,
      })
      if (checks.exitCode !== 0) {
        report(`FAIL  #${before.number} is not merged: its checks did not all pass.`)
        return { exitCode: 1, lines }
      }
      after = await github.view(before.number)
      const verdict = after.head.sha === local ? await github.checkConclusion(local, VERDICT_CHECK) : undefined
      if (after.head.sha !== local || verdict !== 'success') {
        report(
          after.head.sha !== local
            ? `FAIL  #${after.number}'s head moved to ${after.head.sha.slice(0, 8)} while its checks ran; not merged.`
            : `FAIL  #${after.number} has no successful ${VERDICT_CHECK} check on ${local.slice(0, 8)}; not merged.`,
        )
        return { exitCode: 1, lines }
      }
      if (!isMerged(after)) {
        after = await github.mergeQueueRequired(MAIN_BRANCH)
          ? await enqueueAndAwaitMerge(dependencies, root, github, after, local, message, {
            intervalMs: options.intervalMs ?? QUEUE_POLL_MS,
            report,
          })
          : await mergeUnlessAutoMerged(dependencies, root, github, after, local, message)
      }
      if (!isMerged(after)) {
        report(
          after.state === 'open'
            ? `FAIL  #${after.number} left the merge queue unmerged; read its merge group's ${VERDICT_CHECK} run.`
            : `FAIL  #${after.number} is ${after.state} after the merge; not archived.`,
        )
        return { exitCode: 1, lines }
      }
    }
    report(`PASS  #${after.number} merged at ${local.slice(0, 8)} after ${VERDICT_CHECK} passed: ${after.html_url}`)

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

/**
 * Auto-merge fires within seconds of Verify passing, so this merge can lose that race; GitHub then
 * refuses it as already merged, and the pull request's state, not the refusal, is the answer. A draft
 * is marked ready first, since GitHub refuses to merge one; REST has no endpoint for that, so it is
 * the one `gh pr` call here.
 */
async function mergeUnlessAutoMerged(
  dependencies: MergePrDependencies,
  root: string,
  github: ReturnType<typeof gitHubPulls>,
  pr: PullRequest,
  head: string,
  message: { body: string; title: string },
): Promise<PullRequest> {
  if (pr.draft) {
    mustSucceed(
      await dependencies.run('gh', { args: ['pr', 'ready', String(pr.number)], cwd: root, stdio: 'pipe' }),
      dependencies.writeLine,
    )
  }
  const merged = await github.squashMerge(pr.number, { body: message.body, sha: head, title: message.title })
  const after = await github.view(pr.number)
  if (!isMerged(after)) {
    mustSucceed(merged, dependencies.writeLine)
  }
  return after
}

/**
 * Enqueues the pull request at the watched head, unless it is already queued or waiting to be, then
 * reads its state until the queue merges it, closes it, or drops it. A drop means the merge group's
 * Verify failed, timed out, or conflicted; GitHub leaves the pull request open, so the caller reports
 * it as not merged.
 */
async function enqueueAndAwaitMerge(
  dependencies: MergePrDependencies,
  root: string,
  github: ReturnType<typeof gitHubPulls>,
  pr: PullRequest,
  head: string,
  message: { body: string; title: string },
  options: { intervalMs: number; report: (line: string) => void },
): Promise<PullRequest> {
  const gh = async (args: readonly string[]) =>
    mustSucceed(await dependencies.run('gh', { args, cwd: root, stdio: 'pipe' }), dependencies.writeLine)
  if (pr.draft) {
    await gh(['pr', 'ready', String(pr.number)])
  }
  if (await github.queueState(pr.number) === 'none') {
    await github.edit(pr.number, { body: message.body, title: message.title })
    await gh(['pr', 'merge', String(pr.number), '--auto', '--squash', '--match-head-commit', head])
  }
  options.report(
    `WAIT  #${pr.number} is in ${MAIN_BRANCH}'s merge queue at ${head.slice(0, 8)}; GitHub merges it once`
      + ` the merge group's ${VERDICT_CHECK} passes.`,
  )
  // The queue entry ends a moment before the merge shows on the pull request, so one read outside the
  // queue is confirmed by the next before it counts as a drop.
  let outside = false
  for (;;) {
    const after = await github.view(pr.number)
    if (isMerged(after) || after.state !== 'open') {
      return after
    }
    if (await github.queueState(pr.number) !== 'none') {
      outside = false
    } else if (outside) {
      return after
    } else {
      outside = true
    }
    await dependencies.sleep(options.intervalMs)
  }
}

async function git(dependencies: MergePrDependencies, cwd: string, args: readonly string[]) {
  return mustSucceed(await dependencies.run('git', { args, cwd, stdio: 'pipe' }), dependencies.writeLine)
}
