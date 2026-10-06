import type { CLI } from '@shared'
import { type GhRunner, type gitHubPulls, mustSucceed, type PullRequest } from './GitHubPulls'
import type { ReviewedMergeMessage } from './ReviewedMergeMessage'

/*
 * Auto-merge is how a pull request lands under `main`'s ruleset: GitHub squash-merges it the moment
 * the required `Verify` check is green on its head. `open-pr --auto-merge` turns it on when the push
 * starts CI, and `merge-pr` turns it on when the head is not yet green, so both share this one way of
 * enabling it with the reviewed merge message.
 */

/** AutoMergeDependencies is the process and output seam the two callers already inject. */
export type AutoMergeDependencies = {
  run: GhRunner
  writeLine: (line: string) => void
}

type GitHub = ReturnType<typeof gitHubPulls>

/**
 * Auto-merge squash-merges with the headline and body given here once the required Verify check
 * passes. One already on with this message is left alone; one carrying an older message is turned
 * off and on again with the current one, since GitHub keeps the message it was enabled with. A
 * stale one that cannot be turned off is this command's failure, since it would merge the wrong
 * message; one that cannot be turned on is not, since `merge-pr` merges with the right one. With
 * `expectedHead`, GitHub refuses to enable it unless the pull request's head is that commit.
 */
export async function enableAutoMerge(
  dependencies: AutoMergeDependencies,
  root: string,
  github: GitHub,
  prNumber: number,
  message: ReviewedMergeMessage,
  report: (line: string) => void,
  expectedHead?: string,
): Promise<void> {
  const current = (await github.view(prNumber)).auto_merge
  if (carriesMessage(current, message)) {
    report(`PASS  Auto-merge is already on for #${prNumber} with the merge message.`)
    return
  }
  const run = (args: readonly string[]) => dependencies.run('gh', { args, cwd: root, stdio: 'pipe' })
  if (current) {
    const disabled = await run(['pr', 'merge', String(prNumber), '--disable-auto'])
    if (!succeeded(disabled)) {
      mustSucceed(await github.disableHostAutoMerge(prNumber), dependencies.writeLine)
    }
  }
  const stayOff = (said: string): void =>
    report(
      `NOTE  Auto-merge stays off for #${prNumber}${said === '' ? '' : ` (${said})`};`
        + ' merge-pr merges it with the merge message once Verify passes.',
    )
  const enabled = await run([
    'pr',
    'merge',
    String(prNumber),
    '--auto',
    '--squash',
    '--subject',
    message.title,
    '--body',
    message.body,
    ...(expectedHead === undefined ? [] : ['--match-head-commit', expectedHead]),
  ])
  if (!succeeded(enabled)) {
    // `gh pr merge` speaks GraphQL, which a cloud agent host's proxy refuses; its own REST route is
    // the fallback there, and is absent everywhere else.
    const viaHost = await github.enableHostAutoMerge(prNumber, message)
    if (!succeeded(viaHost)) {
      stayOff(`gh said: ${firstLine(enabled)}; the host route said: ${firstLine(viaHost)}`)
      return
    }
    // Read back what the host route stored, since a squash with any other message must not land.
    if (!carriesMessage((await github.view(prNumber)).auto_merge, message)) {
      mustSucceed(await github.disableHostAutoMerge(prNumber), dependencies.writeLine)
      stayOff('the host route did not keep the merge message')
      return
    }
  }
  report(`PASS  Auto-merge is on: GitHub squash-merges #${prNumber} with the merge message once Verify passes.`)
}

/** carriesMessage says whether the pull request's auto-merge would squash with exactly this message. */
function carriesMessage(autoMerge: PullRequest['auto_merge'], message: ReviewedMergeMessage): boolean {
  return autoMerge !== null && autoMerge.commit_title === message.title && autoMerge.commit_message === message.body
}

function succeeded(result: CLI.CommandResult): boolean {
  return result.exitCode === 0 && result.error === undefined && result.signal === null
}

function firstLine(result: CLI.CommandResult): string {
  return (result.stderr || result.stdout).trim().split('\n')[0] ?? ''
}
