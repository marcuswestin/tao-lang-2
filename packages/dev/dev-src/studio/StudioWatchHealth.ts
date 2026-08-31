import { CLI, FS, Repo } from '@shared'
import type { DoctorCheck } from '../doctor/RepositoryDoctor'

/**
 * Studio's edit-to-preview loop is only as good as its file watching. Two failures look identical
 * from the outside — an edit that never reaches the preview — so they are separated here: a source
 * root Metro does not watch at all, and a tree watched twice, which turns one save into two
 * compiles. Both are checked from Metro's own configuration rather than from a guess.
 */

/** Workspace sources an edit must invalidate: Studio's preview bundle is built from all of them. */
export const WATCHED_SOURCE_ROOTS = [
  'packages/runtime/TaoRuntime-src',
  'packages/runtime-toolchain/runtime-toolchain-src',
  'packages/shared/shared-src/core',
  'packages/stdlib',
  'packages/studio/studio-src',
  'packages/code-editor/code-editor-src',
] as const

/** WatchFacts is what the checks read about the machine and Metro's configuration. */
export type WatchFacts = {
  /** Watchman's reported version, or undefined when it is not installed. */
  watchmanVersion?: string
  /** False when Watchman is installed but not answering. */
  watchmanReachable?: boolean
  /** Roots Watchman is currently watching, or undefined when it could not be asked. */
  watchmanRoots?: readonly string[]
  /** Absolute paths Metro watches, from its own configuration. */
  metroWatchFolders: readonly string[]
  projectRoot: string
  repositoryRoot: string
}

/** unwatchedSourceRoots returns the workspace sources no Metro watch folder covers. */
export function unwatchedSourceRoots(facts: WatchFacts): string[] {
  return WATCHED_SOURCE_ROOTS
    .map(relativePath => FS.resolvePath(relativePath, facts.repositoryRoot))
    .filter(path => !facts.metroWatchFolders.some(folder => path === folder || FS.pathIsWithin(path, folder)))
    .map(path => FS.relativePath(facts.repositoryRoot, path))
}

/**
 * overlappingWatchFolders returns folders nested inside another watched folder. Metro delivers one
 * change under a doubly-watched tree twice, and Studio compiles on each, so a save becomes two
 * compiles and the second can publish a preview built from the first one's revision.
 */
export function overlappingWatchFolders(folders: readonly string[]): { inside: string; nested: string }[] {
  const overlaps: { inside: string; nested: string }[] = []
  for (const nested of folders) {
    for (const inside of folders) {
      if (nested !== inside && FS.pathIsWithin(nested, inside)) {
        overlaps.push({ inside, nested })
      }
    }
  }
  return overlaps
}

/** studioWatchChecks reports watch health as doctor lines. */
export function studioWatchChecks(facts: WatchFacts): DoctorCheck[] {
  return [watchmanCoverageCheck(facts), metroCoverageCheck(facts), duplicateWatchCheck(facts)]
}

function watchmanCoverageCheck(facts: WatchFacts): DoctorCheck {
  if (facts.watchmanVersion === undefined || facts.watchmanReachable === false) {
    return {
      // The fallback is defined, not absent: Metro watches through the OS instead. On this
      // repository that exceeds the descriptor limit, so it is reported as a real consequence.
      detail: 'Watchman is unavailable; Metro falls back to watching through the OS',
      name: 'studio watch',
      remediation: 'Start it with: watchman shutdown-server, then rerun. Studio needs it on this repository.',
      status: 'warn',
    }
  }
  if (facts.watchmanRoots === undefined) {
    return {
      detail: `Watchman ${facts.watchmanVersion} is reachable; its watched roots could not be listed`,
      name: 'studio watch',
      status: 'warn',
    }
  }
  const watched = facts.watchmanRoots.some(root =>
    facts.projectRoot === root || FS.pathIsWithin(facts.projectRoot, root)
  )
  if (watched) {
    return { detail: `Watchman is watching ${facts.projectRoot}`, name: 'studio watch', status: 'pass' }
  }
  return {
    detail: `Watchman is running but not watching ${facts.projectRoot} yet`,
    name: 'studio watch',
    remediation: 'Studio establishes the watch when it opens the project; this is expected before a launch.',
    status: 'pass',
  }
}

function metroCoverageCheck(facts: WatchFacts): DoctorCheck {
  const unwatched = unwatchedSourceRoots(facts)
  if (unwatched.length === 0) {
    return {
      detail: `Metro watches all ${WATCHED_SOURCE_ROOTS.length} workspace source roots`,
      name: 'studio watch coverage',
      status: 'pass',
    }
  }
  return {
    detail: `Metro does not watch ${unwatched.join(', ')}, so edits there never reach the preview`,
    name: 'studio watch coverage',
    remediation: 'Add the root to watchFolders in packages/runtime-toolchain/metro.config.cjs.',
    status: 'fail',
  }
}

function duplicateWatchCheck(facts: WatchFacts): DoctorCheck {
  const overlaps = overlappingWatchFolders(facts.metroWatchFolders)
  if (overlaps.length === 0) {
    return { detail: 'no watched folder is nested inside another', name: 'studio watch duplication', status: 'pass' }
  }
  return {
    detail: overlaps
      .map(overlap => `${FS.displayPath(overlap.nested)} is inside ${FS.displayPath(overlap.inside)}`)
      .join(', '),
    name: 'studio watch duplication',
    remediation:
      'A nested watch folder delivers each change twice, compiling twice per save. Watch only the outer root.',
    status: 'warn',
  }
}

/** readWatchFacts inspects Watchman and Metro's configuration without starting either. */
export async function readWatchFacts(
  projectRoot: string,
  repositoryRoot = Repo.getRoot(),
): Promise<WatchFacts> {
  const version = await watchmanVersion()
  return {
    metroWatchFolders: await metroWatchFolders(repositoryRoot),
    projectRoot: FS.resolvePath(projectRoot),
    repositoryRoot,
    watchmanReachable: version === undefined ? undefined : await watchmanReachable(),
    watchmanRoots: version === undefined ? undefined : await watchmanRoots(),
    watchmanVersion: version,
  }
}

async function watchmanVersion(): Promise<string | undefined> {
  const result = await CLI.run('watchman', { args: ['--version'] })
  const version = result.stdout.trim()
  return result.error === undefined && result.exitCode === 0 && version !== '' ? version : undefined
}

async function watchmanReachable(): Promise<boolean> {
  const result = await CLI.run('watchman', { args: ['version'] })
  return result.error === undefined && result.exitCode === 0
}

async function watchmanRoots(): Promise<string[] | undefined> {
  const result = await CLI.run('watchman', { args: ['watch-list'] })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  try {
    return (JSON.parse(result.stdout) as { roots?: string[] }).roots ?? []
  } catch {
    return undefined
  }
}

/** Reads Metro's own configuration, so the check cannot drift from what Metro actually watches. */
async function metroWatchFolders(repositoryRoot: string): Promise<string[]> {
  const configPath = FS.resolvePath('packages/runtime-toolchain/metro.config.cjs', repositoryRoot)
  if (!await FS.isFile(configPath)) {
    return []
  }
  const result = await CLI.run('bun', {
    args: [
      '-e',
      `console.log(JSON.stringify(require(${JSON.stringify(configPath)}).watchFolders ?? []))`,
    ],
    cwd: FS.resolvePath('packages/runtime-toolchain', repositoryRoot),
  })
  try {
    return JSON.parse(result.stdout.trim()) as string[]
  } catch {
    return []
  }
}
