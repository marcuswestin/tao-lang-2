import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { type ReviewedMergeMessage, reviewedMergeMessage } from './ReviewedMergeMessage'

/*
 * `open-pr` is the one command that pushes a feature branch, opens (or reuses) its pull request
 * against `main`, turns on auto-merge, and stays attached to watch the checks the push starts. The
 * reviewed merge message is the pull request's title and description and, verbatim, auto-merge's
 * commit headline and body, all rewritten from it on every run, so editing the message and running
 * this again is how a changed message reaches `main`. The headline and body are set explicitly
 * because GitHub's own squash message appends ` (#N)` to the title and wraps the description at 72
 * columns, which breaks the repository's one-bullet-per-line format. Auto-merge waits for the
 * required Verify check; it is turned on only once checks exist on the pushed head, so Verify is
 * already pending when GitHub reads it. Verify runs on every push, so a reused pull request is
 * watched the same way as a new one. A branch that already merged is refused before any push,
 * because pushing it again would open a second, empty pull request that auto-merge also lands.
 *
 * The Developer runs it by hand and an agent runs it unattended, so every `git` and `gh` invocation is
 * behind the injected `run` seam below rather than a direct `CLI.run` call — the house pattern
 * `android.ts`'s `compatibility.requireAdb ?? requireAdb` uses for the same reason: a test can script
 * every answer without a real remote or a real `gh`. It never force-pushes, and it never merges
 * directly: once the checks pass it names `merge-pr`, which merges unless auto-merge already did.
 */

const FEATURE_BRANCH_PREFIX = 'feat/'
const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
const DEFAULT_POLL_INTERVAL_MS = 15_000
const CHECKS_APPEAR_POLL_MS = 5_000
const CHECKS_APPEAR_WITHIN_MS = 90_000
const GH_AUTH_REMEDY = 'Run `gh auth login`.'

/** OpenPrRunner is the injectable process seam every `git` and `gh` call goes through. */
export type OpenPrRunner = (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>

/** OpenPrDependencies isolates process, filesystem, and clock effects for testing. */
export type OpenPrDependencies = {
  exists: (path: string) => Promise<boolean>
  readText: (path: string) => Promise<string>
  run: OpenPrRunner
  sleep: (ms: number) => Promise<void>
  writeLine: (line: string) => void
}

const defaultDependencies: OpenPrDependencies = {
  exists: FS.exists,
  readText: FS.readText,
  run: CLI.run,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  writeLine: HCI.writeLine,
}

/** OpenPrOptions is the flags-ready input accepted by the development CLI command. */
export type OpenPrOptions = {
  /** How often to poll `gh pr checks --json` when this gh has no `--watch` flag. */
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

type PullRequest = {
  number: number
  url: string
}

type CheckStatus = {
  bucket: string
  link: string
  name: string
  state: string
}

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

    const branch = await requireFeatureBranch(dependencies, root)
    await requireCleanWorktree(dependencies, root)
    await requireCommitsBeyondMain(dependencies, root)
    const message = await reviewedMergeMessage(dependencies, root, branch)
    await requireGh(dependencies, root)
    await refuseMergedBranch(dependencies, root, branch)

    const headSha = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    await pushBranch(dependencies, root, branch, report)
    const pr = await ensurePullRequest(dependencies, root, branch, message, report)
    if (!await awaitChecksOnHead(dependencies, root, pr.number, headSha, report)) {
      return { exitCode: 1, lines }
    }
    await enableAutoMerge(dependencies, root, pr.number, message, report)
    const exitCode = await streamChecks(
      dependencies,
      root,
      pr.number,
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      report,
    )
    if (exitCode === 0) {
      report(
        `NEXT  Run merge-pr: it confirms Verify on this head, merges #${pr.number} unless auto-merge did, and archives it.`,
      )
    }

    return { exitCode, lines }
  },
} as const

async function requireFeatureBranch(dependencies: OpenPrDependencies, root: string): Promise<string> {
  const result = await dependencies.run('git', {
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd: root,
    stdio: 'pipe',
  })
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    assertCommandSucceeded(result)
  }
  const branch = result.exitCode === 0 ? result.stdout.trim() : ''
  if (branch === '') {
    Errors.throwUserInput('HEAD is detached; open-pr needs a feat/<name> branch checked out.')
  }
  if (!branch.startsWith(FEATURE_BRANCH_PREFIX)) {
    Errors.throwUserInput(`This worktree is on '${branch}', not a feat/<name> branch; open-pr refuses to push it.`)
  }
  return branch
}

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
 * `gh auth status` is one call that fails the same way whether `gh` cannot even start, is not
 * logged in, or cannot read its own config file — every one of those is the same remedy from a
 * developer's chair, so this reports a remedy line rather than the raw stack either failure mode
 * would otherwise print.
 */
