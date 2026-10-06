import { FS } from '@shared'
import { Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import type { ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'
import { semanticResult, warmReceipt } from './ProjectRefreshReceiptTestSupport'

const systemFileExistsSlot = testOverrideSlot({
  read: () => ts.sys.fileExists,
  write: value => {
    ts.sys.fileExists = value
  },
})
Describe('watched project refresh receipt host integration', () => {
  Test('rediscovers unused host packages and validates unused declared installs on each reuse attempt', async () => {
    await withTaoFiles('tao-refresh-receipt-installs-', {
      'Project/Main.tao': 'package { version 0.1.0 requires ts npm:real-util version ^2.0.0 as util }\n',
      'Project/.tao/.gitkeep': '',
      'Project/node_modules/util/package.json': '{"name":"real-util","version":"2.1.0"}\n',
      'Host/node_modules/.gitkeep': '',
    }, async (paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const hostModulesRoot = FS.resolvePath('Host/node_modules', fixture)
      const watch = await ProjectTooling.watch(root, { hostModulesRoot })
      try {
        let warm = await warmReceipt(watch)
        await FS.writeText(
          FS.resolvePath('new-peer/package.json', hostModulesRoot),
          '{"name":"new-peer","types":"index.d.ts"}\n',
        )
        await FS.writeText(FS.resolvePath('new-peer/index.d.ts', hostModulesRoot), 'export const value: number\n')
        const addedHost = await watch.requestRefresh()
        Expect(addedHost.revision).toBeGreaterThan(warm.revision)
        Expect(addedHost.status).toBe('fresh')
        const base = await FS.readJson<{ compilerOptions: { paths: Record<string, string[]> } }>(
          FS.resolvePath('.tao/cache/typescript/tsconfig.json', root),
        )
        Expect(base.compilerOptions.paths['new-peer']).toEqual([FS.resolvePath('new-peer/index.d.ts', hostModulesRoot)])
        warm = await warmReceipt(watch)
        await FS.writeText(paths['Project/node_modules/util/package.json'], '{"name":"real-util","version":"3.0.0"}\n')
        const wrongInstall = await watch.requestRefresh()
        Expect(wrongInstall.revision).toBeGreaterThan(warm.revision)
        Expect(wrongInstall.status).toBe('stale')
        Expect(wrongInstall.diagnostics.some(diagnostic => diagnostic.message.includes('requires ^2.0.0'))).toBe(true)
        Expect(semanticResult(wrongInstall)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        await watch.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 180_000)

  Test(
    'host mapping reuse belongs to live watches and drops on force, standalone refresh, and final disposal',
    async () => {
      await withTaoFiles('tao-refresh-receipt-host-lifetime-', {
        'Project/Main.tao': 'type Answer is one of One, Two\n',
        'Project/.tao/.gitkeep': '',
        'Host/node_modules/tao-watch-peer/package.json':
          '{"name":"tao-watch-peer","exports":{".":{"types":"./index.d.ts"}}}\n',
        'Host/node_modules/tao-watch-peer/index.d.ts': 'export declare const value: number\n',
      }, async (_paths, fixture) => {
        const root = FS.resolvePath('Project', fixture)
        const options = { hostModulesRoot: FS.resolvePath('Host/node_modules', fixture) }
        const manifestPath = FS.resolvePath('Host/node_modules/tao-watch-peer/package.json', fixture)
        let manifestProbes = 0
        const originalFileExists = ts.sys.fileExists
        const restoreFileExists = systemFileExistsSlot.install(path => {
          if (FS.resolvePath(path) === manifestPath) {
            manifestProbes += 1
          }
          return originalFileExists(path)
        })
        const watches: ProjectToolingWatch[] = []
        const expectReused = () => {
          // The alias audit checks this distinct input once; the cold native resolver
          // also probes the manifest after enumeration has checked its existence.
          Expect(manifestProbes).toBe(1)
          manifestProbes = 0
        }
        const expectCold = () => {
          Expect(manifestProbes).toBeGreaterThan(1)
          manifestProbes = 0
        }
        try {
          const first = await ProjectTooling.watch(root, options)
          watches.push(first)
          const second = await ProjectTooling.watch(root, options)
          watches.push(second)
          await warmReceipt(second)
          manifestProbes = 0
          await first.requestRefresh()
          expectReused()
          await first.dispose()
          await second.requestRefresh()
          expectReused()
          await second.requestRefresh({ force: true })
          expectCold()
          await ProjectTooling.refresh(root, options)
          expectCold()
          await second.requestRefresh()
          expectReused()
          await second.dispose()
          const reopened = await ProjectTooling.watch(root, options)
          watches.push(reopened)
          expectCold()
        } finally {
          await Promise.all(watches.map(watch => watch.dispose()))
          restoreFileExists()
        }
      }, { location: 'host', verbatim: true })
    },
    180_000,
  )

  Test('a declaration edit refreshes native diagnostics while retaining the same host export alias', async () => {
    await withTaoFiles('tao-refresh-receipt-host-declaration-', {
      'Project/Main.tao': 'type Answer is one of One, Two\n',
      'Project/Main.ts': "import { value } from 'tao-watch-peer'\nexport const output: number = value\n",
      'Project/.tao/.gitkeep': '',
      'Host/node_modules/tao-watch-peer/package.json':
        '{"name":"tao-watch-peer","exports":{".":{"types":"./index.d.ts"}}}\n',
      'Host/node_modules/tao-watch-peer/index.d.ts': 'export declare const value: number\n',
    }, async (paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const hostModulesRoot = FS.resolvePath('Host/node_modules', fixture)
      const watch = await ProjectTooling.watch(root, { hostModulesRoot })
      try {
        const warm = await warmReceipt(watch)
        Expect(warm.status).toBe('fresh')
        const configPath = FS.resolvePath('.tao/cache/typescript/tsconfig.json', root)
        const savedConfig = await FS.readText(configPath)
        await FS.writeText(paths['Host/node_modules/tao-watch-peer/index.d.ts'], 'export declare const value: string\n')
        const changed = await watch.requestRefresh()
        Expect(changed.revision).toBeGreaterThan(warm.revision)
        Expect(changed.status).toBe('stale')
        Expect(changed.diagnostics.some(diagnostic => diagnostic.code === 'TS2322')).toBe(true)
        Expect(await FS.readText(configPath)).toBe(savedConfig)
        Expect(semanticResult(changed)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
        await FS.writeText(paths['Host/node_modules/tao-watch-peer/index.d.ts'], 'export declare const value: number\n')
        Expect((await warmReceipt(watch)).status).toBe('fresh')
      } finally {
        await watch.dispose()
      }
    }, { location: 'host', verbatim: true })
  }, 180_000)
})
