import { FS, Platform } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { inspectMaintainedNativeBindings } from 'tao-native-bindings'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { copyNativeBindings } from './ProjectNativeTestSupport'
import { warmReceipt } from './ProjectRefreshReceiptTestSupport'

Describe('watched maintained native refresh receipt signatures', () => {
  Test(
    'rechecks pure Tao native signatures when a verified wrapper publication changes after receipt reuse',
    async () => {
      await withTaoFiles('tao-refresh-receipt-native-body-', {
        'Project/.tao/.gitkeep': '',
        'Project/Main.tao':
          'use PathsCacheGet from @tao/device/files\npublic action CacheDirectory() { do PathsCacheGet() }\n',
        'Selected/.tao/.gitkeep': '',
        'Selected/Package.tao': 'package { version 0.1.0 includes @tao }\n',
      }, async (_paths, fixture) => {
        const stdlibRoot = FS.resolvePath('Selected', fixture)
        await copyNativeBindings(stdlibRoot)
        const nativeBindings = { stdlibRoot, sourceRoots: [] }
        const root = FS.resolvePath('Project', fixture)
        const watch = await ProjectTooling.watch(root, { nativeBindings })
        try {
          const warm = await warmReceipt(watch)
          Expect(warm.status).toBe('fresh')
          const wrapper = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', stdlibRoot)
          const bytes = await FS.readText(wrapper)
          Expect(bytes).toContain('export function PathsCacheGet(): TR.NativeReference<NativeDirectory>')
          const changed = bytes.replace(
            'export function PathsCacheGet(): TR.NativeReference<NativeDirectory>',
            'export function PathsCacheGet(): TR.NativeReference<NativeFile>',
          )
          await FS.writeText(wrapper, changed)
          const manifestPath = FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', stdlibRoot)
          const manifest = JSON.parse(await FS.readText(manifestPath)) as { outputs: { path: string; hash: string }[] }
          const entry = manifest.outputs.find(entry => entry.path === 'typescript/Bindings.ts')!
          Expect(entry).toBeDefined()
          entry.hash = Platform.sha256Hex(changed)
          await FS.writeText(manifestPath, JSON.stringify(manifest))
          Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
          const invalid = await watch.requestRefresh()
          Expect(invalid.revision).toBeGreaterThan(warm.revision)
          Expect(invalid.status).toBe('stale')
          Expect(
            invalid.diagnostics.some(diagnostic => diagnostic.filePath === wrapper && diagnostic.code === 'TS2322'),
          )
            .toBe(true)
          Expect(
            invalid.diagnostics.some(diagnostic =>
              diagnostic.filePath === FS.resolvePath('@tao/device/files/Bindings.tao', stdlibRoot)
              && diagnostic.code === 'TS2344'
            ),
          ).toBe(true)
          Expect(await FS.exists(FS.resolvePath('.tao-ts/@tao/device/files/Bindings.tao.ts', stdlibRoot))).toBe(false)
        } finally {
          await watch.dispose()
        }
      }, { location: 'host', verbatim: true })
    },
  )
})
