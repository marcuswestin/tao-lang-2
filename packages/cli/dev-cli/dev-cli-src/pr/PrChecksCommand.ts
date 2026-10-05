import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

/*
 * `pr-checks` reports, and with `--wait` follows to the end, every check on a pull request's head
 * commit: the workflow jobs (`Verify`'s partitions and verdict) and the commit statuses (the
 * contributor agreement). It reads GitHub's public REST API directly rather than through `gh`,
 * because an agent's sandbox cannot read `gh`'s configuration and a public repository needs no
 * credentials to read its checks. A `GH_TOKEN` or `GITHUB_TOKEN` in the environment is sent when
 * present, which also lifts the anonymous limit of 60 requests an hour.
 *
 * Polling is sized to that limit: one conditional request per poll, which costs nothing when GitHub
 * answers 304, and the statuses and failure annotations only once, at the end. A failed check's
 * reason comes from its annotations, which the `Verify` job writes from each partition's summary,
 * so an agent learns which gate failed and why without downloading any log.
 */

const API = 'https://api.github.com'
const DEFAULT_INTERVAL_MS = 60_000
/** How long a pull request may carry no checks at all before that is reported as the failure. */
const CHECKS_APPEAR_WITHIN_MS = 180_000
/** Annotations that restate a failure without saying anything about its cause. */
const UNINFORMATIVE_ANNOTATION =
  /^Process completed with exit code \d+\.?$|Node\.js \d+ is deprecated|^Cache save failed/u

/** PrChecksDependencies isolates network, process, clock, and output effects for testing. */
export type PrChecksDependencies = {
  env: Readonly<Record<string, string | undefined>>
  fetch: (url: string, init: { headers: Record<string, string> }) => Promise<Response>
  now: () => number
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
  sleep: (ms: number) => Promise<void>
  writeLine: (line: string) => void
}

const defaultDependencies: PrChecksDependencies = {
  env: Platform.runtimeProcess.env,
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  run: CLI.run,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  writeLine: HCI.writeLine,
}

/** PrChecksOptions is the flags-ready input accepted by the development CLI command. */
export type PrChecksOptions = {
  intervalMs?: number
  /** The pull request; by default, the open one whose head is this worktree's branch. */
  pr?: number
  repositoryRoot?: string
  /** Follow the checks until every one has concluded, instead of reporting them once. */
  wait?: boolean
}

/** PrChecksResult is 0 when every check passed, 1 when one failed or none appeared, 2 while any is still running. */
type PrChecksResult = { exitCode: 0 | 1 | 2; lines: string[] }

/** Check is one check run or commit status, reduced to what the report needs. */
type Check = {
  /** The check run's id, for its annotations; statuses have none. */
  id?: number
  name: string
  state: 'failure' | 'pending' | 'success'
  url: string
}

type PullRequest = {
  head: { ref: string; sha: string }
  html_url: string
  mergeable_state?: string
  number: number
}

type CheckRun = { conclusion: string | null; html_url: string; id: number; name: string; status: string }
type CommitStatus = { context: string; state: string; target_url: string | null }

/** PrChecksCommand is the CLI wiring surface consumed by `dev.ts`. */
export const PrChecksCommand = {
  async run(options: PrChecksOptions = {}, dependencies: PrChecksDependencies = defaultDependencies) {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const lines: string[] = []
    const report = (line: string): void => {
      lines.push(line)
      dependencies.writeLine(line)
    }
    const github = gitHub(dependencies)
    const slug = await repositorySlug(dependencies, root)
    const pr = options.pr === undefined
      ? await pullRequestForBranch(dependencies, github, root, slug)
      : await github.json<PullRequest>(`/repos/${slug}/pulls/${options.pr}`)
    const sha = pr.head.sha
    report(`Pull request #${pr.number} (${pr.head.ref}) at ${sha.slice(0, 8)}: ${pr.html_url}`)
    const local = (await dependencies.run('git', { args: ['rev-parse', 'HEAD'], cwd: root, stdio: 'pipe' })).stdout
      .trim()
    if (local !== '' && local !== sha && options.pr === undefined) {
      report(`NOTE  This worktree is at ${local.slice(0, 8)}, which is not the pull request's head; push it first.`)
    }

    const startedAt = dependencies.now()
    const announced = new Set<string>()
    for (;;) {
      const runs = await github.checkRuns(slug, sha)
      const statuses = await github.json<{ statuses: CommitStatus[] }>(`/repos/${slug}/commits/${sha}/status`)
      const checks = [...runs.map(fromCheckRun), ...statuses.statuses.map(fromStatus)]
      for (const check of checks.filter(check => check.state !== 'pending' && !announced.has(check.name))) {
        announced.add(check.name)
        report(`${check.state === 'success' ? 'PASS' : 'FAIL'}  ${check.name}`)
      }
      const pending = checks.filter(check => check.state === 'pending')

      if (checks.length === 0) {
        const conflicted = (await github.json<PullRequest>(`/repos/${slug}/pulls/${pr.number}`)).mergeable_state
          === 'dirty'
        if (conflicted) {
          report(
            'FAIL  No checks: the pull request conflicts with its base, and GitHub runs no pull_request workflow'
              + ' until it merges cleanly. Merge main into the branch and push.',
          )
          return { exitCode: 1, lines } satisfies PrChecksResult
        }
        if (!options.wait || dependencies.now() - startedAt >= CHECKS_APPEAR_WITHIN_MS) {
          report(`FAIL  No checks on ${sha.slice(0, 8)}. Actions may be disabled, or no workflow matches this event.`)
          return { exitCode: 1, lines } satisfies PrChecksResult
        }
        report('WAIT  No checks yet; GitHub starts them a few seconds after a push.')
      } else if (pending.length === 0 || !options.wait) {
        return { exitCode: await conclude(github, slug, checks, report), lines } satisfies PrChecksResult
      } else {
        report(
          `WAIT  ${checks.length - pending.length}/${checks.length} concluded; running: ${
            pending.map(check => check.name).join(', ')
          }`,
        )
      }
      await dependencies.sleep(options.intervalMs ?? DEFAULT_INTERVAL_MS)
    }
  },
} as const

