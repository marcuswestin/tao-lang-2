import type { Command } from '@commander-js/extra-typings'
import { CLI, HCI, Platform, Repo } from '@shared'

type MergeFeaturePreflightOptions = {
  json?: boolean
}

/** MergeFeaturePreflightIssue describes one preflight blocker or warning. */
type MergeFeaturePreflightIssue = {
  level: 'blocker' | 'warning'
  message: string
}

/** MergeFeaturePreflightReport summarizes read-only merge readiness checks. */
type MergeFeaturePreflightReport = {
  branch: string
  blockers: MergeFeaturePreflightIssue[]
  commitsAheadOfMain?: number
  dirtyEntries: string[]
  gitFailures: string[]
  roadmapArchiveCandidates: string[]
  statusBranch: string
  upstream?: string
  warnings: MergeFeaturePreflightIssue[]
}

/** registerMergeFeaturePreflightCommand registers the merge preflight command. */
export function registerMergeFeaturePreflightCommand(commands: Command): void {
  commands
    .command('merge-feature-preflight')
    .description('Run read-only feature branch merge preflight checks.')
    .option('--json', 'Print a machine-readable preflight report.')
    .action(async (options: MergeFeaturePreflightOptions = {}) => {
      Platform.runtimeProcess.setExitCode(await runMergeFeaturePreflight(options))
    })
}

/** runMergeFeaturePreflight runs read-only Git checks for project-7 merges. */
async function runMergeFeaturePreflight(options: MergeFeaturePreflightOptions = {}): Promise<number> {
  const report = await buildMergeFeaturePreflightReport(Repo.getRoot())

  if (options.json === true) {
    HCI.writeLine(JSON.stringify(report, null, 2))
  } else {
    HCI.write(formatMergeFeaturePreflightReport(report))
  }

  return report.blockers.length === 0 ? 0 : 1
}

