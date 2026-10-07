import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { archiveStem } from '@verification/MergeWithMain'
import { syncAfterLanding, SyncLocalMainCommand } from '../git/SyncLocalMain'
import { gitHubPulls, isMerged, mustSucceed, type PullRequest, requirePrBranch } from './GitHubPulls'

/*
 * `land-fix` is the late-failure half of the landing route. GitHub squash-merges a pull request the
 * moment `Verify` is green, and the local complement lane may still be running then; when it fails
 * after the merge, `main` already holds the change, so the fix goes to `main` directly rather than
 * through a second pull request and a second hosted run of everything. The route is deliberate:
 * fetch `origin/main`, put the branch's fix on top of it as one commit, push, and record a receipt.
 * No verification runs here — the fix is for a gate that already failed, and the author ran that
 * gate before committing the fix.
 *
 * The squash that GitHub made is a different commit from the pull request's own, so the branch's
 * history is not `main`'s: it holds the pre-squash commits and any merge of `main`. The new commit
 * therefore has `origin/main` as its only parent, and its tree applies just the fix — the change
 * from the merged head to the branch head — onto `origin/main`. Nothing of the pre-squash history
 * reaches `main`. It is built without touching any checkout: `git merge-tree --write-tree
 * --merge-base=<merged head>` produces the tree, `git commit-tree` makes the commit, and the push
 * moves `main` on the remote. A conflict refuses the whole command before anything is written;
 * `main` is then merged into the branch by hand and the command run again. Local `main` follows
 * afterwards through `sync-main`, which only fast-forwards and leaves a dirty checkout of `main`
 * alone.
 */

const REMOTE = 'origin'
const MAIN = 'main'
const RECEIPT_DIR = '.artifacts/logs/land-fix'

/** LandFixDependencies isolates process, filesystem, and output effects for testing. */
export type LandFixDependencies = {
  now: () => Date
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
  /** Fast-forwards local `main` to the `origin/main` the push just moved. */
  syncLocalMain: (root: string) => Promise<unknown>
  writeJson: (path: string, content: unknown) => Promise<void>
  writeLine: (line: string) => void
}

const defaultDependencies: LandFixDependencies = {
  now: () => new Date(),
  run: CLI.run,
  syncLocalMain: root => SyncLocalMainCommand.run({ repositoryRoot: root }),
  writeJson: (path, content) => FS.writeJson(path, content),
  writeLine: HCI.writeLine,
}

/** LandFixReceipt records what moved and from where, beside the lane logs. */
type LandFixReceipt = {
  at: string
  branch: string
  fixCommits: readonly string[]
  fixHead: string
  mainAfter: string
  mainBefore: string
  mergedHead: string
  pullRequest: number
}