/** conclude reports any check still running, then each failure with the reasons its annotations give. */
async function conclude(
  github: GitHub,
  slug: string,
  checks: readonly Check[],
  report: (line: string) => void,
): Promise<0 | 1 | 2> {
  const failed = checks.filter(check => check.state === 'failure')
  for (const check of failed) {
    report(`FAIL  ${check.name}: ${check.url}`)
    if (check.id === undefined) {
      continue
    }
    const annotations = await github.json<{ annotation_level: string; message: string; title?: string }[]>(
      `/repos/${slug}/check-runs/${check.id}/annotations`,
    )
    for (const annotation of annotations) {
      if (annotation.annotation_level === 'failure' && !UNINFORMATIVE_ANNOTATION.test(annotation.message)) {
        const title = annotation.title === undefined || annotation.title === '' ? '' : `${annotation.title}: `
        report(`      ${title}${annotation.message.split('\n').slice(0, 6).join('\n      ')}`)
      }
    }
  }
  const pending = checks.filter(check => check.state === 'pending')
  if (failed.length > 0) {
    return 1
  }
  if (pending.length > 0) {
    report(`WAIT  ${pending.length} check(s) still running: ${pending.map(check => check.name).join(', ')}`)
    return 2
  }
  report(`PASS  All ${checks.length} check(s) succeeded.`)
  return 0
}

function fromCheckRun(run: CheckRun): Check {
  const state = run.status !== 'completed'
    ? 'pending'
    : run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral'
    ? 'success'
    : 'failure'
  return { id: run.id, name: run.name, state, url: run.html_url }
}

function fromStatus(status: CommitStatus): Check {
  const state = status.state === 'success' ? 'success' : status.state === 'pending' ? 'pending' : 'failure'
  return { name: status.context, state, url: status.target_url ?? '' }
}

type GitHub = ReturnType<typeof gitHub>

/**
 * gitHub wraps the REST calls this command makes. Check runs are read conditionally: GitHub does not
 * count a 304 against the rate limit, which is what lets an anonymous `--wait` poll for an hour.
 */
function gitHub(dependencies: PrChecksDependencies) {
  const token = dependencies.env['GH_TOKEN'] ?? dependencies.env['GITHUB_TOKEN']
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token === undefined || token === '' ? {} : { Authorization: `Bearer ${token}` }),
    ...extra,
  })
  const cached = new Map<string, { body: unknown; etag: string }>()

  async function request(path: string, conditional: boolean): Promise<unknown> {
    const previous = conditional ? cached.get(path) : undefined
    const response = await dependencies.fetch(
      `${API}${path}`,
      { headers: headers(previous === undefined ? {} : { 'If-None-Match': previous.etag }) },
    )
    if (response.status === 304 && previous !== undefined) {
      return previous.body
    }
    if (!response.ok) {
      const reset = response.headers.get('x-ratelimit-reset')
      const limited = response.headers.get('x-ratelimit-remaining') === '0' && reset !== null
      return Errors.throwHostEnvironment(
        limited
          ? `GitHub's anonymous rate limit is spent until ${
            new Date(Number(reset) * 1000).toISOString()
          }; set GH_TOKEN to lift it.`
          : `GitHub answered ${response.status} for ${path}: ${(await response.text()).slice(0, 300)}`,
      )
    }
    const body: unknown = await response.json()
    const etag = response.headers.get('etag')
    if (conditional && etag !== null) {
      cached.set(path, { body, etag })
    }
    return body
  }

  return {
    async checkRuns(slug: string, sha: string): Promise<CheckRun[]> {
      const body = await request(`/repos/${slug}/commits/${sha}/check-runs?per_page=100`, true) as {
        check_runs: CheckRun[]
      }
      return body.check_runs
    },
    async json<ValueT>(path: string): Promise<ValueT> {
      return await request(path, false) as ValueT
    },
  }
}

async function repositorySlug(dependencies: PrChecksDependencies, root: string): Promise<string> {
  const url = (await dependencies.run('git', { args: ['remote', 'get-url', 'origin'], cwd: root, stdio: 'pipe' }))
    .stdout.trim()
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(url)
  if (match === null) {
    return Errors.throwUserInput(`origin is '${url}', not a GitHub repository; pr-checks reads GitHub's checks.`)
  }
  return match[1]!
}

async function pullRequestForBranch(
  dependencies: PrChecksDependencies,
  github: GitHub,
  root: string,
  slug: string,
): Promise<PullRequest> {
  const branch = (await dependencies.run('git', {
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd: root,
    stdio: 'pipe',
  })).stdout.trim()
  if (branch === '') {
    return Errors.throwUserInput('HEAD is detached; name the pull request with --pr <number>.')
  }
  const owner = slug.split('/')[0]
  const open = await github.json<PullRequest[]>(
    `/repos/${slug}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
  )
  const pr = open[0]
  if (pr === undefined) {
    return Errors.throwUserInput(`No open pull request has ${branch} as its head; name one with --pr <number>.`)
  }
  return pr
}
