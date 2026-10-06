import { FS, Platform } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { inspectMaintainedNativeBindings } from 'tao-native-bindings'
import type { ProjectToolingResult } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { copyNativeBindings } from './ProjectNativeTestSupport'
import { warmReceipt } from './ProjectRefreshReceiptTestSupport'

const SIGNATURE = 'export function PathsCacheGet(): TR.NativeReference<NativeDirectory>'

Describe('project tooling reached native bodies', () => {
  Test(
    'checks reached native bodies and signatures for a pure Tao consumer, once and after watched receipt reuse, without publishing standard contracts',
    async () => {
      await withTaoFiles('tao-tooling-native-body-', {
        'Project/.tao/.gitkeep': '',
        'Project/Main.tao':
          'use PathsCacheGet from @tao/device/files\npublic action CacheDirectory() { do PathsCacheGet() }\n',
        'selected-stdlib/.tao/.gitkeep': '',
        'selected-stdlib/Package.tao': 'package { version 0.1.0 includes @tao }',
      }, async (_paths, fixture) => {
        const selectedRoot = FS.resolvePath('selected-stdlib', fixture)
        await copyNativeBindings(selectedRoot)
        const nativeBindings = { stdlibRoot: selectedRoot, sourceRoots: [] }
        const projectRoot = FS.resolvePath('Project', fixture)
        const standardContract = FS.resolvePath('.tao-ts/@tao/device/files/Bindings.tao.ts', selectedRoot)
        const wrapper = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', selectedRoot)
        const manifestPath = FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', selectedRoot)
        const content = await FS.readText(wrapper)
        const manifestText = await FS.readText(manifestPath)
        Expect(content).toContain(SIGNATURE)

        // Publishes a wrapper whose maintained manifest still verifies, so only a type check can reject it.
        const publishWrapper = async (signature: string): Promise<void> => {
          const changed = content.replace(SIGNATURE, signature)
          await FS.writeText(wrapper, changed)
          const manifest = JSON.parse(manifestText) as { outputs: { path: string; hash: string }[] }
          const output = manifest.outputs.find(output => output.path === 'typescript/Bindings.ts')
          Expect(output).toBeDefined()
          output!.hash = Platform.sha256Hex(changed)
          await FS.writeText(manifestPath, JSON.stringify(manifest))
          Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
        }
        const expectSignatureRejected = async (result: ProjectToolingResult): Promise<void> => {
          Expect(result.status).toBe('stale')
          Expect(result.diagnostics.some(diagnostic => diagnostic.filePath === wrapper && diagnostic.code === 'TS2322'))
            .toBe(true)
          Expect(
            result.diagnostics.some(diagnostic =>
              diagnostic.filePath === FS.resolvePath('@tao/device/files/Bindings.tao', selectedRoot)
              && diagnostic.code === 'TS2344'
            ),
          ).toBe(true)
          Expect(await FS.exists(standardContract)).toBe(false)
        }

        // A wrong body type, through a one-shot refresh.
        await publishWrapper('export function PathsCacheGet(): string')
        await expectSignatureRejected(await ProjectTooling.refresh(projectRoot, { nativeBindings }))

        await FS.writeText(wrapper, content)
        await FS.writeText(manifestPath, manifestText)
        Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
        const watch = await ProjectTooling.watch(projectRoot, { nativeBindings })
        try {
          const warm = await warmReceipt(watch)
          Expect(warm.diagnostics).toEqual([])
          Expect(warm.status).toBe('fresh')
          Expect(await FS.exists(standardContract)).toBe(false)

          // A wrong native family published after the watch reused its receipt is rechecked, not replayed.
          await publishWrapper('export function PathsCacheGet(): TR.NativeReference<NativeFile>')
          const rechecked = await watch.requestRefresh()
          Expect(rechecked.revision).toBeGreaterThan(warm.revision)
          await expectSignatureRejected(rechecked)
        } finally {
          await watch.dispose()
        }
      }, { location: 'host', verbatim: true })
    },
  )
})
