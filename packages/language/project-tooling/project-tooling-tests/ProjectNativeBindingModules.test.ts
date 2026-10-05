import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { hostModulePaths } from '../project-tooling-src/ProjectHostModules'

Describe('maintained native declaration resolution', () => {
  Test('uses bundled declarations before installation and keeps ordinary host and project priority', async () => {
    const root = await mkTestDir('tao-native-module-paths-')
    try {
      const stdlibRoot = FS.resolvePath('stdlib', root)
      const bundled = FS.resolvePath('.tao-ts/native-bindings/files/inputs/node_modules/native-fixture', stdlibRoot)
      const projectRoot = FS.resolvePath('consumer', root)
      const hostModulesRoot = FS.resolvePath('host/node_modules', root)
      const manifest = { name: 'native-fixture', version: '1.0.0', types: 'index.d.ts' }
      await FS.writeJson(FS.resolvePath('package.json', bundled), manifest)
      await FS.writeText(FS.resolvePath('index.d.ts', bundled), 'export declare const value: "bundled"\n')
      const options = { hostModulesRoot, nativeBindings: { stdlibRoot } }
      const beforeInstall = await hostModulePaths(projectRoot, options)
      Expect(beforeInstall['native-fixture']).toEqual([FS.resolvePath('index.d.ts', bundled)])
      const host = FS.resolvePath('native-fixture', hostModulesRoot)
      await FS.writeJson(FS.resolvePath('package.json', host), manifest)
      await FS.writeText(FS.resolvePath('index.d.ts', host), 'export declare const value: "host"\n')
      const afterHost = await hostModulePaths(projectRoot, options)
      Expect(afterHost['native-fixture']).toEqual([FS.resolvePath('index.d.ts', host)])
      const project = FS.resolvePath('node_modules/native-fixture', projectRoot)
      await FS.writeJson(FS.resolvePath('package.json', project), manifest)
      await FS.writeText(FS.resolvePath('index.d.ts', project), 'export declare const value: "project"\n')
      const afterProject = await hostModulePaths(projectRoot, options)
      Expect(afterProject['native-fixture']).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })
})
