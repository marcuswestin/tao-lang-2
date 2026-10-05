import { Errors, FS, Time } from '@shared'
import { Deferred, Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import type {
  ProjectToolingOptions,
  ProjectToolingResult,
  ProjectToolingWatch,
} from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

/** Polling drives real disk events in this test runner; production retains chokidar's native default. */
function watchProjectWithPolling(
  root: string,
  options: ProjectToolingOptions,
  refresh = () => ProjectTooling.refresh(root, options),
): Promise<ProjectToolingWatch> {
  return startProjectFileWatch(
    root,
    options,
    refresh,
    (paths, watcherOptions) => watch(paths, { ...watcherOptions, usePolling: true, interval: 100 }),
  )
}

Describe('project tooling disk watch with a polling test driver', () => {
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
        '{"extends":["./.tao/typescript/tsconfig.json","../Shared/config.json"]}\n',
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

  Test('watches an app’s exact external sidecar closure through missing, edited, and recreated helpers', async () => {
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
        const recreated = await until(
          () => results.find(result => result.revision > deleted.revision && result.status === 'fresh'),
          { description: 'external helper recreation' },
        )

        await FS.remove(widget)
        const missingRoot = await until(
          () =>
            results.find(result =>
              result.revision > recreated.revision && result.status === 'stale'
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
      const watcher = await watchProjectWithPolling(root, { onResult: result => results.push(result) }, async () => {
        const refreshed = await ProjectTooling.refresh(root, {})
        calls += 1
        if (calls === 1) {
          Expect(refreshed.status).toBe('stale')
          Expect(refreshed.externalSidecarInputPaths).toContain(helper)
          await FS.writeText(helper, 'export const value: number = 1\n')
        }
        return refreshed
      })
      try {
        Expect(calls).toBe(2)
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
        '{"extends":["./.tao/typescript/tsconfig.json","../Shared/config.json"]}\n',
      )

      const results: ProjectToolingResult[] = []
      let calls = 0
      const watcher = await watchProjectWithPolling(root, {
        onResult: result => results.push(result),
      }, async () => {
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
        Expect(results).toHaveLength(1)
        Expect(watcher.lastResult.status).toBe('fresh')
      } finally {
        await watcher.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 90_000)

  Test('queues a disk edit that arrives while a refresh is active', async () => {
    await withTaoFiles('tao-tooling-watch-queue-', {
      'Main.ts': 'export const value: number = 1\n',
    }, async (paths, root) => {
      const results: ProjectToolingResult[] = []
      const started = Deferred()
      const release = Deferred()
      let calls = 0
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await watchProjectWithPolling(root, { onResult: result => results.push(result) }, async () => {
          calls += 1
          const result = await ProjectTooling.refresh(root, {})
          if (calls === 2) {
            started.resolve()
            await release.promise
          }
          return result
        })
        Expect(results).toHaveLength(1)

        await FS.writeText(paths['Main.ts'], 'export const value: number = 2\n')
        await until(() => calls === 2, { description: 'the first watched edit to start refreshing' })
        await started.promise
        await FS.writeText(paths['Main.ts'], 'export const value: number = "wrong"\n')
        await Time.sleep(500)
        release.resolve()

        await until(() =>
          results.find(result =>
            result.revision > results[0]!.revision && result.status === 'stale'
            && result.diagnostics.some(diagnostic => diagnostic.code === 'TS2322')
          ), { description: 'the queued refresh after an edit during active work' })
        Expect(calls).toBeGreaterThanOrEqual(3)
        Expect(results[1]?.status).toBe('fresh')
      } finally {
        release.resolve()
        await watcher?.dispose()
      }
    }, { location: 'host' })
  }, 90_000)
})
