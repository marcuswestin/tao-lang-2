import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { type GhRunner, gitHubPulls, isMerged, mustSucceed, type PullRequest, requirePrBranch } from './GitHubPulls'
import { PrChecksCommand, type PrChecksOptions } from './PrChecksCommand'
import { type ReviewedMergeMessage, reviewedMergeMessage } from './ReviewedMergeMessage'

/*
 * `open-pr` is the one command that pushes a branch, opens (or reuses) its pull request against
 * `main`, and stays attached to watch the checks the push starts. Auto-merge is opt-in: only
 * `--auto-merge` turns it on, because a push that only wants CI must never land by itself, and a run
 * without it turns off any auto-merge an earlier run left on. The reviewed merge message is the pull
 * request's title and description and, verbatim, auto-merge's commit headline and body, all
 * rewritten from it on every run, so editing the message and running this again is how a changed
 * message reaches `main`. The headline and body are set explicitly because
 * GitHub's own squash message appends ` (#N)` to the title and wraps the description at 72 columns,
 * which breaks the repository's one-bullet-per-line format. Auto-merge waits for the required Verify
 * check; it is turned on only once checks exist on the pushed head, so Verify is already pending when
 * GitHub reads it. Verify runs on every push, so a reused pull request is watched the same way as a
 * new one. A branch that already merged is refused before any push, because pushing it again would
 * open a second, empty pull request that auto-merge also lands.
 *
 * Every read and write goes through REST (`GitHubPulls`), and the checks are followed by `pr-checks`,
 * so it works where a cloud agent host's proxy refuses `gh pr`'s GraphQL. Auto-merge has no GitHub
 * REST endpoint: where `gh pr merge --auto` is refused, the proxy's own REST route is tried, and
 * where that too is refused the run says so and goes on, since `merge-pr` merges with the same
 * message once Verify passes.
 *
 * The Developer runs it by hand and an agent runs it unattended, so every `git` and `gh` invocation is
 * behind the injected `run` seam below rather than a direct `CLI.run` call — the house pattern
 * `android.ts`'s `compatibility.requireAdb ?? requireAdb` uses for the same reason: a test can script
 * every answer without a real remote or a real `gh`. It never force-pushes, and it never merges
 * directly: with `--auto-merge` it names `merge-pr` once the checks pass; without it, landing waits.
 */

const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
const CHECKS_APPEAR_POLL_MS = 5_000
const CHECKS_APPEAR_WITHIN_MS = 90_000
const GH_AUTH_REMEDY = 'Run `gh auth login`.'

/** OpenPrRunner is the injectable process seam every `git` and `gh` call goes through. */
export type OpenPrRunner = GhRunner

/** OpenPrDependencies isolates process, filesystem, check-following, and clock effects for testing. */
export type OpenPrDependencies = {
  exists: (path: string) => Promise<boolean>
  followChecks: (options: PrChecksOptions) => Promise<{ exitCode: number }>
  readText: (path: string) => Promise<string>
  run: OpenPrRunner
  sleep: (ms: number) => Promise<void>
  writeLine: (line: string) => void
}

const defaultDependencies: OpenPrDependencies = {
  exists: FS.exists,
  followChecks: options => PrChecksCommand.run(options),
  readText: FS.readText,
  run: CLI.run,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  writeLine: HCI.writeLine,
}

/** OpenPrOptions is the flags-ready input accepted by the development CLI command. */
export type OpenPrOptions = {
  /** Turn on auto-merge so the pull request lands once Verify passes; off, the run only runs CI. */
  autoMerge?: boolean
  /** How often to poll the checks while they run; `pr-checks` sizes the default to GitHub's rate limit. */
  pollIntervalMs?: number
  /** Override the current repository root, principally for tests. */
  repositoryRoot?: string
}

