import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { DevRuntime } from '../expo-host-src/dev-loop/DevRuntime'

Describe('Tao development runtime', () => {
  Test('copies Expo config plugins and assets beside the generated app config', async () => {
    const projectRoot = await mkTestDir('tao-dev-runtime-')
    try {
      const runtime = await DevRuntime.prepare(projectRoot)
      Expect(await FS.isFile(FS.resolvePath('plugins/with-jazz-podfile-properties.cjs', runtime.root))).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('plugins/with-ios-fmt-compat.cjs', runtime.root))).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('assets/tao-app-icon.png', runtime.root))).toBe(true)
    } finally {
      await FS.remove(projectRoot)
    }
  })
})
