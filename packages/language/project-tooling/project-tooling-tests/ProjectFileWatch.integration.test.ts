import { Errors, FS, Time } from '@shared'
import { Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import type { ProjectToolingResult, ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { watchProjectWithPolling } from './ProjectFileWatchTestSupport'

Describe('project tooling disk watch saved inputs and dependency races', () => {
  Test('refreshes saved edits, additions, deletions, and stale recovery without output loops', async () => {
    await withTaoFiles('tao-tooling-watch-source-', {
      'Main.tao': `function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
    }, async (paths, root) => {
      await ProjectTooling.refresh(root, {})
      const results: ProjectToolingResult[] = []
      const errors: unknown[] = []
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await watchProjectWithPolling(root, {
          onResult: result => results.push(result),
          onError: error => errors.push(error),
        })
        Expect(results).toHaveLength(1)
        Expect(watcher.lastResult.status).toBe('fresh')
        const contract = FS.resolvePath('.tao-ts/Main.tao.ts', root)
        Expect(watcher.lastResult.contractPaths).toContain(contract)

        // Generated output written while watched must not schedule a refresh.
        await Time.sleep(800)
        const settledCount = results.length
        Expect(settledCount).toBe(1)
        await Time.sleep(800)
        Expect(results).toHaveLength(settledCount)
        await FS.writeText(FS.resolvePath('.tao-ts/unrelated.ts', root), 'export const generated = 1\n')
        await Time.sleep(800)
        Expect(results).toHaveLength(settledCount)

        await FS.writeText(paths['Words.ts'], 'export function CountWords(value: number): number { return value }\n')
        const broken = await until(() =>
          results.find(result =>
            result.revision > 1 && result.status === 'stale'
            && result.diagnostics.some(diagnostic => diagnostic.code === 'TS2344')
          ), { description: 'a stale result after a saved sidecar edit' })
        Expect(broken.contractPaths).toContain(contract)
        Expect(await FS.isFile(contract)).toBe(true)

        await FS.writeText(
          paths['Words.ts'],
          'export function CountWords(value: string): number { return value.length }\n',
        )
        const repaired = await until(
          () => results.find(result => result.revision > broken.revision && result.status === 'fresh'),
          { description: 'a fresh result after sidecar repair' },
        )

        const added = FS.resolvePath('Added.ts', root)
        await FS.writeText(added, 'export const wrong: number = "text"\n')
        const addition = await until(
          () =>
            results.find(result =>
              result.revision > repaired.revision && result.status === 'stale'
              && result.diagnostics.some(diagnostic => diagnostic.filePath === added && diagnostic.code === 'TS2322')
            ),
          { description: 'a stale result after adding invalid TypeScript' },
        )

        await FS.remove(added)
        const deleted = await until(
          () => results.find(result => result.revision > addition.revision && result.status === 'fresh'),
          { description: 'a fresh result after deleting invalid TypeScript' },
        )
        Expect(deleted.contractPaths).toContain(contract)

        await FS.remove(paths['Main.tao'])
        await until(
          () =>
            results.find(result =>
              result.revision > deleted.revision && result.status === 'fresh' && result.contractPaths.length === 0
            ),
          { description: 'generated contract cleanup after deleting Tao source' },
        )
        Expect(await FS.exists(contract)).toBe(false)

        await watcher.dispose()
        watcher = undefined
        const completed = results.length
        await FS.writeText(paths['Words.ts'], 'export const value: number = "text"\n')
        await Time.sleep(800)
        Expect(results).toHaveLength(completed)
        Expect(errors).toEqual([])
      } finally {
        await watcher?.dispose()
      }
    }, { location: 'host' })
  }, 120_000)

  Test('refreshes a selected dependency project after its saved sidecar changes', async () => {
    await withTaoFiles('tao-tooling-watch-dependency-', {
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
      const dependencyRoot = FS.resolvePath('Library', fixture)
      const results: ProjectToolingResult[] = []
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await watchProjectWithPolling(root, { onResult: result => results.push(result) })
        Expect(watcher.lastResult.status).toBe('fresh')
        Expect(watcher.lastResult.dependencyRoots).toContain(dependencyRoot)

        await FS.writeText(
          paths['Library/@widgets/Words.ts'],
          'export function CountWords(value: number): number { return value }\n',
        )
        const broken = await until(() =>
          results.find(result =>
            result.revision > 1 && result.status === 'stale'
            && result.diagnostics.some(diagnostic => diagnostic.code === 'TS2344')
          ), { description: 'a stale consumer after a selected dependency edit' })

        await FS.writeText(
          paths['Library/@widgets/Words.ts'],
          'export function CountWords(value: string): number { return value.length }\n',
        )
        await until(() => results.find(result => result.revision > broken.revision && result.status === 'fresh'), {
          description: 'a fresh consumer after dependency repair',
        })
      } finally {
        await watcher?.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 90_000)

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
