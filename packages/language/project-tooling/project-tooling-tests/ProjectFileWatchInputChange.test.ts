import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import type { ProjectToolingOptions, ProjectToolingResult } from '../project-tooling-src/ProjectTooling'

Describe('project tooling accepted input changes', () => {
  Test('reports source, config, dependency, and native inventory changes with automatic refresh disabled', async () => {
    await withTaoFiles('tao-tooling-classified-invalidation-', {
      'Project/Main.tao': 'view Main() { render Text("Main") }\n',
      'Library/dep.ts': 'export const dependency = 1\n',
      'tsconfig-base.json': '{}\n',
      'generator/generate.ts': 'export const generator = true\n',
    }, async (_paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const source = FS.resolvePath('Main.tao', root)
      const dependencyRoot = FS.resolvePath('Library', fixture)
      const dependency = FS.resolvePath('dep.ts', dependencyRoot)
      const config = FS.resolvePath('tsconfig-base.json', fixture)
      const nativeInput = FS.resolvePath('generator/generate.ts', fixture)
      const result: ProjectToolingResult = {
        root,
        status: 'fresh',
        diagnostics: [],
        contractPaths: [],
        sourceMappings: [],
        dependencyRoots: [dependencyRoot],
        configInputPaths: [config],
        externalSidecarInputPaths: [],
        sidecarOwnershipInputPaths: [],
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
      const changes: Array<{ path?: string; event: string }> = []
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
      try {
        const initialRefreshes = refreshes
        for (
          const [path, watcher] of [
            [source, created.find(item => item.path === root)!.watcher],
            [config, created.find(item => item.path === config)!.watcher],
            [dependency, created.find(item => item.path === dependencyRoot)!.watcher],
            [nativeInput, created.find(item => item.path.includes('generate.ts'))!.watcher],
          ] as const
        ) {
          watcher.emit('all', 'change', path)
        }
        Expect(changes).toEqual([
          { path: source, event: 'change' },
          { path: config, event: 'change' },
          { path: dependency, event: 'change' },
          { path: nativeInput, event: 'change' },
        ])
        Expect(refreshes).toBe(initialRefreshes)

        inventory = 'changed'
        await projectWatch.requestRefresh({ force: true })
        Expect(changes).toContainEqual({ event: 'native-inventory' })
        Expect(refreshes).toBe(initialRefreshes + 1)
      } finally {
        await projectWatch.dispose()
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
