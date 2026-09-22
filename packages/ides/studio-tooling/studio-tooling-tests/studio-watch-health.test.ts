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

  Test('records the three trees this repository deliberately watches twice', async () => {
    const installed = await readWatchFacts(Repo.getRoot())
    const overlaps = overlappingWatchFolders(installed.metroWatchFolders)
      .map(overlap =>
        `${FS.relativePath(Repo.getRoot(), overlap.nested)} inside ${FS.relativePath(Repo.getRoot(), overlap.inside)}`
      )
      .toSorted()

    // metro.config.cjs names these source roots explicitly so Metro's file map can hash the files
    // its aliases return, and metro-config.test.ts asserts that requirement directly. Each is also
    // inside a package root Expo already watches, so each is crawled twice. That is redundant work
    // and nothing worse — Studio compiles from its own watch of the project root — so it is
    // recorded here rather than removed. Growing this list is a regression worth seeing.
    Expect(overlaps).toEqual([
      'packages/apps/expo-host/node_modules inside packages/apps/expo-host',
      'packages/apps/runtime/TaoRuntime-src inside packages/apps/runtime',
      'packages/shared/shared-src/core inside packages/shared',
    ])
  })
})