async function requireGh(dependencies: OpenPrDependencies, root: string): Promise<void> {
  const result = await dependencies.run('gh', { args: ['auth', 'status'], cwd: root, stdio: 'pipe' })
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
  dependencies: OpenPrDependencies,
  root: string,
  branch: string,
  message: ReviewedMergeMessage,
  report: (line: string) => void,
): Promise<PullRequest> {
  const existing = await findExistingPullRequest(dependencies, root, branch)
  if (existing !== undefined) {
    const edited = await dependencies.run('gh', {
      args: ['pr', 'edit', String(existing.number), '--title', message.title, '--body', message.body],
      cwd: root,
      stdio: 'pipe',
    })
    assertCommandSucceeded(edited)
    report(
      `PASS  Reusing #${existing.number} for ${branch}, titled and described by the merge message: ${existing.url}`,
    )
    return existing
  }

  const created = await dependencies.run('gh', {
    args: ['pr', 'create', '--base', MAIN_BRANCH, '--head', branch, '--title', message.title, '--body', message.body],
    cwd: root,
    stdio: 'pipe',
  })
  assertCommandSucceeded(created)
  const url = lastNonEmptyLine(created.stdout)
  const number = parsePullRequestNumber(url)
  report(`PASS  Opened pull request #${number} for ${branch}: ${url}`)
  return { number, url }
}

type AutoMergeRequest = { commitBody?: string | null; commitHeadline?: string | null }

/**
 * Auto-merge squash-merges with the headline and body given here once the required Verify check
 * passes. One already on with this message is left alone; one carrying an older message is turned
 * off and on again with the current one, since GitHub keeps the message it was enabled with.
 */
async function enableAutoMerge(
  dependencies: OpenPrDependencies,
  root: string,
  prNumber: number,
  message: ReviewedMergeMessage,
  report: (line: string) => void,
): Promise<void> {
  const view = await dependencies.run('gh', {
    args: ['pr', 'view', String(prNumber), '--json', 'autoMergeRequest'],
    cwd: root,
    stdio: 'pipe',
  })
  assertCommandSucceeded(view)
  const current = parseJson<{ autoMergeRequest?: AutoMergeRequest | null }>(view.stdout, {}).autoMergeRequest
  if (current && current.commitHeadline === message.title && current.commitBody === message.body) {
    report(`PASS  Auto-merge is already on for #${prNumber} with the merge message.`)
    return
  }
  if (current) {
    const disabled = await dependencies.run('gh', {
      args: ['pr', 'merge', String(prNumber), '--disable-auto'],
      cwd: root,
      stdio: 'pipe',
    })
    assertCommandSucceeded(disabled)
  }
  const enabled = await dependencies.run('gh', {
    args: ['pr', 'merge', String(prNumber), '--auto', '--squash', '--subject', message.title, '--body', message.body],
    cwd: root,
    stdio: 'pipe',
  })
  assertCommandSucceeded(enabled)
  report(`PASS  Auto-merge is on: GitHub squash-merges #${prNumber} with the merge message once Verify passes.`)
}

/** A feat/<name> branch lands once; pushing a merged one again would open an empty duplicate. */
async function refuseMergedBranch(dependencies: OpenPrDependencies, root: string, branch: string): Promise<void> {
  const result = await dependencies.run('gh', {
    args: ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number,url', '--limit', '1'],
    cwd: root,
    stdio: 'pipe',
  })
  assertCommandSucceeded(result)
  const merged = parseJson<PullRequest[]>(result.stdout, [])[0]
  if (merged !== undefined) {
    Errors.throwUserInput(
      `${branch} already merged as #${merged.number} (${merged.url}); a feat/<name> branch lands once.`
        + ' Run merge-pr to archive it, and put further work on a new branch.',
    )
  }
}

async function findExistingPullRequest(
  dependencies: OpenPrDependencies,
  root: string,
  branch: string,
): Promise<PullRequest | undefined> {
  const result = await dependencies.run('gh', {
    args: ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url', '--limit', '1'],
    cwd: root,
    stdio: 'pipe',
  })
  assertCommandSucceeded(result)
  return parseJson<PullRequest[]>(result.stdout, [])[0]
}

/**
 * GitHub creates a newly opened pull request's check runs some seconds after it opens, and until it
 * has, `gh pr checks` answers that there are none. Watching straight away reported the first real
 * run as over before its workflow had started, so this waits until the pull request's head is the
 * pushed commit and that commit carries at least one check. None appearing within the window is
 * reported as a failure, not a pass: this command exists to observe CI, and a silent pass is how it
 * misled its first user. The usual cause is a pull request that conflicts with its base, which GitHub
 * runs no `pull_request` workflow for until a later push resolves the conflict; mergeability is only
 * read out at the end because GitHub recomputes it after each push.
 */
