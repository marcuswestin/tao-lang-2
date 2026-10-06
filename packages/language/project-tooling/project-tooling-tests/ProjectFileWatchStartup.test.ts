import { Errors, Time } from '@shared'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import type { ProjectToolingResult } from '../project-tooling-src/ProjectTooling'

Describe('project watch startup cancellation', () => {
  for (const pending of ['project', 'dependency'] as const) {
    Test(`closes every watcher when the ${pending} readiness wait is cancelled`, async () => {
      const controller = new AbortController()
      const waiting = Deferred()
      const closed: string[] = []
      const phases: string[] = []
      const root = '/tao-startup-fixture'
      const dependency = '/tao-startup-dependency'
      const result: ProjectToolingResult = {
        root,
        status: 'fresh',
        diagnostics: [],
        contractPaths: [],
        sourceMappings: [],
        dependencyRoots: [dependency],
        configInputPaths: [],
        externalSidecarInputPaths: [],
        sidecarOwnershipInputPaths: [],
        nativeBindingInputPaths: [],
        nativeBindingOutputPaths: [],
        changedOutputPaths: [],
        revision: 1,
      }
      let refreshes = 0
      const startup = startProjectFileWatch(root, {
        startupSignal: controller.signal,
        onStartupProgress: phase => phases.push(phase),
      }, async () => {
        refreshes++
        return result
      }, (path, options) => {
        const watcher = watch([], { ...options, usePolling: true })
        const close = watcher.close.bind(watcher)
        watcher.close = async () => {
          closed.push(String(path))
          await close()
        }
        if (pending === 'dependency' && path === root) {
          queueMicrotask(() => watcher.emit('ready'))
        } else {
          queueMicrotask(() => waiting.resolve())
        }
        return watcher
      })
      const rejected = Expect(startup).rejects.toThrow('cancelled fixture startup')
      await waiting.promise
      controller.abort(Errors.abortError('cancelled fixture startup'))
      await rejected
      Expect(phases.at(-1)).toBe(`watching ${pending === 'project' ? `project ${root}` : dependency}`)
      Expect(new Set(closed)).toEqual(new Set(pending === 'project' ? [root] : [root, dependency]))
      Expect(refreshes).toBe(pending === 'project' ? 0 : 1)
    })
  }

  Test('drains a cancelled refresh without publishing its late result', async () => {
    const controller = new AbortController()
    const refreshing = Deferred()
    const finishRefresh = Deferred()
    const watcherClosed = Deferred()
    const publications: ProjectToolingResult[] = []
    const result: ProjectToolingResult = {
      root: '/tao-startup-fixture',
      status: 'fresh',
      diagnostics: [],
      contractPaths: [],
      sourceMappings: [],
      dependencyRoots: [],
      configInputPaths: [],
      externalSidecarInputPaths: [],
      sidecarOwnershipInputPaths: [],
      nativeBindingInputPaths: [],
      nativeBindingOutputPaths: [],
      changedOutputPaths: [],
      revision: 1,
    }
    const startup = startProjectFileWatch(result.root, {
      startupSignal: controller.signal,
      onResult: value => publications.push(value),
    }, async () => {
      refreshing.resolve()
      await finishRefresh.promise
      return result
    }, (_path, options) => {
      const watcher = watch([], { ...options, usePolling: true })
      const close = watcher.close.bind(watcher)
      watcher.close = async () => {
        await close()
        watcherClosed.resolve()
      }
      queueMicrotask(() => watcher.emit('ready'))
      return watcher
    })
    let settled = false
    void startup.then(() => {
      settled = true
    }, () => {
      settled = true
    })
    const rejected = Expect(startup).rejects.toThrow('cancelled fixture refresh')
    await refreshing.promise
    controller.abort(Errors.abortError('cancelled fixture refresh'))
    await watcherClosed.promise
    await Time.sleep(10)
    Expect(settled).toBe(false)
    finishRefresh.resolve()
    await rejected
    Expect(publications).toEqual([])
  })
})
