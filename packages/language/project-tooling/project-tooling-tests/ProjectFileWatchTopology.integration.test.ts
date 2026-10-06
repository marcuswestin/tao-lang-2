import { FS } from '@shared'
import { Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import type { ProjectToolingResult, ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { watchProjectWithPolling } from './ProjectFileWatchTestSupport'

Describe('project tooling disk watch external topology', () => {
  Test('recovers when a missing external tsconfig extend is added and becomes stale when deleted', async () => {
    await withTaoFiles('tao-tooling-watch-config-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.ts': 'export const answer: number = 42\n',
      'Shared/.gitkeep': '',
    }, async (_paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const external = FS.resolvePath('Shared/config.json', fixture)
      await ProjectTooling.refresh(root, {})
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":["./.tao/cache/typescript/tsconfig.json","../Shared/config.json"]}\n',
      )

      const results: ProjectToolingResult[] = []
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await watchProjectWithPolling(root, { onResult: result => results.push(result) })
        Expect(watcher.lastResult.status).toBe('stale')
        Expect(watcher.lastResult.configInputPaths).toContain(external)
        const initialRevision = watcher.lastResult.revision

        await FS.writeText(external, '{}\n')
        const recovered = await until(
          () => results.find(result => result.revision > initialRevision && result.status === 'fresh'),
          { description: 'a refresh after adding an external config extend' },
        )

        await FS.remove(external)
        const removed = await until(
          () => results.find(result => result.revision > recovered.revision && result.status === 'stale'),
          { description: 'a stale refresh after deleting an external config extend' },
        )
        Expect(removed.configInputPaths).toContain(external)
      } finally {
        await watcher?.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 90_000)

  Test('rechecks a helper created before its external watcher finishes attaching', async () => {
    await withTaoFiles('tao-tooling-watch-external-attach-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.tao': 'view Widget() from ../Host/Widget.tsx\n',
      'Host/Widget.tsx': "import { value } from './Helper'\nvoid value\nexport function Widget() { return null }\n",
    }, async (_paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const helper = FS.resolvePath('Host/Helper.ts', fixture)
      const results: ProjectToolingResult[] = []
      let calls = 0
      const forced: boolean[] = []
      const watcher = await watchProjectWithPolling(
        root,
        { onResult: result => results.push(result) },
        async request => {
          forced.push(request?.force === true)
          const refreshed = await ProjectTooling.refresh(root, {})
          calls += 1
          if (calls === 1) {
            Expect(refreshed.status).toBe('stale')
            Expect(refreshed.externalSidecarInputPaths).toContain(helper)
            await FS.writeText(helper, 'export const value: number = 1\n')
          }
          return refreshed
        },
      )
      try {
        Expect(calls).toBe(2)
        Expect(forced).toEqual([false, true])
        Expect(results).toHaveLength(1)
        Expect(watcher.lastResult.status).toBe('fresh')
      } finally {
        await watcher.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 90_000)

  Test('refreshes when a nested ownership marker appears or disappears around a sidecar', async () => {
    await withTaoFiles('tao-tooling-watch-nested-marker-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.tao': 'view Widget() from ./Host/Widget.tsx\n',
      'Project/Host/Widget.tsx': 'export function Widget() { return null }\n',
    }, async (_paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const marker = FS.resolvePath('Host/.tao', root)
      const results: ProjectToolingResult[] = []
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await watchProjectWithPolling(root, { onResult: result => results.push(result) })
        Expect(watcher.lastResult.status).toBe('fresh')
        Expect(watcher.lastResult.sidecarOwnershipInputPaths).toContain(marker)
        const initial = watcher.lastResult

        await FS.mkdir(marker)
        const blocked = await until(
          () =>
            results.find(result =>
              result.revision > initial.revision && result.status === 'stale'
              && result.diagnostics.some(diagnostic => diagnostic.message.includes('Tao project boundary'))
            ),
          { description: 'nested sidecar ownership marker addition' },
        )
        Expect(blocked.sidecarOwnershipInputPaths).toContain(marker)

        await FS.remove(marker)
        await until(
          () => results.find(result => result.revision > blocked.revision && result.status === 'fresh'),
          { description: 'nested sidecar ownership marker removal' },
        )
      } finally {
        await watcher?.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 90_000)

  Test('rechecks a config created between refresh and external watcher attachment', async () => {
    await withTaoFiles('tao-tooling-watch-config-attach-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.ts': 'export const answer: number = 42\n',
      'Shared/.gitkeep': '',
    }, async (_paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const external = FS.resolvePath('Shared/config.json', fixture)
      await ProjectTooling.refresh(root, {})
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":["./.tao/cache/typescript/tsconfig.json","../Shared/config.json"]}\n',
      )

      const results: ProjectToolingResult[] = []
      let calls = 0
      const forced: boolean[] = []
      const watcher = await watchProjectWithPolling(root, {
        onResult: result => results.push(result),
      }, async request => {
        forced.push(request?.force === true)
        const result = await ProjectTooling.refresh(root, {})
        calls += 1
        if (calls === 1) {
          Expect(result.status).toBe('stale')
          Expect(result.configInputPaths).toContain(external)
          await FS.writeText(external, '{}\n')
        }
        return result
      })
      try {
        Expect(calls).toBe(2)
        Expect(forced).toEqual([false, true])
        Expect(results).toHaveLength(1)
        Expect(watcher.lastResult.status).toBe('fresh')
      } finally {
        await watcher.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 90_000)
})