/** OpenPrResult reports what the command printed and how it concluded. */
export type OpenPrResult = {
  /**
   * 0 when every check on the pushed head succeeded; 1 when any failed or none appeared.
   */
  exitCode: number
  lines: string[]
}

type GitHub = ReturnType<typeof gitHubPulls>

/** OpenPrCommand is the CLI wiring surface consumed by `dev.ts`. */
export const OpenPrCommand = {
  async run(
    options: OpenPrOptions = {},
    dependencies: OpenPrDependencies = defaultDependencies,
  ): Promise<OpenPrResult> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const lines: string[] = []
    const report = (line: string): void => {
      lines.push(line)
      dependencies.writeLine(line)
    }

    const branch = await requirePrBranch(dependencies.run, root, 'open-pr')
    await requireCleanWorktree(dependencies, root)
    await requireCommitsBeyondMain(dependencies, root)
    const message = await reviewedMergeMessage(dependencies, root, branch)
    await requireGh(dependencies, root)
    const github = gitHubPulls(dependencies.run, root, dependencies.writeLine)
    await refuseMergedBranch(github, branch)

    const headSha = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    report(`Pushing ${branch} to ${REMOTE}...`)
    await pushBranch(dependencies, root, branch, report)
    report('Opening or updating the pull request...')
    const pr = await ensurePullRequest(github, branch, message, report)
    if (!await awaitChecksOnHead(dependencies, github, pr.number, headSha, report)) {
      return { exitCode: 1, lines }
    }
    if (options.autoMerge === true) {
      await enableAutoMerge(dependencies, root, github, pr.number, message, report)
    } else {
      await disableAutoMerge(dependencies, root, github, pr.number, report)
    }
    report(`Following CI checks for #${pr.number}...`)
    const checks = await dependencies.followChecks({
      expectedHead: options.autoMerge === true ? undefined : headSha,
      ghAuth: true,
      intervalMs: options.pollIntervalMs,
      pr: pr.number,
      repositoryRoot: root,
      wait: true,
    })
    const exitCode = checks.exitCode === 0 ? 0 : 1
    if (exitCode === 0) {
      report(
        options.autoMerge === true
          ? `NEXT  Run merge-pr: it confirms Verify on this head, merges #${pr.number} unless auto-merge did, and archives it.`
          : `NEXT  Nothing lands from this run. To land #${pr.number}, run open-pr --auto-merge, or merge-pr.`,
      )
    }

    return { exitCode, lines }
  },
} as const

