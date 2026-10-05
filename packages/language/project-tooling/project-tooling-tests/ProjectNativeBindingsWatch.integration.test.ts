import { FS, Time } from '@shared'
import { Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import { watch } from 'chokidar'
import { startProjectFileWatch } from '../project-tooling-src/ProjectFileWatch'
import { projectNativeBindingInventory } from '../project-tooling-src/ProjectNativeBindingInventory'
import type { ProjectToolingResult } from '../project-tooling-src/ProjectTooling'

Describe('maintained native watch inputs', () => {
  Test(
    'retains an initially missing explicit source root through empty creation and nested package population',
    async () => {
      await withTaoFiles(
        'tao-native-watch-missing-root-',
        { 'consumer/.tao/.gitkeep': '' },
        async (_paths, fixture) => {
          const root = FS.resolvePath('consumer', fixture)
          const sourceRoot = FS.resolvePath('later', fixture)
          const packageRoot = FS.resolvePath('node_modules/native-later', sourceRoot)
          const declaration = FS.resolvePath('build/deep/index.d.ts', packageRoot)
          const results: ProjectToolingResult[] = []
          let revision = 0
          const refresh = async (): Promise<ProjectToolingResult> => ({
            root,
            revision: ++revision,
            status: 'fresh',
            diagnostics: [],
            contractPaths: [],
            sourceMappings: [],
            dependencyRoots: [],
            configInputPaths: [],
            externalSidecarInputPaths: [],
            sidecarOwnershipInputPaths: [],
            changedOutputPaths: [],
            nativeBindingOutputPaths: [],
            nativeBindingInputPaths: [
              sourceRoot,
              ...await FS.isDirectory(packageRoot) ? [packageRoot] : [],
              ...await FS.exists(declaration) ? [declaration] : [],
            ],
          })
          const watcher = await startProjectFileWatch(
            root,
            { nativeBindings: { sourceRoots: [sourceRoot] }, onResult: result => results.push(result) },
            refresh,
            (path, options) => watch(path, { ...options, usePolling: true, interval: 100 }),
          )
          try {
            const initial = watcher.lastResult.revision
            await FS.mkdir(sourceRoot)
            const empty = await until(() => results.find(result => result.revision > initial), {
              description: 'refresh after a missing explicit source root is created empty',
            })
            await FS.writeText(declaration, 'export declare const populated: string')
            const populated = await until(
              () =>
                results.find(result =>
                  result.revision > empty.revision && result.nativeBindingInputPaths.includes(declaration)
                ),
              { description: 'refresh after a declaration package populates the formerly empty source root' },
            )
            await FS.remove(declaration)
            await until(
              () =>
                results.find(result =>
                  result.revision > populated.revision && !result.nativeBindingInputPaths.includes(declaration)
                ),
              { description: 'refresh after removing the newly discovered declaration' },
            )
          } finally {
            await watcher.dispose()
          }
        },
        { location: 'host', verbatim: true },
      )
    },
  )

  Test(
    'observes declaration and native output edits, then recovers after explicit regeneration without output loops',
    async () => {
      await withTaoFiles('tao-native-watch-', {
        'consumer/.tao/.gitkeep': '',
        'source/node_modules/native/build/index.d.ts': 'first',
        'source/node_modules/typescript/lib/typescript.js': 'engine',
        'stdlib/@tao/device/files/Bindings.tao': 'native source',
        'stdlib/.tao-ts/native-bindings/files/Bindings.ts': 'first',
        'stdlib/.tao-ts/native-bindings/files/maintained.json': '{}',
      }, async (paths, fixture) => {
        const root = FS.resolvePath('consumer', fixture)
        const input = paths['source/node_modules/native/build/index.d.ts']
        const engine = paths['source/node_modules/typescript/lib/typescript.js']
        const output = paths['stdlib/.tao-ts/native-bindings/files/Bindings.ts']
        const additional = FS.resolvePath('source/node_modules/native/build/new/nested.d.ts', fixture)
        const results: ProjectToolingResult[] = []
        let revision = 0
        const refresh = async (): Promise<ProjectToolingResult> => ({
          root,
          revision: ++revision,
          status: await FS.exists(output) && await FS.readText(input) === await FS.readText(output)
              && !await FS.exists(additional)
              && await FS.readText(engine) === 'engine'
            ? 'fresh'
            : 'stale',
          diagnostics: [],
          contractPaths: [],
          sourceMappings: [],
          dependencyRoots: [],
          configInputPaths: [],
          externalSidecarInputPaths: [],
          sidecarOwnershipInputPaths: [],
          changedOutputPaths: [],
          nativeBindingInputPaths: [
            FS.resolvePath('source', fixture),
            FS.resolvePath('source/node_modules/native', fixture),
            input,
            FS.resolvePath('source/node_modules/typescript', fixture),
            engine,
          ],
          nativeBindingOutputPaths: [
            output,
            paths['stdlib/.tao-ts/native-bindings/files/maintained.json'],
            paths['stdlib/@tao/device/files/Bindings.tao'],
          ],
        })
        const watcher = await startProjectFileWatch(
          root,
          { onResult: result => results.push(result) },
          refresh,
          (path, options) => watch(path, { ...options, usePolling: true, interval: 100 }),
        )
        try {
          Expect(watcher.lastResult.status).toBe('fresh')
          const initial = watcher.lastResult.revision
          await FS.writeText(engine, 'changed engine')
          const changedEngine = await until(
            () => results.find(result => result.revision > initial && result.status === 'stale'),
            { description: 'stale after the exact executable engine changes inside a declaration inventory' },
          )
          await FS.writeText(engine, 'engine')
          await until(
            () => results.find(result => result.revision > changedEngine.revision && result.status === 'fresh'),
            {
              description: 'fresh after the executable engine is restored',
            },
          )
          const beforeInput = watcher.lastResult.revision
          await FS.writeText(input, 'changed')
          const changed = await until(
            () => results.find(result => result.revision > beforeInput && result.status === 'stale'),
            { description: 'stale maintained input through node_modules ignore' },
          )
          // Explicit native generation updates its output; the watcher only inspects it.
          await FS.writeText(output, 'changed')
          const repaired = await until(
            () => results.find(result => result.revision > changed.revision && result.status === 'fresh'),
            { description: 'fresh maintained output after explicit regeneration' },
          )
          await FS.writeText(output, 'corrupted')
          const corrupted = await until(
            () => results.find(result => result.revision > repaired.revision && result.status === 'stale'),
            { description: 'stale native output through generated ignore' },
          )
          await FS.writeText(output, 'changed')
          await watcher.requestRefresh()
          Expect(watcher.lastResult.status).toBe('fresh')
          Expect(watcher.lastResult.revision).toBeGreaterThan(corrupted.revision)
          const beforeAddition = watcher.lastResult.revision
          await FS.writeText(additional, 'export declare const added: true')
          const added = await until(
            () => results.find(result => result.revision > beforeAddition && result.status === 'stale'),
            { description: 'stale after a nested declaration inventory addition' },
          )
          await FS.remove(additional)
          await until(() => results.find(result => result.revision > added.revision && result.status === 'fresh'), {
            description: 'fresh after removing the extra declaration input',
          })
          const outputRoot = FS.dirname(output)
          const replacement = `${outputRoot}.replaced`
          const beforeReplacement = watcher.lastResult.revision
          await FS.move(outputRoot, replacement)
          const removedRoot = await until(
            () => results.find(result => result.revision > beforeReplacement && result.status === 'stale'),
            { description: 'stale after native output root replacement removes the old inventory' },
          )
          await FS.move(replacement, outputRoot)
          await until(
            () => results.find(result => result.revision > removedRoot.revision && result.status === 'fresh'),
            { description: 'fresh after the native output root is recreated' },
          )
          const beforeTaoOutput = watcher.lastResult.revision
          await FS.writeText(paths['stdlib/@tao/device/files/Bindings.tao'], 'changed native source')
          await until(() => results.find(result => result.revision > beforeTaoOutput), {
            description: 'refresh after an exact maintained Tao output changes',
          })
          await Time.sleep(1_500)
          const settled = results.length
          const lock = FS.resolvePath('stdlib/@tao/device/files/Bindings.tao-file-mutation.lock.owner-test', fixture)
          await FS.writeText(lock, 'validation lock')
          await FS.remove(lock)
          await FS.writeText(`${output}.tao-file-mutation.lock.owner-test`, 'native publication owner')
          await FS.writeText(`${output}.00000000-0000-0000-0000-000000000000.0.tmp`, 'staged publication')
          await FS.writeText(FS.resolvePath('stdlib/@tao/device/files/Unrelated.tao', fixture), 'unrelated source')
          await FS.writeText(FS.resolvePath('.tao-ts/Other.ts', root), 'ordinary generated output')
          await FS.writeText(FS.resolvePath('source/.tao-ts/Other.ts', fixture), 'unrelated generated output')
          await Time.sleep(1_500)
          Expect(results).toHaveLength(settled)
        } finally {
          await watcher.dispose()
        }
      }, { location: 'host', verbatim: true })
    },
    90_000,
  )

  Test('joins an in-flight inventory scan and stops all native work on disposal', async () => {
    await withTaoFiles('tao-native-watch-disposal-', {
      'consumer/.tao/.gitkeep': '',
      'source/node_modules/native/index.d.ts': 'export declare const value: string',
    }, async (paths, fixture) => {
      const root = FS.resolvePath('consumer', fixture)
      let scans = 0
      let blockScan = false
      let entered = false
      let released = false
      let release!: () => void
      const blocked = new Promise<void>(resolve => {
        release = resolve
      })
      const results: ProjectToolingResult[] = []
      const refresh = async (): Promise<ProjectToolingResult> => ({
        root,
        revision: results.length + 1,
        status: 'fresh',
        diagnostics: [],
        contractPaths: [],
        sourceMappings: [],
        dependencyRoots: [],
        configInputPaths: [],
        externalSidecarInputPaths: [],
        sidecarOwnershipInputPaths: [],
        changedOutputPaths: [],
        nativeBindingInputPaths: [
          FS.resolvePath('source/node_modules/native', fixture),
          paths['source/node_modules/native/index.d.ts'],
        ],
        nativeBindingOutputPaths: [],
      })
      const watcher = await startProjectFileWatch(
        root,
        { onResult: result => results.push(result) },
        refresh,
        (path, options) => watch(path, { ...options, usePolling: true, interval: 100 }),
        async plan => {
          ++scans
          if (blockScan && !entered) {
            entered = true
            await blocked
          }
          return projectNativeBindingInventory(plan)
        },
      )
      try {
        blockScan = true
        await until(() => entered, { description: 'the recurring native inventory scan starts' })
        let disposed = false
        const disposal = watcher.dispose().then(() => {
          disposed = true
        })
        await Time.sleep(0)
        Expect(disposed).toBe(false)
        released = true
        release()
        await disposal
        const settled = results.length
        const settledScans = scans
        await FS.writeText(paths['source/node_modules/native/index.d.ts'], 'changed after disposal')
        await FS.writeText(FS.resolvePath('source/node_modules/native/new/nested.d.ts', fixture), 'new after disposal')
        await Time.sleep(1_500)
        Expect(scans).toBe(settledScans)
        Expect(results).toHaveLength(settled)
      } finally {
        if (!released) {
          release()
        }
        await watcher.dispose()
      }
    }, { location: 'host', verbatim: true })
  })
})
