import { CLI, FS, HCI, Repo } from '@shared'
import { type GhRunner, gitHubPulls } from './GitHubPulls'

/*
 * A local gate that fails while hosted `Verify` is still running has already decided the landing:
 * this head will not merge as it is. The run is then only spending shared runners, and a push of the
 * fix would cancel it anyway through the workflow's `cancel-in-progress`. Cancelling it now returns
 * the runners sooner and makes `pr-checks` conclude instead of waiting on a verdict nobody needs.
 * `open-pr --auto-merge` does this itself when its complement lane fails first; `cancel-verify` is
 * the same for a failure found by hand.
 */

type GitHub = ReturnType<typeof gitHubPulls>

/** cancelVerifyRuns cancels every `Verify` run still in flight for the commit and names each. */
export async function cancelVerifyRuns(
  github: GitHub,
  sha: string,
  report: (line: string) => void,
): Promise<number> {
  const active = (await github.verifyRuns(sha)).filter(run => run.status !== 'completed')
  for (const run of active) {
    await github.cancelRun(run.id)
    report(`PASS  Cancelled Verify run ${run.id} (${run.status}) on ${sha.slice(0, 8)}: ${run.html_url}`)
  }
  if (active.length === 0) {
    report(`PASS  No Verify run is in flight on ${sha.slice(0, 8)}.`)
  }
  return active.length
}

/** CancelVerifyDependencies isolates process and output effects for testing. */
export type CancelVerifyDependencies = {
  run: GhRunner
  writeLine: (line: string) => void
}

const defaultDependencies: CancelVerifyDependencies = { run: CLI.run, writeLine: HCI.writeLine }

/** CancelVerifyCommand cancels the `Verify` runs in flight for this worktree's HEAD. */
export const CancelVerifyCommand = {
  async run(
    options: { repositoryRoot?: string; sha?: string } = {},
    dependencies: CancelVerifyDependencies = defaultDependencies,
  ): Promise<{ cancelled: number; exitCode: number; lines: string[] }> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const lines: string[] = []
    const report = (line: string): void => {
      lines.push(line)
      dependencies.writeLine(line)
    }
    const sha = options.sha
      ?? (await dependencies.run('git', { args: ['rev-parse', 'HEAD'], cwd: root, stdio: 'pipe' })).stdout.trim()
    const github = gitHubPulls(dependencies.run, root, dependencies.writeLine)
    const cancelled = await cancelVerifyRuns(github, sha, report)
    return { cancelled, exitCode: 0, lines }
  },
} as const