async function requireCleanWorktree(dependencies: OpenPrDependencies, root: string): Promise<void> {
  const status = (await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
  if (status !== '') {
    Errors.throwUserInput(
      `The worktree has uncommitted changes; open-pr refuses to push it. Dirty paths:\n${status.trimEnd()}`,
    )
  }
}

async function requireCommitsBeyondMain(dependencies: OpenPrDependencies, root: string): Promise<void> {
  const mergeBase = (await git(dependencies, root, ['merge-base', MAIN_BRANCH, 'HEAD'])).stdout.trim()
  const count = (await git(dependencies, root, ['rev-list', '--count', `${mergeBase}..HEAD`])).stdout.trim()
  if (count === '0') {
    Errors.throwUserInput(
      `This branch has no commits beyond its ${MAIN_BRANCH} merge base; there is nothing to open a pull request for.`,
    )
  }
}

/**
 * Reading the signed-in user is one REST call that fails the same way whether `gh` cannot even
 * start, is not logged in, or cannot read its own config file — every one of those is the same
 * remedy from a developer's chair, so this reports a remedy line rather than the raw stack either
 * failure mode would otherwise print. `gh auth status` is not that call: it also validates the
 * token through GraphQL, which a cloud agent host's proxy refuses even where REST works.
 */
async function requireGh(dependencies: OpenPrDependencies, root: string): Promise<void> {
  const result = await dependencies.run('gh', { args: ['api', 'user', '--jq', '.login'], cwd: root, stdio: 'pipe' })
  if (result.error !== undefined) {
    Errors.throwUserInput(`gh is not installed. Install the GitHub CLI, then ${GH_AUTH_REMEDY}`)
  }
  if (result.exitCode !== 0) {
    const reason = (result.stderr || result.stdout).trim()
    Errors.throwUserInput(
      `gh is not authenticated, or could not read its configuration${reason === '' ? '' : ` (${reason})`}. `
        + GH_AUTH_REMEDY,
    )
  }
}

async function pushBranch(
  dependencies: OpenPrDependencies,
  root: string,
  branch: string,
  report: (line: string) => void,
): Promise<void> {
  const result = await dependencies.run('git', {
    args: ['push', '--set-upstream', REMOTE, branch],
    cwd: root,
    stdio: 'stream',
  })
  assertCommandSucceeded(result)
  report(`PASS  Pushed ${branch} to ${REMOTE} and set its upstream.`)
}

async function ensurePullRequest(
  github: GitHub,
  branch: string,
  message: ReviewedMergeMessage,
  report: (line: string) => void,
): Promise<PullRequest> {
  const existing = (await github.forBranch(branch, 'open'))[0]
  if (existing !== undefined) {
    await github.edit(existing.number, { body: message.body, title: message.title })
    report(
      `PASS  Reusing #${existing.number} for ${branch}, titled and described by the merge message: ${existing.html_url}`,
    )
    return existing
  }

  const created = await github.create({ base: MAIN_BRANCH, body: message.body, head: branch, title: message.title })
  report(`PASS  Opened pull request #${created.number} for ${branch}: ${created.html_url}`)
  return created
}

/**
 * Auto-merge squash-merges with the headline and body given here once the required Verify check
 * passes. One already on with this message is left alone; one carrying an older message is turned
 * off and on again with the current one, since GitHub keeps the message it was enabled with. A
 * stale one that cannot be turned off is this command's failure, since it would merge the wrong
 * message; one that cannot be turned on is not, since `merge-pr` merges with the right one.
 */
async function enableAutoMerge(
  dependencies: OpenPrDependencies,
  root: string,
  github: GitHub,
  prNumber: number,
  message: ReviewedMergeMessage,
  report: (line: string) => void,
): Promise<void> {
  const current = (await github.view(prNumber)).auto_merge
  if (carriesMessage(current, message)) {
    report(`PASS  Auto-merge is already on for #${prNumber} with the merge message.`)
    return
  }
  const run = (args: readonly string[]) => dependencies.run('gh', { args, cwd: root, stdio: 'pipe' })
  if (current) {
    await turnOffAutoMerge(dependencies, root, github, prNumber)
  }
  const stayOff = (said: string): void =>
    report(
      `NOTE  Auto-merge stays off for #${prNumber}${said === '' ? '' : ` (${said})`};`
        + ' merge-pr merges it with the merge message once Verify passes.',
    )
  const enabled = await run(
    ['pr', 'merge', String(prNumber), '--auto', '--squash', '--subject', message.title, '--body', message.body],
  )
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

/** A run without `--auto-merge` only runs CI, so auto-merge an earlier run turned on is turned off. */
async function disableAutoMerge(
  dependencies: OpenPrDependencies,
  root: string,
  github: GitHub,
  prNumber: number,
  report: (line: string) => void,
): Promise<void> {
  if ((await github.view(prNumber)).auto_merge === null) {
    report(`PASS  Auto-merge is off for #${prNumber}; this run only runs CI. Pass --auto-merge to land it.`)
    return
  }
  await turnOffAutoMerge(dependencies, root, github, prNumber)
  report(`PASS  Turned auto-merge off for #${prNumber}; this run only runs CI. Pass --auto-merge to land it.`)
}

/** turnOffAutoMerge tries `gh pr merge`, then the cloud host's REST route, and fails if both refuse. */
async function turnOffAutoMerge(
  dependencies: OpenPrDependencies,
  root: string,
  github: GitHub,
  prNumber: number,
): Promise<void> {
  const disabled = await dependencies.run('gh', {
    args: ['pr', 'merge', String(prNumber), '--disable-auto'],
    cwd: root,
    stdio: 'pipe',
  })
  if (!succeeded(disabled)) {
    mustSucceed(await github.disableHostAutoMerge(prNumber), dependencies.writeLine)
  }
}

function carriesMessage(autoMerge: PullRequest['auto_merge'], message: ReviewedMergeMessage): boolean {
  return autoMerge !== null && autoMerge.commit_title === message.title && autoMerge.commit_message === message.body
}

function succeeded(result: CLI.CommandResult): boolean {
  return result.exitCode === 0 && result.error === undefined && result.signal === null
}

function firstLine(result: CLI.CommandResult): string {
  return (result.stderr || result.stdout).trim().split('\n')[0] ?? ''
}

/** A branch lands once; pushing a merged one again would open an empty duplicate. */
async function refuseMergedBranch(github: GitHub, branch: string): Promise<void> {
  const merged = (await github.forBranch(branch, 'closed')).find(isMerged)
  if (merged !== undefined) {
    Errors.throwUserInput(
      `${branch} already merged as #${merged.number} (${merged.html_url}); a branch lands once.`
        + ' Run merge-pr to archive it, and put further work on a new branch.',
    )
  }
}

/**
 * GitHub creates a newly opened pull request's check runs some seconds after it opens, and until it
 * has, there are none. Watching straight away reported the first real run as over before its
 * workflow had started, so this waits until the pull request's head is the pushed commit and that
 * commit carries at least one check. None appearing within the window is reported as a failure, not
 * a pass: this command exists to observe CI, and a silent pass is how it misled its first user. The
 * usual cause is a pull request that conflicts with its base, which GitHub runs no `pull_request`
 * workflow for until a later push resolves the conflict; mergeability is only read out at the end
 * because GitHub recomputes it after each push.
 */
async function awaitChecksOnHead(
  dependencies: OpenPrDependencies,
  github: GitHub,
  prNumber: number,
  headSha: string,
  report: (line: string) => void,
): Promise<boolean> {
  const attempts = Math.ceil(CHECKS_APPEAR_WITHIN_MS / CHECKS_APPEAR_POLL_MS)
  for (let attempt = 1;; attempt += 1) {
    const pr = await github.view(prNumber)
    if (pr.head.sha === headSha && await github.checkRunCount(headSha) > 0) {
      return true
    }
    if (attempt >= attempts) {
      const noChecks = `FAIL  No checks appeared on ${headSha.slice(0, 8)} within ${
        CHECKS_APPEAR_WITHIN_MS / 1000
      }s of the push`
      report(
        pr.mergeable_state === 'dirty'
          ? `${noChecks}: the pull request conflicts with ${MAIN_BRANCH}, and GitHub runs no pull_request`
            + ` workflow until it merges cleanly. Merge ${MAIN_BRANCH} into this branch and push it with open-pr;`
            + ` that push starts the checks.`
          : `${noChecks}. Actions may be disabled for this repository, or no workflow matches this branch.`,
      )
      return false
    }
    if (attempt === 1) {
      report(`PASS  Waiting for GitHub to start checks on ${headSha.slice(0, 8)}.`)
    }
    await dependencies.sleep(CHECKS_APPEAR_POLL_MS)
  }
}

async function git(dependencies: OpenPrDependencies, cwd: string, args: readonly string[]): Promise<CLI.CommandResult> {
  const result = await dependencies.run('git', { args, cwd, stdio: 'pipe' })
  assertCommandSucceeded(result)
  return result
}

function assertCommandSucceeded(result: CLI.CommandResult): void {
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    throw new Errors.CommandExecutionError(result)
  }
}
