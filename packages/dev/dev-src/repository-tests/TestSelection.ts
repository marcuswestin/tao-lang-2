import { CLI, Errors, FS, Repo } from '@shared'

export type ChangedSelection = {
  changedPaths: readonly string[]
  hasMergeCommit: boolean
  newestCommitAt?: string
  newestMergeAt?: string
  reference: string
}

type GitRunner = typeof CLI.run

const LANGUAGE_PERFORMANCE_PATHS = [
  'packages/compiler/',
  'packages/formatter/',
  'packages/parser/',
  'packages/shared/',
  'packages/validator/',
  'packages/workspace/',
] as const

/** changedSelection resolves the comparison once so every runner receives exactly the same ref. */
async function changedSelection(
  explicitReference?: string,
  repositoryRoot = Repo.getRoot(),
  run: GitRunner = CLI.run,
): Promise<ChangedSelection> {
  const reference = explicitReference === undefined
    ? await defaultReference(repositoryRoot, run)
    : await resolveCommit(explicitReference, repositoryRoot, run)
  const [paths, untracked, merges, newest, newestMerge] = await Promise.all([
    // Match the runners' changed modes: include committed, staged, and working-tree changes since
    // the comparison commit rather than looking only at the committed `<ref>..HEAD` range.
    checkedGit(['diff', '--name-only', reference], repositoryRoot, run),
    checkedGit(['ls-files', '--others', '--exclude-standard'], repositoryRoot, run),
    checkedGit(['rev-list', '--merges', '--count', `${reference}..HEAD`], repositoryRoot, run),
    checkedGit(['log', '-1', '--format=%cI', `${reference}..HEAD`], repositoryRoot, run),
    checkedGit(['log', '-1', '--merges', '--format=%cI', `${reference}..HEAD`], repositoryRoot, run),
  ])
  return {
    changedPaths: [...new Set(`${paths}\n${untracked}`.split(/\r?\n/).filter(Boolean).map(FS.slashPath))].sort(),
    hasMergeCommit: Number(merges.trim()) > 0,
    newestCommitAt: newest.split(/\r?\n/).find(Boolean),
    newestMergeAt: newestMerge.split(/\r?\n/).find(Boolean),
    reference,
  }
}

async function defaultReference(repositoryRoot: string, run: GitRunner): Promise<string> {
  const base = await firstExistingCommit(['origin/main', 'main'], repositoryRoot, run)
  const mergeBase = await checkedGit(['merge-base', 'HEAD', base], repositoryRoot, run)
  return mergeBase.trim()
}

async function firstExistingCommit(
  candidates: readonly string[],
  repositoryRoot: string,
  run: GitRunner,
): Promise<string> {
  for (const candidate of candidates) {
    const result = await run('git', {
      args: ['rev-parse', '--verify', `${candidate}^{commit}`],
      cwd: repositoryRoot,
      stdio: 'pipe',
    })
    if (result.exitCode === 0) {
      return result.stdout.trim()
    }
  }
  Errors.throwHostEnvironment("Cannot resolve origin/main or local main for 'test-changed'.")
}

async function resolveCommit(reference: string, repositoryRoot: string, run: GitRunner): Promise<string> {
  return (await checkedGit(['rev-parse', '--verify', `${reference}^{commit}`], repositoryRoot, run)).trim()
}

async function checkedGit(args: readonly string[], repositoryRoot: string, run: GitRunner): Promise<string> {
  const result = await run('git', { args, cwd: repositoryRoot, stdio: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
  return result.stdout
}

function selectsTaoApps(paths: readonly string[]): boolean {
  return paths.some(path => path.startsWith('Apps/') || path.endsWith('.tao'))
}

function selectsPerformanceChecks(paths: readonly string[]): boolean {
  return paths.some(path =>
    path.startsWith('packages/dev/performance-checks/')
    || LANGUAGE_PERFORMANCE_PATHS.some(prefix => path.startsWith(prefix))
  )
}

/** TestSelection owns Git comparison and the suites whose runners cannot select changes themselves. */
export const TestSelection = {
  LANGUAGE_PERFORMANCE_PATHS,
  changedSelection,
  selectsPerformanceChecks,
  selectsTaoApps,
} as const
