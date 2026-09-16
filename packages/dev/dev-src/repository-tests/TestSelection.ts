import { CLI, Errors, FS, Repo } from '@shared'
import { PackageGraph } from './PackageGraph'

export type ChangedSelection = {
  changedPaths: readonly string[]
  hasMergeCommit: boolean
  newestCommitAt?: string
  newestMergeAt?: string
  reference: string
}

/** SuiteInventory names every suite a complete run would execute, so a plan can say what it skipped. */
export type SuiteInventory = {
  /** Package names with Bun test files, in discovery order. */
  packageSuites: readonly string[]
  hasPerformanceChecks: boolean
  hasRuntimeJest: boolean
  hasTaoApps: boolean
}

/** ChangedPlan is the suites a changed-files run executes, each with the reason it was chosen. */
export type ChangedPlan = {
  /** The path that widened the run to every suite, when one did. */
  everything?: string
  selected: ReadonlyMap<string, string>
  /** Suites in the inventory that this run leaves out. */
  skipped: readonly string[]
  /** Roots handed to `./tao test` when `tao-apps` is selected; `['Apps']` is every app. */
  taoAppPaths?: readonly string[]
}

type GitRunner = typeof CLI.run

const PERFORMANCE_CHECKS = 'performance-checks'
const RUNTIME_JEST = 'runtime-jest'
const TAO_APPS = 'tao-apps'
const ALL_APPS = 'Apps'

/** Packages whose language-service performance the `performance-checks` suite measures. */
const LANGUAGE_PERFORMANCE_PACKAGES = new Set(['compiler', 'formatter', 'parser', 'shared', 'validator', 'workspace'])
/**
 * Packages the Tao behavior tests run through: the CLI that compiles them, the toolchain they are
 * compiled into, and the runtime and standard library the compiled apps execute against. Whatever
 * those import reaches them through the package graph.
 */
const TAO_APPS_PACKAGES = new Set(['runtime', 'runtime-toolchain', 'stdlib', 'tao-cli'])
/** Repository workflow files whose behavior the `dev` package's tests are the proof of. */
const WORKFLOW_PATHS = [
  'Justfile',
  'agent',
  'dev',
  'tao',
  '.envrc',
]
const WORKFLOW_PREFIXES = [
  '.rulesync/',
  '.claude/',
  '.codex/',
  '.cursor/',
  '.config/',
  '.agents/',
  'agents/',
  'config/',
]
/** Paths no suite executes; the lint and format gates own them. */
const DOCUMENTATION_PATTERN = /(^|\/)(LICENSE|\.gitignore|\.gitattributes|\.editorconfig)$|\.md$|^Docs\//
const EVERYTHING_PATHS = new Set([
  'bun.lock',
  'devenv.lock',
  'devenv.nix',
  'devenv.yaml',
  'package.json',
  'packages/tsconfig.base.json',
])

/** packageTestSuite mirrors the package-suite registry's exact test-file shape. */
function packageTestSuite(path: string): string | undefined {
  const match = /^packages\/([^/]+)\/[^/]+-tests\/[^/]+\.test\.ts$/.exec(path)
  return match?.[1]
}

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

/**
 * planChangedSuites maps changed repository paths to the suites that can observe them. A package
 * source change selects that package's suite and every package importing it; a test file selects
 * only its own suite; an app change selects the Tao behavior tests under that app; a repository
 * workflow file selects the developer suite that proves it; documentation selects nothing. A path
 * none of those rules own widens the run to every suite and says which path did it.
 */
