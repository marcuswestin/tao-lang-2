import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  overlappingWatchFolders,
  readWatchFacts,
  studioWatchChecks,
  unwatchedSourceRoots,
  WATCHED_SOURCE_ROOTS,
  type WatchFacts,
} from '../studio-tooling-src/StudioWatchHealth'

const repositoryRoot = '/w'

function facts(overrides: Partial<WatchFacts> = {}): WatchFacts {
  return {
    metroWatchFolders: WATCHED_SOURCE_ROOTS.map(path => FS.resolvePath(path, repositoryRoot)),
    repositoryRoot,
    ...overrides,
  }
}

function check(checks: ReturnType<typeof studioWatchChecks>, name: string) {
  return checks.find(candidate => candidate.name === name)
}

Describe('Studio watch health', () => {
  Test('accepts a configuration that watches every workspace source root', () => {
    const checks = studioWatchChecks(facts())

    Expect(unwatchedSourceRoots(facts())).toEqual([])
    Expect(check(checks, 'studio watch coverage')?.status).toBe('pass')
  })

  Test('fails when an edit in a workspace package could never reach the preview', () => {
    const withoutStudio = facts({
      metroWatchFolders: WATCHED_SOURCE_ROOTS
        .filter(path => path !== 'packages/ides/studio/studio-src')
        .map(path => FS.resolvePath(path, repositoryRoot)),
    })

    Expect(unwatchedSourceRoots(withoutStudio)).toEqual(['packages/ides/studio/studio-src'])
    const coverage = check(studioWatchChecks(withoutStudio), 'studio watch coverage')
    Expect(coverage?.status).toBe('fail')
    Expect(coverage?.detail).toContain('packages/ides/studio/studio-src')
  })

  Test('counts a source root covered by an enclosing watch folder', () => {
    const enclosing = facts({ metroWatchFolders: [repositoryRoot] })

    Expect(unwatchedSourceRoots(enclosing)).toEqual([])
  })

  Test('reports a nested watch folder as redundant work, not as a failure', () => {
    const nested = facts({
      metroWatchFolders: ['/w/packages/apps/runtime', '/w/packages/apps/runtime/TaoRuntime-src'],
    })

    Expect(overlappingWatchFolders(nested.metroWatchFolders)).toEqual([
      { inside: '/w/packages/apps/runtime', nested: '/w/packages/apps/runtime/TaoRuntime-src' },
    ])
    // Studio compiles from its own watch of the project root, so this cannot double a compile.
    const duplication = check(studioWatchChecks(nested), 'studio watch duplication')
    Expect(duplication?.status).toBe('pass')
    Expect(duplication?.detail).toContain('redundant crawl')
  })

  Test('every workspace source root this repository ships is watched by Metro today', async () => {
    const installed = await readWatchFacts(Repo.getRoot())

    Expect(installed.metroWatchFolders.length).toBeGreaterThan(0)
    Expect(unwatchedSourceRoots(installed)).toEqual([])
  })

  Test('keeps every folder Metro watches visible to Watchman', async () => {
    // Watchman answers a query under an ignored directory with no files at all, so ignoring a
    // folder Metro watches hands Metro an empty file map and every package fails to resolve.
    const root = Repo.getRoot()
    const installed = await readWatchFacts(root)
    const config = await FS.readJson<{ ignore_dirs?: string[] }>(FS.resolvePath('.watchmanconfig', root))
    const ignored = (config.ignore_dirs ?? []).map(path => FS.resolvePath(path, root))

    Expect(installed.metroWatchFolders.length).toBeGreaterThan(0)
    Expect(installed.metroWatchFolders.filter(folder => ignored.some(dir => FS.pathIsWithin(folder, dir))))
      .toEqual([])
  })
})
