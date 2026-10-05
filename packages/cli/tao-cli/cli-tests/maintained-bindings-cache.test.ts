import { generateMaintainedNativeBindings, inspectMaintainedNativeBindings } from '@native-bindings'
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { CheckCache } from '../cli-src/check-cache'
import { TestCache } from '../cli-src/test-cache'
import { copyMaintainedBindingPayload } from './maintained-bindings-fixture'
import { withTaoFixture } from './test-cli-files'

Describe('maintained native binding cache guards', () => {
  Test('rejects cached success after declaration or output edits and accepts regenerated bindings', async () => {
    await withTaoFixture({ 'App/.tao/.gitkeep': '', 'App/Main.tao': 'view Main() { }\n' }, async root => {
      const nativeBindings = {
        stdlibRoot: FS.resolvePath('stdlib', root),
        sourceRoots: [FS.resolvePath('source', root)],
      }
      await copyMaintainedBindingPayload(nativeBindings.stdlibRoot, nativeBindings.sourceRoots[0])
      const workspaceRoot = FS.resolvePath('App', root)
      const entries = [FS.resolvePath('Main.tao', workspaceRoot)]
      const record = {
        workspaceRoot,
        diagnostics: [],
        dependencyRoots: [],
        externalSidecarInputPaths: [],
        metadataPaths: [],
      }
      const cacheOptions = { repositoryRoot: root, nativeBindings }
      const fingerprintRequest = {
        roots: [workspaceRoot],
        runtimeRoot: root,
        testPaths: entries,
        toolchainRoot: root,
        nativeBindings,
      }
      const original = await TestCache.fingerprint(fingerprintRequest)
      Expect(original).toBeDefined()
      const first = await CheckCache.open(cacheOptions)
      Expect(first).toBeDefined()
      Expect(await first!.reuse(workspaceRoot, entries)).toBeUndefined()
      await first!.commit([record])
      Expect(await (await CheckCache.open(cacheOptions))!.reuse(workspaceRoot, entries)).toEqual({ diagnostics: [] })
      for (
        const path of [
          FS.resolvePath('node_modules/expo-file-system/build/index.d.ts', nativeBindings.sourceRoots[0]),
          FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', nativeBindings.stdlibRoot),
        ]
      ) {
        await FS.writeText(path, `${await FS.readText(path)}\n// changed input\n`)
        Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('stale')
        Expect(await CheckCache.open(cacheOptions)).toBeUndefined()
        Expect(await first!.reuse(workspaceRoot, entries)).toBeUndefined()
        Expect(await TestCache.fingerprint(fingerprintRequest)).toBeUndefined()
        await generateMaintainedNativeBindings({ ...nativeBindings, mode: 'write' })
        Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
        const regenerated = await TestCache.fingerprint(fingerprintRequest)
        Expect(regenerated).toBeDefined()
        Expect(regenerated).not.toBe(original)
      }
    })
  })

  Test('does not stamp a check whose native outputs changed after capturing its inputs', async () => {
    await withTaoFixture({ 'App/.tao/.gitkeep': '', 'App/Main.tao': 'view Main() { }\n' }, async root => {
      const nativeBindings = {
        stdlibRoot: FS.resolvePath('stdlib', root),
        sourceRoots: [FS.resolvePath('source', root)],
      }
      await copyMaintainedBindingPayload(nativeBindings.stdlibRoot, nativeBindings.sourceRoots[0])
      const workspaceRoot = FS.resolvePath('App', root)
      const cache = await CheckCache.open({ repositoryRoot: root, nativeBindings })
      Expect(cache).toBeDefined()
      await cache!.reuse(workspaceRoot, [FS.resolvePath('Main.tao', workspaceRoot)])
      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', nativeBindings.stdlibRoot)
      await FS.writeText(output, 'stale')
      await cache!.commit([{
        workspaceRoot,
        diagnostics: [],
        dependencyRoots: [],
        externalSidecarInputPaths: [],
        metadataPaths: [],
      }])
      Expect(await FS.exists(FS.resolvePath('.artifacts/tao-check-stamp.json', root))).toBe(false)
    })
  })
})