function planChangedSuites(
  paths: readonly string[],
  graph: PackageGraph,
  inventory: SuiteInventory,
): ChangedPlan {
  const selected = new Map<string, string>()
  const changedPackages = new Map<string, string>()
  const appPaths = new Map<string, string>()
  let appSourcesChanged = false
  let everything: string | undefined

  for (const path of paths) {
    if (EVERYTHING_PATHS.has(path) || path.startsWith('devenv.')) {
      everything ??= path
      continue
    }
    const inPackage = path.match(/^packages\/([^/]+)\/(.+)$/)
    if (inPackage !== null) {
      const [, name, rest] = inPackage as [string, string, string]
      if (rest.endsWith('.md')) {
        continue
      }
      if (!graph.packages.includes(name)) {
        everything ??= path
      } else if (name === 'dev' && rest.startsWith('performance-checks/')) {
        selected.set(PERFORMANCE_CHECKS, 'changed test file')
      } else if (name === 'runtime-toolchain' && /^runtime-toolchain-tests\/[^/]+\.jest-test\.tsx?$/.test(rest)) {
        selected.set(RUNTIME_JEST, 'changed test file')
      } else if (packageTestSuite(path) === name) {
        selected.set(name, 'changed test file')
      } else {
        changedPackages.set(name, path)
      }
      continue
    }
    if (path.startsWith('Apps/')) {
      if (path.endsWith('.md')) {
        continue
      }
      const segments = path.split('/')
      const root = segments.length >= 3 ? `Apps/${segments[1]}` : ALL_APPS
      appPaths.set(root, `${root} changed`)
      appSourcesChanged = true
      continue
    }
    if (path.endsWith('.tao')) {
      appPaths.set(ALL_APPS, `${path} changed outside Apps/`)
      appSourcesChanged = true
      continue
    }
    if (WORKFLOW_PATHS.includes(path) || WORKFLOW_PREFIXES.some(prefix => path.startsWith(prefix))) {
      selected.set('dev', 'repository workflow changed')
      continue
    }
    if (DOCUMENTATION_PATTERN.test(path)) {
      continue
    }
    everything ??= path
  }

  // Affected packages arrive nearest-first, so the first reason to reach the apps or the
  // performance checks is the most direct one and the one worth printing.
  const appAffectedPackages = new Set(
    PackageGraph.affected(graph, [...changedPackages.keys()].filter(name => name !== 'dev'))
      .map(entry => entry.package),
  )
  for (const { package: name, reason } of PackageGraph.affected(graph, changedPackages.keys())) {
    if (inventory.packageSuites.includes(name)) {
      selected.set(name, reason)
    }
    if (name === 'runtime-toolchain' && inventory.hasRuntimeJest) {
      selected.set(RUNTIME_JEST, reason)
    }
    if (
      LANGUAGE_PERFORMANCE_PACKAGES.has(name) && inventory.hasPerformanceChecks && !selected.has(PERFORMANCE_CHECKS)
    ) {
      selected.set(PERFORMANCE_CHECKS, `${name} ${reason}`)
    }
    if (TAO_APPS_PACKAGES.has(name) && appAffectedPackages.has(name) && !appPaths.has(ALL_APPS)) {
      appPaths.clear()
      appPaths.set(ALL_APPS, `${name} ${reason}`)
    }
  }

  const inventoryNames = allSuiteNames(inventory)
  if (everything !== undefined) {
    const reason = `${everything} is not mapped to a suite`
    return {
      everything,
      selected: new Map(inventoryNames.map(name => [name, reason])),
      skipped: [],
      taoAppPaths: inventory.hasTaoApps ? [ALL_APPS] : undefined,
    }
  }

  let taoAppPaths: string[] | undefined
  if (appPaths.size > 0 && inventory.hasTaoApps) {
    if (appSourcesChanged) {
      for (const suite of ['formatter', 'runtime-toolchain']) {
        if (inventory.packageSuites.includes(suite)) {
          selected.set(suite, 'reads Tao app sources')
        }
      }
      if (inventory.hasRuntimeJest) {
        selected.set(RUNTIME_JEST, 'reads Tao app sources')
      }
    }
    taoAppPaths = appPaths.has(ALL_APPS) ? [ALL_APPS] : [...appPaths.keys()].sort()
    selected.set(TAO_APPS, appPaths.get(ALL_APPS) ?? taoAppPaths.map(root => `${root} changed`).join(', '))
  }
  const ordered = new Map(inventoryNames.filter(name => selected.has(name)).map(name => [name, selected.get(name)!]))
  return {
    selected: ordered,
    skipped: inventoryNames.filter(name => !selected.has(name)),
    taoAppPaths,
  }
}

function allSuiteNames(inventory: SuiteInventory): string[] {
  return [
    ...inventory.packageSuites,
    ...(inventory.hasPerformanceChecks ? [PERFORMANCE_CHECKS] : []),
    ...(inventory.hasRuntimeJest ? [RUNTIME_JEST] : []),
    ...(inventory.hasTaoApps ? [TAO_APPS] : []),
  ]
}

/** TestSelection owns Git comparison and the mapping from changed paths to the suites that observe them. */
export const TestSelection = {
  ALL_APPS,
  changedSelection,
  packageTestSuite,
  planChangedSuites,
} as const
