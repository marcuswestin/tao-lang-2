import { Errors, FS, Repo } from '@shared'
import { defaultDependencies, gitHub, type PrChecksDependencies, repositorySlug } from './PrChecksCommand'

/*
 * `ci-timings` puts two `Verify` runs side by side, step by step, so a change meant to make CI faster
 * carries its own before and after. Every partition runs the same steps, so each step is reported as
 * its median and slowest duration across the partitions, beside the partition job's own wall time and
 * the run's. By default the after is the newest `Verify` run of this worktree's branch and the before
 * is the newest green `Verify` push to `main`; `--run` and `--compare` name either one instead.
 *
 * It reads the public REST API the way `pr-checks` does, so it runs in the sandbox with no
 * credentials, and costs three requests per run against the anonymous limit.
 */

const WORKFLOW = 'verify.yml'
/** A partition's step names carry its index, which would split one step into twelve rows. */
const PARTITION_INDEX = /\b\d+\/(\d+)\b/gu

/** CiTimingsOptions is the flags-ready input accepted by the development CLI command. */
export type CiTimingsOptions = {
  /** The before run; by default, the newest green `Verify` push to `main`. */
  compare?: number
  repositoryRoot?: string
  /** The after run; by default, the newest `Verify` run of this worktree's branch. */
  run?: number
}

type Step = { completed_at: string | null; conclusion: string | null; name: string; started_at: string | null }
type Job = { completed_at: string | null; name: string; started_at: string | null; steps?: Step[] }
type WorkflowRun = {
  created_at: string
  head_branch: string
  head_sha: string
  id: number
  run_started_at?: string
  status: string
  updated_at: string
}

/** Timing is one row's durations, in seconds, across the partitions that ran it. */
type Timing = { max: number; median: number; ran: number; skipped: number }

/** RunTimings is one run reduced to its rows, keyed by the partition-independent step name. */
type RunTimings = { label: string; rows: Map<string, Timing>; run: WorkflowRun }

/** CiTimingsCommand is the CLI wiring surface consumed by `dev.ts`. */
export const CiTimingsCommand = {
  async run(
    options: CiTimingsOptions = {},
    dependencies: PrChecksDependencies = defaultDependencies,
  ): Promise<{ exitCode: number; lines: string[] }> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const slug = await repositorySlug(dependencies, root)
    const github = gitHub(dependencies)
    const runs = `/repos/${slug}/actions/workflows/${WORKFLOW}/runs`

    const after = options.run === undefined
      ? await newestRun(
        github,
        `${runs}?branch=${encodeURIComponent(await currentBranch(dependencies, root))}&per_page=1`,
      )
      : await github.json<WorkflowRun>(`/repos/${slug}/actions/runs/${options.run}`)
    const before = options.compare === undefined
      ? await newestRun(github, `${runs}?branch=main&event=push&status=success&per_page=1`)
      : await github.json<WorkflowRun>(`/repos/${slug}/actions/runs/${options.compare}`)

    const timings = await Promise.all([before, after].map(async (run, index) => ({
      label: index === 0 ? 'before' : 'after',
      rows: rowsOf(
        run,
        (await github.json<{ jobs: Job[] }>(`/repos/${slug}/actions/runs/${run.id}/jobs?per_page=100`)).jobs,
      ),
      run,
    })))
    const lines = report(timings[0]!, timings[1]!)
    for (const line of lines) {
      dependencies.writeLine(line)
    }
    return { exitCode: 0, lines }
  },
} as const

async function currentBranch(dependencies: PrChecksDependencies, root: string): Promise<string> {
  const branch = (await dependencies.run('git', {
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd: root,
    stdio: 'pipe',
  })).stdout.trim()
  return branch === '' ? Errors.throwUserInput('HEAD is detached; name the run with --run <id>.') : branch
}

async function newestRun(github: ReturnType<typeof gitHub>, path: string): Promise<WorkflowRun> {
  const run = (await github.json<{ workflow_runs: WorkflowRun[] }>(path)).workflow_runs[0]
  return run ?? Errors.throwUserInput(`No Verify run matches ${path}; name one with --run or --compare.`)
}

/**
 * rowsOf reduces a run's jobs to rows: one per step name shared by the partitions, then the partition
 * job's own wall time, the verdict job's, and the run's from creation to its last update, which
 * includes the time jobs waited for a runner.
 */
function rowsOf(run: WorkflowRun, jobs: readonly Job[]): Map<string, Timing> {
  const samples = new Map<string, { durations: number[]; skipped: number }>()
  const sample = (name: string, seconds: number | undefined, skipped = false): void => {
    const entry = samples.get(name) ?? { durations: [], skipped: 0 }
    if (skipped) {
      entry.skipped++
    } else if (seconds !== undefined) {
      entry.durations.push(seconds)
    }
    samples.set(name, entry)
  }
  const partitions = jobs.filter(job => job.name.startsWith('Partition'))
  for (const job of partitions) {
    for (const step of job.steps ?? []) {
      sample(step.name.replaceAll(PARTITION_INDEX, 'k/$1'), seconds(step), step.conclusion === 'skipped')
    }
  }
  for (const job of partitions) {
    sample('Partition job (wall)', seconds(job))
  }
  for (const job of jobs.filter(job => !job.name.startsWith('Partition'))) {
    sample(`${job.name} job (wall)`, seconds(job))
  }
  sample('Run (created to last update)', between(run.created_at, run.updated_at))

  const rows = new Map<string, Timing>()
  for (const [name, { durations, skipped }] of samples) {
    const sorted = [...durations].sort((a, b) => a - b)
    rows.set(name, {
      max: sorted.at(-1) ?? 0,
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      ran: sorted.length,
      skipped,
    })
  }
  return rows
}

function seconds(span: { completed_at: string | null; started_at: string | null }): number | undefined {
  return span.started_at === null || span.completed_at === null
    ? undefined
    : between(span.started_at, span.completed_at)
}

function between(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 1000)
}

/** report prints a Markdown table, ready to paste into a pull request, then the runs it compared. */
function report(before: RunTimings, after: RunTimings): string[] {
  const names = [...after.rows.keys()]
  for (const name of before.rows.keys()) {
    if (!after.rows.has(name)) {
      names.push(name)
    }
  }
  const cell = (timing: Timing | undefined): string => {
    if (timing === undefined) {
      return '—'
    }
    if (timing.ran === 0) {
      return timing.skipped > 0 ? 'skipped' : 'not run'
    }
    return `${timing.median}s / ${timing.max}s`
  }
  const change = (from: Timing | undefined, to: Timing | undefined): string => {
    if (from === undefined || to === undefined || from.ran === 0 || to.ran === 0) {
      return ''
    }
    const delta = to.median - from.median
    return delta === 0 ? '0s' : `${delta > 0 ? '+' : ''}${delta}s`
  }
  return [
    '| Step (median / slowest across partitions) | Before | After | Median change |',
    '| --- | --- | --- | --- |',
    ...names.map(name => {
      const from = before.rows.get(name)
      const to = after.rows.get(name)
      return `| ${name} | ${cell(from)} | ${cell(to)} | ${change(from, to)} |`
    }),
    '',
    ...[before, after].map(({ label, run }) =>
      `${label}: run ${run.id} on ${run.head_branch} at ${
        run.head_sha.slice(0, 8)
      }, ${run.status}, created ${run.created_at}`
    ),
  ]
}