async function awaitChecksOnHead(
  dependencies: OpenPrDependencies,
  root: string,
  prNumber: number,
  headSha: string,
  report: (line: string) => void,
): Promise<boolean> {
  const attempts = Math.ceil(CHECKS_APPEAR_WITHIN_MS / CHECKS_APPEAR_POLL_MS)
  for (let attempt = 1;; attempt += 1) {
    const view = await dependencies.run('gh', {
      args: ['pr', 'view', String(prNumber), '--json', 'headRefOid,mergeable,statusCheckRollup'],
      cwd: root,
      stdio: 'pipe',
    })
    assertCommandSucceeded(view)
    const head = parseJson<{ headRefOid?: string; mergeable?: string; statusCheckRollup?: unknown[] }>(
      view.stdout,
      {},
    )
    if (head.headRefOid === headSha && (head.statusCheckRollup?.length ?? 0) > 0) {
      return true
    }
    if (attempt >= attempts) {
      const noChecks = `FAIL  No checks appeared on ${headSha.slice(0, 8)} within ${
        CHECKS_APPEAR_WITHIN_MS / 1000
      }s of the push`
      report(
        head.mergeable === 'CONFLICTING'
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

/**
 * `gh pr checks <number> --watch` is the obvious mechanism, but its availability is checked against
 * the installed gh's own `--help` output rather than assumed: a gh old enough to lack it still gets a
 * working command, through the poll loop below, instead of a flag error.
 */
async function streamChecks(
  dependencies: OpenPrDependencies,
  root: string,
  prNumber: number,
  pollIntervalMs: number,
  report: (line: string) => void,
): Promise<number> {
  const checks = await ghChecksSupportsWatch(dependencies, root)
    ? await watchChecks(dependencies, root, prNumber, report)
    : await pollChecks(dependencies, root, prNumber, pollIntervalMs, report)
  return reportOutcome(checks, report)
}

async function ghChecksSupportsWatch(dependencies: OpenPrDependencies, root: string): Promise<boolean> {
  const result = await dependencies.run('gh', { args: ['pr', 'checks', '--help'], cwd: root, stdio: 'pipe' })
  return result.error === undefined && result.stdout.includes('--watch')
}

async function watchChecks(
  dependencies: OpenPrDependencies,
  root: string,
  prNumber: number,
  report: (line: string) => void,
): Promise<CheckStatus[]> {
  report('PASS  Streaming checks with `gh pr checks --watch`.')
  const watch = await dependencies.run('gh', {
    args: ['pr', 'checks', String(prNumber), '--watch'],
    cwd: root,
    stdio: 'stream',
  })
  // A failed check is an ordinary nonzero exit from `--watch`, not a process that could not run; only
  // the latter is this command's own failure to report.
  if (watch.error !== undefined) {
    throw new Errors.CommandExecutionError(watch)
  }
  return await fetchChecks(dependencies, root, prNumber)
}

async function pollChecks(
  dependencies: OpenPrDependencies,
  root: string,
  prNumber: number,
  pollIntervalMs: number,
  report: (line: string) => void,
): Promise<CheckStatus[]> {
  report('PASS  This gh has no `--watch` flag on `gh pr checks`; polling `gh pr checks --json` instead.')
  for (;;) {
    const checks = await fetchChecks(dependencies, root, prNumber)
    report(describeProgress(checks))
    if (checks.length === 0 || checks.some(isFailedCheck) || checks.every(check => !isPendingCheck(check))) {
      return checks
    }
    await dependencies.sleep(pollIntervalMs)
  }
}

async function fetchChecks(dependencies: OpenPrDependencies, root: string, prNumber: number): Promise<CheckStatus[]> {
  const result = await dependencies.run('gh', {
    args: ['pr', 'checks', String(prNumber), '--json', 'name,state,link,bucket'],
    cwd: root,
    stdio: 'pipe',
  })
  assertCommandSucceeded(result)
  return parseJson<CheckStatus[]>(result.stdout, [])
}

function isPendingCheck(check: CheckStatus): boolean {
  return check.bucket === 'pending'
}

function isFailedCheck(check: CheckStatus): boolean {
  return check.bucket === 'fail' || check.bucket === 'cancel'
}

function describeProgress(checks: readonly CheckStatus[]): string {
  const concluded = checks.filter(check => !isPendingCheck(check)).length
  return `PASS  ${concluded}/${checks.length} check(s) concluded.`
}

function reportOutcome(checks: readonly CheckStatus[], report: (line: string) => void): number {
  const failed = checks.filter(isFailedCheck)
  if (failed.length === 0) {
    report(`PASS  All ${checks.length} check(s) succeeded.`)
    return 0
  }
  for (const check of failed) {
    report(`FAIL  ${check.name}: ${check.link}`)
  }
  return 1
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const last = lines.at(-1)
  if (last === undefined) {
    Errors.throwUnexpected('gh pr create produced no output to read the pull request URL from.')
  }
  return last
}

function parsePullRequestNumber(url: string): number {
  const match = /\/pull\/(\d+)/u.exec(url)
  if (match === null) {
    Errors.throwUnexpected(`Could not read a pull request number out of gh's output: ${url}`)
  }
  return Number(match[1])
}

function parseJson<ValueT>(source: string, fallback: ValueT): ValueT {
  const trimmed = source.trim()
  if (trimmed === '') {
    return fallback
  }
  try {
    return JSON.parse(trimmed) as ValueT
  } catch (error) {
    return Errors.throwUnexpected(`gh printed output open-pr could not parse as JSON: ${Errors.messageOf(error)}`, {
      details: { source },
    })
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