/** buildMergeFeaturePreflightReport inspects Git state without mutating it. */
async function buildMergeFeaturePreflightReport(repoRoot: string): Promise<MergeFeaturePreflightReport> {
  const gitFailures: string[] = []
  const branch = (await checkedGitText(repoRoot, ['branch', '--show-current'], gitFailures)).trim()
  const statusBranch = (await checkedGitText(repoRoot, ['status', '--short', '--branch'], gitFailures)).trimEnd()
  const dirtyEntries = splitLines(await checkedGitText(repoRoot, ['status', '--short'], gitFailures))
  const upstream = await optionalGitText(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const hasMain = await gitSucceeds(repoRoot, ['rev-parse', '--verify', 'main'])
  const hasOriginMain = await gitSucceeds(repoRoot, ['rev-parse', '--verify', 'origin/main'])
  const worktrees = await checkedGitText(repoRoot, ['worktree', 'list', '--porcelain'], gitFailures)
  const roadmapArchiveCandidates = hasMain
    ? extractRoadmapCandidates(
      await checkedGitText(
        repoRoot,
        ['diff', '--name-status', 'main...HEAD', '--', 'Roadmap'],
        gitFailures,
      ),
    )
    : []
  const commitsAheadOfMain = hasMain
    ? parseInteger(
      await checkedGitText(repoRoot, ['rev-list', '--count', 'main..HEAD'], gitFailures),
      `git rev-list --count main..HEAD`,
      gitFailures,
    )
    : undefined
  const mainOriginDivergence = hasMain && hasOriginMain
    ? splitCounts(
      await checkedGitText(repoRoot, ['rev-list', '--left-right', '--count', 'main...origin/main'], gitFailures),
      `git rev-list --left-right --count main...origin/main`,
      gitFailures,
    )
    : undefined
  const mainBranchDivergence = hasMain && branch.length > 0
    ? splitCounts(
      await checkedGitText(repoRoot, ['rev-list', '--left-right', '--count', `main...${branch}`], gitFailures),
      `git rev-list --left-right --count main...${branch}`,
      gitFailures,
    )
    : undefined

  return analyzeMergeFeaturePreflight({
    branch,
    commitsAheadOfMain,
    dirtyEntries,
    gitFailures,
    hasMain,
    hasOriginMain,
    mainOriginDivergence,
    mainBranchDivergence,
    roadmapArchiveCandidates,
    statusBranch,
    upstream: upstream?.trim() || undefined,
    worktrees,
  })
}

/** analyzeMergeFeaturePreflight derives merge readiness issues from Git facts. */
export function analyzeMergeFeaturePreflight(facts: {
  branch: string
  commitsAheadOfMain?: number
  dirtyEntries: readonly string[]
  gitFailures?: readonly string[]
  hasMain: boolean
  hasOriginMain: boolean
  mainBranchDivergence?: readonly [number, number]
  mainOriginDivergence?: readonly [number, number]
  roadmapArchiveCandidates: readonly string[]
  statusBranch: string
  upstream?: string
  worktrees: string
}): MergeFeaturePreflightReport {
  const blockers = mergeFeatureBlockers(facts)
  const warnings = mergeFeatureWarnings(facts)

  return {
    branch: facts.branch,
    blockers,
    commitsAheadOfMain: facts.commitsAheadOfMain,
    dirtyEntries: [...facts.dirtyEntries],
    gitFailures: [...(facts.gitFailures ?? [])],
    roadmapArchiveCandidates: [...facts.roadmapArchiveCandidates],
    statusBranch: facts.statusBranch,
    upstream: facts.upstream,
    warnings,
  }
}

type MergeFeaturePreflightFacts = Parameters<typeof analyzeMergeFeaturePreflight>[0]

function mergeFeatureBlockers(facts: MergeFeaturePreflightFacts): MergeFeaturePreflightIssue[] {
  const blockers: MergeFeaturePreflightIssue[] = []
  for (const failure of facts.gitFailures ?? []) {
    blockers.push({ level: 'blocker', message: failure })
  }
  if (facts.branch.length === 0) {
    blockers.push({ level: 'blocker', message: 'HEAD is detached.' })
  } else if (facts.branch === 'main') {
    blockers.push({ level: 'blocker', message: 'Current branch is main; merge from a feature branch instead.' })
  } else if (facts.branch.startsWith('merged/')) {
    blockers.push({ level: 'blocker', message: 'Current branch is already under merged/.' })
  }
  if (facts.dirtyEntries.length > 0) {
    blockers.push({
      level: 'blocker',
      message: `Worktree has ${facts.dirtyEntries.length} dirty entr${facts.dirtyEntries.length === 1 ? 'y' : 'ies'}.`,
    })
  }
  if (!facts.hasMain) {
    blockers.push({ level: 'blocker', message: 'Local main ref is missing.' })
  }
  if (facts.hasMain && facts.commitsAheadOfMain === undefined) {
    blockers.push({ level: 'blocker', message: 'Could not determine commits ahead of main.' })
  } else if (facts.commitsAheadOfMain === 0) {
    blockers.push({ level: 'blocker', message: 'Branch has no commits ahead of main.' })
  }
  if (facts.mainOriginDivergence !== undefined && facts.mainOriginDivergence[1] > 0) {
    blockers.push({
      level: 'blocker',
      message: `Local main is behind origin/main by ${facts.mainOriginDivergence[1]} commit(s).`,
    })
  }
  return blockers
}

function mergeFeatureWarnings(facts: MergeFeaturePreflightFacts): MergeFeaturePreflightIssue[] {
  const warnings: MergeFeaturePreflightIssue[] = []
  if (!facts.hasOriginMain) {
    warnings.push({
      level: 'warning',
      message: 'origin/main ref is unavailable; remote sync state could not be checked.',
    })
  }
  if (facts.upstream === undefined) {
    warnings.push({ level: 'warning', message: 'Feature branch has no upstream configured.' })
  }
  if (facts.mainOriginDivergence !== undefined && facts.mainOriginDivergence[0] > 0) {
    warnings.push({
      level: 'warning',
      message: `Local main is ahead of origin/main by ${facts.mainOriginDivergence[0]} commit(s).`,
    })
  }
  if (facts.mainBranchDivergence !== undefined && facts.mainBranchDivergence[0] > 0) {
    warnings.push({
      level: 'warning',
      message: `Feature branch is missing ${facts.mainBranchDivergence[0]} main commit(s).`,
    })
  }
  if (countBranchWorktrees(facts.worktrees, facts.branch) > 1) {
    warnings.push({ level: 'warning', message: 'Current branch appears in more than one worktree.' })
  }
  return warnings
}

/** formatMergeFeaturePreflightReport formats preflight output for humans. */
export function formatMergeFeaturePreflightReport(report: MergeFeaturePreflightReport): string {
  const lines = [
    `merge feature preflight ${report.blockers.length === 0 ? 'passed' : 'failed'}`,
    `branch: ${report.branch || '(detached)'}`,
    `upstream: ${report.upstream ?? '(none)'}`,
    `commits ahead of main: ${report.commitsAheadOfMain ?? '(unknown)'}`,
    `dirty entries: ${report.dirtyEntries.length}`,
  ]

  appendIssueSection(lines, 'blockers', report.blockers)
  appendIssueSection(lines, 'warnings', report.warnings)
  if (report.roadmapArchiveCandidates.length > 0) {
    lines.push('roadmap archive candidates:')
    for (const candidate of report.roadmapArchiveCandidates) {
      lines.push(`- ${candidate}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function appendIssueSection(
  lines: string[],
  title: string,
  issues: readonly MergeFeaturePreflightIssue[],
): void {
  if (issues.length === 0) {
    return
  }

  lines.push(`${title}:`)
  for (const issue of issues) {
    lines.push(`- ${issue.message}`)
  }
}

async function checkedGitText(repoRoot: string, args: readonly string[], failures: string[]): Promise<string> {
  const result = await CLI.run('git', { args, cwd: repoRoot })
  if (result.error !== undefined || result.exitCode !== 0) {
    failures.push(`${CLI.formatCommand('git', { args })} failed with exit ${result.error ? 1 : (result.exitCode ?? 1)}`)
    return ''
  }
  return result.stdout
}

async function optionalGitText(repoRoot: string, args: readonly string[]): Promise<string | undefined> {
  const result = await CLI.run('git', { args, cwd: repoRoot })
  return result.exitCode === 0 ? result.stdout : undefined
}

async function gitSucceeds(repoRoot: string, args: readonly string[]): Promise<boolean> {
  const result = await CLI.run('git', { args, cwd: repoRoot })
  return result.exitCode === 0
}

function splitLines(text: string): string[] {
  return text.split('\n').filter(line => line.length > 0)
}

function parseInteger(text: string, source: string, failures: string[]): number | undefined {
  const value = Number.parseInt(text.trim(), 10)
  if (Number.isFinite(value)) {
    return value
  }
  failures.push(`${source} returned an invalid count`)
  return undefined
}

function splitCounts(text: string, source: string, failures: string[]): [number, number] | undefined {
  const [left = '0', right = '0'] = text.trim().split(/\s+/)
  const counts: [number, number] = [Number.parseInt(left, 10), Number.parseInt(right, 10)]
  if (Number.isFinite(counts[0]) && Number.isFinite(counts[1])) {
    return counts
  }
  failures.push(`${source} returned invalid divergence counts`)
  return undefined
}

/** extractRoadmapCandidates extracts active Roadmap folders from git name-status output. */
export function extractRoadmapCandidates(pathsText: string): string[] {
  const candidates = new Set<string>()
  for (const line of splitLines(pathsText)) {
    const [status = '', firstPath = '', secondPath] = line.split('\t')
    if (status.startsWith('D')) {
      continue
    }
    const path = status.startsWith('R') ? secondPath : firstPath
    if (path === undefined) {
      continue
    }
    const match = /^Roadmap\/(?!Archive\/)([^/]+)\//.exec(path)
    if (match?.[1] !== undefined) {
      candidates.add(`Roadmap/${match[1]}`)
    }
  }
  return [...candidates].sort()
}

function countBranchWorktrees(worktrees: string, branch: string): number {
  if (branch.length === 0) {
    return 0
  }
  const branchLine = `branch refs/heads/${branch}`
  return splitLines(worktrees).filter(line => line === branchLine).length
}
