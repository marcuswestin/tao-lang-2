import { CLI, FS, Repo } from '@shared'
import type { DoctorCheck } from '@verification/RepositoryDoctor'

/**
 * Studio's edit-to-preview loop is only as good as its file watching, and two different watchers
 * are involved: Studio compiles from its own chokidar watch of the project root, while Metro
 * bundles from `watchFolders`. Only the second is checked here, because only the second is
 * configuration; the first is verified end to end by the studio-smoke lane.
 *
 * A source root Metro does not watch is a real failure — an aliased workspace edit that never
 * reaches the bundle. A tree watched twice is not: it costs a redundant crawl and a duplicate
 * subscription, and nothing more. Whether Watchman itself answers, and at which root, is the
 * repository doctor's `WatchmanHealth`, which the Studio report already includes.
 */

/** Workspace sources an edit must invalidate: Studio's preview bundle is built from all of them. */
export const WATCHED_SOURCE_ROOTS = [
  'packages/apps/runtime/TaoRuntime-src',
  'packages/apps/expo-host/expo-host-src',
  'packages/shared/shared-src/core',
  'packages/apps/stdlib',
  'packages/ides/studio/studio-src',
] as const

/** WatchFacts is what the checks read about the machine and Metro's configuration. */
export type WatchFacts = {
  /** Absolute paths Metro watches, from its own configuration. */
  metroWatchFolders: readonly string[]
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
 * overlappingWatchFolders returns folders nested inside another watched folder. This is waste, not
 * breakage: Metro crawls the nested tree twice at startup and subscribes to it twice. It does not
 * double Studio's compiles, which are driven by a separate watch of the project root.
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
  return [metroCoverageCheck(facts), duplicateWatchCheck(facts)]
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
    remediation: 'Add the root to watchFolders in packages/apps/expo-host/metro.config.cjs.',
    status: 'fail',
  }
}

function duplicateWatchCheck(facts: WatchFacts): DoctorCheck {
  const overlaps = overlappingWatchFolders(facts.metroWatchFolders)
  if (overlaps.length === 0) {
    return { detail: 'no watched folder is nested inside another', name: 'studio watch duplication', status: 'pass' }
  }
  return {
    // Reported, not warned about: it costs startup work, and nothing else. Warning would put a
    // permanent yellow line in front of every reader for something that is merely untidy.
    detail: `${overlaps.length} watched folder(s) are nested inside another, which costs a `
      + `redundant crawl: ${
        overlaps
          .map(overlap => `${FS.displayPath(overlap.nested)} inside ${FS.displayPath(overlap.inside)}`)
          .join(', ')
      }`,
    name: 'studio watch duplication',
    status: 'pass',
  }
}

/** readWatchFacts reads Metro's watch configuration without starting it. */
export async function readWatchFacts(repositoryRoot = Repo.getRoot()): Promise<WatchFacts> {
  return { metroWatchFolders: await metroWatchFolders(repositoryRoot), repositoryRoot }
}

/** Reads Metro's own configuration, so the check cannot drift from what Metro actually watches. */
async function metroWatchFolders(repositoryRoot: string): Promise<string[]> {
  const configPath = FS.resolvePath('packages/apps/expo-host/metro.config.cjs', repositoryRoot)
  if (!await FS.isFile(configPath)) {
    return []
  }
  const result = await CLI.run('bun', {
    args: [
      '-e',
      `console.log(JSON.stringify(require(${JSON.stringify(configPath)}).watchFolders ?? []))`,
    ],
    cwd: FS.resolvePath('packages/apps/expo-host', repositoryRoot),
  })
  try {
    return JSON.parse(result.stdout.trim()) as string[]
  } catch {
    return []
  }
}
