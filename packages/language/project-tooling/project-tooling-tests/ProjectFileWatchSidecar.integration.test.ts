import { FS } from '@shared'
import { Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import type { ProjectToolingResult, ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { watchProjectWithPolling } from './ProjectFileWatchTestSupport'

Describe('project tooling disk watch external sidecar closure', () => {
  Test('watches an app’s external sidecar helper through missing, edited, deleted, and recreated states', async () => {
    await withTaoFiles('tao-tooling-watch-external-sidecar-', {
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
      'Host/.gitkeep': '',
    }, async (paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const widget = paths['Host/Widget.tsx']
      const helper = FS.resolvePath('Host/Helper.ts', fixture)
      const results: ProjectToolingResult[] = []
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await watchProjectWithPolling(root, { onResult: result => results.push(result) })
        Expect(watcher.lastResult.status).toBe('stale')
        Expect(watcher.lastResult.externalSidecarInputPaths).toContain(widget)
        Expect(watcher.lastResult.externalSidecarInputPaths).toContain(helper)
        const initial = watcher.lastResult

        await FS.writeText(helper, 'export const value: number = 1\n')
        const created = await until(
          () => results.find(result => result.revision > initial.revision && result.status === 'fresh'),
          { description: 'external missing helper creation' },
        )
        Expect(created.externalSidecarInputPaths).toEqual([helper, widget])

        await FS.writeText(helper, 'export const value: number = "wrong"\n')
        const edited = await until(
          () =>
            results.find(result =>
              result.revision > created.revision && result.status === 'stale'
              && result.diagnostics.some(diagnostic => diagnostic.filePath === helper && diagnostic.code === 'TS2322')
            ),
          { description: 'external helper edit' },
        )

        await FS.remove(helper)
        const deleted = await until(
          () =>
            results.find(result =>
              result.revision > edited.revision && result.status === 'stale'
              && result.externalSidecarInputPaths.includes(helper)
            ),
          { description: 'external helper deletion' },
        )

        await FS.writeText(helper, 'export const value: number = 1\n')
        await until(
          () => results.find(result => result.revision > deleted.revision && result.status === 'fresh'),
          { description: 'external helper recreation' },
        )
      } finally {
        await watcher?.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 120_000)
})
