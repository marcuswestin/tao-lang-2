import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  overlappingWatchFolders,
  readWatchFacts,
  studioWatchChecks,
  unwatchedSourceRoots,
  WATCHED_SOURCE_ROOTS,
  type WatchFacts,
} from '../dev-src/studio/StudioWatchHealth'

const repositoryRoot = '/w'

function facts(overrides: Partial<WatchFacts> = {}): WatchFacts {
  return {
    metroWatchFolders: WATCHED_SOURCE_ROOTS.map(path => FS.resolvePath(path, repositoryRoot)),
    projectRoot: '/w/Apps/HNReader',
    repositoryRoot,
    watchmanReachable: true,
    watchmanRoots: ['/w'],
    watchmanVersion: '2026.01.19.00',
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
    Expect(check(checks, 'studio watch')?.status).toBe('pass')
  })

  Test('fails when an edit in a workspace package could never reach the preview', () => {
    const withoutStudio = facts({
      metroWatchFolders: WATCHED_SOURCE_ROOTS
        .filter(path => path !== 'packages/studio/studio-src')
        .map(path => FS.resolvePath(path, repositoryRoot)),
    })

    Expect(unwatchedSourceRoots(withoutStudio)).toEqual(['packages/studio/studio-src'])
    const coverage = check(studioWatchChecks(withoutStudio), 'studio watch coverage')
    Expect(coverage?.status).toBe('fail')
    Expect(coverage?.detail).toContain('packages/studio/studio-src')
  })

  Test('counts a source root covered by an enclosing watch folder', () => {
    const enclosing = facts({ metroWatchFolders: [repositoryRoot] })

    Expect(unwatchedSourceRoots(enclosing)).toEqual([])
  })

  Test('reports a nested watch folder, which turns one save into two compiles', () => {
    const nested = facts({ metroWatchFolders: ['/w/packages/runtime', '/w/packages/runtime/TaoRuntime-src'] })

    Expect(overlappingWatchFolders(nested.metroWatchFolders)).toEqual([
      { inside: '/w/packages/runtime', nested: '/w/packages/runtime/TaoRuntime-src' },
    ])
    Expect(check(studioWatchChecks(nested), 'studio watch duplication')?.status).toBe('warn')
  })

  Test('names the defined fallback when Watchman is unavailable', () => {
    const withoutWatchman = check(studioWatchChecks(facts({ watchmanVersion: undefined })), 'studio watch')

    Expect(withoutWatchman?.status).toBe('warn')
    Expect(withoutWatchman?.detail).toContain('Metro falls back to watching through the OS')
  })

  Test('treats a project not yet watched as expected before a launch', () => {
    const notYet = check(studioWatchChecks(facts({ watchmanRoots: [] })), 'studio watch')

    Expect(notYet?.status).toBe('pass')
    Expect(notYet?.detail).toContain('not watching')
  })

  Test('every workspace source root this repository ships is watched by Metro today', async () => {
    const installed = await readWatchFacts(Repo.getRoot())

    Expect(installed.metroWatchFolders.length).toBeGreaterThan(0)
    Expect(unwatchedSourceRoots(installed)).toEqual([])
  })
})
