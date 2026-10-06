import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { enableAutoMerge } from './AutoMerge'
import { cancelVerifyRuns } from './CancelVerify'
import {
  type GhRunner,
  gitHubPulls,
  isMerged,
  type PullRequest,
  requirePrBranch,
  type WorkflowRun,
} from './GitHubPulls'
import { PrChecksCommand, type PrChecksOptions } from './PrChecksCommand'
import { type ReviewedMergeMessage, reviewedMergeMessage } from './ReviewedMergeMessage'

/*
 * `open-pr` is the one command that pushes a branch, opens (or reuses) its pull request against
 * `main`, and stays attached to watch the checks the push starts. Auto-merge stays off unless the
 * caller explicitly enables it; with it on, the command is the whole landing route: it also starts
 * the local complement lane (`verify-complement`, the host-only gates hosted Verify does not admit)
 * in parallel with the hosted run, and posts its verdict as the `Verify (host)` status on the head.
 * That status is not a required check, so GitHub can merge on a green Verify before the complement
 * finishes; the halves are not joined by GitHub. A complement failure while Verify still runs cancels that run
 * and turns auto-merge off, since the head will not land as it is; one after GitHub already merged
 * names `land-fix` as the way the fix reaches `main`. The reviewed
 * merge message is the pull request's title and description and, verbatim, auto-merge's commit
 * headline and body, all rewritten from it on every run, so editing the message and running this
 * again is how a changed message reaches `main`. The headline and body are set explicitly because
 * GitHub's own squash message appends ` (#N)` to the title and wraps the description at 72 columns,
 * which breaks the repository's one-bullet-per-line format. Auto-merge waits for the required Verify
 * check; it is turned on once any check exists on the pushed head, while `pr-checks` keeps following
 * the Verify workflow itself through its literal successful check run. Verify runs on every push,
 * so a reused pull request is watched the same way as a new one. A branch that already merged is
 * refused before any push, because pushing it again would
 * open a second, empty pull request that auto-merge also lands.
 * By default, it refuses an already enabled pull request before pushing, checks that auto-merge is
 * still off before following CI, and leaves landing to a later decision. Before the push it also
 * waits for admission to the hosted runner pool (`admitVerifyRun`), which `--jump-queue` skips.
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
 * directly: the default mode names `merge-pr` after checks pass; explicitly enabled auto-merge
 * lands through GitHub once Verify passes.
 */

const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
const CHECKS_APPEAR_POLL_MS = 5_000
const CHECKS_APPEAR_WITHIN_MS = 90_000
/**
 * GitHub merges an armed pull request some seconds after its last required check concludes
 * (45 s on 2026-10-06's landings). The merge is the landing, so with auto-merge on the command
 * waits for it this long after a green verdict, at this interval, and otherwise names `merge-pr`.
 * It never waits for the archive workflow, which starts after the merge and `landed` reads later.
 */
const MERGE_POLL_MS = 5_000
const MERGE_APPEARS_WITHIN_MS = 180_000
const GH_AUTH_REMEDY = 'Run `gh auth login`.'
/**
 * The hosted runner pool (about 25) holds one Verify run at its full 20 partitions, or two at the
 * smaller count the plan job picks when another run is in flight. A third run beside them starves
 * all three, so admission waits until fewer than this many other runs are in flight.
 */
const VERIFY_RUNS_IN_FLIGHT_LIMIT = 2
const ADMISSION_POLL_MS = 30_000
/** A wait this long while the set is unchanged prints a still-waiting line rather than staying silent. */
const ADMISSION_HEARTBEAT_MS = 5 * 60_000
const ADMISSION_WAIT_LIMIT_MS = 90 * 60_000
const OVERLAP_PATHS_SHOWN = 10

/** OpenPrRunner is the injectable process seam every `git` and `gh` call goes through. */
export type OpenPrRunner = GhRunner

/** OpenPrDependencies isolates process, filesystem, check-following, and clock effects for testing. */
export type OpenPrDependencies = {
  exists: (path: string) => Promise<boolean>
  followChecks: (options: PrChecksOptions) => Promise<{ exitCode: number }>
  /** The current time in epoch milliseconds; admission ages runs and bounds its wait by it. */
  now: () => number
  readText: (path: string) => Promise<string>
  run: OpenPrRunner
  /** Runs the local complement lane to its verdict; the lane posts its own status on the head. */
  runComplement: (root: string) => Promise<{ exitCode: number }>
  sleep: (ms: number) => Promise<void>
  writeLine: (line: string) => void
}

const defaultDependencies: OpenPrDependencies = {
  exists: FS.exists,
  followChecks: options => PrChecksCommand.run(options),
  now: () => Date.now(),
  readText: FS.readText,
  run: CLI.run,
  runComplement: async root => {
    const result = await CLI.run('just', { args: ['verify-complement'], cwd: root, stdio: 'inherit' })
    return { exitCode: result.error === undefined && result.signal === null ? result.exitCode ?? 1 : 1 }
  },
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  writeLine: HCI.writeLine,
}

