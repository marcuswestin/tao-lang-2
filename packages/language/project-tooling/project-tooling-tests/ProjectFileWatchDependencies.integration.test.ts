import { Errors, FS } from '@shared'
import { Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import type { ProjectToolingResult } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { watchProjectWithPolling } from './ProjectFileWatchTestSupport'

Describe('project tooling disk watch dependency attachment', () => {
  Test('retries a failed live dependency attachment and observes later dependency edits', async () => {
    await withTaoFiles('tao-tooling-watch-dependency-retry-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Widget Package" version 2.0.0 includes @widgets }',
      'Library/@widgets/Widget.tao': `public function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Library/@widgets/Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': 'package { version 0.1.0 }',
    }, async (paths, fixture) => {
      const root = FS.resolvePath('Consumer', fixture)
      const dependencyRoot = FS.resolvePath('Library', fixture)
      const results: ProjectToolingResult[] = []
      const errors: unknown[] = []
      let attachmentAttempts = 0
      const watcher = await startProjectFileWatch(
        root,
        {
          onResult: result => results.push(result),
          onError: error => errors.push(error),
        },
        async () => await ProjectTooling.refresh(root, {}),
        (watchPath, watcherOptions) => {
          const fileWatcher = watch(watchPath, { ...watcherOptions, usePolling: true, interval: 100 })
          if (watchPath === dependencyRoot) {
            attachmentAttempts += 1
            if (attachmentAttempts === 1) {
              queueMicrotask(() =>
                fileWatcher.emit(
                  'error',
                  new Errors.HostEnvironmentError('injected dependency watcher attachment failure'),
                )
              )
            }
          }
          return fileWatcher
        },
      )
      try {
        Expect(watcher.lastResult.status).toBe('fresh')
        Expect(watcher.lastResult.dependencyRoots).toEqual([])
        await FS.writeText(
          paths['Consumer/Main.tao'],
          `use CountWords from @parts
package { version 0.1.0 requires "Widget Package" from ../Library version ^2.0.0 { @widgets as @parts } }
`,
        )
        await until(
          () => errors.some(error => String(error).includes('injected dependency watcher attachment failure')),
          { description: 'the first dependency attachment to fail' },
        )
        Expect(attachmentAttempts).toBe(1)

        const recovered = await watcher.requestRefresh()
        Expect(recovered.status).toBe('fresh')
        Expect(recovered.dependencyRoots).toContain(dependencyRoot)
        Expect(attachmentAttempts).toBe(2)

        await FS.writeText(
          paths['Library/@widgets/Words.ts'],
          'export function CountWords(value: number): number { return value }\n',
        )
        await until(() =>
          results.find(result =>
            result.revision > recovered.revision
            && result.status === 'stale' && result.diagnostics.some(diagnostic => diagnostic.code === 'TS2344')
          ), { description: 'a dependency edit after attachment retry' })
      } finally {
        await watcher.dispose()
      }
    })
  }, 90_000)

  Test('rechecks a dependency edited between refresh and watcher attachment', async () => {
    await withTaoFiles('tao-tooling-watch-dependency-attach-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Widget Package" version 2.0.0 includes @widgets }',
      'Library/@widgets/Widget.tao': `public function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Library/@widgets/Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `use CountWords from @parts
package { version 0.1.0 requires "Widget Package" from ../Library version ^2.0.0 { @widgets as @parts } }
`,
    }, async (paths, fixture) => {
      const root = FS.resolvePath('Consumer', fixture)
      const results: ProjectToolingResult[] = []
      let calls = 0
      const watcher = await watchProjectWithPolling(root, {
        onResult: result => results.push(result),
      }, async () => {
        const result = await ProjectTooling.refresh(root, {})
        calls += 1
        if (calls === 1) {
          Expect(result.status).toBe('fresh')
          await FS.writeText(
            paths['Library/@widgets/Words.ts'],
            'export function CountWords(value: number): number { return value }\n',
          )
        }
        return result
      })
      try {
        Expect(calls).toBe(2)
        Expect(results).toHaveLength(1)
        Expect(watcher.lastResult.status).toBe('stale')
        Expect(watcher.lastResult.diagnostics.some(diagnostic => diagnostic.code === 'TS2344')).toBe(true)
      } finally {
        await watcher.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 90_000)
})
