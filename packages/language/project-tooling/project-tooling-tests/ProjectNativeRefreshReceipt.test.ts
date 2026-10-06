import { FS, Platform, TaoResources } from '@shared'
import { Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { inspectMaintainedNativeBindings } from 'tao-native-bindings'
import { ProjectRefreshReceipt } from '../project-tooling-src/ProjectRefreshReceipt'
import type { ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { copyNativeBindings } from './ProjectNativeTestSupport'
import { warmReceipt } from './ProjectRefreshReceiptTestSupport'

const candidateSlot = testOverrideSlot({
  read: () => ProjectRefreshReceipt.prototype.candidate,
  write: value => {
    ProjectRefreshReceipt.prototype.candidate = value
  },
})
const resourceRootSlot = testOverrideSlot({
  read: () => Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV]
    } else {
      Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV] = value
    }
  },
})

Describe('watched maintained native refresh receipts', () => {
  Test(
    'rejects native output deletion, executable engine changes, and selected root changes before replay',
    async () => {
      await withTaoFiles('tao-refresh-receipt-native-', {
        'Project/.tao/.gitkeep': '',
        'Project/Main.tao': 'type Answer is one of One, Two\n',
        'First/.tao/.gitkeep': '',
        'First/Package.tao': 'package { version 0.1.0 includes @tao }\n',
        'Second/.tao/.gitkeep': '',
        'Second/Package.tao': 'package { version 0.1.0 includes @tao }\n',
      }, async (_paths, fixture) => {
        const firstRoot = FS.resolvePath('First', fixture)
        const secondRoot = FS.resolvePath('Second', fixture)
        await copyNativeBindings(firstRoot)
        await copyNativeBindings(secondRoot)
        const nativeBindings = { stdlibRoot: firstRoot, sourceRoots: [] as string[] }
        const root = FS.resolvePath('Project', fixture)
        const originalInspection = await inspectMaintainedNativeBindings(nativeBindings)
        const originalEngine = originalInspection.inputPaths.find(path =>
          path.endsWith('/typescript/lib/typescript.js')
        )!
        Expect(await FS.isFile(originalEngine)).toBe(true)
        const resourceRoot = FS.resolvePath('Resources', fixture)
        const engineRoot = FS.resolvePath(
          `${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript`,
          resourceRoot,
        )
        await FS.copyDirectory(FS.dirname(FS.dirname(originalEngine)), engineRoot)
        const engine = FS.resolvePath('lib/typescript.js', engineRoot)
        const engineBytes = await FS.readText(engine)
        const restoreResources = resourceRootSlot.install(resourceRoot)
        let watch: ProjectToolingWatch | undefined
        try {
          watch = await ProjectTooling.watch(root, {
            nativeBindings,
            runtimeRoot: FS.resolvePath('../../../apps/runtime', import.meta.dir),
            hostModulesRoot: FS.resolvePath('../../../../node_modules', import.meta.dir),
            hostModuleRoots: [
              FS.resolvePath('../../../apps/expo-host/node_modules', import.meta.dir),
              FS.resolvePath('../../../apps/runtime/node_modules', import.meta.dir),
            ],
          })
          let warm = await warmReceipt(watch)
          Expect(warm.status).toBe('fresh')
          const contract = warm.contractPaths[0]!
          const contractBytes = await FS.readText(contract)
          const wrapper = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', firstRoot)
          const wrapperBytes = await FS.readText(wrapper)
          await FS.remove(wrapper)
          const missing = await watch.requestRefresh()
          Expect(missing.revision).toBeGreaterThan(warm.revision)
          Expect(missing.status).toBe('stale')
          Expect(missing.diagnostics.some(diagnostic => diagnostic.code === 'maintained-native-bindings-stale')).toBe(
            true,
          )
          Expect(missing.contractPaths).toEqual(warm.contractPaths)
          Expect(missing.changedOutputPaths).toEqual([])
          Expect(await FS.readText(contract)).toBe(contractBytes)
          Expect(await FS.exists(wrapper)).toBe(false)
          await FS.writeText(wrapper, wrapperBytes)
          warm = await warmReceipt(watch)
          Expect((await inspectMaintainedNativeBindings(nativeBindings)).inputPaths).toContain(engine)
          await FS.writeText(engine, `${engineBytes}\n// different executable engine bytes\n`)
          try {
            const changedEngine = await watch.requestRefresh()
            Expect(changedEngine.status).toBe('stale')
            Expect(changedEngine.revision).toBeGreaterThan(warm.revision)
            Expect(changedEngine.diagnostics.some(diagnostic => diagnostic.code === 'maintained-native-bindings-stale'))
              .toBe(true)
            Expect(await FS.readText(contract)).toBe(contractBytes)
          } finally {
            await FS.writeText(engine, engineBytes)
          }
          warm = await warmReceipt(watch)
          const originalCandidate = ProjectRefreshReceipt.prototype.candidate
          let acceptedCandidates = 0
          const restoreCandidate = candidateSlot.install(async function(this: ProjectRefreshReceipt, audit) {
            const candidate = await originalCandidate.call(this, audit)
            if (candidate && ++acceptedCandidates === 2) {
              await FS.remove(wrapper)
            }
            return candidate
          })
          try {
            const changedAfterReplay = await watch.requestRefresh()
            Expect(acceptedCandidates).toBe(2)
            Expect(changedAfterReplay.status).toBe('stale')
            Expect(changedAfterReplay.contractPaths).toEqual(warm.contractPaths)
            Expect(await FS.readText(contract)).toBe(contractBytes)
          } finally {
            restoreCandidate()
            await FS.writeText(wrapper, wrapperBytes)
          }
          warm = await warmReceipt(watch)
          nativeBindings.stdlibRoot = secondRoot
          const selected = await watch.requestRefresh()
          Expect(selected.status).toBe('fresh')
          Expect(selected.revision).toBeGreaterThan(warm.revision)
          Expect(selected.nativeBindingOutputPaths).toContain(
            FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', secondRoot),
          )
          Expect(selected.nativeBindingOutputPaths).not.toContain(wrapper)
          const selectedWarm = await warmReceipt(watch)
          Expect(selectedWarm.status).toBe('fresh')
          Expect((await watch.requestRefresh()).revision).toBe(selectedWarm.revision)
          const missingSourceRoot = FS.resolvePath('MissingSources', fixture)
          nativeBindings.sourceRoots = [missingSourceRoot]
          const changedRoots = await watch.requestRefresh()
          Expect(changedRoots.status).toBe('stale')
          Expect(changedRoots.nativeBindingInputPaths).toContain(missingSourceRoot)
          Expect(changedRoots.contractPaths).toEqual(selected.contractPaths)
          nativeBindings.sourceRoots = []
          Expect((await watch.requestRefresh()).status).toBe('fresh')
        } finally {
          try {
            await watch?.dispose()
          } finally {
            restoreResources()
          }
        }
      }, { location: 'host', verbatim: true })
    },
  )
})
