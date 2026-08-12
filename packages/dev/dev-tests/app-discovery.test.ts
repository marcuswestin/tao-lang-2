import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { discoverSwitchableAppPaths } from '../dev-src/dev-loop/AppDiscovery'

Describe('dev loop app discovery', () => {
  Test('prioritizes a canonical Current app family before switch-menu truncation', async () => {
    const appsRoot = await mkTestDir('tao-dev-app-discovery-')
    try {
      await FS.writeText(FS.resolvePath('TestApps', appsRoot), '')
      for (let index = 1; index <= 9; index += 1) {
        const appName = `Test App ${index}`
        await FS.writeText(FS.resolvePath(`Test Apps/${appName}/${appName}.tao`, appsRoot), '')
      }

      const appPaths = await discoverSwitchableAppPaths(appsRoot)

      Expect(appPaths).toHaveLength(9)
      Expect(FS.relativePath(appsRoot, appPaths[0]!)).toBe('Test Apps/Test App 1/Test App 1.tao')
    } finally {
      await FS.remove(appsRoot)
    }
  })
})
