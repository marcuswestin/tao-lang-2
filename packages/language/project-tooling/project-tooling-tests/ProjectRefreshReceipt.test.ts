import { Workspace } from '@compiler/workspace'
import { FS } from '@shared'
import { Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { ProjectRefreshReceipt } from '../project-tooling-src/ProjectRefreshReceipt'
import type { ProjectToolingResult, ProjectToolingWatch } from '../project-tooling-src/ProjectTooling'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

const validationSlot = testOverrideSlot({
  read: () => Workspace.prototype.validateFiles,
  write: value => {
    Workspace.prototype.validateFiles = value
  },
})
const auditSlot = testOverrideSlot({
  read: () => ProjectRefreshReceipt.prototype.audit,
  write: value => {
    ProjectRefreshReceipt.prototype.audit = value
  },
})
const rememberSlot = testOverrideSlot({
  read: () => ProjectRefreshReceipt.prototype.remember,
  write: value => {
    ProjectRefreshReceipt.prototype.remember = value
  },
})

const systemFileExistsSlot = testOverrideSlot({
  read: () => ts.sys.fileExists,
  write: value => {
    ts.sys.fileExists = value
  },
})

function semanticResult(result: ProjectToolingResult) {
  const { revision: _revision, changedOutputPaths: _changed, ...semantic } = result
  return semantic
}

async function warmReceipt(watch: ProjectToolingWatch, previous?: ProjectToolingResult): Promise<ProjectToolingResult> {
  previous ??= await watch.requestRefresh()
  for (let index = 0; index < 4; index += 1) {
    const current = await watch.requestRefresh()
    if (current.revision === previous.revision) {
      return current
    }
    previous = current
  }
  Expect('a stable fresh watch must reuse its completed revision').toBe('receipt reused')
  return previous
}

Describe('watched project refresh receipts', () => {
  Test(
    'skips the complete validated graph for matching saves, preserves cold parity, and releases on disposal',
    async () => {
      await withTaoFiles('tao-refresh-receipt-reuse-', {
        'Main.tao': 'use Stack from @tao/ui\ntype Answer is one of One, Two\n',
      }, async (_paths, root) => {
        const original = Workspace.prototype.validateFiles
        let validations = 0
        const restore = validationSlot.install(async function(this: Workspace, paths) {
          if (paths.some(path => FS.pathIsWithin(path, root))) {
            validations += 1
          }
          return await original.call(this, paths)
        })
        const watches: ProjectToolingWatch[] = []
        try {
          const watch = await ProjectTooling.watch(root, {})
          watches.push(watch)
          const warm = await warmReceipt(watch)
          Expect(warm.status).toBe('fresh')
          Expect(warm.diagnostics.some(diagnostic => diagnostic.severity === 'warning')).toBe(true)
          Expect(warm.diagnostics.every(diagnostic => diagnostic.severity !== 'error')).toBe(true)
          Expect(warm.contractPaths).toEqual([FS.resolvePath('.tao-ts/Main.tao.ts', root)])
          const count = validations
          Expect(count).toBeGreaterThan(0)
          for (let index = 0; index < 3; index += 1) {
            const reused = await watch.requestRefresh()
            Expect(reused.revision).toBe(warm.revision)
            Expect(reused.changedOutputPaths).toEqual([])
            Expect(semanticResult(reused)).toEqual(semanticResult(warm))
          }
          Expect(validations).toBe(count)
          const forced = await watch.requestRefresh({ force: true })
          Expect(forced.revision).toBeGreaterThan(warm.revision)
          Expect(validations).toBeGreaterThan(count)
          Expect(semanticResult(forced)).toEqual(semanticResult(warm))
          Expect(semanticResult(await ProjectTooling.refresh(root, {}))).toEqual(semanticResult(warm))

          await watch.dispose()
          await watch.dispose()
          await Expect(watch.requestRefresh()).rejects.toThrow('disposed')
          const beforeReopen = validations
          const reopened = await ProjectTooling.watch(root, {})
          watches.push(reopened)
          Expect(reopened.lastResult.revision).toBeGreaterThan(forced.revision)
          Expect(validations).toBeGreaterThan(beforeReopen)
        } finally {
          await Promise.all(watches.map(watch => watch.dispose()))
          restore()
        }
      }, { location: 'host' })
    },
  )

  for (const group of ['source and config', 'ownership', 'lock', 'package topology', 'publication'] as const) {
    Test(`invalidates saved ${group} inputs and preserves authoritative cold parity`, async () => {
      await withTaoFiles('tao-refresh-receipt-inputs-', {
        'Main.tao': 'type Answer is one of One, Two\n',
        'Nested/Value.ts': 'export const value = 1\n',
      }, async (paths, root) => {
        const watch = await ProjectTooling.watch(root, {})
        try {
          let previous = await warmReceipt(watch)
          const contract = FS.resolvePath('.tao-ts/Main.tao.ts', root)
          const savedContract = await FS.readText(contract)
          const mutations = {
            'source and config': [
              [paths['Main.tao'], 'function Answer( {\n', 'stale'],
              [
                FS.resolvePath('tsconfig.json', root),
                '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"strict":false}}\n',
                'stale',
              ],
            ],
            ownership: [
              [
                FS.resolvePath('Nested/.tao/store/project.json', root),
                '{"id":"11111111-1111-4111-8111-111111111111"}\n',
                'fresh',
              ],
            ],
            lock: [[FS.resolvePath('.tao/store/lock.jsonc', root), '{broken', 'stale']],
            'package topology': [[FS.resolvePath('package.json', root), '{"name":"changed-topology"}\n', 'fresh']],
            publication: [
              [contract, '// Generated by Tao.\nexport const corrupted: number = "wrong"\n', 'fresh'],
              [FS.resolvePath('.tao/cache/typescript/tsconfig.json', root), '{}\n', 'fresh'],
              [FS.resolvePath('.tao/cache/typescript/outputs.json', root), '{"version":1,"outputs":[]}\n', 'fresh'],
            ],
          } as const
          for (const [path, content, status] of mutations[group]) {
            const saved = await FS.isFile(path) ? await FS.readText(path) : undefined
            await FS.writeText(path, content)
            const changed = await watch.requestRefresh()
            Expect(changed.revision).toBeGreaterThan(previous.revision)
            Expect(changed.status).toBe(status)
            Expect(semanticResult(changed)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
            if (path === contract) {
              Expect(changed.changedOutputPaths).toContain(contract)
              Expect(await FS.readText(contract)).toBe(savedContract)
            }
            if (saved === undefined) {
              await FS.remove(path)
              if (path.includes('Nested/.tao/')) {
                await FS.remove(FS.resolvePath('Nested/.tao', root))
              }
            } else {
              await FS.writeText(path, saved)
            }
            const repaired = await watch.requestRefresh({ force: true })
            Expect(repaired.status).toBe('fresh')
            previous = await warmReceipt(watch, repaired)
          }
          if (group === 'publication') {
            await FS.remove(contract)
            const missingOutput = await watch.requestRefresh()
            Expect(missingOutput.revision).toBeGreaterThan(previous.revision)
            Expect(missingOutput.changedOutputPaths).toContain(contract)
            Expect(await FS.readText(contract)).toBe(savedContract)
          }
        } finally {
          await watch.dispose()
        }
      }, { location: 'host' })
    })
  }

  Test('replays internal sidecar resolution and recovers a newly missing relative target', async () => {
    await withTaoFiles('tao-refresh-receipt-sidecars-', {
      'Main.tao': 'function CountWords(Value text) returns number { return CountWords(Value) from ./Words.ts }\n',
      'Words.ts': "import { count } from './Helper'\nexport const CountWords = count\n",
      'Helper.js': 'export function count(value) { return value.length }\n',
      'tsconfig.json':
        '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"noImplicitAny":false}}\n',
    }, async (paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      try {
        const first = await warmReceipt(watch)
        await FS.writeText(
          FS.resolvePath('Helper.ts', root),
          'export function count(value: string): string { return value }\n',
        )
        const higherPriority = await watch.requestRefresh()
        Expect(higherPriority.revision).toBeGreaterThan(first.revision)
        Expect(higherPriority.status).toBe('stale')
        Expect(higherPriority.diagnostics.some(diagnostic => diagnostic.code === 'TS2344')).toBe(true)
        Expect(semanticResult(higherPriority)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
        await FS.remove(FS.resolvePath('Helper.ts', root))
        await FS.remove(paths['Helper.js'])
        const missing = await watch.requestRefresh()
        Expect(missing.status).toBe('stale')
        Expect(missing.diagnostics.some(diagnostic => diagnostic.message.includes('could not be resolved'))).toBe(true)
        await FS.writeText(
          FS.resolvePath('Helper.ts', root),
          'export function count(value: string): number { return value.length }\n',
        )
        const repaired = await watch.requestRefresh()
        Expect(repaired.status).toBe('fresh')
        Expect(repaired.revision).toBeGreaterThan(missing.revision)
        Expect((await warmReceipt(watch)).status).toBe('fresh')
      } finally {
        await watch.dispose()
      }
    }, { location: 'host' })
  })

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
  })

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
  })

  Test('rejects an ABA source read whose parsed text differs from both filesystem audits', async () => {
    await withTaoFiles('tao-refresh-receipt-raced-parse-', {
      'Main.tao': 'type Original is one of One, Two\n',
    }, async (paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      const original = Workspace.prototype.validateFiles
      const saved = await FS.readText(paths['Main.tao'])
      await warmReceipt(watch)
      let raced = false
      const restore = validationSlot.install(async function(this: Workspace, entries) {
        if (!raced && entries.includes(paths['Main.tao'])) {
          raced = true
          await FS.writeText(paths['Main.tao'], 'type Interleaved is one of Changed, Value\n')
          try {
            return await original.call(this, entries)
          } finally {
            await FS.writeText(paths['Main.tao'], saved)
          }
        }
        return await original.call(this, entries)
      })
      try {
        await warmReceipt(watch)
        // Warm-up must not trigger the race: force explicitly enters the parsed graph.
        Expect(raced).toBe(false)
        const interleaved = await watch.requestRefresh({ force: true })
        Expect(raced).toBe(true)
        Expect(interleaved.status).toBe('fresh')
        const corrected = await watch.requestRefresh()
        Expect(corrected.revision).toBeGreaterThan(interleaved.revision)
        Expect(corrected.status).toBe('fresh')
        const content = await FS.readText(corrected.contractPaths[0]!)
        Expect(content).toContain('Original')
        Expect(content).not.toContain('Interleaved')
        Expect(semanticResult(corrected)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        restore()
        await watch.dispose()
      }
    }, { location: 'host' })
  })

  Test('audits selected dependency source and repairs its copied snapshot independently of contracts', async () => {
    await withTaoFiles('tao-refresh-receipt-dependency-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Widget Package" version 2.0.0 includes @widgets }\n',
      'Library/@widgets/Widget.tao':
        'public function CountWords(Value text) returns number { return CountWords(Value) from ./Words.ts }\n',
      'Library/@widgets/Words.ts':
        "import { suffix } from './Helper'\nexport function CountWords(value: string): number { return (value + suffix).length }\n",
      'Library/@widgets/Helper.ts': "export const suffix = '!'\n",
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao':
        'use CountWords from @parts\npackage { version 0.1.0 requires "Widget Package" from ../Library version ^2.0.0 { @widgets as @parts } }\n',
    }, async (paths, fixture) => {
      const root = FS.resolvePath('Consumer', fixture)
      const watch = await ProjectTooling.watch(root, {})
      try {
        let warm = await watch.requestRefresh()
        Expect(warm.dependencyRoots).toEqual([FS.resolvePath('Library', fixture)])
        const snapshots: string[] = []
        for await (const path of FS.walk(FS.resolvePath('.tao-ts/.dependencies', root), { includeHidden: true })) {
          if (path.endsWith('/Helper.ts')) {
            snapshots.push(path)
          }
        }
        Expect(snapshots).toHaveLength(1)
        const snapshot = snapshots[0]!
        const originalSnapshot = await FS.readText(snapshot)
        await FS.writeText(
          snapshot,
          '// Generated by Tao from a dependency source.\nexport const suffix = "corrupted"\n',
        )
        const repaired = await watch.requestRefresh()
        Expect(repaired.revision).toBeGreaterThan(warm.revision)
        Expect(repaired.changedOutputPaths).toContain(snapshot)
        Expect(await FS.readText(snapshot)).toBe(originalSnapshot)
        warm = await watch.requestRefresh()
        await FS.writeText(paths['Library/@widgets/Helper.ts'], 'export const suffix = "changed"\n')
        const changed = await watch.requestRefresh()
        Expect(changed.revision).toBeGreaterThan(warm.revision)
        Expect(changed.status).toBe('fresh')
        Expect(changed.changedOutputPaths).toContain(snapshot)
        Expect(await FS.readText(snapshot)).toContain('"changed"')
        Expect(semanticResult(changed)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        await watch.dispose()
      }
    }, { location: 'host', verbatim: true })
  })

  Test('keeps external sidecars on the authoritative cold resolution path', async () => {
    await withTaoFiles('tao-refresh-receipt-external-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.tao': 'view Widget() from ../Host/Widget.tsx\n',
      'Host/Widget.tsx': 'export function Widget() { return null }\n',
    }, async (_paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const watch = await ProjectTooling.watch(root, {})
      try {
        const first = await watch.requestRefresh()
        const second = await watch.requestRefresh()
        Expect(first.status).toBe('fresh')
        Expect(second.status).toBe('fresh')
        Expect(second.revision).toBeGreaterThan(first.revision)
        Expect(second.externalSidecarInputPaths).toEqual([FS.resolvePath('Host/Widget.tsx', fixture)])
        Expect(semanticResult(second)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        await watch.dispose()
      }
    }, { location: 'host', verbatim: true })
  })

  Test('rejects ABA ownership discovery that omitted an authored contract between equal disk audits', async () => {
    await withTaoFiles('tao-refresh-receipt-raced-ownership-', {
      'Main.tao': 'type MainAnswer is one of One, Two\n',
      'Nested/Extra.tao': 'type ExtraAnswer is one of One, Two\n',
    }, async (_paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      await warmReceipt(watch)
      const extraContract = FS.resolvePath('.tao-ts/Nested/Extra.tao.ts', root)
      Expect(watch.lastResult.contractPaths).toContain(extraContract)
      const marker = FS.resolvePath('Nested/.tao', root)
      const originalAudit = ProjectRefreshReceipt.prototype.audit
      const originalValidation = Workspace.prototype.validateFiles
      let arm = true
      let markerAdded = false
      let markerRemoved = false
      const restoreAudit = auditSlot.install(
        async function(this: ProjectRefreshReceipt, options, force, nativeIdentity) {
          const audit = await originalAudit.call(this, options, force, nativeIdentity)
          if (arm) {
            arm = false
            await FS.mkdir(marker)
            markerAdded = true
          }
          return audit
        },
      )
      const restoreValidation = validationSlot.install(async function(this: Workspace, entries) {
        if (markerAdded && !markerRemoved) {
          await FS.remove(marker)
          markerRemoved = true
        }
        return await originalValidation.call(this, entries)
      })
      try {
        const omitted = await watch.requestRefresh({ force: true })
        Expect(markerAdded).toBe(true)
        Expect(markerRemoved).toBe(true)
        Expect(omitted.status).toBe('fresh')
        Expect(omitted.contractPaths).not.toContain(extraContract)
        const restored = await watch.requestRefresh()
        Expect(restored.revision).toBeGreaterThan(omitted.revision)
        Expect(restored.status).toBe('fresh')
        Expect(restored.contractPaths).toContain(extraContract)
        Expect(await FS.isFile(extraContract)).toBe(true)
        Expect(semanticResult(restored)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        restoreValidation()
        restoreAudit()
        await watch.dispose()
      }
    }, { location: 'host' })
  })

  Test('revalidates identity after an invalid-valid-invalid marker race during a cold refresh', async () => {
    await withTaoFiles('tao-refresh-receipt-raced-identity-', {
      '.tao/.gitkeep': '',
      'Main.ts': 'export const value: number = 1\n',
    }, async (_paths, root) => {
      const watch = await ProjectTooling.watch(root, {})
      await warmReceipt(watch)
      const identity = FS.resolvePath('.tao/store/project.json', root)
      const valid = await FS.readText(identity)
      const invalid = '{"id":"invalid"}\n'
      const originalAudit = ProjectRefreshReceipt.prototype.audit
      const originalRemember = ProjectRefreshReceipt.prototype.remember
      let arm = true
      let validated = false
      const restoreAudit = auditSlot.install(
        async function(this: ProjectRefreshReceipt, options, force, nativeIdentity) {
          if (arm && force) {
            arm = false
            await FS.writeText(identity, invalid)
            const audit = await originalAudit.call(this, options, force, nativeIdentity)
            await FS.writeText(identity, valid)
            validated = true
            return audit
          }
          return await originalAudit.call(this, options, force, nativeIdentity)
        },
      )
      const restoreRemember = rememberSlot.install(async function(this: ProjectRefreshReceipt, before, options, data) {
        await FS.writeText(identity, invalid)
        return await originalRemember.call(this, before, options, data)
      })
      try {
        const raced = await watch.requestRefresh({ force: true })
        Expect(validated).toBe(true)
        Expect(raced.diagnostics).toEqual([])
        Expect(raced.status).toBe('fresh')
        Expect(await FS.readText(identity)).toBe(invalid)
        const rejected = await watch.requestRefresh()
        Expect(rejected.revision).toBeGreaterThan(raced.revision)
        Expect(rejected.status).toBe('stale')
        Expect(rejected.diagnostics.some(diagnostic => diagnostic.message.includes('Invalid Tao project identity')))
          .toBe(true)
        Expect(semanticResult(rejected)).toEqual(semanticResult(await watch.requestRefresh({ force: true })))
      } finally {
        restoreRemember()
        restoreAudit()
        await watch.dispose()
      }
    }, { location: 'host' })
  })
})
