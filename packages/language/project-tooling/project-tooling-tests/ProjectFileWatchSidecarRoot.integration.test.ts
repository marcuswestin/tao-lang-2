import { FS } from '@shared'
import { Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import type { ProjectToolingResult, ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { watchProjectWithPolling } from './ProjectFileWatchTestSupport'

Describe('project tooling disk watch external sidecar root and ownership', () => {
  Test('watches an external sidecar root and an external ownership marker', async () => {
    await withTaoFiles('tao-tooling-watch-external-root-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.tao': `app Example {
  id "com.tao.example"
  version "1.0.0"
  name "Example"
  view Widget
}
view Widget() from ../Host/Widget.tsx
`,
      'Host/Widget.tsx': "import { value } from './Helper'\nvoid value\nexport function Widget() { return null }\n",
      'Host/Helper.ts': 'export const value: number = 1\n',
    }, async (paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const widget = paths['Host/Widget.tsx']
      const results: ProjectToolingResult[] = []
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await watchProjectWithPolling(root, { onResult: result => results.push(result) })
        Expect(watcher.lastResult.status).toBe('fresh')
        const initial = watcher.lastResult

        await FS.remove(widget)
        const missingRoot = await until(
          () =>
            results.find(result =>
              result.revision > initial.revision && result.status === 'stale'
              && result.externalSidecarInputPaths.includes(widget)
            ),
          { description: 'external sidecar root deletion' },
        )

        await FS.writeText(
          widget,
          "import { value } from './Helper'\nvoid value\nexport function Widget() { return null }\n",
        )
        await until(
          () => results.find(result => result.revision > missingRoot.revision && result.status === 'fresh'),
          { description: 'external sidecar root recreation' },
        )

        const beforeMarker = results.at(-1)!
        const marker = FS.resolvePath('Host/.tao', fixture)
        await FS.mkdir(marker)
        const blocked = await until(
          () =>
            results.find(result =>
              result.revision > beforeMarker.revision && result.status === 'stale'
              && result.diagnostics.some(diagnostic => diagnostic.message.includes('Tao project boundary'))
            ),
          { description: 'external ownership marker addition' },
        )
        Expect(blocked.sidecarOwnershipInputPaths).toContain(marker)

        await FS.remove(marker)
        await until(
          () => results.find(result => result.revision > blocked.revision && result.status === 'fresh'),
          { description: 'external ownership marker removal' },
        )
      } finally {
        await watcher?.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 120_000)
})
