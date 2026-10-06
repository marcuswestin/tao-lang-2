import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { archiveStem } from '@verification/MergeWithMain'
import { syncAfterLanding, SyncLocalMainCommand } from '../git/SyncLocalMain'
import { enableAutoMerge } from './AutoMerge'
import { gitHubPulls, isMerged, mustSucceed, type PullRequest, requirePrBranch } from './GitHubPulls'
import { reviewedMergeMessage } from './ReviewedMergeMessage'

/*
 * `merge-pr` finishes this branch's landing on GitHub from wherever it stands, without waiting on
 * anything. It confirms the pull request's head is this worktree's commit, then takes one of three
 * paths. A pull request already merged at that head is archived at `merged/<name>`, exactly where
 * `land` archives a feature branch, and its remote branch deleted, so `landed` and `reclaim` read a
 * merged pull request the same way they read a landing; GitHub may already have deleted the branch
 * on merge, which leaves nothing to delete. One whose `Verify` check is green and whose auto-merge
 * is off is squash-merged now with the reviewed merge message, pinned to that head so a later push
 * cannot slip in unproved, then archived the same way. Any other pull request has auto-merge turned
 * on for that head, so GitHub squash-merges it the moment `Verify` is green; run `merge-pr` again
 * after the merge to archive it. A draft is marked ready first, since GitHub refuses to merge one.
 * Once archived, local `main` is fast-forwarded to the merge (`sync-main`).
 *
 * Every `git` and `gh` call goes through the injected `run` seam so a test can script every answer
 * without a real remote, and every GitHub read and the merge itself go through REST (`GitHubPulls`),
 * so it works where a host's proxy refuses `gh pr`'s GraphQL.
 */

const REMOTE = 'origin'
/** The workflow job whose success is the hosted verdict; the partitions report into it. */
const VERDICT_CHECK = 'Verify'

/** MergePrDependencies isolates process, filesystem, and output effects for testing. */
export type MergePrDependencies = {
  exists: (path: string) => Promise<boolean>
  readText: (path: string) => Promise<string>
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
  /** Fast-forwards local `main` to the `origin/main` the merge moved. */
  syncLocalMain: (root: string) => Promise<unknown>
  writeLine: (line: string) => void
}

const defaultDependencies: MergePrDependencies = {
  exists: FS.exists,
  readText: FS.readText,
  run: CLI.run,
  syncLocalMain: root => SyncLocalMainCommand.run({ repositoryRoot: root }),
  writeLine: HCI.writeLine,
}

/** MergePrOptions is the flags-ready input accepted by the development CLI command. */
export type MergePrOptions = {
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

    let after = before
    if (!isMerged(before)) {
      const verdict = await github.checkConclusion(local, VERDICT_CHECK)
      if (verdict !== 'success' || before.auto_merge !== null) {
        report(
          verdict === 'success'
            ? `WAIT  ${VERDICT_CHECK} is green on ${
              local.slice(0, 8)
            } and auto-merge is on; GitHub is merging #${before.number}.`
            : `WAIT  ${VERDICT_CHECK} is ${verdict ?? 'still running'} on ${
              local.slice(0, 8)
            }; #${before.number} is not merged.`,
        )
        await enableAutoMerge(dependencies, root, github, before.number, message, report, local)
        report(`NEXT  Run merge-pr again once GitHub has merged #${before.number}, to archive it.`)
        return { exitCode: 0, lines }
      }
      after = await mergeUnlessAutoMerged(dependencies, root, github, before, local, message)
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
    await syncAfterLanding(() => dependencies.syncLocalMain(root), report)
    return { exitCode: 0, lines }
  },
} as const

/**
 * Auto-merge turned on elsewhere fires within seconds of Verify passing, so this merge can lose
 * that race; GitHub then refuses it as already merged, and the pull request's state, not the
 * refusal, is the answer. A draft is marked ready first, since GitHub refuses to merge one; REST has
 * no endpoint for that, so it is the one `gh pr` call here.
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
