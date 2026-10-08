import { Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import * as NativeBindings from '@native-bindings'
import { inspectMaintainedNativeBindings } from '@native-bindings'
import { Assert, Diagnostics, FS, ReleaseCapabilities, Repo, TaoStdlib } from '@shared'
import { Describe, Expect, MockModule, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import Compiler, { compileWorkspaceAttempt, EmittedModuleCache } from '../../compiler-src/compiler'

const originalNativeBindings = { ...NativeBindings }
const nativeInspectionSlot = testOverrideSlot({
  read: () => NativeBindings.inspectMaintainedNativeBindings,
  write: value => {
    MockModule(
      new URL('../../../apps/native-bindings/native-bindings-src/native-bindings.ts', import.meta.url).pathname,
      () => ({ ...originalNativeBindings, inspectMaintainedNativeBindings: value }),
    )
  },
})

Describe('workspace maintained native admission with retained documents', () => {
  Test('carries only the immediate implicit-root inspection and independently checks native freshness', async () => {
    await withTaoFiles('tao-workspace-native-attempt-', {
      'Main.tao': `
        app Example { id "native-attempt" version "1.0.0" name "Example" view Main }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const context = Compiler.createContext(await Packages.createContext(root), root)
      const inspection = await inspectMaintainedNativeBindings()
      Expect(inspection.status).toBe('fresh')
      let inspections = 0
      const restore = nativeInspectionSlot.install(async options => {
        inspections++
        return await originalNativeBindings.inspectMaintainedNativeBindings(options)
      })
      try {
        const first = await workspace.compileFiles([paths['Main.tao']])
        Expect(inspections).toBe(2)
        inspections = 0
        const warm = await workspace.compileFiles([paths['Main.tao']])
        Expect(inspections).toBe(2)
        Expect(warm.files).toEqual(first.files)

        const validation = await workspace.validateFiles([paths['Main.tao']])
        inspections = 0
        const standalone = await Compiler.compileValidated(validation, context)
        Expect(inspections).toBe(2)
        Expect(standalone.files).toEqual(first.files)

        inspections = 0
        const immediate = await compileWorkspaceAttempt(validation, context, {}, inspection)
        Expect(inspections).toBe(1)
        Expect(immediate.files).toEqual(standalone.files)

        inspections = 0
        const explicit = Compiler.createContext(context.packagesContext, root, context.releaseProfile, {})
        await compileWorkspaceAttempt(validation, explicit, {}, inspection)
        Expect(inspections).toBe(2)

        inspections = 0
        await Expect(compileWorkspaceAttempt(validation, context, {}, {
          ...inspection,
          identity: 'different-attempt-native-inputs',
        })).rejects.toThrow('Native binding inputs changed during compilation')
        Expect(inspections).toBe(1)
      } finally {
        restore()
      }
    })
  })

  Test('rejects stale native outputs before reused validation and cached emission, then recovers', async () => {
    await withTaoFiles('tao-workspace-native-cache-', {
      'App/.tao/.gitkeep': '',
      'stdlib/.tao/.gitkeep': '',
      'App/Main.tao': `
        use DirectoryUriGet, PathsCacheGet from @tao/device/files
        app Example { id "native-cache" version "1.0.0" name "Example" view Main }
        action Read() {
          let Directory = do PathsCacheGet()
          let Uri = do DirectoryUriGet(Directory)
        }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
      'App/Main.test.tao': 'test "Native" { test "opens" { run Example } }\nuse Example from ./Main',
    }, async (paths, root) => {
      const nativeBindings = { stdlibRoot: FS.resolvePath('stdlib', root), sourceRoots: [] }
      const installed = await inspectMaintainedNativeBindings()
      Assert.input(installed.status === 'fresh', Diagnostics.errorMessages(installed.diagnostics).join('\n'))
      const installedRoot = TaoStdlib.declaredRoot() ?? Repo.resolvePath('packages/apps/stdlib')
      await FS.synchronizeDirectoryFiles(
        FS.resolvePath('@tao', installedRoot),
        FS.resolvePath('@tao', nativeBindings.stdlibRoot),
      )
      for (const path of installed.outputPaths) {
        await FS.writeText(
          FS.resolvePath(FS.relativePath(installedRoot, path), nativeBindings.stdlibRoot),
          await FS.readText(path),
        )
      }
      Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
      const appRoot = FS.resolvePath('App', root)
      const workspace = await Workspace.openProfile(appRoot, ReleaseCapabilities.current(), { nativeBindings })
      const ordinary = await Workspace.open(appRoot, { nativeBindings })
      const entry = paths['App/Main.tao']
      const testEntry = paths['App/Main.test.tao']
      const cache = new EmittedModuleCache()
      const firstValidation = await workspace.validate(entry)
      Expect(firstValidation.diagnostics).toEqual([])
      const first = await workspace.compileFiles([entry], { emittedModuleCache: cache })
      const warm = await workspace.compileFiles([entry], { emittedModuleCache: cache })
      Expect(warm.emittedModuleCache?.hits).toBeGreaterThan(0)
      Expect(warm.files).toEqual(first.files)
      const retained = await workspace.validate(entry)
      Expect(retained.entry.document === firstValidation.entry.document).toBe(true)
      const caller = first.files.find(file => file.sourcePath === entry && file.relativePath === 'App.tsx')
      Assert.defined(caller, 'native caller is emitted')
      Expect(caller.code).toContain('.NativeTypes["Directory"]')
      Expect((await workspace.compileTestPlan(testEntry, { skipValidation: true })).suites[0]?.name).toBe('Native')

      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', nativeBindings.stdlibRoot)
      const original = await FS.readText(output)
      // The Tao graph stays identical: native admission must not be a reused semantic result.
      await FS.writeText(output, `${original}\n// task-owned output drift\n`)
      Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('stale')
      const stale = await workspace.validate(entry)
      Expect(Diagnostics.hasError(stale.diagnostics)).toBe(true)
      Expect(stale.entry.document === retained.entry.document).toBe(true)
      Expect(Diagnostics.hasError((await ordinary.validate(entry)).diagnostics)).toBe(true)
      const parsed = await workspace.parseFiles([entry])
      Expect(Diagnostics.hasError((await workspace.validateParsedFiles(parsed)).diagnostics)).toBe(true)
      Expect(Diagnostics.hasError((await workspace.validateFiles([entry])).diagnostics)).toBe(true)
      await Expect(workspace.compile(entry, { emittedModuleCache: cache })).rejects.toThrow('native')
      await Expect(workspace.compileFiles([entry], { emittedModuleCache: cache })).rejects.toThrow('native')
      await Expect(workspace.compileTestPlan(testEntry, { skipValidation: true })).rejects.toThrow('native')

      await FS.writeText(output, original)
      Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
      Expect((await workspace.validate(entry)).diagnostics).toEqual([])
      const recovered = await workspace.compileFiles([entry], { emittedModuleCache: cache })
      const cold = await (await Workspace.open(appRoot, { nativeBindings })).compileFiles([entry])
      Expect(recovered.files).toEqual(first.files)
      Expect(recovered.files).toEqual(cold.files)
      Expect(recovered.emittedModuleCache?.hits).toBeGreaterThan(0)
    })
  })
})
