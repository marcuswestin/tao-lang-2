import { FS, Platform, TaoStdlib } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { inspectMaintainedNativeBindings } from 'tao-native-bindings'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

Describe('project tooling reached native bodies', () => {
  Test(
    'checks reached native bodies and signatures for a pure Tao consumer without publishing standard contracts',
    async () => {
      await withTaoFiles('tao-tooling-native-body-', {
        'Project/.tao/.gitkeep': '',
        'Project/Main.tao':
          'use PathsCacheGet from @tao/device/files\npublic action CacheDirectory() { do PathsCacheGet() }\n',
        'selected-stdlib/.tao/.gitkeep': '',
        'selected-stdlib/Package.tao': 'package { version 0.1.0 includes @tao }',
      }, async (_paths, fixture) => {
        const originalRoot = TaoStdlib.declaredRoot() ?? FS.resolvePath('../../../apps/stdlib', import.meta.dir)
        const original = await inspectMaintainedNativeBindings({ stdlibRoot: originalRoot })
        Expect(original.status).toBe('fresh')
        const selectedRoot = FS.resolvePath('selected-stdlib', fixture)
        for (const path of original.outputPaths) {
          await FS.copyFile(path, FS.resolvePath(FS.relativePath(originalRoot, path), selectedRoot))
        }
        const nativeBindings = { stdlibRoot: selectedRoot, sourceRoots: [] }
        const projectRoot = FS.resolvePath('Project', fixture)
        const good = await ProjectTooling.refresh(projectRoot, { nativeBindings })
        Expect(good.diagnostics).toEqual([])
        Expect(good.status).toBe('fresh')
        const standardContract = FS.resolvePath('.tao-ts/@tao/device/files/Bindings.tao.ts', selectedRoot)
        Expect(await FS.exists(standardContract)).toBe(false)
        const wrapper = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', selectedRoot)
        const content = await FS.readText(wrapper)
        Expect(content).toContain('export function PathsCacheGet(): TR.NativeReference<NativeDirectory>')
        const changed = content.replace(
          'export function PathsCacheGet(): TR.NativeReference<NativeDirectory>',
          'export function PathsCacheGet(): string',
        )
        await FS.writeText(wrapper, changed)
        const manifestPath = FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', selectedRoot)
        const manifest = JSON.parse(await FS.readText(manifestPath)) as { outputs: { path: string; hash: string }[] }
        const output = manifest.outputs.find(output => output.path === 'typescript/Bindings.ts')!
        Expect(output).toBeDefined()
        output.hash = Platform.sha256Hex(changed)
        await FS.writeText(manifestPath, JSON.stringify(manifest))
        Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
        const bad = await ProjectTooling.refresh(projectRoot, { nativeBindings })
        Expect(bad.status).toBe('stale')
        Expect(bad.diagnostics.some(diagnostic => diagnostic.filePath === wrapper && diagnostic.code === 'TS2322'))
          .toBe(true)
        Expect(
          bad.diagnostics.some(diagnostic =>
            diagnostic.filePath === FS.resolvePath('@tao/device/files/Bindings.tao', selectedRoot)
            && diagnostic.code === 'TS2344'
          ),
        ).toBe(true)
        Expect(await FS.exists(standardContract)).toBe(false)
        const wrongFamily = content.replace(
          'export function PathsCacheGet(): TR.NativeReference<NativeDirectory>',
          'export function PathsCacheGet(): TR.NativeReference<NativeFile>',
        )
        await FS.writeText(wrapper, wrongFamily)
        output.hash = Platform.sha256Hex(wrongFamily)
        await FS.writeText(manifestPath, JSON.stringify(manifest))
        Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
        const mismatched = await ProjectTooling.refresh(projectRoot, { nativeBindings })
        Expect(mismatched.status).toBe('stale')
        Expect(
          mismatched.diagnostics.some(diagnostic => diagnostic.filePath === wrapper && diagnostic.code === 'TS2322'),
        ).toBe(true)
        Expect(
          mismatched.diagnostics.some(diagnostic =>
            diagnostic.filePath === FS.resolvePath('@tao/device/files/Bindings.tao', selectedRoot)
            && diagnostic.code === 'TS2344'
          ),
        ).toBe(true)
        Expect(await FS.exists(standardContract)).toBe(false)
      }, { verbatim: true })
    },
  )
})
