import { FS, Time } from '@shared'
import { Deferred, Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import type { ProjectToolingResult, ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { watchProjectWithPolling } from './ProjectFileWatchTestSupport'

Describe('project tooling disk watch refresh scheduling', () => {
  Test('queues a disk edit that arrives while a refresh is active', async () => {
    await withTaoFiles('tao-tooling-watch-queue-', {
      'Main.ts': 'export const value: number = 1\n',
    }, async (paths, root) => {
      const results: ProjectToolingResult[] = []
      const started = Deferred()
      const release = Deferred()
      let calls = 0
      let blockedCall: number | undefined
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await watchProjectWithPolling(root, { onResult: result => results.push(result) }, async () => {
          calls += 1
          const result = await ProjectTooling.refresh(root, {})
          if (calls === blockedCall) {
            started.resolve()
            await release.promise
          }
          return result
        })
        Expect(results).toHaveLength(1)
        blockedCall = calls + 1

        await FS.writeText(paths['Main.ts'], 'export const value: number = 2\n')
        await until(() => calls === blockedCall, { description: 'the first watched edit to start refreshing' })
        await started.promise
        await FS.writeText(paths['Main.ts'], 'export const value: number = "wrong"\n')
        await Time.sleep(500)
        release.resolve()

        await until(() =>
          results.find(result =>
            result.revision > results[0]!.revision && result.status === 'stale'
            && result.diagnostics.some(diagnostic => diagnostic.code === 'TS2322')
          ), { description: 'the queued refresh after an edit during active work' })
        Expect(calls).toBeGreaterThanOrEqual(blockedCall + 1)
        Expect(results[1]?.status).toBe('fresh')
      } finally {
        release.resolve()
        await watcher?.dispose()
      }
    }, { location: 'host' })
  }, 90_000)

  Test('an explicit refresh consumes a watcher debounce already pending for the saved input', async () => {
    await withTaoFiles('tao-tooling-watch-explicit-consumes-debounce-', {
      'Main.ts': 'export const value: number = 1\n',
    }, async (paths, root) => {
      const results: ProjectToolingResult[] = []
      let calls = 0
      let projectWatcher: ReturnType<typeof watch> | undefined
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await startProjectFileWatch(
          root,
          { onResult: result => results.push(result) },
          async () => {
            calls += 1
            return await ProjectTooling.refresh(root, {})
          },
          (watchPath, watcherOptions) => {
            const fileWatcher = watch(watchPath, { ...watcherOptions, usePolling: true, interval: 100 })
            if (watchPath === FS.resolvePath(root)) {
              projectWatcher = fileWatcher
            }
            return fileWatcher
          },
        )
        Expect(results).toHaveLength(1)
        Expect(projectWatcher).toBeDefined()
        const initialCalls = calls

        projectWatcher!.emit('all', 'change', paths['Main.ts']!)
        const explicit = await watcher.requestRefresh({ force: true })
        Expect(calls).toBe(initialCalls + 1)
        Expect(results).toEqual([results[0], explicit])

        // Observe the full debounce window: its already-pending timer must have been consumed.
        await Time.sleep(350)
        Expect(calls).toBe(initialCalls + 1)
        Expect(results).toHaveLength(2)
      } finally {
        await watcher?.dispose()
      }
    }, { location: 'host' })
  }, 90_000)

  Test('a watcher event during an explicit refresh still queues and publishes a follow-up', async () => {
    await withTaoFiles('tao-tooling-watch-explicit-follow-up-', {
      'Main.ts': 'export const value: number = 1\n',
    }, async (paths, root) => {
      const results: ProjectToolingResult[] = []
      const started = Deferred()
      const release = Deferred()
      const forceOptions: boolean[] = []
      let calls = 0
      let blockedCall: number | undefined
      let projectWatcher: ReturnType<typeof watch> | undefined
      let watcher: ProjectToolingWatch | undefined
      try {
        watcher = await startProjectFileWatch(
          root,
          { onResult: result => results.push(result) },
          async request => {
            forceOptions.push(request?.force === true)
            calls += 1
            const result = await ProjectTooling.refresh(root, {})
            if (calls === blockedCall) {
              started.resolve()
              await release.promise
            }
            return result
          },
          (watchPath, watcherOptions) => {
            const fileWatcher = watch(watchPath, { ...watcherOptions, usePolling: true, interval: 100 })
            if (watchPath === FS.resolvePath(root)) {
              projectWatcher = fileWatcher
            }
            return fileWatcher
          },
        )
        Expect(results).toHaveLength(1)
        Expect(projectWatcher).toBeDefined()
        const initialCalls = calls
        blockedCall = initialCalls + 1

        const explicitRefresh = watcher.requestRefresh({ force: true })
        await started.promise
        projectWatcher!.emit('all', 'change', paths['Main.ts']!)
        // Let the new event's debounce expire while the explicit refresh remains blocked.
        await Time.sleep(350)
        release.resolve()

        const explicit = await explicitRefresh
        await until(() => results.length === 3, {
          description: 'the follow-up publication queued during an explicit refresh',
        })
        Expect(calls).toBe(initialCalls + 2)
        Expect(forceOptions.slice(initialCalls)).toEqual([true, false])
        Expect(results[1]).toEqual(explicit)
        Expect(results[2]!.revision).toBeGreaterThan(explicit.revision)
        Expect(watcher.lastResult).toEqual(results[2])
      } finally {
        release.resolve()
        await watcher?.dispose()
      }
    }, { location: 'host' })
  }, 90_000)
})