/** OpenPrOptions is the flags-ready input accepted by the development CLI command. */
export type OpenPrOptions = {
  /** Enable auto-merge explicitly; by default, observe CI with auto-merge required to stay off. */
  autoMerge?: boolean
  /** With auto-merge, run the local complement lane beside hosted Verify; false leaves it to a separate run. */
  complement?: boolean
  /** Push without waiting for the Verify pool or for another lander that changed the same files. */
  jumpQueue?: boolean
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
    if (options.autoMerge !== true) {
      const existing = (await github.forBranch(branch, 'open'))[0]
      if (existing !== undefined) {
        await requireAutoMergeOff(github, existing.number)
      }
    }

    const headSha = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    if (!await admitVerifyRun(dependencies, root, github, branch, options.jumpQueue === true, report)) {
      return { exitCode: 1, lines }
    }
    report(`Pushing ${branch} to ${REMOTE}...`)
    await pushBranch(dependencies, root, branch, report)
    report('Opening or updating the pull request...')
    const pr = await ensurePullRequest(github, branch, message, report)
    if (!await awaitChecksOnHead(dependencies, github, pr.number, headSha, report)) {
      return { exitCode: 1, lines }
    }
    if (options.autoMerge !== true) {
      await requireAutoMergeOff(github, pr.number)
      report(`PASS  Auto-merge is off for #${pr.number}; following CI without enabling it.`)
    } else {
      await enableAutoMerge(dependencies, root, github, pr.number, message, report)
    }
    const complement = options.autoMerge === true && options.complement !== false
      ? startComplement(dependencies, root, github, pr.number, headSha, report)
      : undefined
    report(`Following CI checks for #${pr.number}...`)
    const checks = await dependencies.followChecks({
      expectedHead: headSha,
      ghAuth: true,
      intervalMs: options.pollIntervalMs,
      pr: pr.number,
      repositoryRoot: root,
      wait: true,
    })
    if (options.autoMerge !== true) {
      await requireAutoMergeOff(github, pr.number)
    }
    const complementPassed = complement === undefined ? true : await complement
    const exitCode = checks.exitCode === 0 && complementPassed ? 0 : 1
    if (!complementPassed) {
      report(
        isMerged(await github.view(pr.number))
          ? `NEXT  GitHub merged #${pr.number} before the complement failed: commit the fix on this branch and run land-fix.`
          : `NEXT  Fix the failed gate on this branch and push it with open-pr --auto-merge again.`,
      )
    } else if (exitCode === 0) {
      if (options.autoMerge !== true) {
        report(`PASS  CI succeeded on ${headSha.slice(0, 8)} for #${pr.number}; auto-merge is off.`)
        report(`NEXT  After authorization, run merge-pr to confirm Verify and merge #${pr.number}.`)
      } else if (await awaitMerge(dependencies, github, pr.number, report)) {
        report(
          `NEXT  The archive workflow records merged/<name>; \`landed\` reads it. Put further work on a new branch.`,
        )
      } else {
        report(
          `NEXT  Run merge-pr: it confirms Verify on this head, merges #${pr.number} unless auto-merge did, and archives it.`,
        )
      }
    }

    return { exitCode, lines }
  },
} as const

/**
 * The complement runs beside the hosted checks, not after them: the one is minutes on this machine
 * and the other minutes on GitHub's, and a landing waits for the slower. It settles to whether it
 * passed, and a failure acts at once rather than when the checks return — the hosted run is
 * cancelled and auto-merge turned off while the pull request is still open, because a head one gate
 * already failed must not land on the strength of the other half. Once GitHub has merged, there is
 * nothing to hold back, and the caller names `land-fix`.
 */
