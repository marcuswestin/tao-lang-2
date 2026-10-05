import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { archiveStem } from '@verification/MergeWithMain'
import { gitHubPulls, isMerged, mustSucceed, type PullRequest, requirePrBranch } from './GitHubPulls'
import { PrChecksCommand, type PrChecksOptions } from './PrChecksCommand'
import { reviewedMergeMessage } from './ReviewedMergeMessage'

/*
 * `merge-pr` merges this branch's pull request on GitHub once hosted CI has proved it. It follows
 * every check on the pushed head to its conclusion, requires the `Verify` verdict among them, then
 * squash-merges with the reviewed merge message, pinned to the head it watched so a later push
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
 * every answer without a real remote, and every GitHub read and the merge itself go through REST
 * (`GitHubPulls`), so it works where a host's proxy refuses `gh pr`'s GraphQL.
 */

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
        after = await mergeUnlessAutoMerged(dependencies, root, github, after, local, message)
      }
      if (!isMerged(after)) {
        report(`FAIL  #${after.number} is ${after.state} after the merge; not archived.`)
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

async function git(dependencies: MergePrDependencies, cwd: string, args: readonly string[]) {
  return mustSucceed(await dependencies.run('git', { args, cwd, stdio: 'pipe' }), dependencies.writeLine)
}