/** LandFixCommand is the CLI wiring surface consumed by `dev.ts`. */
export const LandFixCommand = {
  async run(
    options: { repositoryRoot?: string } = {},
    dependencies: LandFixDependencies = defaultDependencies,
  ): Promise<{ exitCode: number; lines: string[]; receiptPath?: string }> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const lines: string[] = []
    const report = (line: string): void => {
      lines.push(line)
      dependencies.writeLine(line)
    }

    const branch = await requirePrBranch(dependencies.run, root, 'land-fix')
    const status = (await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
    if (status !== '') {
      Errors.throwUserInput(`The worktree has uncommitted changes; commit the fix first:\n${status.trimEnd()}`)
    }
    const github = gitHubPulls(dependencies.run, root, dependencies.writeLine)
    const pr = (await github.forBranch(branch, 'closed')).find(isMerged)
    if (pr === undefined) {
      Errors.throwUserInput(
        `No merged pull request has ${branch} as its head; land-fix is for a fix after GitHub merged.`
          + ' Push an unmerged branch with `./agent unsandboxed open-pr --auto-merge` instead.',
      )
    }
    const fixHead = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    const mergedHead = pr.head.sha
    if (fixHead === mergedHead) {
      Errors.throwUserInput(`HEAD is the commit #${pr.number} merged; there is no fix to land.`)
    }
    const descends = await dependencies.run('git', {
      args: ['merge-base', '--is-ancestor', mergedHead, fixHead],
      cwd: root,
      stdio: 'pipe',
    })
    if (descends.exitCode !== 0) {
      Errors.throwUserInput(
        `HEAD does not descend from ${mergedHead.slice(0, 8)}, the commit #${pr.number} merged;`
          + ' land-fix lands only commits added to the merged branch.',
      )
    }

    report(`Fetching ${REMOTE}/${MAIN}...`)
    await git(dependencies, root, ['fetch', REMOTE, MAIN])
    const mainBefore = (await git(dependencies, root, ['rev-parse', `${REMOTE}/${MAIN}`])).stdout.trim()
    const mainHasMerge = await dependencies.run('git', {
      args: ['merge-base', '--is-ancestor', pr.merge_commit_sha ?? mergedHead, mainBefore],
      cwd: root,
      stdio: 'pipe',
    })
    if (pr.merge_commit_sha !== undefined && pr.merge_commit_sha !== null && mainHasMerge.exitCode !== 0) {
      Errors.throwUserInput(
        `${REMOTE}/${MAIN} at ${mainBefore.slice(0, 8)} does not contain #${pr.number}'s merge ${
          pr.merge_commit_sha.slice(0, 8)
        }; refusing to land a fix ahead of what it fixes.`,
      )
    }

    // The fix is what the branch added beyond the merged head and `main` does not already hold: a merge
    // of `main` into the branch brings main's own commits into the range, and they are not the fix.
    const fixCommits = (await git(dependencies, root, [
      'log',
      '--format=%s',
      '--no-merges',
      `${mergedHead}..${fixHead}`,
      `^${mainBefore}`,
    ])).stdout.split('\n').filter(line => line !== '')
    if (fixCommits.length === 0) {
      Errors.throwUserInput(
        `Every commit ${branch} added beyond #${pr.number}'s merged head is already on ${REMOTE}/${MAIN};`
          + ' there is no fix to land.',
      )
    }

    // Applying the diff from the merged head to the fix onto `main` leaves the pre-squash history behind.
    const merge = await dependencies.run('git', {
      args: ['merge-tree', '--write-tree', '--messages', `--merge-base=${mergedHead}`, mainBefore, fixHead],
      cwd: root,
      stdio: 'pipe',
    })
    if (merge.exitCode !== 0) {
      report(`FAIL  ${branch} conflicts with ${REMOTE}/${MAIN}:`)
      report(merge.stdout.trimEnd())
      Errors.throwUserInput(
        `Merge ${MAIN} into ${branch} here, resolve the conflict, commit it, and run land-fix again.`,
      )
    }
    const tree = merge.stdout.split('\n')[0]?.trim() ?? ''
    if (!/^[0-9a-f]{40}$/u.test(tree)) {
      Errors.throwUnexpected(`git merge-tree printed no tree id: ${merge.stdout.slice(0, 200)}`)
    }
    const message = mergeMessage(pr, branch, fixCommits)
    const commit = (await git(dependencies, root, [
      'commit-tree',
      tree,
      '-p',
      mainBefore,
      '-m',
      message,
    ])).stdout.trim()
    report(`Pushing the fix to ${REMOTE}/${MAIN} as ${commit.slice(0, 8)}...`)
    await git(dependencies, root, [
      'push',
      `--force-with-lease=refs/heads/${MAIN}:${mainBefore}`,
      REMOTE,
      `${commit}:refs/heads/${MAIN}`,
    ])
    report(
      `PASS  ${MAIN} moved from ${mainBefore.slice(0, 8)} to ${
        commit.slice(0, 8)
      } with ${fixCommits.length} fix commit(s).`,
    )
    const archive = archiveStem(branch)
    await git(dependencies, root, ['push', REMOTE, `${fixHead}:refs/heads/${archive}`])
    report(`PASS  Archive ${archive} now ends at ${fixHead.slice(0, 8)}.`)
    await syncAfterLanding(() => dependencies.syncLocalMain(root), report)

    const receipt: LandFixReceipt = {
      at: dependencies.now().toISOString(),
      branch,
      fixCommits,
      fixHead,
      mainAfter: commit,
      mainBefore,
      mergedHead,
      pullRequest: pr.number,
    }
    const receiptPath = FS.resolvePath(`${RECEIPT_DIR}/${receipt.at.replace(/[:.]/gu, '-')}.json`, root)
    await dependencies.writeJson(receiptPath, receipt)
    report(`Receipt: ${receiptPath}`)
    return { exitCode: 0, lines, receiptPath }
  },
} as const

function mergeMessage(pr: PullRequest, branch: string, fixCommits: readonly string[]): string {
  const summary = `Fix after #${pr.number}: ${fixCommits.at(-1) ?? branch}`
  const bullets = fixCommits.map(subject => `- ${subject}`).join('\n')
  return `${summary.slice(0, 72)}\n\n${bullets}\n`
}

async function git(dependencies: LandFixDependencies, cwd: string, args: readonly string[]) {
  return mustSucceed(await dependencies.run('git', { args, cwd, stdio: 'pipe' }), dependencies.writeLine)
}