function startComplement(
  dependencies: OpenPrDependencies,
  root: string,
  github: GitHub,
  prNumber: number,
  headSha: string,
  report: (line: string) => void,
): Promise<boolean> {
  report(`Starting the local complement lane beside Verify for ${headSha.slice(0, 8)}...`)
  return dependencies.runComplement(root).then(async ({ exitCode }) => {
    if (exitCode === 0) {
      report(`PASS  The complement lane passed on ${headSha.slice(0, 8)}.`)
      return true
    }
    report(`FAIL  The complement lane failed on ${headSha.slice(0, 8)} (exit ${exitCode}).`)
    if (!isMerged(await github.view(prNumber))) {
      await cancelVerifyRuns(github, headSha, report)
      const disabled = await dependencies.run('gh', {
        args: ['pr', 'merge', String(prNumber), '--disable-auto'],
        cwd: root,
        stdio: 'pipe',
      })
      if (disabled.exitCode !== 0) {
        await github.disableHostAutoMerge(prNumber)
      }
      report(`PASS  Auto-merge is off for #${prNumber}; this head will not land.`)
    }
    return false
  }, error => {
    report(`FAIL  The complement lane could not run: ${Errors.messageOf(error)}`)
    return false
  })
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

/** Never change another run's auto-merge choice when the purpose is only to observe CI. */
async function requireAutoMergeOff(github: GitHub, prNumber: number): Promise<void> {
  if ((await github.view(prNumber)).auto_merge !== null) {
    Errors.throwUserInput(
      `Auto-merge is enabled for #${prNumber}; open-pr refuses to continue without --auto-merge.`
        + ' Resolve its auto-merge setting before running CI without landing.',
    )
  }
}

/** AdmissionVerdict is admission's reading of the other runs in flight: push now, or wait for `blocking`. */
type AdmissionVerdict =
  | { admit: true; line: string }
  | { admit: false; blocking: WorkflowRun[]; line: string }

/**
 * Admission comes immediately before the push, because the push is what starts Verify. On
 * 2026-10-06 four agents landing together cancelled 22 of 25 Verify runs: the runner pool holds two
 * runs, so a third starves them all. Admission therefore waits while two other Verify runs are in
 * flight, whatever their event, and while the one other run is a pull request that changed any of
 * this branch's files, since two such landings would each pass against a `main` without the other
 * and then merge untested together. A run on this branch is not counted: the push replaces it
 * through the workflow's concurrency group. The wait polls, prints a line whenever the blocking set
 * changes and a still-waiting line every few minutes otherwise, and gives up after
 * `ADMISSION_WAIT_LIMIT_MS`, naming `--jump-queue` as the way past it.
 */
async function admitVerifyRun(
  dependencies: OpenPrDependencies,
  root: string,
  github: GitHub,
  branch: string,
  jumpQueue: boolean,
  report: (line: string) => void,
): Promise<boolean> {
  report('Checking the Verify runs in flight before pushing...')
  const started = dependencies.now()
  let branchFiles: Promise<Set<string>> | undefined
  const overlaps = new Map<number, Promise<string[] | undefined>>()
  const overlapWith = (run: WorkflowRun): Promise<string[] | undefined> => {
    let overlap = overlaps.get(run.id)
    if (overlap === undefined) {
      branchFiles ??= changedOnBranch(dependencies, root, run, report)
      overlap = sharedPaths(github, run, branchFiles)
      overlaps.set(run.id, overlap)
    }
    return overlap
  }
  let shownKey: string | undefined
  let shownAt = started
  for (;;) {
    const runs = (await github.inFlightVerifyRuns()).filter(run => run.head_branch !== branch)
    const now = dependencies.now()
    if (jumpQueue) {
      report(
        runs.length === 0
          ? 'NOTE  --jump-queue: no other Verify run is in flight, so admission had nothing to skip.'
          : `NOTE  --jump-queue: pushing without admission beside ${describeRuns(runs, now)}.`,
      )
      return true
    }
    const verdict = await admissionVerdict(runs, now, overlapWith)
    if (verdict.admit) {
      report(verdict.line)
      return true
    }
    const waited = now - started
    if (waited >= ADMISSION_WAIT_LIMIT_MS) {
      report(
        `FAIL  Waited ${minutes(waited)} for admission and ${describeRuns(verdict.blocking, now)} still in flight;`
          + ' nothing was pushed. Run open-pr again later, or with --jump-queue to push beside them.',
      )
      return false
    }
    const key = verdict.blocking.map(run => run.id).sort((left, right) => left - right).join(',')
    if (key !== shownKey) {
      report(verdict.line)
      shownKey = key
      shownAt = now
    } else if (now - shownAt >= ADMISSION_HEARTBEAT_MS) {
      report(
        `WAIT  Still waiting for admission (${minutes(waited)} of ${minutes(ADMISSION_WAIT_LIMIT_MS)}): ${
          describeRuns(verdict.blocking, now)
        }.`,
      )
      shownAt = now
    }
    await dependencies.sleep(ADMISSION_POLL_MS)
  }
}

async function admissionVerdict(
  runs: readonly WorkflowRun[],
  now: number,
  overlapWith: (run: WorkflowRun) => Promise<string[] | undefined>,
): Promise<AdmissionVerdict> {
  const poll = `checking every ${ADMISSION_POLL_MS / 1000}s`
  if (runs.length >= VERIFY_RUNS_IN_FLIGHT_LIMIT) {
    return {
      admit: false,
      blocking: [...runs],
      line:
        `WAIT  ${runs.length} other Verify runs are in flight and the runner pool holds ${VERIFY_RUNS_IN_FLIGHT_LIMIT}: ${
          describeRuns(runs, now)
        }; ${poll} until fewer remain.`,
    }
  }
  const other = runs[0]
  if (other === undefined) {
    return { admit: true, line: 'PASS  No other Verify run is in flight; this run gets the whole runner pool.' }
  }
  const isPullRequest = other.event === 'pull_request'
  if (isPullRequest) {
    const overlap = await overlapWith(other)
    if (overlap === undefined) {
      return {
        admit: false,
        blocking: [other],
        line: `WAIT  Found no pull request for ${describeRun(other, now)}, so its changed files are unknown;`
          + ` waiting for it to finish, ${poll}.`,
      }
    }
    if (overlap.length > 0) {
      return {
        admit: false,
        blocking: [other],
        line: `WAIT  ${describeRun(other, now)} changed the same files as this branch, and the two would merge`
          + ` untested against each other: ${listPaths(overlap)}. Waiting for it to finish, ${poll}.`,
      }
    }
  }
  return {
    admit: true,
    line: `PASS  One other Verify run is in flight (${describeRun(other, now)})${
      isPullRequest ? ' and it changed none of these files' : ''
    }; this run will share the pool with run ${other.id} at the smaller partition count.`,
  }
}

/** The paths this branch changes since it left `main`, a rename counted as both of its paths. */
async function changedOnBranch(
  dependencies: OpenPrDependencies,
  root: string,
  other: WorkflowRun,
  report: (line: string) => void,
): Promise<Set<string>> {
  report(`Fetching ${REMOTE}/${MAIN_BRANCH} to compare this branch's files with run ${other.id}'s...`)
  await git(dependencies, root, ['fetch', REMOTE, MAIN_BRANCH])
  const diff = await git(dependencies, root, ['diff', '--name-only', '--no-renames', `${REMOTE}/${MAIN_BRANCH}...HEAD`])
  return new Set(diff.stdout.split('\n').map(line => line.trim()).filter(line => line !== ''))
}

/**
 * The paths both this branch and the run's pull request change, or undefined when the run names no
 * pull request: GitHub leaves `pull_requests` empty for one opened from a fork, so the run's branch
 * is looked up before giving up.
 */
async function sharedPaths(
  github: GitHub,
  run: WorkflowRun,
  branchFiles: Promise<Set<string>>,
): Promise<string[] | undefined> {
  const number = run.pull_requests?.[0]?.number
    ?? (typeof run.head_branch === 'string' && run.head_branch !== ''
      ? (await github.forBranch(run.head_branch, 'open'))[0]?.number
      : undefined)
  if (number === undefined) {
    return undefined
  }
  const theirs = new Set(await github.changedFiles(number))
  const ours = await branchFiles
  return [...theirs].filter(path => ours.has(path)).sort()
}

function describeRuns(runs: readonly WorkflowRun[], now: number): string {
  return runs.map(run => describeRun(run, now)).join(', ')
}

function describeRun(run: WorkflowRun, now: number): string {
  const pr = run.pull_requests?.[0]?.number
  const created = run.created_at === undefined ? Number.NaN : Date.parse(run.created_at)
  const age = Number.isNaN(created) ? 'age unknown' : `${minutes(now - created)} old`
  return `run ${run.id} on ${run.head_branch ?? 'an unnamed branch'} (${run.event ?? 'unknown event'}${
    pr === undefined ? '' : ` #${pr}`
  }, ${age})`
}

function listPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, OVERLAP_PATHS_SHOWN).join(', ')
  const more = paths.length - OVERLAP_PATHS_SHOWN
  return more > 0 ? `${shown}, and ${more} more` : shown
}

function minutes(ms: number): string {
  return `${Math.max(0, Math.round(ms / 60_000))}m`
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

/** awaitMerge reports GitHub's merge of the pull request once it happens, or that it has not within the window. */
async function awaitMerge(
  dependencies: OpenPrDependencies,
  github: GitHub,
  prNumber: number,
  report: (line: string) => void,
): Promise<boolean> {
  const attempts = Math.ceil(MERGE_APPEARS_WITHIN_MS / MERGE_POLL_MS)
  for (let attempt = 1;; attempt += 1) {
    const pr = await github.view(prNumber)
    if (pr.merged_at !== null) {
      report(
        `PASS  GitHub merged #${prNumber} at ${pr.merged_at}${
          typeof pr.merge_commit_sha === 'string' ? ` as ${pr.merge_commit_sha.slice(0, 8)}` : ''
        }.`,
      )
      return true
    }
    if (attempt >= attempts) {
      report(
        `NOTE  GitHub has not merged #${prNumber} within ${MERGE_APPEARS_WITHIN_MS / 1000}s of Verify passing;`
          + ' a required check may be missing or auto-merge may be off.',
      )
      return false
    }
    if (attempt === 1) {
      report(`Waiting for GitHub to merge #${prNumber}...`)
    }
    await dependencies.sleep(MERGE_POLL_MS)
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
