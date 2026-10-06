import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import type { ProjectToolingOptions, ProjectToolingResult } from '../project-tooling-src/ProjectTooling'

Describe('project tooling accepted input changes', () => {
  Test('classifies every accepted input before debounce, refresh suppression, and disposal', async () => {
    await withTaoFiles('tao-tooling-classified-invalidation-', {
      'Project/Main.tao': 'view Main() { render Text("Main") }\n',
      'Project/Component.tao': 'view Component() { render Text("Component") }\n',
      'Project/Component.tsx': 'export const component = true\n',
      'Project/subdir/Child.tao': 'view Child() { render Text("Child") }\n',
      'Library/dep.tao': 'export const dependency = 1\n',
      'tsconfig-base.json': '{}\n',
      'sidecars/contract.json': '{}\n',
      'Project/feature/.tao/Owned.tao': 'view Owned() { render Text("Owned") }\n',
      'generator/generate.ts': 'export const generator = true\n',
    }, async (_paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const source = FS.resolvePath('Main.tao', root)
      const addedSource = FS.resolvePath('Added.tao', root)
      const directory = FS.resolvePath('subdir', root)
      const unknown = FS.resolvePath('Component.tsx', root)
      const dependencyRoot = FS.resolvePath('Library', fixture)
      const dependency = FS.resolvePath('dep.tao', dependencyRoot)
      const config = FS.resolvePath('tsconfig-base.json', fixture)
      const sidecar = FS.resolvePath('contract.json', FS.resolvePath('sidecars', fixture))
      const ownershipRoot = FS.resolvePath('.tao', FS.resolvePath('feature', root))
      const nativeInput = FS.resolvePath('generator/generate.ts', fixture)
      const result: ProjectToolingResult = {
        root,
        status: 'fresh',
        diagnostics: [],
        contractPaths: [],
        sourceMappings: [],
        dependencyRoots: [dependencyRoot],
        configInputPaths: [config],
        externalSidecarInputPaths: [sidecar],
        sidecarOwnershipInputPaths: [ownershipRoot],
        nativeBindingInputPaths: [nativeInput],
        nativeBindingOutputPaths: [],
        changedOutputPaths: [],
        revision: 1,
      }
      const created: Array<{ path: string; watcher: FakeWatcher }> = []
      const fakeWatch = ((path: string | readonly string[]) => {
        const watcher = new FakeWatcher()
        created.push({ path: typeof path === 'string' ? path : path.join(','), watcher })
        queueMicrotask(() => watcher.emit('ready'))
        return watcher
      }) as unknown as typeof watch
      const changes: Array<{ path?: string; event: string; kind: string }> = []
      let inventory = 'stable'
      let refreshes = 0
      const options: ProjectToolingOptions = {
        automaticRefresh: false,
        onInputChange: change => changes.push(change),
      }
      const projectWatch = await startProjectFileWatch(
        root,
        options,
        async () => {
          refreshes += 1
          return result
        },
        fakeWatch,
        async () => inventory,
      )
      let disposed = false
      try {
        const initialRefreshes = refreshes
        const projectWatcher = created.find(item => item.path === root)!.watcher
        projectWatcher.emit('all', 'change', source)
        projectWatcher.emit('all', 'add', addedSource)
        projectWatcher.emit('all', 'addDir', directory)
        projectWatcher.emit('all', 'change', unknown)
        projectWatcher.emit('all', 'addDir', ownershipRoot)
        created.find(item => item.path === config)!.watcher.emit('all', 'change', config)
        created.find(item => item.path === sidecar)!.watcher.emit('all', 'change', sidecar)
        created.find(item => item.path === ownershipRoot)!.watcher.emit('all', 'addDir', ownershipRoot)
        created.find(item => item.path === dependencyRoot)!.watcher.emit('all', 'change', dependency)
        created.find(item => item.path.includes('generate.ts'))!.watcher.emit('all', 'change', nativeInput)
        Expect(changes).toEqual([
          { path: source, event: 'change', kind: 'source' },
          { path: addedSource, event: 'add', kind: 'topology' },
          { path: directory, event: 'addDir', kind: 'topology' },
          { path: unknown, event: 'change', kind: 'unknown' },
          { path: ownershipRoot, event: 'addDir', kind: 'sidecar' },
          { path: config, event: 'change', kind: 'config' },
          { path: sidecar, event: 'change', kind: 'sidecar' },
          { path: ownershipRoot, event: 'addDir', kind: 'sidecar' },
          { path: dependency, event: 'change', kind: 'dependency' },
          { path: nativeInput, event: 'change', kind: 'native' },
        ])
        Expect(refreshes).toBe(initialRefreshes)

        inventory = 'changed'
        await projectWatch.requestRefresh()
        Expect(changes).toContainEqual({ event: 'native-inventory', kind: 'native' })
        Expect(refreshes).toBe(initialRefreshes + 1)

        const retainedCount = changes.length
        await projectWatch.dispose()
        disposed = true
        projectWatcher.emit('all', 'change', source)
        Expect(changes).toHaveLength(retainedCount)
      } finally {
        if (!disposed) {
          await projectWatch.dispose()
        }
      }
    }, { verbatim: true })
  })

  Test('reports a change before automatic debounce and clears the pending refresh on disposal', async () => {
    await withTaoFiles('tao-tooling-watch-input-before-debounce-', {
      'Project/Main.tao': 'view Main() { render Text("Main") }\n',
    }, async (_paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const source = FS.resolvePath('Main.tao', root)
      const result: ProjectToolingResult = {
        root,
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
      const watcher = new FakeWatcher()
      const fakeWatch = (() => {
        queueMicrotask(() => watcher.emit('ready'))
        return watcher
      }) as unknown as typeof watch
      const changes: Array<{ path?: string; event: string; kind: string }> = []
      let refreshes = 0
      const projectWatch = await startProjectFileWatch(
        root,
        { onInputChange: change => changes.push(change) },
        async () => {
          refreshes += 1
          return result
        },
        fakeWatch,
      )
      let disposed = false
      try {
        watcher.emit('all', 'change', source)
        Expect(changes).toEqual([{ path: source, event: 'change', kind: 'source' }])
        Expect(refreshes).toBe(1)
        await projectWatch.dispose()
        disposed = true
        Expect(changes).toHaveLength(1)
        Expect(refreshes).toBe(1)
      } finally {
        if (!disposed) {
          await projectWatch.dispose()
        }
      }
    }, { verbatim: true })
  })
})

class FakeWatcher {
  private readonly listeners = new Map<string, Array<{ callback: (...args: unknown[]) => void; once: boolean }>>()

  on(event: string, callback: (...args: unknown[]) => void): this {
    const entries = this.listeners.get(event) ?? []
    entries.push({ callback, once: false })
    this.listeners.set(event, entries)
    return this
  }

  once(event: string, callback: (...args: unknown[]) => void): this {
    this.on(event, callback)
    this.listeners.get(event)!.at(-1)!.once = true
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    const entries = this.listeners.get(event) ?? []
    this.listeners.set(event, entries.filter(entry => !entry.once))
    for (const entry of entries) {
      entry.callback(...args)
    }
  }

  async close(): Promise<void> {
    this.listeners.clear()
  }
}
